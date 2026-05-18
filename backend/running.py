"""Running coach — personalised pace plans, VDOT tracking, run logging."""
import math
import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database import db
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/running", tags=["running"])


# ─── Schema init ──────────────────────────────────────────────────────────────

def init_running_db(user_id: str | None = None):
    with db(user_id) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS run_logs (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            type                 TEXT NOT NULL,
            planned_distance_km  REAL,
            planned_pace_s_km    INTEGER,
            actual_distance_km   REAL,
            actual_duration_s    INTEGER,
            actual_avg_pace_s_km INTEGER,
            actual_avg_hr        INTEGER,
            notes                TEXT,
            started_at           TEXT DEFAULT (datetime('now')),
            finished_at          TEXT
        );
        """)


# ─── VDOT engine (Jack Daniels methodology) ───────────────────────────────────
#
# VDOT is a proxy for VO2max derived from a best-effort run.  All training paces
# are calculated as percentages of the pace that corresponds to running exactly
# at your VDOT (i.e. 100% VO2max), giving scientifically calibrated zones.
#
# Reference: Daniels' Running Formula (3rd ed.) — Table A/B pace charts.

def _vdot_from_effort(distance_m: float, time_s: float) -> float | None:
    """Estimate VDOT from any best-effort run using Daniels' formula."""
    if distance_m < 1000 or time_s < 60:
        return None
    T = time_s / 60          # minutes
    V = distance_m / T        # m / min
    vo2    = -4.60 + 0.182258 * V + 0.000104 * V * V
    pct_v2 = (0.8 + 0.1894393 * math.exp(-0.012778 * T)
                  + 0.2989558 * math.exp(-0.1932605 * T))
    if pct_v2 <= 0:
        return None
    return round(vo2 / pct_v2, 1)


def _pace_s_km_from_vdot(vdot: float, pct_vo2max: float) -> int:
    """
    Return pace in s/km for the velocity that elicits `pct_vo2max` of VDOT.
    Solves: 0.000104 V² + 0.182258 V − (VDOT × pct + 4.60) = 0
    """
    target = vdot * pct_vo2max
    a, b   = 0.000104, 0.182258
    c      = -(target + 4.60)
    disc   = b * b - 4 * a * c
    if disc < 0 or disc ** 0.5 < b:
        return 720           # fallback 12 min/km — something is very off
    v = (-b + math.sqrt(disc)) / (2 * a)   # m / min
    if v <= 0:
        return 720
    return max(180, int(round(60_000 / v)))  # clamp minimum 3 min/km


def _fmt_pace(s_per_km: int) -> str:
    """Format seconds/km → 'M:SS /km'."""
    m, s = divmod(max(0, s_per_km), 60)
    return f"{m}:{s:02d} /km"


def _fmt_duration(total_s: int) -> str:
    m, s = divmod(total_s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m:02d}m"
    return f"{m}m {s:02d}s"


# Jack Daniels % VO2max targets per run type
# Each is (slow_end, fast_end) — slow_end = easier = higher s/km
VDOT_PCTS = {
    "recovery": (0.59, 0.65),
    "easy":     (0.65, 0.74),
    "long":     (0.65, 0.72),
    "tempo":    (0.83, 0.88),
    "interval": (0.95, 1.00),
}

# HR zones as % of observed max HR
HR_PCTS = {
    "recovery": (0.60, 0.70),
    "easy":     (0.65, 0.75),
    "long":     (0.65, 0.75),
    "tempo":    (0.80, 0.88),
    "interval": (0.88, 0.95),
}

# Default target distances (km) per type when user hasn't specified
DEFAULT_DISTANCES = {
    "recovery": 5.0,
    "easy":     8.0,
    "long":     16.0,
    "tempo":    8.0,
    "interval": 7.0,
}

RUN_TYPES = ["long", "tempo", "interval", "recovery"]

