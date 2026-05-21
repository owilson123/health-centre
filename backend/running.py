"""Running coach — personalised pace plans, VDOT tracking, run logging."""
import math
import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
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

        CREATE TABLE IF NOT EXISTS training_programs (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            race_date        TEXT NOT NULL,
            race_distance_km REAL NOT NULL,
            target_time_s    INTEGER,
            runs_per_week    INTEGER NOT NULL DEFAULT 4,
            created_at       TEXT DEFAULT (datetime('now')),
            active           INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS training_plan_days (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            program_id       INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
            plan_date        TEXT NOT NULL,
            week_number      INTEGER NOT NULL,
            phase            TEXT NOT NULL,
            run_type         TEXT NOT NULL,
            distance_km      REAL NOT NULL,
            pace_target_s_km INTEGER,
            notes            TEXT,
            completed        INTEGER DEFAULT 0,
            actual_log_id    INTEGER
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
        "Complete your warm-up km at a genuinely easy pace — this is non-negotiable. "
        "'Comfortably hard' is the target: you can speak in 3–4 word bursts, not full sentences. "
        "If you feel controlled at tempo pace 5 minutes in, you're nailing it. "
        "Cool-down km should feel like active recovery, not a continuation of effort."
    ),
    "interval": (
        "Complete every warm-up km before touching interval pace. "
        "Each rep should feel identical — if rep 4 is noticeably harder than rep 1, "
        "your recovery jog is too short or your rep pace is too fast. "
        "Stop the session if pace slips more than 5 sec/km — quality over volume. "
        "Walk the cool-down km if needed."
    ),
}


# ─── Workout structure builders ───────────────────────────────────────────────
#
# Warm-up / cool-down expressed in km (not minutes) — derived from the user's
# actual easy pace.  A 6:00/km runner's 12-min warm-up = 2 km; a 5:00/km
# runner's same 12 min = 2.4 km.  Much more actionable than a time target.

def _wu_cd_km(easy_pace_s: int | None, wu_min: float = 12, cd_min: float = 10) -> tuple[float, float]:
    """Convert warm-up / cool-down minutes into km based on easy pace."""
    pace  = easy_pace_s or 360                          # default 6:00/km
    wu_km = round((wu_min * 60 / pace) * 2) / 2        # round to nearest 0.5 km
    cd_km = round((cd_min * 60 / pace) * 2) / 2
    return max(1.0, wu_km), max(1.0, cd_km)


def _interval_structure(
    distance_km: float,
    pace_lo_s: int,
    pace_hi_s: int,
    easy_pace_s: int | None,
) -> str:
    """
    Select the best interval session for the planned distance.

    Session types (chosen by total distance):
    ┌──────────────┬──────────────┬──────────────────────────────────────────────┐
    │ Session      │ Distance     │ Primary stimulus                             │
    ├──────────────┼──────────────┼──────────────────────────────────────────────┤
    │ 400m repeats │ ≤ 6 km       │ Speed / neuromuscular — develops leg turnover│
    │ 800m repeats │ 6–8.5 km     │ VO₂max — the gold-standard interval session  │
    │ 1000m reps   │ 8.5–11 km    │ VO₂max + threshold — sustained high effort   │
    │ 1200m reps   │ 11–14 km     │ Threshold / VO₂max crossover                 │
    │ Mile repeats │ > 14 km      │ Race-specific VO₂max and pace control         │
    └──────────────┴──────────────┴──────────────────────────────────────────────┘
    Recovery jog between reps = 400m easy.
    """
    wu_km, cd_km = _wu_cd_km(easy_pace_s, wu_min=12, cd_min=10)
    pace_str     = _fmt_pace(int((pace_lo_s + pace_hi_s) / 2))
    rec_str      = "400m easy jog"

    if distance_km <= 6.0:
        # 400m repeats — short, sharp, leg speed
        work_km = max(1.0, distance_km - wu_km - cd_km)
        reps    = max(4, min(8, int(work_km * 1000 / (400 + 400))))
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{reps}×400m @ {pace_str} with {rec_str} between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    elif distance_km <= 8.5:
        # 800m repeats — classic VO₂max session
        work_km = max(1.0, distance_km - wu_km - cd_km)
        reps    = max(3, min(6, int(work_km * 1000 / (800 + 400))))
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{reps}×800m @ {pace_str} with {rec_str} between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    elif distance_km <= 11.0:
        # 1000m repeats — extended VO₂max stimulus
        work_km = max(1.0, distance_km - wu_km - cd_km)
        reps    = max(3, min(5, int(work_km * 1000 / (1000 + 400))))
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{reps}×1000m @ {pace_str} with {rec_str} between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    elif distance_km <= 14.0:
        # 1200m repeats — VO₂max / threshold crossover
        work_km = max(1.0, distance_km - wu_km - cd_km)
        reps    = max(3, min(5, int(work_km * 1000 / (1200 + 400))))
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{reps}×1200m @ {pace_str} with {rec_str} between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    else:
        # Mile (1600m) repeats — elite VO₂max development
        work_km = max(1.0, distance_km - wu_km - cd_km)
        reps    = max(3, min(5, int(work_km * 1000 / (1600 + 400))))
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{reps}×1600m @ {pace_str} with {rec_str} between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )


