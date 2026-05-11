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
        if eff > 0:
            eff_score = _clamp((eff / 95) * 100) if eff <= 95 else 100.0
        else:
            eff_score = 50.0  # no data — neutral, don't penalise

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
        acwr, acwr_label, acute_load, chronic_load = _calc_acwr(conn, target_date)

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
            "acute_load": acute_load,
            "chronic_load": chronic_load,
            "target_strain": target_strain,
            "insight": insight,
        }


def _cardio_strain_from_row(act: dict) -> float:
    """Compute TRIMP-based strain from a single activity row.

    Priority:
      1. Zone seconds (always present after sync, no write-back dependency)
      2. Stored activities.strain (fallback for old rows without zone data)
      3. 0 if neither is available

    This keeps ACWR stable regardless of whether calc_strain_score has been
    called for that specific date yet.
    """
    ZONE_WEIGHTS = {1: 1.0, 2: 2.0, 3: 4.0, 4: 8.0, 5: 16.0}
    MAX_LOAD = 28800.0

    zone_secs = sum((act.get(f"zone{z}_seconds") or 0) for z in range(1, 6))
    if zone_secs > 0:
        load = sum((act.get(f"zone{z}_seconds") or 0) * ZONE_WEIGHTS[z] for z in range(1, 6))
        return _clamp((load / MAX_LOAD) * 100)

    # Fallback: stored value written by a previous calc_strain_score call
    stored = act.get("strain") or 0
    if stored > 0:
        return float(stored)

    return 0.0