TYPE_META = {
    "recovery": {
        "label":       "Recovery",
        "description": "Very easy aerobic effort — strictly aerobic, below lactate threshold. "
                       "You should be able to hold a full conversation throughout. "
                       "Keeps blood flowing without adding fatigue.",
        "icon":        "🌿",
    },
    "easy": {
        "label":       "Easy",
        "description": "Comfortable aerobic pace. Breathing is controlled, effort feels easy. "
                       "The workhorse of distance training — builds aerobic base safely.",
        "icon":        "🏃",
    },
    "long": {
        "label":       "Long Run",
        "description": "Same easy aerobic effort but extended duration. Builds mitochondrial "
                       "density, fat oxidation, and mental resilience. Aim for negative splits — "
                       "second half slightly faster than first.",
        "icon":        "🛣️",
    },
    "tempo": {
        "label":       "Tempo",
        "description": "Comfortably hard — your lactate threshold pace. You can speak in short "
                       "sentences but not easily. Sustained for 20–40 minutes. Raises the speed "
                       "you can hold aerobically.",
        "icon":        "🔥",
    },
    "interval": {
        "label":       "Intervals",
        "description": "High-intensity repeats at VO₂max effort (roughly your 5K race pace). "
                       "Develops maximum aerobic power. Full recovery jog between reps — "
                       "quality over quantity.",
        "icon":        "⚡",
    },
}

COACH_NOTES = {
    "recovery": (
        "Keep ego at the door. If your HR climbs above zone 2, slow to a walk until it drops. "
        "Recovery runs flush fatigue without adding stress — going too hard defeats the purpose."
    ),
    "easy": (
        "The 80/20 rule: 80% of your running should be at this effort. Resist the urge to push. "
        "Aerobic adaptations happen here."
    ),
    "long": (
        "Start conservatively — the first 40% should feel almost too easy. Glycogen depletion "
        "happens in the final third, which is where the real training stimulus is. Stay fuelled."
    ),
    "tempo": (
        "Warm up 10–15 min easy, hold threshold for 20–40 min, cool down 10 min easy. "
        "It should feel 'comfortably hard' — controlled discomfort. "
        "This pace raises your lactate threshold faster than any other session."
    ),
    "interval": (
        "Warm up 15 min easy. Run each rep at a hard, controlled effort — not all-out sprint. "
        "The recovery jog should be slow enough that you can complete all reps at the same quality. "
        "Stop the session if pace drops more than 5 sec/km."
    ),
}


def _workout_structure(run_type: str, distance_km: float, pace_lo_s: int, pace_hi_s: int) -> str:
    if run_type == "interval":
        rep_dist   = 800  # metres
        # Total reps: roughly half the distance as work, other half warm/cool/recovery
        work_km    = distance_km * 0.55
        reps       = max(4, min(10, int(work_km * 1000 / rep_dist)))
        rep_pace   = _fmt_pace(int((pace_lo_s + pace_hi_s) / 2 * rep_dist / 1000 / rep_dist * 1000))
        return (
            f"15 min easy warm-up  →  "
            f"{reps}×{rep_dist}m @ {rep_pace} with 90s recovery jog  →  "
            f"10 min easy cool-down"
        )
    elif run_type == "tempo":
        sustained_min = max(20, min(40, int(distance_km * 0.6 * (pace_lo_s + pace_hi_s) / 2 / 60)))
        return (
            f"10–15 min easy warm-up  →  "
            f"{sustained_min} min at {_fmt_pace(pace_lo_s)}–{_fmt_pace(pace_hi_s)}  →  "
            f"10 min easy cool-down"
        )
    elif run_type == "long":
        split_km = distance_km / 2
        return (
            f"First {split_km:.0f} km at {_fmt_pace(pace_hi_s)} (easy)  →  "
            f"Final {split_km:.0f} km at {_fmt_pace(pace_lo_s)} (slightly quicker) — "
            f"negative split"
        )
    else:  # recovery
        return (
            f"Run the full {distance_km:.0f} km at {_fmt_pace(pace_hi_s)}–{_fmt_pace(pace_lo_s)}.  "
            f"Walk breaks are fine and encouraged if HR climbs."
        )


# ─── Core profile builder ────────────────────────────────────────────────────

