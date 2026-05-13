"""Garmin Connect data fetcher — pulls and caches 90 days of health data.

All public functions accept an explicit user_id so there is zero reliance on
ContextVar for routing.  This guarantees that two users syncing simultaneously
never touch each other's database or Garmin client.
"""
import logging
from datetime import date, timedelta, datetime
from pathlib import Path
from typing import Optional

from garminconnect import Garmin
from database import db, DB_DIR

logger = logging.getLogger(__name__)

# Per-user Garmin clients  {user_id: Garmin | None}
_clients: dict[str, Optional[Garmin]] = {}


def _token_path(user_id: str) -> Path:
    p = DB_DIR / f"garmin_tokens_{user_id}"
    p.mkdir(parents=True, exist_ok=True)
    return p


# ── Credential helpers ────────────────────────────────────────────────────────

def get_stored_credentials(user_id: str) -> Optional[tuple[str, str]]:
    """Return (email, password) from this user's own DB only."""
    with db(user_id) as conn:
        row = conn.execute(
            "SELECT garmin_email, garmin_password FROM credentials WHERE id=1"
        ).fetchone()
        if row:
            return row[0], row[1]
    return None


def reset_client(user_id: str) -> None:
    """Clear the cached Garmin client for user_id (forces re-login on next call)."""
    _clients[user_id] = None


def get_client(user_id: str) -> Garmin:
    """Return a live, authenticated Garmin client for user_id."""
    if not _clients.get(user_id):
        creds = get_stored_credentials(user_id)
        if not creds:
            raise RuntimeError(
                f"No Garmin credentials configured for user '{user_id}'."
            )
        email, password = creds
        client = Garmin(email, password)
        tp = _token_path(user_id)
        try:
            client.login(str(tp))
            logger.info(f"[{user_id}] Garmin session resumed from token")
        except Exception:
            logger.info(f"[{user_id}] No saved session — doing full Garmin login")
            client.login()
        logger.info(f"[{user_id}] Garmin client ready (email: {email})")
        _clients[user_id] = client
    return _clients[user_id]


def test_credentials(email: str, password: str, user_id: str) -> Garmin:
    """Attempt a login with the given credentials, save session token.
    Returns the authenticated client on success; raises on failure."""
    tp = _token_path(user_id)
    client = Garmin(email, password)
    client.login(str(tp))
    logger.info(f"[{user_id}] Garmin credentials verified and session saved (email: {email})")
    return client


# ── Sync entry-point ──────────────────────────────────────────────────────────

def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def sync_all(user_id: str, days: int = 90):
    """Pull all health data for user_id from Garmin Connect."""
    client = get_client(user_id)
    end   = date.today()
    start = end - timedelta(days=days)

    _sync_user_profile(client, user_id)
    _sync_sleep(client, user_id, start, end)
    _sync_hrv(client, user_id, start, end)
    _sync_body_battery(client, user_id, start, end)
    _sync_stress(client, user_id, start, end)
    _sync_steps(client, user_id, start, end)
    _sync_activities(client, user_id, start, end)
    _backfill_strain(user_id, start, end)

    with db(user_id) as conn:
        conn.execute(
            "INSERT INTO sync_log (status, message) VALUES (?, ?)",
            ("ok", f"Synced {days} days ending {end}"),
        )
    logger.info(f"[{user_id}] Full sync complete")


def _backfill_strain(user_id: str, start: date, end: date):
    from database import _current_user
    from metrics import calc_strain_score

    # metrics.py still uses ContextVar internally — set it here so all metric
    # calls route to the right DB within this thread.
    _current_user.set(user_id)

    d = start
    while d <= end:
        try:
            calc_strain_score(d)
        except Exception as e:
            logger.debug(f"[{user_id}] Strain backfill {d}: {e}")
        d += timedelta(days=1)
    logger.info(f"[{user_id}] Strain backfilled {start} → {end}")


# ── Internal sync helpers (all accept user_id explicitly) ────────────────────

def _sync_user_profile(client: Garmin, user_id: str):
    try:
        profile = client.get_user_profile()
        age = profile.get("age") or _calc_age(profile.get("birthDate"))
        weight = profile.get("weight", 0) / 1000 if profile.get("weight") else None
        height = profile.get("height")
        vo2 = None
        try:
            vo2data = client.get_max_metrics(date.today().isoformat())
            if vo2data:
                vo2 = vo2data[0].get("generic", {}).get("vo2MaxValue")
        except Exception:
            pass

        max_hr_recorded = _get_max_recorded_hr(user_id)

        with db(user_id) as conn:
            conn.execute("""
                INSERT INTO user_profile (id, age, weight_kg, height_cm, max_hr_recorded, vo2max, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    age=excluded.age, weight_kg=excluded.weight_kg, height_cm=excluded.height_cm,
                    max_hr_recorded=excluded.max_hr_recorded, vo2max=excluded.vo2max,
                    updated_at=excluded.updated_at
            """, (age, weight, height, max_hr_recorded, vo2))
    except Exception as e:
        logger.warning(f"[{user_id}] Profile sync error: {e}")