def _tempo_structure(
    distance_km: float,
    pace_lo_s: int,
    pace_hi_s: int,
    easy_pace_s: int | None,
) -> str:
    """
    Select the best tempo session for the planned distance.

    Session types (chosen by total distance):
    ┌────────────────────┬──────────────┬───────────────────────────────────────────┐
    │ Session            │ Distance     │ Best for                                  │
    ├────────────────────┼──────────────┼───────────────────────────────────────────┤
    │ Tempo repeats      │ ≤ 7 km       │ Building sustained threshold tolerance    │
    │ Cruise intervals   │ 7–10 km      │ Classic Daniels T-pace; high quality vol  │
    │ Sustained tempo    │ 10–14 km     │ Race-specific threshold — single block     │
    │ Progressive tempo  │ > 14 km      │ Negative-split race simulation            │
    └────────────────────┴──────────────┴───────────────────────────────────────────┘
    """
    wu_km, cd_km = _wu_cd_km(easy_pace_s, wu_min=12, cd_min=10)
    pace_str     = f"{_fmt_pace(pace_lo_s)}–{_fmt_pace(pace_hi_s)}"
    work_km      = max(1.0, distance_km - wu_km - cd_km)

    if distance_km <= 7.0:
        # Tempo repeats — 3 reps of N min with short easy jog between
        # Each rep ≈ work_km/3 distance; jog between ≈ 0.5 km
        rep_km   = max(0.8, round(work_km / 3 / 0.5) * 0.5)   # round to 0.5 km
        jog_km   = round((120 / (easy_pace_s or 360)), 1)       # ~2 min easy jog
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"3×{rep_km:.1f} km @ {pace_str} with {jog_km:.1f} km easy jog between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    elif distance_km <= 10.0:
        # Cruise intervals — 2 blocks with a short easy km between (classic Daniels)
        rep_km = max(1.5, round(work_km / 2 / 0.5) * 0.5)
        jog_km = max(0.5, round((120 / (easy_pace_s or 360)) * 2) / 2)
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"2×{rep_km:.1f} km @ {pace_str} with {jog_km:.1f} km easy between  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    elif distance_km <= 14.0:
        # Sustained continuous tempo — single unbroken block
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{work_km:.1f} km continuous @ {pace_str}  →  "
            f"{cd_km:.1f} km easy cool-down"
        )
    else:
        # Progressive tempo / negative-split long effort
        easy_km   = round(work_km * 0.40 / 0.5) * 0.5
        mid_km    = round(work_km * 0.30 / 0.5) * 0.5
        tempo_km  = max(1.0, round((work_km - easy_km - mid_km) / 0.5) * 0.5)
        mid_pace  = _fmt_pace(int((easy_pace_s or 360) * 0.90))  # ~marathon pace
        return (
            f"{wu_km:.1f} km easy warm-up  →  "
            f"{easy_km:.1f} km easy  →  "
            f"{mid_km:.1f} km @ marathon pace ({mid_pace})  →  "
            f"{tempo_km:.1f} km @ tempo pace ({pace_str})  →  "
            f"{cd_km:.1f} km easy cool-down"
        )