def _get_running_profile(conn) -> dict:
    """
    Build a full running profile from Garmin activities + manual run logs.
    Returns VDOT, pace zones, HR zones, and weekly stats.
    """
    today  = date.today()
    cutoff = (today - timedelta(days=90)).isoformat()

    # Pull Garmin runs (activities table uses distance_meters)
    garmin_runs = conn.execute("""
        SELECT distance_meters / 1000.0 AS distance_km,
               duration_seconds, avg_hr, max_hr, date
        FROM activities
        WHERE (LOWER(type) LIKE '%run%')
          AND distance_meters > 1000
          AND duration_seconds > 300
          AND date >= ?
        ORDER BY date DESC
        LIMIT 60
    """, (cutoff,)).fetchall()

    # Pull manual run logs
    manual_runs = conn.execute("""
        SELECT actual_distance_km  AS distance_km,
               actual_duration_s   AS duration_seconds,
               actual_avg_hr       AS avg_hr,
               NULL                AS max_hr,
               DATE(started_at)    AS date
        FROM run_logs
        WHERE actual_distance_km IS NOT NULL AND actual_duration_s IS NOT NULL
          AND actual_distance_km > 1 AND actual_duration_s > 300
          AND started_at >= ?
        ORDER BY started_at DESC
        LIMIT 60
    """, (cutoff,)).fetchall()

    all_runs = [dict(r) for r in garmin_runs] + [dict(r) for r in manual_runs]

    # ── Best VDOT from all efforts ────────────────────────────────────────────
    best_vdot: float | None = None
    for r in all_runs:
        if not r["distance_km"] or not r["duration_seconds"]:
            continue
        v = _vdot_from_effort(r["distance_km"] * 1000, r["duration_seconds"])
        if v and v > 10 and (best_vdot is None or v > best_vdot):
            best_vdot = v

    # ── Max HR from Garmin activities ─────────────────────────────────────────
    max_hr_obs: int | None = None
    for r in garmin_runs:
        if r["max_hr"] and r["max_hr"] > (max_hr_obs or 0):
            max_hr_obs = int(r["max_hr"])
    # Also check all activities for observed max (cycling etc. still shows HR)
    hr_row = conn.execute(
        "SELECT MAX(max_hr) FROM activities WHERE date >= ?", (cutoff,)
    ).fetchone()
    if hr_row and hr_row[0]:
        max_hr_obs = max(max_hr_obs or 0, int(hr_row[0]))
    if not max_hr_obs:
        max_hr_obs = 185   # sensible default

    # ── Pace zones from VDOT ─────────────────────────────────────────────────
    pace_zones: dict[str, dict] = {}
    if best_vdot:
        for rtype, (slow_pct, fast_pct) in VDOT_PCTS.items():
            slow_s = _pace_s_km_from_vdot(best_vdot, slow_pct)   # slower end
            fast_s = _pace_s_km_from_vdot(best_vdot, fast_pct)   # faster end
            mid_s  = (slow_s + fast_s) // 2
            pace_zones[rtype] = {
                "pace_s_km":      mid_s,
                "pace_low_s_km":  fast_s,    # lower s/km = faster pace
                "pace_high_s_km": slow_s,
                "label":          f"{_fmt_pace(fast_s)} – {_fmt_pace(slow_s)}",
            }

    # ── HR zones ─────────────────────────────────────────────────────────────
    hr_zones: dict[str, list[int]] = {
        rtype: [int(max_hr_obs * lo), int(max_hr_obs * hi)]
        for rtype, (lo, hi) in HR_PCTS.items()
    }

    # ── Estimated 5K time ─────────────────────────────────────────────────────
    est_5k_s: int | None = None
    if best_vdot:
        # 5K is run at ~97% VO2max
        pace_5k = _pace_s_km_from_vdot(best_vdot, 0.97)
        est_5k_s = pace_5k * 5

    # ── Weekly stats ─────────────────────────────────────────────────────────
    week_ago = (today - timedelta(days=7)).isoformat()
    g_week = conn.execute("""
        SELECT COALESCE(SUM(distance_meters/1000.0), 0) AS km,
               COUNT(*) AS cnt
        FROM activities
        WHERE LOWER(type) LIKE '%run%' AND date >= ?
    """, (week_ago,)).fetchone()
    m_week = conn.execute("""
        SELECT COALESCE(SUM(actual_distance_km), 0) AS km,
               COUNT(*) AS cnt
        FROM run_logs
        WHERE actual_distance_km IS NOT NULL AND DATE(started_at) >= ?
    """, (week_ago,)).fetchone()

    weekly_km   = round((g_week["km"] or 0) + (m_week["km"] or 0), 1)
    weekly_runs = (g_week["cnt"] or 0) + (m_week["cnt"] or 0)

    # ── 30-day stats ──────────────────────────────────────────────────────────
    month_ago = (today - timedelta(days=30)).isoformat()
    g_month = conn.execute("""
        SELECT COALESCE(SUM(distance_meters/1000.0), 0) AS km
        FROM activities WHERE LOWER(type) LIKE '%run%' AND date >= ?
    """, (month_ago,)).fetchone()
    m_month = conn.execute("""
        SELECT COALESCE(SUM(actual_distance_km), 0) AS km
        FROM run_logs WHERE actual_distance_km IS NOT NULL AND DATE(started_at) >= ?
    """, (month_ago,)).fetchone()
    monthly_km = round((g_month["km"] or 0) + (m_month["km"] or 0), 1)

    # ── Longest recent run ────────────────────────────────────────────────────
    longest = 0.0
    for r in all_runs[:20]:
        if r["distance_km"] and r["distance_km"] > longest:
            longest = r["distance_km"]

    return {
        "vdot":               best_vdot,
        "vdot_source":        "best_effort" if best_vdot else "insufficient_data",
        "estimated_5k_s":     est_5k_s,
        "pace_zones":         pace_zones,
        "max_hr_observed":    max_hr_obs,
        "hr_zones":           hr_zones,
        "weekly_km":          weekly_km,
        "weekly_runs":        weekly_runs,
        "monthly_km":         monthly_km,
        "longest_run_km":     round(longest, 1),
        "total_runs_90d":     len(all_runs),
    }


