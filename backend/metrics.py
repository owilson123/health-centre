"""
Science-backed health metric calculations.
All scoring is personal-baseline-relative using 30-day rolling history.
"""
from __future__ import annotations
import math
from datetime import date, timedelta
from typing import Optional
from database import db


# ─────────────────────────── helpers ───────────────────────────

def _clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, v))


def _rolling(conn, table: str, col: str, days: int = 30, exclude_today: bool = True) -> list[float]:
    end = date.today() - timedelta(days=1 if exclude_today else 0)
    start = end - timedelta(days=days)
    rows = conn.execute(
        f"SELECT {col} FROM {table} WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL",
        (start.isoformat(), end.isoformat())
    ).fetchall()
    return [r[0] for r in rows]


def _mean(vals: list[float]) -> Optional[float]:
    return sum(vals) / len(vals) if vals else None


def _std(vals: list[float]) -> Optional[float]:
    if len(vals) < 2:
        return None
    m = _mean(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))


def _get_profile(conn) -> dict:
    row = conn.execute("SELECT * FROM user_profile WHERE id=1").fetchone()
    if row:
        return dict(row)
    return {"age": 30, "weight_kg": 75, "height_cm": 175, "max_hr_recorded": None, "vo2max": None}


def _max_hr(profile: dict) -> int:
    formula = int(208 - 0.7 * (profile.get("age") or 30))
    recorded = profile.get("max_hr_recorded") or 0
    return max(formula, recorded)


# ─────────────────────────── sleep score ───────────────────────────

def calc_sleep_score(target_date: date = None) -> dict:
    if target_date is None:
        target_date = date.today() - timedelta(days=1)

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM sleep WHERE date=?", (target_date.isoformat(),)
        ).fetchone()

        if not row:
            return {"score": 0, "components": {}, "insight": "No sleep data available.", "data": None}

        sleep = dict(row)
        total = sleep["total_sleep_seconds"] or 1

        # 30-day baselines
        dur_hist = _rolling(conn, "sleep", "total_sleep_seconds")
        hrv_hist = _rolling(conn, "sleep", "hrv_overnight")
        rhr_hist = _rolling(conn, "sleep", "resting_hr")

        avg_dur = _mean(dur_hist) or total
        avg_hrv = _mean(hrv_hist)
        avg_rhr = _mean(rhr_hist)

        # 1. Duration (20%)
        dur_ratio = total / avg_dur
        if dur_ratio >= 1.0:
            dur_score = _clamp(100 - max(0, (dur_ratio - 1.15) * 200))
        else:
            dur_score = _clamp(dur_ratio / 1.0 * 100)

        # 2. Efficiency (15%)
        eff = sleep["efficiency"] or 0
        eff_score = _clamp((eff / 95) * 100) if eff <= 95 else 100

        # 3. Deep sleep % (20%)
        deep_pct = (sleep["deep_sleep_seconds"] or 0) / total * 100
        if 15 <= deep_pct <= 20:
            deep_score = 100.0
        elif deep_pct < 15:
            deep_score = _clamp((deep_pct / 15) * 100)
        else:
            deep_score = _clamp(100 - (deep_pct - 20) * 10)

        # 4. REM % (20%)
        rem_pct = (sleep["rem_sleep_seconds"] or 0) / total * 100
        if 20 <= rem_pct <= 25:
            rem_score = 100.0
        elif rem_pct < 20:
            rem_score = _clamp((rem_pct / 20) * 100)
        else:
            rem_score = _clamp(100 - (rem_pct - 25) * 8)

        # 5. Awake penalty (10%)
        awake_pct = (sleep["awake_seconds"] or 0) / total * 100
        awake_score = _clamp(100 - (awake_pct / 10) * 100) if awake_pct <= 10 else 0

        # 6. HRV vs baseline (10%)
        hrv_today = sleep["hrv_overnight"]
        if hrv_today and avg_hrv:
            hrv_ratio = hrv_today / avg_hrv
            hrv_score = _clamp(hrv_ratio * 100)
        else:
            hrv_score = 50.0

        # 7. Resting HR vs baseline (5%)
        rhr_today = sleep["resting_hr"]
        if rhr_today and avg_rhr:
            rhr_score = _clamp(100 - ((rhr_today - avg_rhr) / avg_rhr) * 200)
        else:
            rhr_score = 50.0

        components = {
            "duration": round(dur_score),
            "efficiency": round(eff_score),
            "deep_sleep": round(deep_score),
            "rem_sleep": round(rem_score),
            "awake_penalty": round(awake_score),
            "hrv": round(hrv_score),
            "resting_hr": round(rhr_score),
        }

        weights = {"duration": 0.20, "efficiency": 0.15, "deep_sleep": 0.20,
                   "rem_sleep": 0.20, "awake_penalty": 0.10, "hrv": 0.10, "resting_hr": 0.05}

        score = round(sum(components[k] * w for k, w in weights.items()))

        insight = _sleep_insight(components, deep_pct, rem_pct, hrv_today, avg_hrv)

        return {
            "score": score,
            "components": components,
            "insight": insight,
            "data": sleep,
        }