def _calc_age(birth_date_str: Optional[str]) -> Optional[int]:
    if not birth_date_str:
        return None
    try:
        bd = datetime.strptime(birth_date_str, "%Y-%m-%d").date()
        today = date.today()
        return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    except Exception:
        return None


def _get_max_recorded_hr(user_id: str) -> Optional[int]:
    with db(user_id) as conn:
        row = conn.execute(
            "SELECT MAX(max_hr) FROM activities WHERE max_hr IS NOT NULL"
        ).fetchone()
        return row[0] if row else None


def _sync_sleep(client: Garmin, user_id: str, start: date, end: date):
    for d in daterange(start, end):
        try:
            raw = client.get_sleep_data(d.isoformat())
            daily = raw.get("dailySleepDTO", {})
            if not daily:
                continue

            if d >= end - timedelta(days=1):
                logger.info(
                    f"[{user_id}] Sleep {d}: "
                    f"sleepTimeSeconds={daily.get('sleepTimeSeconds')} "
                    f"deep={daily.get('deepSleepSeconds')} "
                    f"rem={daily.get('remSleepSeconds')} "
                    f"light={daily.get('lightSleepSeconds')} "
                    f"awake={daily.get('awakeSleepSeconds')}"
                )

            deep  = daily.get("deepSleepSeconds",  0) or 0
            rem   = daily.get("remSleepSeconds",    0) or 0
            light = daily.get("lightSleepSeconds",  0) or 0
            awake = daily.get("awakeSleepSeconds",  0) or 0
            total = (
                daily.get("sleepTimeSeconds")
                or daily.get("totalSleepSeconds")
                or (deep + rem + light)
            )
            efficiency = (
                daily.get("sleepScores", {}).get("sleepEfficiency")
                or daily.get("sleepEfficiency")
            )
            if not efficiency and total and (deep + rem + light + awake) > 0:
                efficiency = round((deep + rem + light) / (deep + rem + light + awake) * 100)
            efficiency = efficiency or 0

            hrv_summary = raw.get("hrvSummary") or {}
            hrv = (
                hrv_summary.get("lastNight")
                or hrv_summary.get("lastNight5MinHigh")
                or daily.get("averageHRV")
            )
            rhr      = daily.get("restingHeartRate")
            start_ts = daily.get("sleepStartTimestampGMT")
            end_ts   = daily.get("sleepEndTimestampGMT")

            with db(user_id) as conn:
                conn.execute("""
                    INSERT INTO sleep (
                        date, total_sleep_seconds, efficiency, deep_sleep_seconds,
                        rem_sleep_seconds, light_sleep_seconds, awake_seconds,
                        hrv_overnight, resting_hr, sleep_start, sleep_end
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(date) DO UPDATE SET
                        total_sleep_seconds=excluded.total_sleep_seconds,
                        efficiency=excluded.efficiency,
                        deep_sleep_seconds=excluded.deep_sleep_seconds,
                        rem_sleep_seconds=excluded.rem_sleep_seconds,
                        light_sleep_seconds=excluded.light_sleep_seconds,
                        awake_seconds=excluded.awake_seconds,
                        hrv_overnight=excluded.hrv_overnight,
                        resting_hr=excluded.resting_hr,
                        sleep_start=excluded.sleep_start,
                        sleep_end=excluded.sleep_end
                """, (
                    d.isoformat(), total, efficiency, deep, rem, light, awake, hrv, rhr,
                    str(start_ts) if start_ts else None,
                    str(end_ts)   if end_ts   else None,
                ))
        except Exception as e:
            logger.debug(f"[{user_id}] Sleep sync {d}: {e}")


def _sync_hrv(client: Garmin, user_id: str, start: date, end: date):
    for d in daterange(start, end):
        try:
            raw     = client.get_hrv_data(d.isoformat())
            summary = raw.get("hrvSummary", {})
            val     = summary.get("lastNight") or summary.get("weeklyAvg")
            status  = summary.get("status")
            if val is None:
                continue
            with db(user_id) as conn:
                conn.execute("""
                    INSERT INTO hrv (date, hrv_value, hrv_status)
                    VALUES (?, ?, ?)
                    ON CONFLICT(date) DO UPDATE SET
                        hrv_value=excluded.hrv_value,
                        hrv_status=excluded.hrv_status
                """, (d.isoformat(), val, status))
        except Exception as e:
            logger.debug(f"[{user_id}] HRV sync {d}: {e}")