# ─── Garmin run classifier ────────────────────────────────────────────────────

def _classify_run(
    distance_km: float,
    duration_s: float,
    avg_hr: float | None,
    max_hr_ref: int,
    median_dist: float,
    easy_pace_s: int | None,
) -> str:
    """
    Classify a run as long / tempo / interval / recovery / easy using
    distance, HR%, and pace — the same signals a coach would use on
    a training log.
    """
    if distance_km <= 0 or duration_s <= 0:
        return "easy"

    pace_s_km = duration_s / distance_km
    hr_pct    = (avg_hr / max_hr_ref) if (avg_hr and max_hr_ref) else 0.0

    # Interval: HR clearly in VO2max territory (≥87% max) — short/punchy effort
    if hr_pct >= 0.87:
        return "interval"

    # Tempo: HR in threshold zone (80–87% max) OR notably faster than easy pace
    tempo_by_hr   = 0.80 <= hr_pct < 0.87
    tempo_by_pace = easy_pace_s and pace_s_km < easy_pace_s * 0.92
    if tempo_by_hr or tempo_by_pace:
        return "tempo"

    # Long: substantially longer than the user's typical run
    # Threshold: ≥1.4× their median distance AND ≥10 km (avoids false positives for low-mileage runners)
    long_threshold = max(10.0, median_dist * 1.4)
    if distance_km >= long_threshold:
        return "long"

    # Recovery: very low HR (<70% max) OR significantly slower than easy pace
    recovery_by_hr   = hr_pct > 0 and hr_pct < 0.70
    recovery_by_pace = easy_pace_s and pace_s_km > easy_pace_s * 1.12
    if recovery_by_hr or recovery_by_pace:
        return "recovery"

    return "easy"


# ─── Coach suggestion engine ──────────────────────────────────────────────────