def _cap(s: str) -> str:
    """Uppercase first character only, preserving the rest (e.g. HRV, REM stay intact)."""
    return s[0].upper() + s[1:] if s else s


def _sleep_insight(c: dict, deep_pct: float, rem_pct: float, hrv: Optional[float], avg_hrv: Optional[float]) -> str:
    parts = []
    if c["deep_sleep"] >= 80:
        parts.append("strong deep sleep")
    elif c["deep_sleep"] < 50:
        parts.append("low deep sleep")
    if c["rem_sleep"] >= 80:
        parts.append("good REM")
    elif c["rem_sleep"] < 50:
        parts.append("low REM")
    if hrv and avg_hrv:
        if hrv >= avg_hrv:
            parts.append("HRV above your baseline")
        else:
            parts.append("HRV below your baseline")
    if c["efficiency"] < 60:
        parts.append("sleep efficiency was low")
    if not parts:
        return "Sleep quality was average across all components."
    return ". ".join(_cap(p) for p in parts) + "."


# ─────────────────────────── recovery score ───────────────────────────

def calc_recovery_score(target_date: date = None, sleep_score: Optional[int] = None) -> dict:
    if target_date is None:
        target_date = date.today()

    with db() as conn:
        profile = _get_profile(conn)

        # HRV today
        hrv_row = conn.execute("SELECT hrv_value FROM hrv WHERE date=?", (target_date.isoformat(),)).fetchone()
        hrv_today = hrv_row[0] if hrv_row else None

        # HRV baseline
        hrv_hist = _rolling(conn, "hrv", "hrv_value", days=30)
        hrv_mean = _mean(hrv_hist)
        hrv_sd = _std(hrv_hist)

        # HRV score (35%)
        if hrv_today and hrv_mean and hrv_sd:
            z = (hrv_today - hrv_mean) / max(hrv_sd, 0.1)
            if z >= -1:
                hrv_score = _clamp(70 + z * 15)
            else:
                hrv_score = _clamp(70 + z * 30)
        elif hrv_today and hrv_mean:
            hrv_score = _clamp((hrv_today / hrv_mean) * 70)
        else:
            hrv_score = 50.0

        # Resting HR (25%)
        rhr_row = conn.execute("SELECT resting_hr FROM steps WHERE date=?", (target_date.isoformat(),)).fetchone()
        rhr_today = rhr_row[0] if rhr_row else None
        rhr_hist = _rolling(conn, "steps", "resting_hr", days=30)
        rhr_mean = _mean(rhr_hist)
        if rhr_today and rhr_mean:
            beats_above = rhr_today - rhr_mean
            rhr_score = _clamp(100 - beats_above * 5)
        else:
            rhr_score = 50.0

        # Sleep score (20%) — use passed value or recalculate
        if sleep_score is None:
            sleep_result = calc_sleep_score(target_date - timedelta(days=1))
            sleep_score = sleep_result["score"]

        # Body battery start (10%)
        bb_row = conn.execute("SELECT start_value FROM body_battery WHERE date=?", (target_date.isoformat(),)).fetchone()
        bb_score = float(bb_row[0]) if bb_row and bb_row[0] else 50.0

        # Previous day stress (10%)
        prev_date = target_date - timedelta(days=1)
        stress_row = conn.execute("SELECT avg_stress FROM stress WHERE date=?", (prev_date.isoformat(),)).fetchone()
        stress = stress_row[0] if stress_row else 25
        stress_score = _clamp(100 - (stress or 25))

        components = {
            "hrv": round(hrv_score),
            "resting_hr": round(rhr_score),
            "sleep": round(sleep_score),
            "body_battery": round(bb_score),
            "stress": round(stress_score),
        }

        weights = {"hrv": 0.35, "resting_hr": 0.25, "sleep": 0.20, "body_battery": 0.10, "stress": 0.10}
        score = round(sum(components[k] * w for k, w in weights.items()))

        # ACWR
        acwr, acwr_label = _calc_acwr(conn, target_date)

        # Apply ACWR penalty
        if acwr > 1.5:
            score = round(score * 0.9)
        elif acwr < 0.8:
            score = round(score * 0.95)

        # Target strain
        target_strain = _recovery_to_target_strain(score)

        insight = _recovery_insight(components, acwr, acwr_label, hrv_today, hrv_mean)

        return {
            "score": _clamp(score),
            "components": components,
            "acwr": round(acwr, 2),
            "acwr_label": acwr_label,
            "target_strain": target_strain,
            "insight": insight,
        }