def _sync_body_battery(client: Garmin, user_id: str, start: date, end: date):
    try:
        for d in daterange(start, end):
            data = client.get_body_battery(d.isoformat(), d.isoformat())
            if not data:
                continue
            readings  = data[0].get("bodyBatteryValuesArray", [])
            start_val = readings[0][-1]  if readings else None
            end_val   = readings[-1][-1] if readings else None
            with db(user_id) as conn:
                conn.execute("""
                    INSERT INTO body_battery (date, start_value, end_value)
                    VALUES (?, ?, ?)
                    ON CONFLICT(date) DO UPDATE SET
                        start_value=excluded.start_value,
                        end_value=excluded.end_value
                """, (d.isoformat(), start_val, end_val))
    except Exception as e:
        logger.warning(f"[{user_id}] Body battery sync error: {e}")


def _sync_stress(client: Garmin, user_id: str, start: date, end: date):
    for d in daterange(start, end):
        try:
            data = client.get_stress_data(d.isoformat())
            avg  = data.get("avgStressLevel")
            if avg is None:
                continue
            with db(user_id) as conn:
                conn.execute("""
                    INSERT INTO stress (date, avg_stress)
                    VALUES (?, ?)
                    ON CONFLICT(date) DO UPDATE SET avg_stress=excluded.avg_stress
                """, (d.isoformat(), avg))
        except Exception as e:
            logger.debug(f"[{user_id}] Stress sync {d}: {e}")


def _sync_steps(client: Garmin, user_id: str, start: date, end: date):
    for d in daterange(start, end):
        try:
            summary    = client.get_user_summary(d.isoformat())
            steps      = summary.get("totalSteps")
            active_cal = summary.get("activeKilocalories") or summary.get("totalKilocalories", 0)
            total_cal  = summary.get("totalKilocalories")
            rhr        = summary.get("restingHeartRate")
            with db(user_id) as conn:
                conn.execute("""
                    INSERT INTO steps (date, steps, active_calories, total_calories, resting_hr)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(date) DO UPDATE SET
                        steps=excluded.steps,
                        active_calories=excluded.active_calories,
                        total_calories=excluded.total_calories,
                        resting_hr=excluded.resting_hr
                """, (d.isoformat(), steps, active_cal, total_cal, rhr))
        except Exception as e:
            logger.debug(f"[{user_id}] Steps sync {d}: {e}")


def _sync_activities(client: Garmin, user_id: str, start: date, end: date):
    try:
        activities = client.get_activities_by_date(start.isoformat(), end.isoformat())
        for a in activities:
            garmin_id = str(a.get("activityId", ""))
            act_date  = (a.get("startTimeLocal") or "")[:10]
            act_type  = (a.get("activityType", {}).get("typeKey") or "other").lower()
            name      = a.get("activityName", act_type)
            duration  = int(a.get("duration", 0))
            distance  = a.get("distance")
            avg_hr    = a.get("averageHR")
            max_hr    = a.get("maxHR")
            calories  = int(a.get("calories", 0))
            te        = a.get("aerobicTrainingEffect")
            epoc      = a.get("anaerobicTrainingEffect")

            zones = {"zone1": 0, "zone2": 0, "zone3": 0, "zone4": 0, "zone5": 0}
            hr_zones = a.get("hrZones") or []
            for i, z in enumerate(hr_zones[:5]):
                zones[f"zone{i+1}"] = int(z.get("secsInZone", 0))

            with db(user_id) as conn:
                conn.execute("""
                    INSERT INTO activities (
                        garmin_id, date, type, name, duration_seconds,
                        distance_meters, avg_hr, max_hr, calories,
                        training_effect, epoc,
                        zone1_seconds, zone2_seconds, zone3_seconds,
                        zone4_seconds, zone5_seconds
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(garmin_id) DO UPDATE SET
                        zone1_seconds=excluded.zone1_seconds,
                        zone2_seconds=excluded.zone2_seconds,
                        zone3_seconds=excluded.zone3_seconds,
                        zone4_seconds=excluded.zone4_seconds,
                        zone5_seconds=excluded.zone5_seconds,
                        calories=excluded.calories,
                        avg_hr=excluded.avg_hr,
                        max_hr=excluded.max_hr
                """, (
                    garmin_id, act_date, act_type, name, duration, distance,
                    avg_hr, max_hr, calories, te, epoc,
                    zones["zone1"], zones["zone2"], zones["zone3"],
                    zones["zone4"], zones["zone5"],
                ))
    except Exception as e:
        logger.warning(f"[{user_id}] Activities sync error: {e}")