def _workout_structure(
    run_type: str,
    distance_km: float,
    pace_lo_s: int,
    pace_hi_s: int,
    easy_pace_s: int | None = None,
) -> str:
    """Route to the correct session builder based on run type."""
    if run_type == "interval":
        return _interval_structure(distance_km, pace_lo_s, pace_hi_s, easy_pace_s)
    elif run_type == "tempo":
        return _tempo_structure(distance_km, pace_lo_s, pace_hi_s, easy_pace_s)
    elif run_type == "long":
        wu_km, cd_km = _wu_cd_km(easy_pace_s, wu_min=10, cd_min=8)
        split_km = round((distance_km - wu_km) / 2 / 0.5) * 0.5
        return (
            f"{wu_km:.1f} km easy to settle in  →  "
            f"{split_km:.1f} km at {_fmt_pace(pace_hi_s)} (comfortable)  →  "
            f"{split_km:.1f} km at {_fmt_pace(pace_lo_s)} (negative split — slightly quicker)  →  "
            f"Walk the final {cd_km:.1f} km to cool down"
        )
    else:  # recovery / easy
        wu_km, cd_km = _wu_cd_km(easy_pace_s, wu_min=8, cd_min=5)
        run_km = max(1.0, distance_km - wu_km - cd_km)
        return (
            f"Walk {0.5:.1f} km to warm up  →  "
            f"Run {run_km:.1f} km at {_fmt_pace(pace_hi_s)}–{_fmt_pace(pace_lo_s)} — "
            f"walk whenever HR climbs above zone 2  →  "
            f"Walk {0.5:.1f} km cool-down"
        )


# ─── Core profile builder ────────────────────────────────────────────────────