def _calc_acwr(conn, target_date: date) -> tuple[float, str]:
    # Acute = sum of strain last 7 days
    acute_start = (target_date - timedelta(days=7)).isoformat()
    acute_rows = conn.execute(
        "SELECT SUM(strain) FROM activities WHERE date > ? AND date <= ?",
        (acute_start, target_date.isoformat())
    ).fetchone()
    acute = (acute_rows[0] or 0)

    # Chronic = avg weekly strain over 28 days
    chronic_start = (target_date - timedelta(days=28)).isoformat()
    chronic_rows = conn.execute(
        "SELECT SUM(strain) FROM activities WHERE date > ? AND date <= ?",
        (chronic_start, target_date.isoformat())
    ).fetchone()
    chronic_total = (chronic_rows[0] or 0)
    chronic = chronic_total / 4

    if chronic < 1:
        acwr = 1.0
    else:
        acwr = acute / chronic

    if acwr > 1.5:
        label = "Overreaching"
    elif acwr < 0.8:
        label = "Detraining"
    else:
        label = "On Track"

    return acwr, label


def _recovery_to_target_strain(recovery: float) -> int:
    if recovery <= 33:
        return round(recovery)
    elif recovery <= 66:
        return round(34 + (recovery - 34) / 32 * 21)
    else:
        return round(56 + (recovery - 67) / 33 * 44)


def _recovery_insight(c: dict, acwr: float, acwr_label: str, hrv: Optional[float], avg_hrv: Optional[float]) -> str:
    parts = []
    if c["hrv"] >= 75:
        parts.append("HRV is strong today")
    elif c["hrv"] < 40:
        parts.append("HRV is significantly below your baseline")
    if c["sleep"] < 50:
        parts.append("poor sleep is dragging recovery down")
    if acwr > 1.5:
        parts.append("training load is high — consider an easy day")
    elif acwr < 0.8:
        parts.append("training load is low — you may be undertraining")
    if not parts:
        return "Recovery is tracking well. You're in a good position to train."
    return ". ".join(_cap(p) for p in parts) + "."


# ─────────────────────────── strain score ───────────────────────────

