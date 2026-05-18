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
#
# Methodology: Matthew Walker ("Why We Sleep"), Peter Attia ("Outlive"),
# Huberman Lab, and published polysomnography research.
#
# Component weights (total = 1.00):
#   HRV overnight    25%  — single strongest predictor of autonomic recovery
#   Duration         20%  — cumulative sleep debt is catastrophic
#   Deep sleep       20%  — SWS = physical restoration, HGH release, immune function
#   REM              15%  — emotional regulation, memory, cognitive performance
#   Efficiency       10%  — consolidated sleep quality
#   Resting HR        5%  — sympathetic vs parasympathetic balance overnight
#   Awake time        5%  — sleep fragmentation penalty

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
        hours = total / 3600.0

        # ── 30-day rolling baselines ─────────────────────────────────────────
        dur_hist = _rolling(conn, "sleep", "total_sleep_seconds")
        avg_dur  = _mean(dur_hist) or total

        # HRV — prefer dedicated hrv table; fall back to sleep.hrv_overnight
        hrv_row = conn.execute(
            "SELECT hrv_value FROM hrv WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        hrv_today = hrv_row[0] if hrv_row else sleep.get("hrv_overnight")
        hrv_hist  = _rolling(conn, "hrv", "hrv_value", days=30)
        if not hrv_hist:
            hrv_hist = _rolling(conn, "sleep", "hrv_overnight")
        avg_hrv = _mean(hrv_hist)
        hrv_sd  = _std(hrv_hist)

        # HRV 7-day trend: recent 7-day mean vs prior 7–28 day mean
        hrv_trend_pct: Optional[float] = None
        if hrv_hist and len(hrv_hist) >= 7:
            recent_7  = hrv_hist[-7:]
            prior_21  = hrv_hist[:-7]
            if prior_21:
                r_mean = _mean(recent_7)
                p_mean = _mean(prior_21)
                if r_mean and p_mean and p_mean > 0:
                    hrv_trend_pct = (r_mean - p_mean) / p_mean * 100

        # RHR — prefer steps table; fall back to sleep.resting_hr
        rhr_row = conn.execute(
            "SELECT resting_hr FROM steps WHERE date=? AND resting_hr IS NOT NULL",
            (target_date.isoformat(),)
        ).fetchone()
        rhr_today = rhr_row[0] if rhr_row else sleep.get("resting_hr")
        rhr_hist  = _rolling(conn, "steps", "resting_hr", days=30)
        if not rhr_hist:
            rhr_hist = _rolling(conn, "sleep", "resting_hr")
        avg_rhr = _mean(rhr_hist)
        rhr_sd  = _std(rhr_hist)

        # ── Sleep debt signal: last 3 nights vs baseline ──────────────────────
        debt_cutoff = (target_date - timedelta(days=3)).isoformat()
        debt_row = conn.execute("""
            SELECT AVG(total_sleep_seconds) AS avg3
            FROM sleep WHERE date > ? AND date < ?
              AND total_sleep_seconds > 0
        """, (debt_cutoff, target_date.isoformat())).fetchone()
        avg_3night = debt_row["avg3"] if debt_row else None
        sleep_debt_flag = bool(
            avg_3night and avg_dur and avg_3night < avg_dur * 0.87
        )
        sleep_debt_severity = 0.0
        if sleep_debt_flag and avg_dur and avg_3night:
            sleep_debt_severity = max(0.0, (avg_dur - avg_3night) / avg_dur)

        # ── 1. Duration (20%) ─────────────────────────────────────────────────
        # Uses BOTH absolute hours (optimal band 7–9h per Walker) and relative
        # to personal baseline. Hard floors: < 6h is physiologically damaging.
        if hours >= 7.0 and hours <= 9.0:
            abs_score = 100.0
        elif hours >= 6.0:
            abs_score = 55.0 + (hours - 6.0) * 45.0        # 55→100 for 6–7h
        elif hours >= 5.0:
            abs_score = 20.0 + (hours - 5.0) * 35.0        # 20→55 for 5–6h
        elif hours > 0:
            abs_score = max(0.0, hours / 5.0 * 20.0)       # 0→20 for < 5h
        else:
            abs_score = 0.0
        if hours > 9.0:
            abs_score = _clamp(100.0 - (hours - 9.0) * 15.0)  # slight over-sleep penalty

        rel_ratio = total / avg_dur
        if rel_ratio >= 0.93 and rel_ratio <= 1.08:
            rel_score = 100.0
        elif rel_ratio >= 0.80:
            rel_score = 50.0 + (rel_ratio - 0.80) / 0.13 * 50.0
        elif rel_ratio >= 1.08:
            rel_score = 100.0 - (rel_ratio - 1.08) * 80.0
        else:
            rel_score = max(0.0, rel_ratio / 0.80 * 50.0)

        # Blend: 65% absolute (universal standard), 35% relative (personal context)
        dur_score = 0.65 * abs_score + 0.35 * rel_score
        # Hard cap: < 6h sleep cannot score > 50 regardless of relative context
        if hours < 6.0:
            dur_score = min(dur_score, 50.0)

        # ── 2. Efficiency (10%) ───────────────────────────────────────────────
        # PSG standards: < 75% = clinical insomnia range; > 90% = excellent
        eff = sleep.get("efficiency") or 0
        if eff >= 92:
            eff_score = 100.0
        elif eff >= 85:
            eff_score = 70.0 + (eff - 85.0) / 7.0 * 30.0   # 70→100
        elif eff >= 75:
            eff_score = 35.0 + (eff - 75.0) / 10.0 * 35.0  # 35→70
        elif eff > 0:
            eff_score = max(0.0, eff / 75.0 * 35.0)
        else:
            eff_score = 50.0   # no data — neutral

        # ── 3. Deep sleep / SWS (20%) ─────────────────────────────────────────
        # Walker research: optimal 20–25% of TST (SWS = physical restoration)
        # < 13%: significantly impaired; > 25%: often recovery from prior debt
        deep_s   = sleep.get("deep_sleep_seconds") or 0
        deep_pct = deep_s / total * 100.0
        if deep_pct >= 20.0 and deep_pct <= 25.0:
            deep_score = 100.0
        elif deep_pct >= 13.0 and deep_pct < 20.0:
            deep_score = 72.0 + (deep_pct - 13.0) / 7.0 * 28.0   # 72→100
        elif deep_pct > 25.0 and deep_pct <= 32.0:
            deep_score = 88.0   # above optimal — likely recovery from debt
        elif deep_pct > 32.0:
            deep_score = 70.0   # unusually high — could indicate data artefact
        elif deep_pct >= 5.0:
            deep_score = deep_pct / 13.0 * 72.0                    # 0→72
        else:
            deep_score = max(0.0, deep_pct * 2.0)                  # minimal

        # ── 4. REM sleep (15%) ────────────────────────────────────────────────
        # Optimal: 20–25% of TST. Huberman: < 15% impairs emotional regulation.
        rem_s   = sleep.get("rem_sleep_seconds") or 0
        rem_pct = rem_s / total * 100.0
        if rem_pct >= 20.0 and rem_pct <= 27.0:
            rem_score = 100.0
        elif rem_pct >= 15.0 and rem_pct < 20.0:
            rem_score = 65.0 + (rem_pct - 15.0) / 5.0 * 35.0     # 65→100
        elif rem_pct > 27.0 and rem_pct <= 35.0:
            rem_score = 85.0   # REM rebound — slightly above optimal
        elif rem_pct > 35.0:
            rem_score = 65.0
        elif rem_pct >= 8.0:
            rem_score = rem_pct / 15.0 * 65.0                      # 0→65
        else:
            rem_score = max(0.0, rem_pct * 2.5)

        # ── 5. Awake time (5%) ────────────────────────────────────────────────
        # Use absolute minutes, not percentage — 30 min awake in 8h is different
        # from 30 min awake in 4h
        awake_min = (sleep.get("awake_seconds") or 0) / 60.0
        if awake_min <= 8.0:
            awake_score = 100.0
        elif awake_min <= 20.0:
            awake_score = 100.0 - (awake_min - 8.0) * 4.5         # 100→46
        elif awake_min <= 45.0:
            awake_score = 46.0 - (awake_min - 20.0) * 1.6         # 46→6
        else:
            awake_score = max(0.0, 6.0 - (awake_min - 45.0) * 0.2)

        # ── 6. HRV overnight (25%) ────────────────────────────────────────────
        # Z-score with asymmetric curve: below baseline hurts more than above
        # helps (reflects CNS suppression being more impactful than elevation).
        # Trend bonus: +5 pts if 7-day HRV has been rising (positive adaptation).
        hrv_pct_vs_baseline: Optional[float] = None
        if hrv_today and avg_hrv and avg_hrv > 0:
            hrv_pct_vs_baseline = (hrv_today - avg_hrv) / avg_hrv * 100
            if hrv_sd and hrv_sd > 0:
                z = (hrv_today - avg_hrv) / hrv_sd
                if z >= 0:
                    hrv_score = _clamp(65.0 + z * 17.5)    # z=0→65, z=2→100
                elif z >= -1.0:
                    hrv_score = _clamp(65.0 + z * 28.0)    # z=-1→37
                else:
                    hrv_score = _clamp(37.0 + (z + 1.0) * 30.0)  # z=-2→7
            else:
                # No SD (insufficient history) — use ratio
                hrv_score = _clamp(50.0 + (hrv_today / avg_hrv - 1.0) * 150.0)

            # HRV trend bonus: rising over 7 days = positive autonomic adaptation
            if hrv_trend_pct is not None and hrv_trend_pct > 3.0:
                hrv_score = min(100.0, hrv_score + 5.0)
        else:
            hrv_score = 50.0   # insufficient data — neutral

        # ── 7. Resting HR overnight (5%) ──────────────────────────────────────
        # Z-score relative to personal baseline. Elevated RHR = heightened
        # sympathetic tone, impaired parasympathetic recovery.
        rhr_delta: Optional[float] = None
        if rhr_today and avg_rhr:
            rhr_delta = rhr_today - avg_rhr
            if rhr_sd and rhr_sd > 0:
                z_rhr = rhr_delta / rhr_sd
                # Higher RHR = worse score; asymmetric
                rhr_score = _clamp(70.0 - z_rhr * 22.0)
                # z=0: 70; z=+1: 48; z=+2: 26; z=-1: 92
            else:
                rhr_score = _clamp(100.0 - rhr_delta * 7.0)
        else:
            rhr_score = 50.0

        # ── Weighted score ────────────────────────────────────────────────────
        components = {
            "hrv":          round(hrv_score),
            "duration":     round(dur_score),
            "deep_sleep":   round(deep_score),
            "rem_sleep":    round(rem_score),
            "efficiency":   round(eff_score),
            "resting_hr":   round(rhr_score),
            "awake_penalty": round(awake_score),
        }

        weights = {
            "hrv":           0.25,
            "duration":      0.20,
            "deep_sleep":    0.20,
            "rem_sleep":     0.15,
            "efficiency":    0.10,
            "resting_hr":    0.05,
            "awake_penalty": 0.05,
        }

        score = sum(components[k] * weights[k] for k in weights)

        # ── Sleep debt penalty ─────────────────────────────────────────────────
        # 3+ nights of short sleep compounds impairment even if tonight looks OK
        if sleep_debt_flag:
            penalty = min(12.0, sleep_debt_severity * 35.0)
            score   = score - penalty

        score = round(_clamp(score))

        insight = _sleep_insight(
            components, deep_pct, rem_pct, awake_min, hours, avg_dur / 3600.0,
            hrv_today, avg_hrv, hrv_pct_vs_baseline, hrv_trend_pct,
            rhr_today, avg_rhr, rhr_delta, sleep_debt_flag,
        )

        return {
            "score":       score,
            "components":  components,
            "insight":     insight,
            "data":        sleep,
            # Extra context for rich UI display
            "context": {
                "hours":                round(hours, 1),
                "deep_pct":             round(deep_pct, 1),
                "rem_pct":              round(rem_pct, 1),
                "awake_min":            round(awake_min),
                "hrv_vs_baseline_pct":  round(hrv_pct_vs_baseline, 1) if hrv_pct_vs_baseline is not None else None,
                "hrv_trend_pct":        round(hrv_trend_pct, 1) if hrv_trend_pct is not None else None,
                "rhr_delta":            round(rhr_delta, 1) if rhr_delta is not None else None,
                "sleep_debt":           sleep_debt_flag,
            },
        }


def _cap(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def _sleep_insight(
    c: dict, deep_pct: float, rem_pct: float, awake_min: float,
    hours: float, avg_hours: float,
    hrv: Optional[float], avg_hrv: Optional[float],
    hrv_pct: Optional[float], hrv_trend: Optional[float],
    rhr: Optional[float], avg_rhr: Optional[float], rhr_delta: Optional[float],
    debt_flag: bool,
) -> str:
    parts = []

    # HRV — lead with the most important signal
    if hrv and avg_hrv and hrv_pct is not None:
        pct_str = f"{'+' if hrv_pct >= 0 else ''}{round(hrv_pct)}%"
        if hrv_pct >= 10:
            parts.append(f"HRV {pct_str} above baseline — autonomic recovery was excellent")
        elif hrv_pct >= 3:
            parts.append(f"HRV {pct_str} above baseline — good nervous system recovery")
        elif hrv_pct >= -5:
            parts.append(f"HRV near baseline ({pct_str}) — recovery was average")
        elif hrv_pct >= -15:
            parts.append(f"HRV {pct_str} below baseline — sympathetic nervous system was elevated overnight")
        else:
            parts.append(f"HRV significantly suppressed ({pct_str}) — your body was under stress during sleep")
        if hrv_trend is not None and hrv_trend > 4:
            parts.append(f"7-day HRV trend is rising (+{round(hrv_trend)}%) — positive autonomic adaptation")
        elif hrv_trend is not None and hrv_trend < -4:
            parts.append(f"HRV has been declining over 7 days ({round(hrv_trend)}%) — watch cumulative load")

    # Duration
    if hours < 5.5:
        parts.append(f"Only {round(hours, 1)}h sleep — severe sleep debt builds rapidly below 6h. Cognitive impairment is measurable.")
    elif hours < 6.5:
        parts.append(f"{round(hours, 1)}h sleep — below the 7h minimum. Prioritise an earlier bedtime tonight.")
    elif hours > 9.5:
        parts.append(f"{round(hours, 1)}h sleep — above average. This can indicate recovery from prior debt or illness.")

    # Sleep debt
    if debt_flag:
        parts.append("3-night sleep debt detected — consecutive short nights compound impairment even if tonight looked OK. Prioritise recovery this week.")

    # Deep sleep
    if deep_pct < 13:
        parts.append(f"Deep sleep (SWS) was only {round(deep_pct)}% — well below the 20–25% optimal for physical restoration and HGH release. Avoid alcohol, late meals, and blue light 2h before bed.")
    elif deep_pct < 18:
        parts.append(f"Deep sleep at {round(deep_pct)}% — slightly below the 20–25% optimal band.")
    elif deep_pct >= 20 and deep_pct <= 25:
        parts.append(f"Deep sleep at {round(deep_pct)}% — within the optimal 20–25% band. Physical restoration was strong.")

    # REM
    if rem_pct < 15:
        parts.append(f"REM at {round(rem_pct)}% — below the 20% threshold. Emotional regulation and memory consolidation were compromised.")
    elif rem_pct >= 20 and rem_pct <= 27:
        parts.append(f"REM at {round(rem_pct)}% — excellent. Cognitive and emotional restoration was complete.")

    # RHR
    if rhr and rhr_delta is not None:
        if rhr_delta >= 5:
            parts.append(f"Resting HR was {round(rhr_delta)} bpm above your baseline ({round(rhr)} bpm) — elevated sympathetic tone suggests incomplete recovery or early illness.")
        elif rhr_delta <= -4:
            parts.append(f"Resting HR {abs(round(rhr_delta))} bpm below baseline — excellent parasympathetic dominance overnight.")

    # Efficiency
    if c["efficiency"] < 50:
        parts.append(f"Sleep efficiency was low — significant time awake in bed. Review sleep hygiene and avoid lying in bed when not sleepy.")

    # Awake time
    if awake_min > 45:
        parts.append(f"{round(awake_min)} minutes awake during the night — highly fragmented sleep. Consider sleep restriction therapy if this is recurring.")

    if not parts:
        return "Sleep quality was solid across all components."
    return " ".join(p.rstrip(".") + "." for p in parts)


# ─────────────────────────── recovery score ───────────────────────────
#
# Methodology: Peter Attia ("Outlive"), Andrew Huberman, Rhonda Patrick,
# published HRV / autonomic neuroscience research.
#
# Component weights (total = 1.00):
#   HRV              35%  — single best objective readiness signal
#   Sleep quality    20%  — prior night composite (from calc_sleep_score)
#   Resting HR       20%  — sympathetic / parasympathetic balance
#   Body battery     15%  — Garmin's integrated recovery estimate
#   Stress (prev)    10%  — psychological/physiological load preceding night

def calc_recovery_score(target_date: date = None, sleep_score: Optional[int] = None) -> dict:
    if target_date is None:
        target_date = date.today()

    with db() as conn:
        profile = _get_profile(conn)

        # ── HRV ──────────────────────────────────────────────────────────────
        hrv_row = conn.execute(
            "SELECT hrv_value FROM hrv WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        hrv_today = hrv_row[0] if hrv_row else None

        hrv_hist  = _rolling(conn, "hrv", "hrv_value", days=30)
        hrv_mean  = _mean(hrv_hist)
        hrv_sd    = _std(hrv_hist)

        # HRV 7-day trend: recent mean vs prior 21-day mean
        hrv_trend_pct: Optional[float] = None
        if hrv_hist and len(hrv_hist) >= 7:
            recent_7 = hrv_hist[-7:]
            prior_21 = hrv_hist[:-7]
            if prior_21:
                r_m = _mean(recent_7)
                p_m = _mean(prior_21)
                if r_m and p_m and p_m > 0:
                    hrv_trend_pct = (r_m - p_m) / p_m * 100

        # Asymmetric z-score — below baseline hurts more than above helps
        # Baseline at 60 (not 70): recovery sits lower than pure sleep HRV
        hrv_pct_vs_baseline: Optional[float] = None
        if hrv_today and hrv_mean and hrv_mean > 0:
            hrv_pct_vs_baseline = (hrv_today - hrv_mean) / hrv_mean * 100
            if hrv_sd and hrv_sd > 0:
                z = (hrv_today - hrv_mean) / hrv_sd
                if z >= 0:
                    hrv_score = _clamp(60.0 + z * 20.0)      # z=0→60, z=2→100
                elif z >= -1.0:
                    hrv_score = _clamp(60.0 + z * 25.0)      # z=-1→35
                else:
                    hrv_score = _clamp(35.0 + (z + 1.0) * 30.0)  # z=-2→5
            else:
                hrv_score = _clamp(50.0 + (hrv_today / hrv_mean - 1.0) * 150.0)

            # Trend bonus: rising HRV over 7 days = positive adaptation
            if hrv_trend_pct is not None and hrv_trend_pct > 3.0:
                hrv_score = min(100.0, hrv_score + 5.0)
        else:
            hrv_score = 50.0

        # ── Resting HR (20%) ─────────────────────────────────────────────────
        # Elevated RHR = heightened sympathetic tone; use z-score for sensitivity
        rhr_row = conn.execute(
            "SELECT resting_hr FROM steps WHERE date=? AND resting_hr IS NOT NULL",
            (target_date.isoformat(),)
        ).fetchone()
        rhr_today = rhr_row[0] if rhr_row else None
        rhr_hist  = _rolling(conn, "steps", "resting_hr", days=30)
        rhr_mean  = _mean(rhr_hist)
        rhr_sd    = _std(rhr_hist)
        rhr_delta: Optional[float] = None

        if rhr_today and rhr_mean:
            rhr_delta = rhr_today - rhr_mean
            if rhr_sd and rhr_sd > 0:
                z_rhr = rhr_delta / rhr_sd
                # Elevated RHR → lower score; z=0→65; z=+1→45; z=-1→85
                rhr_score = _clamp(65.0 - z_rhr * 20.0)
            else:
                rhr_score = _clamp(100.0 - rhr_delta * 7.0)
        else:
            rhr_score = 50.0

        # ── Sleep score (20%) ─────────────────────────────────────────────────
        if sleep_score is None:
            sleep_result = calc_sleep_score(target_date - timedelta(days=1))
            sleep_score = sleep_result["score"]

        # ── Body battery (15%) ────────────────────────────────────────────────
        # Nonlinear curve: ≥75=100, 50–75 linear 60→100, 30–50 linear 30→60, <30 steep
        bb_row = conn.execute(
            "SELECT start_value FROM body_battery WHERE date=?", (target_date.isoformat(),)
        ).fetchone()
        bb_raw = float(bb_row[0]) if bb_row and bb_row[0] else None
        if bb_raw is not None:
            if bb_raw >= 75:
                bb_score = 100.0
            elif bb_raw >= 50:
                bb_score = 60.0 + (bb_raw - 50.0) / 25.0 * 40.0   # 60→100
            elif bb_raw >= 30:
                bb_score = 30.0 + (bb_raw - 30.0) / 20.0 * 30.0   # 30→60
            else:
                bb_score = max(0.0, bb_raw / 30.0 * 30.0)          # 0→30
        else:
            bb_score = 50.0

        # ── Stress — relative to personal 30-day baseline (10%) ───────────────
        # Absolute stress numbers are meaningless; what matters is deviation from
        # YOUR normal. High-stress person at 50 is fine; low-stress person at 50 is alarming.
        prev_date    = target_date - timedelta(days=1)
        stress_row   = conn.execute(
            "SELECT avg_stress FROM stress WHERE date=?", (prev_date.isoformat(),)
        ).fetchone()
        stress_today = stress_row[0] if stress_row else None
        stress_hist  = _rolling(conn, "stress", "avg_stress", days=30)
        stress_mean  = _mean(stress_hist)
        stress_sd    = _std(stress_hist)
        stress_delta: Optional[float] = None

        if stress_today is not None and stress_mean and stress_mean > 0:
            stress_delta = stress_today - stress_mean
            if stress_sd and stress_sd > 0:
                z_stress = stress_delta / stress_sd
                # Higher stress → lower score; z=0→70; z=+1→50; z=-1→90
                stress_score = _clamp(70.0 - z_stress * 20.0)
            else:
                # Fallback absolute: stress 25=100, 50=75, 75=50, 100=25
                stress_score = _clamp(100.0 - (stress_today or 25) * 1.0)
        elif stress_today is not None:
            stress_score = _clamp(100.0 - (stress_today or 25) * 1.0)
        else:
            stress_score = 70.0   # no data — mildly optimistic neutral

        # ── Weighted composite ────────────────────────────────────────────────
        components = {
            "hrv":          round(hrv_score),
            "resting_hr":   round(rhr_score),
            "sleep":        round(sleep_score),
            "body_battery": round(bb_score),
            "stress":       round(stress_score),
        }

        weights = {
            "hrv":          0.35,
            "resting_hr":   0.20,
            "sleep":        0.20,
            "body_battery": 0.15,
            "stress":       0.10,
        }
        score = sum(components[k] * weights[k] for k in weights)

        # ── Sleep debt penalty ─────────────────────────────────────────────────
        # If 3-night rolling average is < 87% of 30-day baseline, we're in debt.
        # Recovery is fundamentally impaired — cap penalty at 10 pts.
        dur_hist   = _rolling(conn, "sleep", "total_sleep_seconds")
        avg_dur    = _mean(dur_hist) or 0
        debt_cut   = (target_date - timedelta(days=3)).isoformat()
        debt_row   = conn.execute("""
            SELECT AVG(total_sleep_seconds) AS avg3 FROM sleep
            WHERE date > ? AND date < ?
              AND total_sleep_seconds > 0
        """, (debt_cut, target_date.isoformat())).fetchone()
        avg_3night = debt_row["avg3"] if debt_row else None
        sleep_debt_flag = bool(avg_3night and avg_dur and avg_3night < avg_dur * 0.87)
        if sleep_debt_flag and avg_dur and avg_3night:
            debt_severity = max(0.0, (avg_dur - avg_3night) / avg_dur)
            score -= min(10.0, debt_severity * 30.0)

        # ── ACWR penalty ──────────────────────────────────────────────────────
        # More aggressive than before: overreaching meaningfully suppresses recovery.
        acwr, acwr_label, acute_load, chronic_load = _calc_acwr(conn, target_date)

        if acwr > 1.8:
            score *= 0.75    # -25%: significant overreaching
        elif acwr > 1.5:
            score *= 0.85    # -15%: overreaching
        elif acwr < 0.8:
            score *= 0.97    # -3%: mild detraining signal

        score = round(_clamp(score))

        target_strain = _recovery_to_target_strain(score)

        insight = _recovery_insight(
            components, acwr, acwr_label,
            hrv_today, hrv_mean, hrv_pct_vs_baseline, hrv_trend_pct,
            rhr_today, rhr_mean, rhr_delta,
            bb_raw, stress_today, stress_mean, stress_delta,
            sleep_debt_flag,
        )

        return {
            "score":         _clamp(score),
            "components":    components,
            "acwr":          round(acwr, 2),
            "acwr_label":    acwr_label,
            "acute_load":    acute_load,
            "chronic_load":  chronic_load,
            "target_strain": target_strain,
            "insight":       insight,
            # Rich context for UI / future use
            "context": {
                "hrv_vs_baseline_pct": round(hrv_pct_vs_baseline, 1) if hrv_pct_vs_baseline is not None else None,
                "hrv_trend_pct":       round(hrv_trend_pct, 1) if hrv_trend_pct is not None else None,
                "rhr_delta":           round(rhr_delta, 1) if rhr_delta is not None else None,
                "body_battery":        bb_raw,
                "stress_delta":        round(stress_delta, 1) if stress_delta is not None else None,
                "sleep_debt":          sleep_debt_flag,
            },
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


def _recovery_insight(
    c: dict, acwr: float, acwr_label: str,
    hrv: Optional[float], avg_hrv: Optional[float],
    hrv_pct: Optional[float], hrv_trend: Optional[float],
    rhr: Optional[float], avg_rhr: Optional[float], rhr_delta: Optional[float],
    bb: Optional[float], stress: Optional[float], avg_stress: Optional[float],
    stress_delta: Optional[float], debt_flag: bool,
) -> str:
    parts = []

    # ── HRV — lead signal ──────────────────────────────────────────────
    if hrv and avg_hrv and hrv_pct is not None:
        pct_str = f"{'+' if hrv_pct >= 0 else ''}{round(hrv_pct)}%"
        if hrv_pct >= 10:
            parts.append(f"HRV is {pct_str} above baseline — autonomic nervous system is primed. High-quality training recommended.")
        elif hrv_pct >= 4:
            parts.append(f"HRV {pct_str} above baseline — good parasympathetic dominance. Green light to train.")
        elif hrv_pct >= -5:
            parts.append(f"HRV near baseline ({pct_str}) — recovery is average. Moderate intensity is appropriate.")
        elif hrv_pct >= -15:
            parts.append(f"HRV {pct_str} below baseline ({round(hrv)} vs {round(avg_hrv)} ms) — sympathetic tone elevated. Keep today's effort low.")
        else:
            parts.append(f"HRV significantly suppressed ({pct_str}, {round(hrv)} vs {round(avg_hrv)} ms) — your system is under stress. Rest or very light movement only.")

        if hrv_trend is not None and hrv_trend > 4:
            parts.append(f"7-day HRV trending up (+{round(hrv_trend)}%) — positive adaptation to training load.")
        elif hrv_trend is not None and hrv_trend < -5:
            parts.append(f"HRV declining over 7 days ({round(hrv_trend)}%) — cumulative fatigue is building. Reduce load this week.")

    # ── RHR ────────────────────────────────────────────────────────────
    if rhr and rhr_delta is not None and abs(rhr_delta) >= 3:
        if rhr_delta >= 6:
            parts.append(f"Resting HR {round(rhr_delta)} bpm above baseline ({round(rhr)} bpm) — could indicate illness, dehydration, or overreaching.")
        elif rhr_delta >= 3:
            parts.append(f"Resting HR slightly elevated (+{round(rhr_delta)} bpm) — monitor today; avoid high-intensity work.")
        elif rhr_delta <= -5:
            parts.append(f"Resting HR {abs(round(rhr_delta))} bpm below baseline — excellent parasympathetic recovery.")

    # ── Body battery ────────────────────────────────────────────────────
    if bb is not None:
        if bb >= 75:
            parts.append(f"Body battery at {round(bb)} — fully charged.")
        elif bb < 30:
            parts.append(f"Body battery at {round(bb)} — critically low. Sleep and recovery are the priority.")
        elif bb < 50:
            parts.append(f"Body battery at {round(bb)} — partially depleted. Avoid stacking hard sessions.")

    # ── Sleep score ─────────────────────────────────────────────────────
    if c["sleep"] < 45:
        parts.append("Last night's sleep was poor — physical and cognitive performance will be impaired regardless of other metrics.")
    elif c["sleep"] < 60:
        parts.append("Sleep quality was below average — consider this when judging perceived effort today.")

    # ── Sleep debt ──────────────────────────────────────────────────────
    if debt_flag:
        parts.append("3-night sleep debt detected — consecutive short nights compound cognitive and physical impairment. Recovery this week is non-negotiable.")

    # ── Stress ──────────────────────────────────────────────────────────
    if stress_delta is not None and stress_delta >= 10:
        parts.append(f"Yesterday's stress was above your normal ({'+' if stress_delta >= 0 else ''}{round(stress_delta)} vs baseline) — psychological load also impairs recovery.")

    # ── ACWR ────────────────────────────────────────────────────────────
    if acwr > 1.8:
        parts.append(f"Training load ratio is {round(acwr, 2)} — significant overreaching territory. Injury risk is elevated. Take a rest day.")
    elif acwr > 1.5:
        parts.append(f"Acute:chronic load ratio is {round(acwr, 2)} — approaching overreaching. Ease off this week.")
    elif acwr < 0.8:
        parts.append(f"Load ratio is low ({round(acwr, 2)}) — you have capacity to add stimulus without risk.")

    if not parts:
        return "All recovery markers are tracking well. You're in a strong position to train hard today."
    return " ".join(p.rstrip(".") + "." for p in parts)


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