def _smart_suggest(conn, profile: dict) -> dict:
    """
    Personalised run suggestion that reads ALL run data — both Garmin
    activities and manual logs — classifying each Garmin run by effort
    level so the coach never recommends something you just did.

    Signals used (in priority order):
    1. Acute fatigue: HRV vs baseline, resting HR trend, sleep quality,
       recent gym strain — always overrides training-type logic
    2. Consecutive run days: ≥3 in a row → mandatory easy/recovery
    3. Run-day yesterday or today: suppresses hard sessions regardless
    4. Days since each run type (long / tempo / interval) across
       BOTH Garmin activities (classified) and manual logs
    5. Weekly volume vs 4-week average: high volume week → easier session
    6. Training balance: fill the most overdue session type
    """
    today  = date.today()
    cutoff = (today - timedelta(days=28)).isoformat()   # 4-week window

    # ── Pull all runs from both sources ───────────────────────────────────────
    garmin_runs = conn.execute("""
        SELECT date,
               distance_meters / 1000.0 AS distance_km,
               duration_seconds,
               avg_hr,
               max_hr
        FROM activities
        WHERE LOWER(type) LIKE '%run%'
          AND distance_meters > 800
          AND duration_seconds > 240
          AND date >= ?
        ORDER BY date DESC
    """, (cutoff,)).fetchall()

    manual_runs = conn.execute("""
        SELECT DATE(started_at)       AS date,
               actual_distance_km     AS distance_km,
               actual_duration_s      AS duration_seconds,
               actual_avg_hr          AS avg_hr,
               NULL                   AS max_hr,
               type                   AS manual_type
        FROM run_logs
        WHERE actual_distance_km IS NOT NULL AND actual_duration_s IS NOT NULL
          AND actual_distance_km > 0.5
          AND started_at >= ?
        ORDER BY started_at DESC
    """, (cutoff,)).fetchall()

    max_hr_ref  = profile.get("max_hr_observed") or 185

    # Median distance from Garmin runs (last 28 days) — defines "normal" run length
    g_dists     = [r["distance_km"] for r in garmin_runs if r["distance_km"]]
    m_dists     = [r["distance_km"] for r in manual_runs if r["distance_km"]]
    all_dists   = sorted(g_dists + m_dists)
    median_dist = all_dists[len(all_dists) // 2] if all_dists else 8.0

    # Easy pace from profile (centre of easy zone)
    easy_pz    = profile.get("pace_zones", {}).get("easy")
    easy_pace  = easy_pz["pace_s_km"] if easy_pz else None

    # ── Classify every Garmin run ─────────────────────────────────────────────
    # Build a combined list: (date_str, run_type, distance_km)
    all_classified: list[tuple[str, str]] = []

    for r in garmin_runs:
        rtype = _classify_run(
            r["distance_km"] or 0,
            r["duration_seconds"] or 0,
            r["avg_hr"],
            max_hr_ref,
            median_dist,
            easy_pace,
        )
        all_classified.append((r["date"], rtype))

    for r in manual_runs:
        # Manual logs have an explicit type — trust it directly
        rtype = r["manual_type"] or "easy"
        all_classified.append((r["date"], rtype))

    # ── Days since each run type (across all sources) ─────────────────────────
    last_date_by_type: dict[str, date] = {}
    for ds, rtype in all_classified:
        try:
            d = date.fromisoformat(ds)
        except Exception:
            continue
        if rtype not in last_date_by_type or d > last_date_by_type[rtype]:
            last_date_by_type[rtype] = d

    def days_since(rtype: str) -> int:
        if rtype not in last_date_by_type:
            return 99
        return (today - last_date_by_type[rtype]).days

    days_since_long     = days_since("long")
    days_since_tempo    = days_since("tempo")
    days_since_interval = days_since("interval")

    # ── Most recent run overall ───────────────────────────────────────────────
    all_run_dates: list[date] = []
    for ds, _ in all_classified:
        try:
            all_run_dates.append(date.fromisoformat(ds))
        except Exception:
            pass
    last_any_run: int | None = None
    if all_run_dates:
        last_any_run = (today - max(all_run_dates)).days

    # ── Consecutive run days (looking back from today) ────────────────────────
    run_date_set = set(all_run_dates)
    consecutive = 0
    check = today - timedelta(days=1)
    while check in run_date_set:
        consecutive += 1
        check -= timedelta(days=1)

    # ── Weekly volume vs 4-week average ──────────────────────────────────────
    week_km  = sum(
        r["distance_km"] for r in garmin_runs
        if r["distance_km"] and r["date"] >= (today - timedelta(days=7)).isoformat()
    ) + sum(
        r["distance_km"] for r in manual_runs
        if r["distance_km"] and r["date"] >= (today - timedelta(days=7)).isoformat()
    )
    avg_weekly_km = sum(
        r["distance_km"] for r in garmin_runs if r["distance_km"]
    ) / 4 + sum(
        r["distance_km"] for r in manual_runs if r["distance_km"]
    ) / 4
    high_volume_week = avg_weekly_km > 5 and week_km >= avg_weekly_km * 1.20

    # ── Fatigue signals from health metrics ───────────────────────────────────
    rhr_row = conn.execute("""
        SELECT AVG(resting_hr) AS avg_rhr FROM steps
        WHERE date >= ? AND resting_hr IS NOT NULL
    """, ((today - timedelta(days=2)).isoformat(),)).fetchone()
    rhr_row7 = conn.execute("""
        SELECT AVG(resting_hr) AS avg_rhr7 FROM steps
        WHERE date >= ? AND resting_hr IS NOT NULL
    """, ((today - timedelta(days=7)).isoformat(),)).fetchone()
    current_rhr  = rhr_row["avg_rhr"]   if rhr_row  else None
    baseline_rhr = rhr_row7["avg_rhr7"] if rhr_row7 else None
    rhr_elevated = current_rhr and baseline_rhr and current_rhr > baseline_rhr * 1.05

    hrv_today_row = conn.execute(
        "SELECT hrv_value FROM hrv WHERE date = ?", (today.isoformat(),)
    ).fetchone()
    hrv_mean_row  = conn.execute("""
        SELECT AVG(hrv_value) AS avg_hrv FROM hrv WHERE date >= ?
    """, ((today - timedelta(days=7)).isoformat(),)).fetchone()
    hrv_today      = hrv_today_row["hrv_value"] if hrv_today_row else None
    hrv_mean7      = hrv_mean_row["avg_hrv"]    if hrv_mean_row  else None
    hrv_suppressed = hrv_today and hrv_mean7 and hrv_today < hrv_mean7 * 0.90

    sleep_row = conn.execute("""
        SELECT efficiency, total_sleep_seconds FROM sleep
        WHERE date IN (?, ?) ORDER BY date DESC LIMIT 1
    """, (today.isoformat(), (today - timedelta(days=1)).isoformat())).fetchone()
    poor_sleep = sleep_row and (
        (sleep_row["efficiency"] and sleep_row["efficiency"] < 75) or
        (sleep_row["total_sleep_seconds"] and sleep_row["total_sleep_seconds"] < 21600)
    )

    strain_row = conn.execute("""
        SELECT AVG(strength_strain) AS avg FROM workout_sessions
        WHERE finished_at IS NOT NULL AND DATE(finished_at) >= ? AND strength_strain > 0
    """, ((today - timedelta(days=2)).isoformat(),)).fetchone()
    heavy_gym = strain_row["avg"] and strain_row["avg"] >= 55

    # ── Ran hard or long yesterday / today? ───────────────────────────────────
    # Check Garmin + manual for any hard effort in last 24–48h
    recent_hard = any(
        rtype in ("long", "tempo", "interval")
        for ds, rtype in all_classified
        if ds >= (today - timedelta(days=1)).isoformat()
    )
    ran_today = any(
        ds == today.isoformat()
        for ds, _ in all_classified
    )

    # ── Decision tree ─────────────────────────────────────────────────────────
    recovery_flags = sum([bool(rhr_elevated), bool(hrv_suppressed), bool(poor_sleep)])
    is_fatigued    = recovery_flags >= 2 or (heavy_gym and recovery_flags >= 1)
    urgency        = "medium"

    # 1. Physiological fatigue always wins
    if is_fatigued:
        rtype   = "recovery"
        urgency = "high"
        if hrv_suppressed and rhr_elevated:
            reason = "HRV is suppressed and resting HR is elevated — your body is signalling it needs an easy day."
        elif poor_sleep:
            reason = "Poor sleep last night — a short recovery run will promote blood flow without adding stress."
        else:
            reason = "Recent training load and fatigue markers suggest a light aerobic session today."

    # 2. No running history
    elif last_any_run is None:
        rtype  = "easy"
        reason = "No running history yet — let's start with an easy calibration run to set your zones."

    # 3. Already ran today
    elif ran_today:
        rtype   = "recovery"
        urgency = "low"
        reason  = "You've already run today — if you want a second session, keep it very easy."

    # 4. Consecutive days: 3+ in a row → mandatory easy
    elif consecutive >= 3:
        rtype   = "recovery" if consecutive >= 4 else "easy"
        urgency = "medium"
        reason  = (f"You've run {consecutive} days in a row — "
                   f"{'a rest day or very easy jog' if consecutive >= 4 else 'an easy day'} "
                   f"protects against injury and lets your body adapt.")

    # 5. Hard/long session yesterday → never suggest another hard session
    elif recent_hard:
        rtype   = "easy"
        urgency = "low"
        # Explain specifically what they did
        yesterday_types = [rtype for ds, rtype in all_classified
                           if ds >= (today - timedelta(days=1)).isoformat()]
        what = yesterday_types[0] if yesterday_types else "hard"
        reason = (f"You did a {what} run yesterday — an easy aerobic run today "
                  f"consolidates the adaptation without adding cumulative fatigue.")

    # 6. Haven't run in several days
    elif last_any_run >= 5:
        rtype   = "easy"
        urgency = "high"
        reason  = (f"You haven't run in {last_any_run} days — ease back in with a comfortable "
                   f"aerobic run before returning to quality sessions.")

    # 7. High-volume week → protect with easy
    elif high_volume_week:
        rtype   = "easy"
        urgency = "low"
        reason  = (f"You're tracking {round(week_km, 1)} km this week "
                   f"(above your ~{round(avg_weekly_km, 1)} km average) — "
                   f"an easy run keeps the week strong without overdoing it.")

    # 8. Long run overdue (≥8 days) and not fatigued
    elif days_since_long >= 8 and not is_fatigued and not recent_hard:
        rtype   = "long"
        urgency = "high"
        ld      = last_date_by_type.get("long")
        reason  = (f"Your long run was {days_since_long} days ago "
                   f"({'on ' + ld.strftime('%a %-d %b') if ld else 'a while back'}) — "
                   f"this is your most important aerobic session of the week.")

    # 9. Tempo overdue (≥6 days) and not fatigued
    elif days_since_tempo >= 6 and not is_fatigued:
        rtype   = "tempo"
        urgency = "medium"
        reason  = (f"No tempo work in {days_since_tempo} days — "
                   f"a threshold session is the fastest way to raise your aerobic ceiling.")

    # 10. Intervals overdue (≥10 days) and not fatigued
    elif days_since_interval >= 10 and not is_fatigued and profile.get("vdot"):
        rtype   = "interval"
        urgency = "medium"
        reason  = (f"Intervals are {days_since_interval} days overdue — "
                   f"VO₂max work keeps your top-end speed from fading.")

    # 11. Default: easy run
    else:
        rtype   = "easy"
        urgency = "low"
        reason  = "Training is well balanced — a comfortable easy run builds your aerobic base."

    # ── Build pacing for the suggestion ───────────────────────────────────────
    pz = profile.get("pace_zones", {}).get(rtype)
    hr = profile.get("hr_zones",   {}).get(rtype, [0, 0])
    dist = DEFAULT_DISTANCES[rtype]

    structure = ""
    if pz:
        structure = _workout_structure(rtype, dist, pz["pace_low_s_km"], pz["pace_high_s_km"])

    return {
        "type":             rtype,
        "reason":           reason,
        "urgency":          urgency,
        "coach_note":       COACH_NOTES[rtype],
        "target_distance_km": dist,
        "pace_zone":        pz,
        "hr_zone":          hr,
        "workout_structure": structure,
        "meta":             TYPE_META[rtype],
    }


# ─── Pacing plan for a specific run type ─────────────────────────────────────

def _pacing_plan(profile: dict, run_type: str, distance_km: float) -> dict:
    pz = profile.get("pace_zones", {}).get(run_type)
    hr = profile.get("hr_zones", {}).get(run_type, [0, 0])
    vdot = profile.get("vdot")

    structure = ""
    if pz:
        structure = _workout_structure(run_type, distance_km, pz["pace_low_s_km"], pz["pace_high_s_km"])

    basis = None
    if vdot:
        est5k = profile.get("estimated_5k_s")
        if est5k:
            m, s = divmod(int(est5k), 60)
            basis = f"Based on your estimated 5K of {m}:{s:02d} (VDOT {round(vdot, 1)})"
        else:
            basis = f"Based on your running data (VDOT {round(vdot, 1)})"
    else:
        basis = "Not enough run data yet — pace zones will improve with more activity."

    return {
        "type":              run_type,
        "distance_km":       distance_km,
        "pace_zone":         pz,
        "hr_zone":           hr,
        "workout_structure": structure,
        "coach_note":        COACH_NOTES[run_type],
        "description":       TYPE_META[run_type]["description"],
        "basis":             basis,
        "max_hr_used":       profile.get("max_hr_observed"),
        "vdot":              vdot,
    }


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/profile")
def get_profile(user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        profile = _get_running_profile(conn)
    return profile


@router.get("/suggest")
def suggest_run(user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        profile    = _get_running_profile(conn)
        suggestion = _smart_suggest(conn, profile)
    return suggestion


@router.get("/plan")
def get_plan(
    type: str = "easy",
    distance_km: float = 8.0,
    user_id: str = Depends(get_current_user),
):
    if type not in VDOT_PCTS:
        raise HTTPException(400, f"Unknown run type: {type}")
    with db(user_id) as conn:
        profile = _get_running_profile(conn)
    return _pacing_plan(profile, type, distance_km)


class RunLogCreate(BaseModel):
    type:               str
    planned_distance_km: Optional[float] = None
    actual_distance_km:  Optional[float] = None
    actual_duration_s:   Optional[int]   = None
    actual_avg_hr:       Optional[int]   = None
    notes:               Optional[str]   = None


@router.post("/logs", status_code=201)
def create_run_log(body: RunLogCreate, user_id: str = Depends(get_current_user)):
    if body.type not in VDOT_PCTS:
        raise HTTPException(400, f"Unknown run type: {body.type}")

    avg_pace: int | None = None
    if body.actual_distance_km and body.actual_duration_s and body.actual_distance_km > 0:
        avg_pace = int(body.actual_duration_s / body.actual_distance_km)

    with db(user_id) as conn:
        cur = conn.execute("""
            INSERT INTO run_logs
              (type, planned_distance_km, actual_distance_km,
               actual_duration_s, actual_avg_pace_s_km, actual_avg_hr,
               notes, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            body.type, body.planned_distance_km, body.actual_distance_km,
            body.actual_duration_s, avg_pace, body.actual_avg_hr, body.notes,
        ))
    return {"id": cur.lastrowid, "status": "logged"}


@router.get("/logs")
def list_run_logs(limit: int = 30, user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        rows = conn.execute("""
            SELECT * FROM run_logs
            ORDER BY started_at DESC LIMIT ?
        """, (limit,)).fetchall()
    return [dict(r) for r in rows]


@router.delete("/logs/{log_id}")
def delete_run_log(log_id: int, user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        row = conn.execute("SELECT id FROM run_logs WHERE id=?", (log_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Run log not found")
        conn.execute("DELETE FROM run_logs WHERE id=?", (log_id,))
    return {"status": "deleted"}