def calc_strain_score(target_date: date = None, recovery_score: int = 50) -> dict:
    if target_date is None:
        target_date = date.today()

    ZONE_WEIGHTS = {1: 1.0, 2: 2.0, 3: 4.0, 4: 8.0, 5: 16.0}
    TYPE_MULTIPLIERS = {
        "running": 1.0, "cycling": 0.85, "swimming": 0.95,
        "strength_training": 0.9, "other": 0.9,
    }

    with db() as conn:
        profile = _get_profile(conn)
        max_hr = _max_hr(profile)

        activities = conn.execute(
            "SELECT * FROM activities WHERE date=?", (target_date.isoformat(),)
        ).fetchall()

        total_load = 0.0
        zone_totals = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}

        rhr_row = conn.execute(
            "SELECT resting_hr FROM steps WHERE date=? AND resting_hr IS NOT NULL",
            (target_date.isoformat(),)
        ).fetchone()
        rhr = (rhr_row[0] if rhr_row else None) or 60

        for a in activities:
            act = dict(a)
            mult = TYPE_MULTIPLIERS.get(act["type"], 0.9)
            zone_secs_total = sum((act.get(f"zone{z}_seconds", 0) or 0) for z in range(1, 6))

            if zone_secs_total > 0:
                # Use zone breakdown when available
                for z in range(1, 6):
                    secs = act.get(f"zone{z}_seconds", 0) or 0
                    zone_totals[z] += secs
                    total_load += secs * ZONE_WEIGHTS[z] * mult
            else:
                # Fallback: TRIMP from avg_hr + duration
                avg_hr = act.get("avg_hr") or 0
                duration = act.get("duration_seconds") or 0
                if avg_hr > 0 and duration > 0:
                    hr_reserve = _clamp((avg_hr - rhr) / max(max_hr - rhr, 1), 0, 1)
                    trimp = (duration / 60) * hr_reserve * 0.64 * math.exp(1.92 * hr_reserve)
                    # Calibrate: TRIMP ~100 for a moderate 60min run ≈ 50 strain
                    # MAX_LOAD = 28800 units; TRIMP 100 → load ~14400 → 50 strain
                    total_load += trimp * 144 * mult

                    # Approximate zone distribution for display
                    if hr_reserve < 0.5:
                        zone_totals[2] += duration
                    elif hr_reserve < 0.7:
                        zone_totals[3] += duration
                    elif hr_reserve < 0.85:
                        zone_totals[4] += duration
                    else:
                        zone_totals[5] += duration

            # Training Effect bonus
            te = act.get("training_effect") or 0
            if te > 0:
                total_load += te * 60

        MAX_LOAD = 28800  # ~100 strain reference

        # General movement load from steps (represents non-structured activity)
        steps_row = conn.execute(
            "SELECT steps, active_calories FROM steps WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        steps = (steps_row[0] if steps_row else None) or 0
        active_cal = (steps_row[1] if steps_row else None) or 0

        # Steps above 5k baseline contribute light load (10k steps ≈ +5 strain)
        STEP_BASELINE = 5000
        step_load = max(0, steps - STEP_BASELINE) / 1000 * 0.5 / 100 * MAX_LOAD
        total_load += step_load

        # Active calories as secondary signal (cap contribution at +10 strain)
        # 500 active kcal ≈ +10 strain
        cal_load = _clamp(active_cal / 500, 0, 1) * 0.10 * MAX_LOAD
        total_load += cal_load

        # Stress load — chronic stress is physiological strain even without exercise
        stress_row = conn.execute(
            "SELECT avg_stress FROM stress WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        avg_stress = (stress_row[0] if stress_row else None) or 0
        # Stress > 25 (baseline) adds load, stress 75+ ≈ +8 strain
        stress_load = _clamp(max(0, avg_stress - 25) / 50, 0, 1) * 0.08 * MAX_LOAD
        total_load += stress_load

        strain = _clamp((total_load / MAX_LOAD) * 100)

        # Update DB with strain values per activity
        for a in activities:
            act = dict(a)
            mult = TYPE_MULTIPLIERS.get(act["type"], 0.9)
            zone_secs_total = sum((act.get(f"zone{z}_seconds", 0) or 0) for z in range(1, 6))
            if zone_secs_total > 0:
                act_load = sum(
                    (act.get(f"zone{z}_seconds", 0) or 0) * ZONE_WEIGHTS[z] * mult
                    for z in range(1, 6)
                )
            else:
                avg_hr = act.get("avg_hr") or 0
                duration = act.get("duration_seconds") or 0
                if avg_hr > 0 and duration > 0:
                    hr_reserve = _clamp((avg_hr - rhr) / max(max_hr - rhr, 1), 0, 1)
                    trimp = (duration / 60) * hr_reserve * 0.64 * math.exp(1.92 * hr_reserve)
                    act_load = trimp * 144 * mult
                else:
                    act_load = 0
            act_strain = _clamp((act_load / MAX_LOAD) * 100)
            conn.execute("UPDATE activities SET strain=? WHERE id=?", (act_strain, act["id"]))

        target = _recovery_to_target_strain(recovery_score)

        label = (
            "Recovery / light day" if strain <= 33 else
            "Moderate training" if strain <= 55 else
            "Hard training" if strain <= 77 else
            "Very hard / race effort"
        )

        insight = _strain_insight(strain, target, zone_totals)

        return {
            "score": round(strain),
            "target": target,
            "zones": {f"zone{z}_minutes": round(zone_totals[z] / 60) for z in range(1, 6)},
            "label": label,
            "insight": insight,
        }


def _strain_insight(strain: float, target: float, zones: dict) -> str:
    z4_z5 = (zones.get(4, 0) + zones.get(5, 0)) / 60
    if strain > target + 15:
        return f"Today's strain ({round(strain)}) significantly exceeded your target ({target}). Prioritise recovery."
    elif strain < target - 15:
        return f"Strain ({round(strain)}) was below your target ({target}). Consider adding intensity tomorrow."
    elif z4_z5 > 20:
        return f"High-intensity effort today with {round(z4_z5)}min in zones 4–5. Allow 48h before another hard session."
    return f"Strain is on target at {round(strain)}. Good balance of load and recovery."


# ─────────────────────────── calorie calc ───────────────────────────

def calc_calories(target_date: date = None) -> dict:
    if target_date is None:
        target_date = date.today()

    with db() as conn:
        profile = _get_profile(conn)

        age = profile.get("age") or 30
        weight = profile.get("weight_kg") or 75
        height = profile.get("height_cm") or 175

        # Mifflin-St Jeor BMR (male — Health Centre is for Olly)
        bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5

        # Active calories today from Garmin
        steps_row = conn.execute(
            "SELECT active_calories, total_calories FROM steps WHERE date=?",
            (target_date.isoformat(),)
        ).fetchone()

        active_cal = steps_row[0] if steps_row and steps_row[0] else 0
        garmin_total = steps_row[1] if steps_row and steps_row[1] else None

        # Pro-rate BMR to current time of day
        now = target_date  # for past dates use full day
        is_today = target_date == date.today()
        from datetime import datetime
        if is_today:
            minutes_elapsed = datetime.now().hour * 60 + datetime.now().minute
            bmr_prorated = bmr * (minutes_elapsed / 1440)
        else:
            bmr_prorated = bmr

        total_burned = (garmin_total or (bmr_prorated + active_cal))

        # 7-day average
        start_7 = (target_date - timedelta(days=7)).isoformat()
        weekly_rows = conn.execute(
            "SELECT AVG(total_calories) FROM steps WHERE date > ? AND date <= ? AND total_calories IS NOT NULL",
            (start_7, target_date.isoformat())
        ).fetchone()
        weekly_avg = weekly_rows[0] or total_burned

        # Predicted total (project forward based on current burn rate)
        if is_today:
            elapsed_frac = max(minutes_elapsed / 1440, 0.01)
            predicted_total = total_burned / elapsed_frac
        else:
            predicted_total = total_burned

        # Hourly burn — rough model: BMR distributed across 24h + activity spikes
        hourly = []
        for h in range(24):
            base = bmr / 24
            # Activities: attribute calories to their hour
            act_cal = conn.execute(
                "SELECT SUM(calories) FROM activities WHERE date=? AND CAST(substr(date, 12, 2) AS INTEGER)=?",
                (target_date.isoformat(), h)
            ).fetchone()[0] or 0
            hourly.append({"hour": h, "calories": round(base + act_cal)})

        # Activity breakdown
        acts = conn.execute(
            "SELECT name, type, calories FROM activities WHERE date=? AND calories > 0",
            (target_date.isoformat(),)
        ).fetchall()
        breakdown = [{"name": a["name"], "type": a["type"], "calories": a["calories"]} for a in acts]

        return {
            "bmr": round(bmr),
            "active_calories": round(active_cal),
            "total_burned": round(total_burned),
            "predicted_total": round(predicted_total),
            "weekly_avg": round(weekly_avg),
            "hourly_burn": hourly,
            "activity_breakdown": breakdown,
            "bmr_prorated": round(bmr_prorated),
        }
