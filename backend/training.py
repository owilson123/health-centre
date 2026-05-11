"""Gym training tracker — exercises, templates, session logging."""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database import db
from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/training", tags=["training"])

# ─── Schema init + seed ───────────────────────────────────────────────────────

def init_training_db(user_id: str | None = None):
    with db(user_id) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS exercises (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL UNIQUE,
            category  TEXT NOT NULL,
            equipment TEXT NOT NULL,
            is_custom INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS workout_templates (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS template_exercises (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
            exercise_id INTEGER NOT NULL REFERENCES exercises(id),
            position    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS workout_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id     INTEGER REFERENCES workout_templates(id),
            name            TEXT,
            started_at      TEXT DEFAULT (datetime('now')),
            finished_at     TEXT,
            strength_strain REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS workout_sets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
            exercise_id INTEGER NOT NULL REFERENCES exercises(id),
            set_number  INTEGER NOT NULL,
            weight_kg   REAL,
            reps        INTEGER NOT NULL,
            logged_at   TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_maxes (
            exercise_name TEXT PRIMARY KEY,
            one_rm_kg     REAL NOT NULL,
            updated_at    TEXT DEFAULT (datetime('now'))
        );
        """)
        _seed_exercises(conn)
        # Migrations for existing databases
        try:
            conn.execute("ALTER TABLE workout_sessions ADD COLUMN strength_strain REAL DEFAULT 0")
        except Exception:
            pass  # column already exists


EXERCISES = [
    # Push — Barbell
    ("Barbell Bench Press",        "Push",  "Barbell"),
    ("Incline Barbell Bench Press","Push",  "Barbell"),
    ("Close-Grip Bench Press",     "Push",  "Barbell"),
    ("Overhead Press",             "Push",  "Barbell"),
    ("Push Press",                 "Push",  "Barbell"),
    # Push — Dumbbell
    ("Dumbbell Bench Press",       "Push",  "Dumbbell"),
    ("Incline Dumbbell Press",     "Push",  "Dumbbell"),
    ("Dumbbell Shoulder Press",    "Push",  "Dumbbell"),
    ("Dumbbell Fly",               "Push",  "Dumbbell"),
    ("Dumbbell Lateral Raise",     "Push",  "Dumbbell"),
    ("Dumbbell Front Raise",       "Push",  "Dumbbell"),
    # Push — Cable / Machine
    ("Cable Fly",                  "Push",  "Cable"),
    ("Cable Lateral Raise",        "Push",  "Cable"),
    ("Chest Press Machine",        "Push",  "Machine"),
    ("Pec Deck",                   "Push",  "Machine"),
    # Push — Bodyweight
    ("Push-Up",                    "Push",  "Bodyweight"),
    ("Dip",                        "Push",  "Bodyweight"),
    ("Pike Push-Up",               "Push",  "Bodyweight"),

    # Pull — Barbell
    ("Deadlift",                   "Pull",  "Barbell"),
    ("Barbell Row",                "Pull",  "Barbell"),
    ("T-Bar Row",                  "Pull",  "Barbell"),
    ("Romanian Deadlift",          "Pull",  "Barbell"),
    ("Barbell Shrug",              "Pull",  "Barbell"),
    # Pull — Dumbbell
    ("Dumbbell Row",               "Pull",  "Dumbbell"),
    ("Dumbbell Shrug",             "Pull",  "Dumbbell"),
    ("Dumbbell RDL",               "Pull",  "Dumbbell"),
    # Pull — Cable
    ("Lat Pulldown",               "Pull",  "Cable"),
    ("Seated Cable Row",           "Pull",  "Cable"),
    ("Face Pull",                  "Pull",  "Cable"),
    ("Cable Curl",                 "Pull",  "Cable"),
    # Pull — Bodyweight
    ("Pull-Up",                    "Pull",  "Bodyweight"),
    ("Chin-Up",                    "Pull",  "Bodyweight"),
    ("Inverted Row",               "Pull",  "Bodyweight"),
    # Pull — Machine
    ("Machine Row",                "Pull",  "Machine"),

    # Arms
    ("Barbell Curl",               "Arms",  "Barbell"),
    ("EZ-Bar Curl",                "Arms",  "Barbell"),
    ("Skull Crusher",              "Arms",  "Barbell"),
    ("Dumbbell Curl",              "Arms",  "Dumbbell"),
    ("Hammer Curl",                "Arms",  "Dumbbell"),
    ("Incline Dumbbell Curl",      "Arms",  "Dumbbell"),
    ("Overhead Tricep Extension",  "Arms",  "Dumbbell"),
    ("Tricep Pushdown",            "Arms",  "Cable"),
    ("Overhead Cable Curl",        "Arms",  "Cable"),
    ("Preacher Curl Machine",      "Arms",  "Machine"),

    # Legs — Barbell
    ("Squat",                      "Legs",  "Barbell"),
    ("Front Squat",                "Legs",  "Barbell"),
    ("Hip Thrust",                 "Legs",  "Barbell"),
    ("Good Morning",               "Legs",  "Barbell"),
    # Legs — Dumbbell
    ("Dumbbell Lunge",             "Legs",  "Dumbbell"),
    ("Bulgarian Split Squat",      "Legs",  "Dumbbell"),
    ("Dumbbell Step-Up",           "Legs",  "Dumbbell"),
    # Legs — Machine
    ("Leg Press",                  "Legs",  "Machine"),
    ("Leg Curl",                   "Legs",  "Machine"),
    ("Leg Extension",              "Legs",  "Machine"),
    ("Seated Calf Raise",          "Legs",  "Machine"),
    ("Standing Calf Raise",        "Legs",  "Machine"),
    ("Smith Machine Squat",        "Legs",  "Machine"),
    # Legs — Bodyweight
    ("Bodyweight Squat",           "Legs",  "Bodyweight"),
    ("Nordic Curl",                "Legs",  "Bodyweight"),
    ("Glute Bridge",               "Legs",  "Bodyweight"),
    ("Box Jump",                   "Legs",  "Bodyweight"),

    # Core
    ("Plank",                      "Core",  "Bodyweight"),
    ("Ab Wheel Rollout",           "Core",  "Bodyweight"),
    ("Hanging Leg Raise",          "Core",  "Bodyweight"),
    ("Crunch",                     "Core",  "Bodyweight"),
    ("Russian Twist",              "Core",  "Bodyweight"),
    ("Cable Crunch",               "Core",  "Cable"),
    ("Decline Sit-Up",             "Core",  "Bodyweight"),
]


def _seed_exercises(conn):
    conn.executemany(
        "INSERT OR IGNORE INTO exercises (name, category, equipment) VALUES (?, ?, ?)",
        EXERCISES,
    )


# ─── Pydantic models ──────────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    exercise_ids: list[int]

class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    exercise_ids: Optional[list[int]] = None

class SessionStart(BaseModel):
    template_id: Optional[int] = None
    name: Optional[str] = None

class SetLog(BaseModel):
    exercise_id: int
    set_number: int
    weight_kg: Optional[float] = None
    reps: int


# ─── DUP recommendation engine ───────────────────────────────────────────────

# Three DUP phases that cycle: Hypertrophy → Strength → Power → repeat
DUP_PHASES = [
    {"name": "Hypertrophy", "sets": 4, "reps_low": 8,  "reps_high": 12, "pct": 0.68},
    {"name": "Strength",    "sets": 4, "reps_low": 5,  "reps_high": 6,  "pct": 0.825},
    {"name": "Power",       "sets": 5, "reps_low": 3,  "reps_high": 5,  "pct": 0.875},
]

# Anchor lift names for each category
ANCHOR: dict[str, str] = {
    "Push": "Barbell Bench Press",
    "Pull": "Barbell Row",
    "Legs": "Squat",
    "Arms": "Barbell Bench Press",   # proxy: bench → arms scales
    "Core": "",
}

# Scale relative to anchor 1RM (total weight on bar / combined DB weight)
# None = bodyweight exercise, no weight recommendation
SCALE: dict[str, float | None] = {
    # Push — anchor = Bench Press
    "Barbell Bench Press":          1.00,
    "Incline Barbell Bench Press":  0.85,
    "Close-Grip Bench Press":       0.80,
    "Overhead Press":               0.64,
    "Push Press":                   0.75,
    "Dumbbell Bench Press":         0.82,   # both DBs combined
    "Incline Dumbbell Press":       0.76,
    "Dumbbell Shoulder Press":      0.55,
    "Dumbbell Fly":                 0.45,
    "Dumbbell Lateral Raise":       0.20,
    "Dumbbell Front Raise":         0.22,
    "Cable Fly":                    0.40,
    "Cable Lateral Raise":          0.15,
    "Chest Press Machine":          0.90,
    "Pec Deck":                     0.55,
    "Push-Up":                      None,
    "Dip":                          None,
    "Pike Push-Up":                 None,
    # Pull — anchor = Barbell Row
    "Barbell Row":                  1.00,
    "T-Bar Row":                    0.90,
    "Barbell Shrug":                1.30,
    "Deadlift":                     1.55,
    "Romanian Deadlift":            1.10,
    "Dumbbell Row":                 0.55,
    "Dumbbell Shrug":               0.65,
    "Dumbbell RDL":                 0.60,
    "Lat Pulldown":                 0.75,
    "Seated Cable Row":             0.75,
    "Face Pull":                    0.30,
    "Cable Curl":                   0.25,
    "Pull-Up":                      None,
    "Chin-Up":                      None,
    "Inverted Row":                 None,
    "Machine Row":                  0.80,
    # Legs — anchor = Squat
    "Squat":                        1.00,
    "Front Squat":                  0.80,
    "Hip Thrust":                   1.15,
    "Good Morning":                 0.45,
    "Dumbbell Lunge":               0.35,
    "Bulgarian Split Squat":        0.32,
    "Dumbbell Step-Up":             0.30,
    "Leg Press":                    1.80,
    "Leg Curl":                     0.30,
    "Leg Extension":                0.35,
    "Seated Calf Raise":            0.30,
    "Standing Calf Raise":          0.50,
    "Smith Machine Squat":          0.95,
    "Bodyweight Squat":             None,
    "Nordic Curl":                  None,
    "Glute Bridge":                 None,
    "Box Jump":                     None,
    # Arms — proxy anchor = Bench Press
    "Barbell Curl":                 0.28,
    "EZ-Bar Curl":                  0.27,
    "Skull Crusher":                0.30,
    "Dumbbell Curl":                0.18,
    "Hammer Curl":                  0.20,
    "Incline Dumbbell Curl":        0.17,
    "Overhead Tricep Extension":    0.22,
    "Tricep Pushdown":              0.25,
    "Overhead Cable Curl":          0.20,
    "Preacher Curl Machine":        0.30,
}

# Fallback scales for custom exercises not in SCALE dict, keyed by category
DEFAULT_CATEGORY_SCALE: dict[str, float | None] = {
    "Push": 0.70,
    "Pull": 0.70,
    "Legs": 0.60,
    "Arms": 0.22,
    "Core": None,   # reps only
}

# Category for each known exercise (built from EXERCISES list + a few extras in SCALE)
_EXERCISE_CATEGORY: dict[str, str] = {name: cat for name, cat, _ in EXERCISES}

# Movement/muscle keywords that carry more weight in similarity scoring
_KEY_TERMS = {
    # Movements
    "pushdown", "curl", "press", "row", "deadlift", "squat", "fly", "raise",
    "extension", "pulldown", "pullup", "chinup", "shrug", "thrust", "lunge",
    "dip", "crunch", "plank", "kickback", "crossover", "pullover",
    # Muscles
    "tricep", "bicep", "chest", "shoulder", "lat", "glute", "quad",
    "hamstring", "calf", "back", "core",
    # Meaningful modifiers
    "incline", "decline", "overhead", "reverse", "hammer", "close", "wide",
    "seated", "standing", "cable", "barbell", "dumbbell", "machine",
}

import re as _re

def _tokenize(name: str) -> set[str]:
    return {t for t in _re.split(r"[^a-z]+", name.lower()) if len(t) > 1}

def _weighted_jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = a | b
    def w(t: str) -> float:
        return 2.5 if t in _KEY_TERMS else 1.0
    shared  = sum(w(t) for t in a & b)
    total   = sum(w(t) for t in union)
    return shared / total if total else 0.0

def _find_similar_scale(exercise_name: str, category: str) -> tuple[str, float] | None:
    """
    Find the closest known exercise (by weighted token similarity) in the same
    category. Returns (matched_name, scale) or None if confidence is too low.
    """
    tokens = _tokenize(exercise_name)
    best_name:  str   = ""
    best_score: float = 0.0
    best_scale: float = 0.0

    for known_name, scale in SCALE.items():
        if scale is None:
            continue
        # Only compare within the same category
        if _EXERCISE_CATEGORY.get(known_name) != category:
            continue
        score = _weighted_jaccard(tokens, _tokenize(known_name))
        if score > best_score:
            best_score = score
            best_name  = known_name
            best_scale = scale

    # Require at least one meaningful shared keyword (score > 0.20)
    if best_score >= 0.20 and best_name:
        return best_name, best_scale
    return None

# Dumbbell exercises where weight shown should be per-dumbbell (scale/2)
DUMBBELL_PER_HAND = {
    "Dumbbell Bench Press", "Incline Dumbbell Press", "Dumbbell Shoulder Press",
    "Dumbbell Fly", "Dumbbell Lateral Raise", "Dumbbell Front Raise",
    "Dumbbell Row", "Dumbbell Shrug", "Dumbbell RDL",
    "Dumbbell Lunge", "Bulgarian Split Squat", "Dumbbell Step-Up",
    "Dumbbell Curl", "Hammer Curl", "Incline Dumbbell Curl",
    "Overhead Tricep Extension",
}


def _epley_1rm(weight: float, reps: int) -> float:
    """Epley formula: weight × (1 + reps/30)."""
    if reps == 1:
        return weight
    return weight * (1 + reps / 30)


def _round_weight(kg: float) -> float:
    """Round to nearest 2.5 kg plate increment."""
    return round(kg / 2.5) * 2.5


def _best_1rm(conn, exercise_name: str) -> float | None:
    """Return best estimated 1RM (kg) for a named exercise, or None.
    Manual user_maxes entries take precedence over logged data."""
    # 1. Manual override
    manual = conn.execute(
        "SELECT one_rm_kg FROM user_maxes WHERE exercise_name = ?", (exercise_name,)
    ).fetchone()
    if manual:
        return round(manual["one_rm_kg"], 1)
    # 2. Best Epley estimate from logged sets
    row = conn.execute(
        "SELECT id FROM exercises WHERE name = ?", (exercise_name,)
    ).fetchone()
    if not row:
        return None
    sets = conn.execute(
        """SELECT weight_kg, reps FROM workout_sets
           WHERE exercise_id = ? AND weight_kg IS NOT NULL AND weight_kg > 0 AND reps > 0""",
        (row["id"],)
    ).fetchall()
    if not sets:
        return None
    best = max(_epley_1rm(s["weight_kg"], s["reps"]) for s in sets)
    return round(best, 1)


def _dup_phase(conn, category: str) -> dict:
    """
    Determine which DUP phase to prescribe next.
    Count completed sessions that contained exercises of this category,
    advance through Hypertrophy → Strength → Power cyclically.
    """
    row = conn.execute("""
        SELECT COUNT(DISTINCT ws.session_id) as n
        FROM workout_sets ws
        JOIN exercises e ON e.id = ws.exercise_id
        JOIN workout_sessions sess ON sess.id = ws.session_id
        WHERE e.category = ? AND sess.finished_at IS NOT NULL
    """, (category,)).fetchone()
    n = row["n"] if row else 0
    return DUP_PHASES[n % len(DUP_PHASES)]


def _dup_recommendation(conn, exercise_name: str, category: str) -> dict | None:
    """
    Build a full DUP recommendation for an exercise.
    Returns None if no anchor data yet.
    """
    # Look up scale:
    #  1. Exact match in SCALE dict (built-in exercises)
    #  2. Similarity match within category (custom exercises)
    #  3. Category default fallback
    matched_from: str | None = None   # name of the matched exercise, if any

    if exercise_name in SCALE:
        scale = SCALE[exercise_name]
    else:
        similar = _find_similar_scale(exercise_name, category)
        if similar:
            matched_from, scale = similar
        else:
            scale = DEFAULT_CATEGORY_SCALE.get(category)

    if scale is None:
        # Bodyweight / Core / no match — give reps-only recommendation
        phase = _dup_phase(conn, category)
        return {
            "phase": phase["name"],
            "sets": phase["sets"],
            "reps_low": phase["reps_low"],
            "reps_high": phase["reps_high"],
            "weight_kg": None,
            "per_hand": False,
            "anchor_name": None,
            "anchor_1rm": None,
            "note": "Focus on quality reps",
        }

    anchor_name = ANCHOR.get(category, "")
    if not anchor_name:
        return None   # Core — no recommendation

    anchor_1rm = _best_1rm(conn, anchor_name)

    # Fallback: if the exercise IS the anchor (e.g. user logs bench, no prior bench),
    # try to get 1RM from the exercise itself
    if anchor_1rm is None and exercise_name != anchor_name:
        anchor_1rm = _best_1rm(conn, exercise_name)
        if anchor_1rm is not None:
            # Reverse-scale to get implied anchor 1RM
            anchor_1rm = anchor_1rm / scale
    if anchor_1rm is None:
        # Check if THIS exercise is the anchor and has direct data
        anchor_1rm = _best_1rm(conn, exercise_name)
        if anchor_1rm is not None:
            anchor_name = exercise_name
        else:
            return None  # No data yet — can't recommend

    phase = _dup_phase(conn, category)

    # Target working weight at prescribed % of 1RM
    target_total = anchor_1rm * scale * phase["pct"]

    per_hand = exercise_name in DUMBBELL_PER_HAND
    display_weight = _round_weight(target_total / 2 if per_hand else target_total)

    # Don't suggest a nonsensical weight
    if display_weight <= 0:
        return None

    return {
        "phase":       phase["name"],
        "sets":        phase["sets"],
        "reps_low":    phase["reps_low"],
        "reps_high":   phase["reps_high"],
        "weight_kg":   display_weight,
        "per_hand":    per_hand,
        "anchor_name": anchor_name,
        "anchor_1rm":  round(anchor_1rm, 1),
        "note": (
            f"Matched to {matched_from} · based on {anchor_name} {round(anchor_1rm)}kg"
            if matched_from
            else (
                f"Based on {anchor_name} est. 1RM {round(anchor_1rm)}kg"
                if anchor_name != exercise_name
                else f"Based on your best estimated 1RM {round(anchor_1rm)}kg"
            )
        ),
    }


# ─── Strength strain (INOL-based) ────────────────────────────────────────────
#
# Problem with HR-based TRIMP for lifting: rest periods drop HR back down,
# so a heavy 5×5 squat session looks like "light effort" to a heart-rate monitor.
#
# INOL (Intensity × Number of Lifts) fixes this:
#   INOL per set = reps / (100 − intensity_%)
# At 90% 1RM a set of 5 = 5/10 = 0.50 INOL.
# At 70% 1RM a set of 10 = 10/30 = 0.33 INOL.
# Same reps, higher intensity → higher INOL → correctly harder on CNS.
#
# Compound lifts (squat, deadlift, row, bench, etc.) apply a 1.35× multiplier
# because they recruit far more total muscle mass and systemic fatigue than
# isolation work.
#
# Scale: total INOL × 10 → strain 0–100.
# Reference points (calibrated to an intermediate lifter):
#   ~20  light isolation pump session (3 exercises, light weight)
#   ~45  moderate push/pull day with compounds + accessories
#   ~65  heavy 5×5 session (squat + bench or DL)
#   ~80  high-volume full-body hypertrophy day
#   ~90  competition-style max-effort day (near limit on multiple lifts)

COMPOUND_LIFTS_STRAIN = {
    "Squat", "Front Squat", "Deadlift", "Romanian Deadlift", "Hip Thrust",
    "Good Morning", "Barbell Row", "T-Bar Row", "Dumbbell Row",
    "Barbell Bench Press", "Incline Barbell Bench Press", "Close-Grip Bench Press",
    "Overhead Press", "Push Press", "Lat Pulldown",
}


def _set_inol(weight_kg: float | None, reps: int, one_rm: float | None,
              is_compound: bool) -> float:
    compound_mult = 1.35 if is_compound else 1.0

    if weight_kg and weight_kg > 0 and one_rm and one_rm > 0:
        intensity = min(weight_kg / one_rm, 0.99)
        pct = intensity * 100
        # Denominator capped at 2 so ≥98% 1RM doesn't blow up
        inol = reps / max(100.0 - pct, 2.0)
    elif weight_kg and weight_kg > 0:
        # No 1RM known — assume moderate intensity (~50% 1RM)
        inol = reps / 50.0
    else:
        # Bodyweight exercise
        inol = reps / 80.0

    return inol * compound_mult


def calc_strength_strain(conn, session_id: int) -> float:
    """
    Return INOL-based strain score (0–100) for a finished strength session.
    Uses the best Epley 1RM from the session's own sets for each exercise,
    so it requires no pre-set user maxes — it self-calibrates from the data.
    """
    rows = conn.execute("""
        SELECT ws.exercise_id, ws.weight_kg, ws.reps, e.name AS exercise_name
        FROM workout_sets ws
        JOIN exercises e ON e.id = ws.exercise_id
        WHERE ws.session_id = ? AND ws.reps > 0
        ORDER BY ws.exercise_id, ws.set_number
    """, (session_id,)).fetchall()

    if not rows:
        return 0.0

    # Group by exercise, compute 1RM from best set within this session
    by_ex: dict[int, list] = {}
    names: dict[int, str]  = {}
    for r in rows:
        by_ex.setdefault(r["exercise_id"], []).append(r)
        names[r["exercise_id"]] = r["exercise_name"]

    total_inol = 0.0
    for ex_id, sets in by_ex.items():
        name        = names[ex_id]
        is_compound = name in COMPOUND_LIFTS_STRAIN

        weighted = [s for s in sets if s["weight_kg"] and s["weight_kg"] > 0]
        one_rm   = (max(_epley_1rm(s["weight_kg"], s["reps"]) for s in weighted)
                    if weighted else None)

        for s in sets:
            total_inol += _set_inol(s["weight_kg"], s["reps"], one_rm, is_compound)

    return round(min(95.0, total_inol * 10), 1)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _fmt_performance(sets: list) -> str | None:
    if not sets:
        return None
    by_ex: dict[int, list] = {}
    for s in sets:
        by_ex.setdefault(s["exercise_id"], []).append(s)
    parts = []
    for ex_sets in by_ex.values():
        ex_sets.sort(key=lambda s: s["set_number"])
        n = len(ex_sets)
        reps = ex_sets[0]["reps"]
        kg   = ex_sets[0]["weight_kg"]
        weight_str = f" @ {kg:g} kg" if kg else ""
        parts.append(f"{n}×{reps}{weight_str}")
    return " · ".join(parts)


# ─── Routes ──────────────────────────────────────────────────────────────────

class ExerciseCreate(BaseModel):
    name:      str
    category:  str
    equipment: str


@router.get("/exercises")
def list_exercises(q: str = "", category: str = "", _uid: str = Depends(get_current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, category, equipment, is_custom FROM exercises ORDER BY is_custom, category, name"
        ).fetchall()
    result = [dict(r) for r in rows]
    if q:
        ql = q.lower()
        result = [r for r in result if ql in r["name"].lower()]
    if category:
        result = [r for r in result if r["category"] == category]
    return result


@router.post("/exercises", status_code=201)
def create_exercise(body: ExerciseCreate, _uid: str = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Exercise name is required")
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM exercises WHERE LOWER(name) = LOWER(?)", (name,)
        ).fetchone()
        if existing:
            raise HTTPException(409, "An exercise with this name already exists")
        cur = conn.execute(
            "INSERT INTO exercises (name, category, equipment, is_custom) VALUES (?, ?, ?, 1)",
            (name, body.category, body.equipment)
        )
    return {"id": cur.lastrowid, "name": name, "category": body.category,
            "equipment": body.equipment, "is_custom": 1}


@router.delete("/exercises/{exercise_id}")
def delete_exercise(exercise_id: int, _uid: str = Depends(get_current_user)):
    with db() as conn:
        row = conn.execute(
            "SELECT is_custom FROM exercises WHERE id=?", (exercise_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Exercise not found")
        if not row["is_custom"]:
            raise HTTPException(403, "Cannot delete built-in exercises")
        conn.execute("DELETE FROM exercises WHERE id=?", (exercise_id,))
    return {"status": "deleted"}


@router.get("/templates")
def list_templates(_uid: str = Depends(get_current_user)):
    with db() as conn:
        templates = conn.execute(
            "SELECT id, name, created_at FROM workout_templates ORDER BY id DESC"
        ).fetchall()
        result = []
        for t in templates:
            exs = conn.execute("""
                SELECT e.id, e.name, e.category, e.equipment
                FROM template_exercises te
                JOIN exercises e ON e.id = te.exercise_id
                WHERE te.template_id = ?
                ORDER BY te.position
            """, (t["id"],)).fetchall()
            result.append({**dict(t), "exercises": [dict(e) for e in exs]})
    return result


@router.post("/templates", status_code=201)
def create_template(body: TemplateCreate, _uid: str = Depends(get_current_user)):
    with db() as conn:
        cur = conn.execute("INSERT INTO workout_templates (name) VALUES (?)", (body.name,))
        tid = cur.lastrowid
        conn.executemany(
            "INSERT INTO template_exercises (template_id, exercise_id, position) VALUES (?, ?, ?)",
            [(tid, eid, i) for i, eid in enumerate(body.exercise_ids)]
        )
    return {"id": tid, "name": body.name}


@router.put("/templates/{tid}")
def update_template(tid: int, body: TemplateUpdate, _uid: str = Depends(get_current_user)):
    with db() as conn:
        if body.name is not None:
            conn.execute("UPDATE workout_templates SET name=? WHERE id=?", (body.name, tid))
        if body.exercise_ids is not None:
            conn.execute("DELETE FROM template_exercises WHERE template_id=?", (tid,))
            conn.executemany(
                "INSERT INTO template_exercises (template_id, exercise_id, position) VALUES (?, ?, ?)",
                [(tid, eid, i) for i, eid in enumerate(body.exercise_ids)]
            )
    return {"status": "updated"}


@router.delete("/templates/{tid}")
def delete_template(tid: int, _uid: str = Depends(get_current_user)):
    with db() as conn:
        conn.execute("DELETE FROM workout_templates WHERE id=?", (tid,))
    return {"status": "deleted"}


@router.post("/sessions", status_code=201)
def start_session(body: SessionStart, _uid: str = Depends(get_current_user)):
    name = body.name
    exercises = []

    with db() as conn:
        if body.template_id:
            t = conn.execute(
                "SELECT name FROM workout_templates WHERE id=?", (body.template_id,)
            ).fetchone()
            if not t:
                raise HTTPException(404, "Template not found")
            name = name or t["name"]
            exs = conn.execute("""
                SELECT e.id, e.name, e.category, e.equipment
                FROM template_exercises te
                JOIN exercises e ON e.id = te.exercise_id
                WHERE te.template_id = ? ORDER BY te.position
            """, (body.template_id,)).fetchall()
            exercises = [dict(e) for e in exs]

        cur = conn.execute(
            "INSERT INTO workout_sessions (template_id, name) VALUES (?, ?)",
            (body.template_id, name or "Quick Workout")
        )
        sid = cur.lastrowid

    return {"session_id": sid, "name": name or "Quick Workout", "exercises": exercises}


@router.get("/sessions")
def list_sessions(limit: int = 20, _uid: str = Depends(get_current_user)):
    with db() as conn:
        sessions = conn.execute("""
            SELECT id, name, template_id, started_at, finished_at, strength_strain
            FROM workout_sessions
            WHERE finished_at IS NOT NULL
            ORDER BY started_at DESC LIMIT ?
        """, (limit,)).fetchall()
        result = []
        for s in sessions:
            sets = conn.execute("""
                SELECT ws.exercise_id, ws.weight_kg, ws.reps
                FROM workout_sets ws WHERE ws.session_id=?
            """, (s["id"],)).fetchall()
            total_sets   = len(sets)
            total_volume = sum((r["weight_kg"] or 0) * r["reps"] for r in sets)
            ex_count     = len({r["exercise_id"] for r in sets})
            result.append({
                **dict(s),
                "total_sets": total_sets,
                "total_volume_kg": round(total_volume),
                "exercise_count": ex_count,
                "strength_strain": s["strength_strain"] or 0,
            })
    return result


@router.get("/sessions/{sid}")
def get_session(sid: int, _uid: str = Depends(get_current_user)):
    with db() as conn:
        session = conn.execute(
            "SELECT * FROM workout_sessions WHERE id=?", (sid,)
        ).fetchone()
        if not session:
            raise HTTPException(404, "Session not found")
        sets = conn.execute("""
            SELECT ws.id, ws.exercise_id, ws.set_number, ws.weight_kg, ws.reps, ws.logged_at,
                   e.name as exercise_name, e.category, e.equipment
            FROM workout_sets ws
            JOIN exercises e ON e.id = ws.exercise_id
            WHERE ws.session_id=?
            ORDER BY ws.exercise_id, ws.set_number
        """, (sid,)).fetchall()

    # Group sets by exercise
    grouped: dict[int, dict] = {}
    for s in sets:
        eid = s["exercise_id"]
        if eid not in grouped:
            grouped[eid] = {
                "exercise_id": eid,
                "exercise_name": s["exercise_name"],
                "category": s["category"],
                "equipment": s["equipment"],
                "sets": [],
            }
        grouped[eid]["sets"].append({
            "id": s["id"], "set_number": s["set_number"],
            "weight_kg": s["weight_kg"], "reps": s["reps"],
        })

    return {**dict(session), "exercises": list(grouped.values())}


@router.patch("/sessions/{sid}/finish")
def finish_session(sid: int, _uid: str = Depends(get_current_user)):
    with db() as conn:
        strain = calc_strength_strain(conn, sid)
        conn.execute(
            "UPDATE workout_sessions SET finished_at=datetime('now'), strength_strain=? WHERE id=?",
            (strain, sid)
        )
    return {"status": "finished", "strength_strain": strain}


@router.post("/sessions/{sid}/sets", status_code=201)
def log_set(sid: int, body: SetLog, _uid: str = Depends(get_current_user)):
    with db() as conn:
        session = conn.execute("SELECT id FROM workout_sessions WHERE id=?", (sid,)).fetchone()
        if not session:
            raise HTTPException(404, "Session not found")
        cur = conn.execute("""
            INSERT INTO workout_sets (session_id, exercise_id, set_number, weight_kg, reps)
            VALUES (?, ?, ?, ?, ?)
        """, (sid, body.exercise_id, body.set_number, body.weight_kg, body.reps))
    return {"set_id": cur.lastrowid}


@router.delete("/sets/{set_id}")
def delete_set(set_id: int, _uid: str = Depends(get_current_user)):
    with db() as conn:
        conn.execute("DELETE FROM workout_sets WHERE id=?", (set_id,))
    return {"status": "deleted"}


@router.get("/exercises/{exercise_id}/last-performance")
def last_performance(exercise_id: int, _uid: str = Depends(get_current_user)):
    with db() as conn:
        # Exercise meta (needed for DUP recommendation)
        ex_row = conn.execute(
            "SELECT name, category FROM exercises WHERE id=?", (exercise_id,)
        ).fetchone()

        # Find most recent finished session containing this exercise
        row = conn.execute("""
            SELECT ws.session_id
            FROM workout_sets ws
            JOIN workout_sessions sess ON sess.id = ws.session_id
            WHERE ws.exercise_id = ? AND sess.finished_at IS NOT NULL
            ORDER BY sess.started_at DESC LIMIT 1
        """, (exercise_id,)).fetchone()

        set_list = []
        session_date = None
        if row:
            sid = row["session_id"]
            sets = conn.execute("""
                SELECT set_number, weight_kg, reps
                FROM workout_sets WHERE session_id=? AND exercise_id=?
                ORDER BY set_number
            """, (sid, exercise_id)).fetchall()
            session = conn.execute(
                "SELECT started_at FROM workout_sessions WHERE id=?", (sid,)
            ).fetchone()
            set_list = [dict(s) for s in sets]
            session_date = session["started_at"][:10] if session else None

        # DUP recommendation
        recommendation = None
        if ex_row:
            recommendation = _dup_recommendation(conn, ex_row["name"], ex_row["category"])

    summary = _fmt_performance([{**s, "exercise_id": exercise_id} for s in set_list]) if set_list else None
    return {
        "summary": summary,
        "sets": set_list,
        "session_date": session_date,
        "recommendation": recommendation,
    }


# ─── User maxes (manual 1RM overrides) ───────────────────────────────────────

ANCHOR_NAMES = ["Barbell Bench Press", "Barbell Row", "Squat"]

class MaxesUpdate(BaseModel):
    bench_1rm:  Optional[float] = None
    row_5rm:    Optional[float] = None   # user enters 5RM; we convert to 1RM internally
    squat_1rm:  Optional[float] = None


@router.get("/maxes")
def get_maxes(_uid: str = Depends(get_current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT exercise_name, one_rm_kg FROM user_maxes WHERE exercise_name IN (?,?,?)",
            ANCHOR_NAMES
        ).fetchall()
    data = {r["exercise_name"]: r["one_rm_kg"] for r in rows}
    # Back-convert row 1RM → 5RM for display: 5RM = 1RM / (1 + 5/30)
    row_1rm = data.get("Barbell Row")
    row_5rm = round(row_1rm / (1 + 5 / 30), 1) if row_1rm else None
    return {
        "bench_1rm": data.get("Barbell Bench Press"),
        "row_5rm":   row_5rm,
        "squat_1rm": data.get("Squat"),
    }


@router.put("/maxes")
def update_maxes(body: MaxesUpdate, _uid: str = Depends(get_current_user)):
    # Convert row 5RM → 1RM using Epley before storing
    row_1rm = round(body.row_5rm * (1 + 5 / 30), 1) if body.row_5rm and body.row_5rm > 0 else None
    mapping = {
        "Barbell Bench Press": body.bench_1rm,
        "Barbell Row":         row_1rm,
        "Squat":               body.squat_1rm,
    }
    with db() as conn:
        for name, val in mapping.items():
            if val is not None and val > 0:
                conn.execute(
                    """INSERT INTO user_maxes (exercise_name, one_rm_kg, updated_at)
                       VALUES (?, ?, datetime('now'))
                       ON CONFLICT(exercise_name) DO UPDATE SET
                         one_rm_kg=excluded.one_rm_kg,
                         updated_at=excluded.updated_at""",
                    (name, val)
                )
    return {"status": "updated"}