def _get_running_profile(conn) -> dict:
    """
    Build a full running profile from Garmin activities + manual run logs.
    Returns VDOT, pace zones, HR zones, and weekly stats.

    VDOT is derived from the last 30 days of runs (most recent fitness signal).
    Falls back to 90 days if fewer than 2 qualifying runs exist in the 30-day window.
    """
    today      = date.today()
    cutoff_90  = (today - timedelta(days=90)).isoformat()
    cutoff_30  = (today - timedelta(days=30)).isoformat()

    def _fetch_runs(cutoff: str):
        g = conn.execute("""
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
        m = conn.execute("""
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
        return [dict(r) for r in g] + [dict(r) for r in m]

    # Use 30-day window for VDOT (most recent fitness); fall back to 90 days
    runs_30 = _fetch_runs(cutoff_30)
    all_runs = runs_30 if len(runs_30) >= 2 else _fetch_runs(cutoff_90)

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
    for r in all_runs:
        if r.get("max_hr") and r["max_hr"] > (max_hr_obs or 0):
            max_hr_obs = int(r["max_hr"])
    # Also check all activities for observed max (cycling etc. still shows HR)
    hr_row = conn.execute(
        "SELECT MAX(max_hr) FROM activities WHERE date >= ?", (cutoff_90,)
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


# ─── Training program generation ─────────────────────────────────────────────
#
# Expert running coach methodology:
#   • Jack Daniels VDOT-based pace zones
#   • Polarised training: ~80% easy, ~20% quality
#   • 3-week loading cycles (load / load / recovery)
#   • Periodised phases: Base → Build → Peak → Taper
#   • Race-appropriate long run caps
#   • Progressive overload with fatigue management

# Day offsets from Monday (0=Mon, 6=Sun) for each runs-per-week slot
_WEEK_DAY_SLOTS = {
    2: [1, 5],                # Tue, Sat
    3: [1, 3, 5],             # Tue, Thu, Sat
    4: [0, 2, 4, 5],          # Mon, Wed, Fri, Sat
    5: [0, 1, 3, 4, 5],       # Mon, Tue, Thu, Fri, Sat
    6: [0, 1, 2, 3, 4, 5],    # Mon–Sat
}

# Run type patterns — 'quality' alternates tempo/interval per week
_WEEK_TYPE_PATTERNS = {
    2: ["easy",     "long"],
    3: ["easy",     "quality",   "long"],
    4: ["easy",     "quality",   "easy",     "long"],
    5: ["easy",     "quality",   "recovery", "easy",    "long"],
    6: ["easy",     "quality",   "recovery", "easy",    "quality",  "long"],
}

# Peak long run cap (km) by race distance
def _peak_long_run_km(race_km: float) -> float:
    if race_km <= 6:   return 18.0
    if race_km <= 12:  return 24.0
    if race_km <= 25:  return 32.0
    return 38.0

def _get_phase(week: int, build_start: int, peak_start: int, taper_start: int) -> str:
    if week >= taper_start: return "Taper"
    if week >= peak_start:  return "Peak"
    if week >= build_start: return "Build"
    return "Base"

def _plan_day_note(run_type: str, phase: str, race_km: float) -> str:
    notes: dict[str, dict[str, str]] = {
        "easy": {
            "Base":  "Conversational effort — build your aerobic engine.",
            "Build": "Resist the urge to push. Save it for quality days.",
            "Peak":  "Active recovery between quality sessions.",
            "Taper": "Keep the legs fresh. Easy and controlled.",
        },
        "long": {
            "Base":  "Foundation long run. Easy to moderate effort throughout.",
            "Build": "Progressive effort — start easy, allow pace to drift in final third.",
            "Peak":  "Race-simulation long run. Practice your race nutrition strategy.",
            "Taper": "Confidence long run — shorter but same rhythm as race day.",
        },
        "tempo": {
            "Base":  "First tempo exposure. Focus on rhythm and form, not speed.",
            "Build": "Lactate threshold work. Comfortably hard — 3–4 word sentences only.",
            "Peak":  "Race-pace precision. This is your target speed — memorise the feel.",
            "Taper": "Short tempo to maintain sharpness without adding fatigue.",
        },
        "interval": {
            "Base":  "Controlled speed work — introduce fast running gently.",
            "Build": "VO₂max intervals. Hard effort, full recovery between reps.",
            "Peak":  "Race-specific speed. Fast, controlled, and consistent.",
            "Taper": "Short sharp intervals — keep the engine revving.",
        },
        "recovery": {
            "Base":  "Very easy jog — barely above a walk. Flush accumulated fatigue.",
            "Build": "Active recovery between hard sessions — protect the adaptations.",
            "Peak":  "Protect the legs. Walk if needed.",
            "Taper": "Gentle movement — keep the body ticking over.",
        },
        "race": {
            "Race":  f"Race day! {race_km:.0f}K — trust your training. Negative split.",
        },
    }
    p = phase if phase in ("Base", "Build", "Peak", "Taper", "Race") else "Base"
    return notes.get(run_type, {}).get(p, f"{phase} {run_type} run")


def _generate_training_plan(
    race_date_str:    str,
    race_distance_km: float,
    target_time_s:    int | None,
    runs_per_week:    int,
    current_vdot:     float | None,
    monthly_km:       float,
) -> list[dict]:
    """
    Generate a race-specific training plan.

    Phases (by % of total weeks):
      Base  ≈ 45%  — aerobic foundation, 80/20 easy/quality
      Build ≈ 30%  — introduce quality, progressive volume
      Peak  ≈ 15%  — race-specific quality, maximum long runs
      Taper ≈ 10%  — volume drops, intensity maintained
    """
    today        = date.today()
    race_date    = date.fromisoformat(race_date_str)
    runs_per_week = max(2, min(6, runs_per_week))

    days_to_race = (race_date - today).days
    total_weeks  = max(4, days_to_race // 7)

    # Taper / peak durations calibrated to race distance
    if race_distance_km <= 6:
        taper_wks, peak_wks = 1, 2
    elif race_distance_km <= 12:
        taper_wks, peak_wks = 2, 2
    elif race_distance_km <= 25:
        taper_wks, peak_wks = 2, 3
    else:
        taper_wks, peak_wks = 3, 3

    # Clamp to available weeks
    total_quality = min(taper_wks + peak_wks, total_weeks - 2)
    taper_wks     = min(taper_wks, total_quality // 2 + total_quality % 2)
    peak_wks      = total_quality - taper_wks

    # Phase boundary week numbers (1-indexed)
    taper_start = total_weeks - taper_wks + 1
    peak_start  = taper_start - peak_wks
    base_weeks  = peak_start - 1
    build_start = max(2, base_weeks // 2 + 1)

    # ── Volume progression ─────────────────────────────────────────────────
    start_km = max(15.0, round(monthly_km / 4.33))
    if race_distance_km <= 6:
        peak_km = min(60.0, max(30.0, start_km * 1.8))
    elif race_distance_km <= 12:
        peak_km = min(70.0, max(40.0, start_km * 2.0))
    elif race_distance_km <= 25:
        peak_km = min(80.0, max(50.0, start_km * 2.2))
    else:
        peak_km = min(95.0, max(60.0, start_km * 2.5))

    # Build km array with 3-week loading cycles in base/build
    week_kms: list[float] = []
    for w in range(1, total_weeks + 1):
        ph = _get_phase(w, build_start, peak_start, taper_start)
        if ph == "Taper":
            ti = w - taper_start
            km = peak_km * max(0.35, 0.65 - ti * 0.22)
        elif ph == "Peak":
            pi = w - peak_start
            km = peak_km * (0.90 + pi * 0.05)
        elif ph == "Build":
            bw = peak_start - build_start
            bf = (w - build_start) / max(1, bw)
            mid_km = start_km + (peak_km - start_km) * 0.5
            km = mid_km + (peak_km - mid_km) * bf
        else:  # Base
            basew = build_start - 1
            bf    = (w - 1) / max(1, basew)
            km    = start_km + (peak_km - start_km) * 0.45 * bf
        # Every 3rd base/build week is a recovery week (-20%)
        if ph in ("Base", "Build") and w % 3 == 0:
            km *= 0.80
        week_kms.append(max(10.0, round(km)))

    # ── Long run progression ───────────────────────────────────────────────
    peak_long  = _peak_long_run_km(race_distance_km)
    start_long = max(6.0, round(monthly_km / 4.33 * 0.4))

    # ── Training VDOT for pace targets ─────────────────────────────────────
    training_vdot = current_vdot
    if target_time_s and race_distance_km > 0:
        tv = _vdot_from_effort(race_distance_km * 1000, target_time_s)
        if tv and current_vdot:
            # Train towards target — use conservative blend (30% toward goal)
            training_vdot = current_vdot + (tv - current_vdot) * 0.30
        elif tv:
            training_vdot = tv * 0.88

    # ── Assign runs to calendar days ───────────────────────────────────────
    # Start from Monday of next week
    next_monday  = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
    day_slots    = _WEEK_DAY_SLOTS.get(runs_per_week, _WEEK_DAY_SLOTS[4])
    type_pattern = _WEEK_TYPE_PATTERNS.get(runs_per_week, _WEEK_TYPE_PATTERNS[4])

    days_out: list[dict] = []
    quality_toggle = 0

    for w in range(1, total_weeks + 1):
        wkm      = week_kms[w - 1]
        ph       = _get_phase(w, build_start, peak_start, taper_start)
        week_mon = next_monday + timedelta(weeks=w - 1)

        # Long run for this week
        if ph == "Taper":
            ti       = w - taper_start
            long_km  = round(peak_long * max(0.45, 0.70 - ti * 0.22), 1)
        elif ph == "Peak":
            pi       = w - peak_start
            long_km  = round(start_long + (peak_long - start_long) * (0.85 + pi * 0.08), 1)
        else:
            prog     = (w - 1) / max(1, peak_start - 2)
            long_km  = round(start_long + (peak_long - start_long) * 0.80 * prog, 1)
        long_km = max(6.0, long_km)

        # Quality type alternates tempo / interval (no intervals in Base)
        quality_type = "tempo" if ph == "Base" else ["tempo", "interval"][quality_toggle % 2]
        quality_toggle += (0 if ph == "Base" else 1)

        non_long_slots = max(1, len(day_slots) - 1)
        non_long_km    = max(non_long_slots * 4.0, wkm - long_km)

        for slot_i, (day_off, rtype_raw) in enumerate(zip(day_slots, type_pattern)):
            run_date = week_mon + timedelta(days=day_off)
            if run_date >= race_date:
                continue

            rtype = rtype_raw if rtype_raw != "quality" else quality_type

            if rtype == "long":
                dist = long_km
            elif rtype == "recovery":
                dist = max(4.0, round(non_long_km / non_long_slots * 0.55, 1))
            elif rtype == "interval":
                dist = max(5.0, min(12.0, round(non_long_km / non_long_slots * 0.90, 1)))
            elif rtype == "tempo":
                dist = max(5.0, min(14.0, round(non_long_km / non_long_slots * 1.05, 1)))
            else:  # easy
                dist = max(5.0, round(non_long_km / non_long_slots, 1))

            # Taper reduction
            if ph == "Taper":
                tf   = max(0.40, 0.70 - (w - taper_start) * 0.22)
                dist = max(3.0, round(dist * tf, 1))

            # VDOT pace target
            pace_target: int | None = None
            if training_vdot:
                pcts       = VDOT_PCTS.get(rtype, VDOT_PCTS["easy"])
                mid_pct    = (pcts[0] + pcts[1]) / 2
                pace_target = _pace_s_km_from_vdot(training_vdot, mid_pct)

            days_out.append({
                "plan_date":        run_date.isoformat(),
                "week_number":      w,
                "phase":            ph,
                "run_type":         rtype,
                "distance_km":      dist,
                "pace_target_s_km": pace_target,
                "notes":            _plan_day_note(rtype, ph, race_distance_km),
            })

    # Race day marker
    race_pace: int | None = None
    if training_vdot:
        pct = 0.97 if race_distance_km <= 6 else (0.88 if race_distance_km <= 12 else 0.83)
        race_pace = _pace_s_km_from_vdot(training_vdot, pct)

    days_out.append({
        "plan_date":        race_date.isoformat(),
        "week_number":      total_weeks + 1,
        "phase":            "Race",
        "run_type":         "race",
        "distance_km":      race_distance_km,
        "pace_target_s_km": race_pace,
        "notes":            _plan_day_note("race", "Race", race_distance_km),
    })

    return days_out


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

    easy_pz_s = (profile.get("pace_zones", {}).get("easy") or {}).get("pace_s_km")
    structure = ""
    if pz:
        structure = _workout_structure(rtype, dist, pz["pace_low_s_km"], pz["pace_high_s_km"], easy_pz_s)

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

    easy_pz_s = (profile.get("pace_zones", {}).get("easy") or {}).get("pace_s_km")
    structure = ""
    if pz:
        structure = _workout_structure(run_type, distance_km, pz["pace_low_s_km"], pz["pace_high_s_km"], easy_pz_s)

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


# ─── Training program routes ──────────────────────────────────────────────────

class ProgramCreate(BaseModel):
    name:             str
    race_date:        str           # YYYY-MM-DD
    race_distance_km: float
    target_time_s:    Optional[int] = None
    runs_per_week:    int = 4


@router.post("/programs", status_code=201)
def create_program(body: ProgramCreate, user_id: str = Depends(get_current_user)):
    # Validate race date
    try:
        rd = date.fromisoformat(body.race_date)
    except ValueError:
        raise HTTPException(400, "Invalid race_date — use YYYY-MM-DD")
    if rd <= date.today():
        raise HTTPException(400, "Race date must be in the future")

    with db(user_id) as conn:
        profile = _get_running_profile(conn)

        # Deactivate any existing programs
        conn.execute("UPDATE training_programs SET active=0")

        cur = conn.execute("""
            INSERT INTO training_programs
              (name, race_date, race_distance_km, target_time_s, runs_per_week, active)
            VALUES (?, ?, ?, ?, ?, 1)
        """, (body.name, body.race_date, body.race_distance_km,
              body.target_time_s, body.runs_per_week))
        program_id = cur.lastrowid

        # Generate plan days
        days = _generate_training_plan(
            race_date_str    = body.race_date,
            race_distance_km = body.race_distance_km,
            target_time_s    = body.target_time_s,
            runs_per_week    = body.runs_per_week,
            current_vdot     = profile.get("vdot"),
            monthly_km       = profile.get("monthly_km") or 0.0,
        )
        conn.executemany("""
            INSERT INTO training_plan_days
              (program_id, plan_date, week_number, phase, run_type,
               distance_km, pace_target_s_km, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            (program_id, d["plan_date"], d["week_number"], d["phase"],
             d["run_type"], d["distance_km"], d["pace_target_s_km"], d["notes"])
            for d in days
        ])

    return {
        "id":             program_id,
        "name":           body.name,
        "race_date":      body.race_date,
        "race_distance_km": body.race_distance_km,
        "total_weeks":    max((d["week_number"] for d in days), default=0),
        "total_days":     len(days),
    }


@router.get("/programs")
def list_programs(user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        rows = conn.execute("""
            SELECT p.*,
                   COUNT(d.id) AS total_days,
                   SUM(d.completed) AS completed_days
            FROM training_programs p
            LEFT JOIN training_plan_days d ON d.program_id = p.id
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT 10
        """).fetchall()
    return [dict(r) for r in rows]


@router.get("/programs/active")
def get_active_program(user_id: str = Depends(get_current_user)):
    """Return the active program with upcoming week's plan days."""
    today = date.today().isoformat()
    with db(user_id) as conn:
        prog = conn.execute(
            "SELECT * FROM training_programs WHERE active=1 ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        if not prog:
            return None

        # Next 14 days of plan days
        upcoming = conn.execute("""
            SELECT * FROM training_plan_days
            WHERE program_id=? AND plan_date >= ? AND completed=0
            ORDER BY plan_date ASC
            LIMIT 14
        """, (prog["id"], today)).fetchall()

        # Completion stats
        stats = conn.execute("""
            SELECT COUNT(*) AS total,
                   SUM(completed) AS done,
                   MAX(CASE WHEN completed=1 THEN plan_date END) AS last_completed
            FROM training_plan_days WHERE program_id=?
        """, (prog["id"],)).fetchone()

    today_d   = date.today()
    race_d    = date.fromisoformat(prog["race_date"])
    days_left = (race_d - today_d).days

    return {
        **dict(prog),
        "days_to_race":     days_left,
        "weeks_to_race":    days_left // 7,
        "upcoming_days":    [dict(d) for d in upcoming],
        "total_days":       stats["total"] or 0,
        "completed_days":   stats["done"] or 0,
        "last_completed":   stats["last_completed"],
    }


@router.get("/programs/calendar")
def programs_calendar(
    start: str = Query(..., description="YYYY-MM-DD"),
    end:   str = Query(..., description="YYYY-MM-DD"),
    user_id: str = Depends(get_current_user),
):
    """Return training plan days for a date range (for calendar integration)."""
    with db(user_id) as conn:
        rows = conn.execute("""
            SELECT d.*, p.name AS program_name, p.race_distance_km
            FROM training_plan_days d
            JOIN training_programs p ON p.id = d.program_id
            WHERE p.active = 1
              AND d.plan_date >= ? AND d.plan_date <= ?
            ORDER BY d.plan_date ASC
        """, (start, end)).fetchall()
    return [dict(r) for r in rows]


@router.patch("/programs/{program_id}/days/{day_id}/complete")
def complete_plan_day(
    program_id: int,
    day_id:     int,
    user_id:    str = Depends(get_current_user),
):
    with db(user_id) as conn:
        row = conn.execute(
            "SELECT id FROM training_plan_days WHERE id=? AND program_id=?",
            (day_id, program_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Plan day not found")
        conn.execute(
            "UPDATE training_plan_days SET completed=1 WHERE id=?", (day_id,)
        )
    return {"status": "completed"}


@router.delete("/programs/{program_id}")
def delete_program(program_id: int, user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        row = conn.execute(
            "SELECT id FROM training_programs WHERE id=?", (program_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Program not found")
        conn.execute("DELETE FROM training_plan_days WHERE program_id=?", (program_id,))
        conn.execute("DELETE FROM training_programs WHERE id=?", (program_id,))
    return {"status": "deleted"}