def _calc_acwr(conn, target_date: date) -> tuple[float, str, float, float]:
    _ST = ("strength_training", "gym_and_fitness_equipment",
           "functional_training", "crossfit", "weightlifting")
    _ph = ",".join("?" * len(_ST))

    acute_start   = (target_date - timedelta(days=7)).isoformat()
    chronic_start = (target_date - timedelta(days=28)).isoformat()
    today         = target_date.isoformat()

    # ── Cardio strain — computed from zone seconds (not stored strain column) ──
    # This avoids the write-back ordering problem: calc_recovery_score runs before
    # calc_strain_score, so activities.strain for today is not yet written on the
    # first dashboard load. Computing from zones is deterministic and immediate.
    acute_rows = conn.execute(
        f"""SELECT type, zone1_seconds, zone2_seconds, zone3_seconds,
                   zone4_seconds, zone5_seconds, strain
            FROM activities
            WHERE date > ? AND date <= ? AND type NOT IN ({_ph})""",
        (acute_start, today, *_ST)
    ).fetchall()

    chronic_rows = conn.execute(
        f"""SELECT type, zone1_seconds, zone2_seconds, zone3_seconds,
                   zone4_seconds, zone5_seconds, strain
            FROM activities
            WHERE date > ? AND date <= ? AND type NOT IN ({_ph})""",
        (chronic_start, today, *_ST)
    ).fetchall()

    acute_cardio   = sum(_cardio_strain_from_row(dict(r)) for r in acute_rows)
    chronic_cardio = sum(_cardio_strain_from_row(dict(r)) for r in chronic_rows)

    # ── Strength strain (INOL from training tab) ────────────────────────
    try:
        acute_strength = (conn.execute(
            "SELECT COALESCE(SUM(strength_strain),0) FROM workout_sessions "
            "WHERE DATE(started_at) > ? AND DATE(started_at) <= ? AND finished_at IS NOT NULL",
            (acute_start, today)
        ).fetchone()[0])
        chronic_strength = (conn.execute(
            "SELECT COALESCE(SUM(strength_strain),0) FROM workout_sessions "
            "WHERE DATE(started_at) > ? AND DATE(started_at) <= ? AND finished_at IS NOT NULL",
            (chronic_start, today)
        ).fetchone()[0])
    except Exception:
        acute_strength = chronic_strength = 0

    acute         = acute_cardio + acute_strength
    chronic_total = chronic_cardio + chronic_strength
    chronic       = chronic_total / 4

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

    return acwr, label, round(acute, 1), round(chronic, 1)


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
    # Garmin activity types where HR-based TRIMP is unreliable because rest periods
    # dominate. We exclude these from the TRIMP calculation and let INOL (from the
    # training tab) replace them entirely — avoiding double-counting.
    STRENGTH_ACTIVITY_TYPES = {
        "strength_training", "gym_and_fitness_equipment",
        "functional_training", "crossfit", "weightlifting",
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
            act_type = act.get("type", "") or ""

            # Skip strength-type activities — TRIMP is unreliable for lifting
            # because rest periods keep average HR artificially low.
            # INOL (from the training tab) replaces these entirely.
            if act_type in STRENGTH_ACTIVITY_TYPES:
                continue

            mult = TYPE_MULTIPLIERS.get(act_type, 0.9)
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
        STEP_BASELINE = 5000

        # ── Today's non-activity (background) load ──────────────────────
        steps_row = conn.execute(
            "SELECT steps, active_calories FROM steps WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        steps = (steps_row[0] if steps_row else None) or 0
        active_cal = (steps_row[1] if steps_row else None) or 0

        step_load = max(0, steps - STEP_BASELINE) / 1000 * 0.5 / 100 * MAX_LOAD
        cal_load  = _clamp(active_cal / 500, 0, 1) * 0.10 * MAX_LOAD

        stress_row = conn.execute(
            "SELECT avg_stress FROM stress WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        avg_stress = (stress_row[0] if stress_row else None) or 0
        stress_load = _clamp(max(0, avg_stress - 25) / 50, 0, 1) * 0.08 * MAX_LOAD

        bg_load_today = step_load + cal_load + stress_load
        total_load += bg_load_today

        # ── 30-day rolling background baseline ─────────────────────────
        # Compute the same formula on each of the last 30 days to establish
        # what a "typical" background load looks like for this person.
        hist_start = (target_date - timedelta(days=31)).isoformat()
        hist_end   = (target_date - timedelta(days=1)).isoformat()

        hist_steps = {r["date"]: r for r in conn.execute(
            "SELECT date, steps, active_calories FROM steps WHERE date BETWEEN ? AND ?",
            (hist_start, hist_end)
        ).fetchall()}
        hist_stress = {r["date"]: r for r in conn.execute(
            "SELECT date, avg_stress FROM stress WHERE date BETWEEN ? AND ?",
            (hist_start, hist_end)
        ).fetchall()}

        bg_history: list[float] = []
        for i in range(1, 31):
            d = (target_date - timedelta(days=i)).isoformat()
            s_row = hist_steps.get(d)
            st_row = hist_stress.get(d)
            if not s_row:
                continue
            h_steps = s_row["steps"] or 0
            h_cal   = s_row["active_calories"] or 0
            h_stress = st_row["avg_stress"] if st_row else 25
            h_step_load   = max(0, h_steps - STEP_BASELINE) / 1000 * 0.5 / 100 * MAX_LOAD
            h_cal_load    = _clamp(h_cal / 500, 0, 1) * 0.10 * MAX_LOAD
            h_stress_load = _clamp(max(0, (h_stress or 25) - 25) / 50, 0, 1) * 0.08 * MAX_LOAD
            bg_history.append(h_step_load + h_cal_load + h_stress_load)

        bg_baseline_load = _mean(bg_history) or bg_load_today
        bg_baseline_strain = round(_clamp((bg_baseline_load / MAX_LOAD) * 100))
        bg_today_strain    = round(_clamp((bg_load_today   / MAX_LOAD) * 100))

        # Annotate how today compares to the baseline
        bg_delta = bg_today_strain - bg_baseline_strain
        if bg_delta > 3:
            bg_context = f"higher than your usual {bg_baseline_strain} ({'+' if bg_delta>0 else ''}{bg_delta})"
        elif bg_delta < -3:
            bg_context = f"lower than your usual {bg_baseline_strain} ({bg_delta})"
        else:
            bg_context = f"about normal for you ({bg_baseline_strain} avg)"

        strain = _clamp((total_load / MAX_LOAD) * 100)

        # ── Per-activity strain write-back ──────────────────────────────
        for a in activities:
            act = dict(a)
            act_type = act.get("type", "") or ""

            # Strength activities are excluded from TRIMP — write 0 so they
            # don't contaminate ACWR queries that sum activities.strain.
            if act_type in STRENGTH_ACTIVITY_TYPES:
                conn.execute("UPDATE activities SET strain=0 WHERE id=?", (act["id"],))
                continue

            mult = TYPE_MULTIPLIERS.get(act_type, 0.9)
            zone_secs_total = sum((act.get(f"zone{z}_seconds", 0) or 0) for z in range(1, 6))
            if zone_secs_total > 0:
                act_load = sum(
                    (act.get(f"zone{z}_seconds", 0) or 0) * ZONE_WEIGHTS[z] * mult
                    for z in range(1, 6)
                )
            else:
                a_avg_hr = act.get("avg_hr") or 0
                a_dur    = act.get("duration_seconds") or 0
                if a_avg_hr > 0 and a_dur > 0:
                    hr_res = _clamp((a_avg_hr - rhr) / max(max_hr - rhr, 1), 0, 1)
                    trimp  = (a_dur / 60) * hr_res * 0.64 * math.exp(1.92 * hr_res)
                    act_load = trimp * 144 * mult
                else:
                    act_load = 0
            act_strain = _clamp((act_load / MAX_LOAD) * 100)
            conn.execute("UPDATE activities SET strain=? WHERE id=?", (act_strain, act["id"]))

        target = _recovery_to_target_strain(recovery_score)

        label = (
            "Recovery / light day" if strain <= 33 else
            "Moderate training"    if strain <= 55 else
            "Hard training"        if strain <= 77 else
            "Very hard / race effort"
        )

        insight = _strain_insight(strain, target, zone_totals)

        # ── Load breakdown ──────────────────────────────────────────────
        activity_strain_val = round(_clamp(((total_load - bg_load_today) / MAX_LOAD) * 100))
        load_breakdown = {
            "activities": max(0, activity_strain_val),
            "steps":    round(_clamp((step_load   / MAX_LOAD) * 100)),
            "calories": round(_clamp((cal_load    / MAX_LOAD) * 100)),
            "stress":   round(_clamp((stress_load / MAX_LOAD) * 100)),
            "background_today":    bg_today_strain,
            "background_baseline": bg_baseline_strain,
            "background_context":  bg_context,
            "activity_list": [
                {"name": dict(a)["name"], "type": dict(a)["type"],
                 "strain": round(dict(a).get("strain") or 0),
                 "duration_seconds": dict(a).get("duration_seconds") or 0,
                 "avg_hr": dict(a).get("avg_hr")}
                for a in activities
            ],
        }

        # ── Workout prescriptions ───────────────────────────────────────
        # Target for exercise = total target minus predicted background.
        # Use today's background if it's already known, otherwise the baseline.
        predicted_bg = bg_today_strain if (steps > 0 or avg_stress > 0) else bg_baseline_strain
        activity_target = max(0, target - predicted_bg)
        activity_done   = max(0, activity_strain_val)
        exercise_remaining = max(0, activity_target - activity_done)
        prescriptions = _prescribe_workouts(exercise_remaining, rhr, max_hr)

        return {
            "score": round(strain),
            "target": target,
            "zones": {f"zone{z}_minutes": round(zone_totals[z] / 60) for z in range(1, 6)},
            "label": label,
            "insight": insight,
            "load_breakdown": load_breakdown,
            "prescriptions": prescriptions,
            "remaining_to_target": max(0, target - round(strain)),
            "activity_target": activity_target,
            "exercise_remaining": exercise_remaining,
            "background_baseline": bg_baseline_strain,
            "background_today": bg_today_strain,
        }


def _prescribe_workouts(remaining_strain: float, rhr: int, max_hr: int) -> list[dict]:
    """Return workout options that would cover the remaining strain target."""
    MAX_LOAD = 28800

    def strain_for(duration_min: float, hr_reserve: float, mult: float) -> float:
        trimp = duration_min * hr_reserve * 0.64 * math.exp(1.92 * hr_reserve)
        return _clamp((trimp * 144 * mult / MAX_LOAD) * 100)

    def hr_bpm(hr_reserve: float) -> int:
        return round(rhr + hr_reserve * (max_hr - rhr))

    def mins_to_hit(target_strain: float, hr_reserve: float, mult: float) -> Optional[int]:
        if target_strain <= 0:
            return 0
        # strain_per_min at this hr_reserve
        spm = strain_for(1, hr_reserve, mult)
        if spm <= 0:
            return None
        mins = target_strain / spm
        return round(mins) if mins <= 180 else None

    workouts = []

    # Easy run — Zone 2 (hr_reserve ~0.55)
    hr2 = 0.55
    dur2 = mins_to_hit(remaining_strain, hr2, 1.0)
    if dur2 is not None:
        workouts.append({
            "type": "run", "label": "Easy run",
            "zone": "Zone 2", "hr_reserve": hr2,
            "avg_hr_bpm": hr_bpm(hr2),
            "duration_minutes": dur2,
            "strain": round(strain_for(dur2, hr2, 1.0)),
            "description": "Conversational pace — you should be able to hold a full sentence",
        })

    # Moderate run — Zone 3 (hr_reserve ~0.70)
    hr3 = 0.70
    dur3 = mins_to_hit(remaining_strain, hr3, 1.0)
    if dur3 is not None:
        workouts.append({
            "type": "run", "label": "Moderate run",
            "zone": "Zone 3", "hr_reserve": hr3,
            "avg_hr_bpm": hr_bpm(hr3),
            "duration_minutes": dur3,
            "strain": round(strain_for(dur3, hr3, 1.0)),
            "description": "Comfortably hard — breathing elevated, short sentences only",
        })

    # Hard run — Zone 4 (hr_reserve ~0.82)
    hr4 = 0.82
    dur4 = mins_to_hit(remaining_strain, hr4, 1.0)
    if dur4 is not None:
        workouts.append({
            "type": "run", "label": "Hard run / tempo",
            "zone": "Zone 4", "hr_reserve": hr4,
            "avg_hr_bpm": hr_bpm(hr4),
            "duration_minutes": dur4,
            "strain": round(strain_for(dur4, hr4, 1.0)),
            "description": "Threshold effort — uncomfortable, single words only",
        })

    # Gym — strength training typically sits Zone 2–3 average (hr_reserve ~0.60)
    hr_gym = 0.60
    dur_gym = mins_to_hit(remaining_strain, hr_gym, 0.9)
    if dur_gym is not None:
        workouts.append({
            "type": "gym", "label": "Gym / strength",
            "zone": "Zone 2–3", "hr_reserve": hr_gym,
            "avg_hr_bpm": hr_bpm(hr_gym),
            "duration_minutes": dur_gym,
            "strain": round(strain_for(dur_gym, hr_gym, 0.9)),
            "description": "Compound lifts with moderate rest — keep HR steady throughout",
        })

    # Cycling — Zone 3 (hr_reserve ~0.68, mult 0.85)
    hr_cy = 0.68
    dur_cy = mins_to_hit(remaining_strain, hr_cy, 0.85)
    if dur_cy is not None:
        workouts.append({
            "type": "cycling", "label": "Bike / cycle",
            "zone": "Zone 3", "hr_reserve": hr_cy,
            "avg_hr_bpm": hr_bpm(hr_cy),
            "duration_minutes": dur_cy,
            "strain": round(strain_for(dur_cy, hr_cy, 0.85)),
            "description": "Steady endurance ride — maintain a consistent cadence",
        })

    return workouts


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
