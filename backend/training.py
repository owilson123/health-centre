"""Gym training tracker — exercises, templates, session logging."""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database import db
from main import get_current_user

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
            equipment TEXT NOT NULL
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
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER REFERENCES workout_templates(id),
            name        TEXT,
            started_at  TEXT DEFAULT (datetime('now')),
            finished_at TEXT
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
        """)
        _seed_exercises(conn)


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

@router.get("/exercises")
def list_exercises(q: str = "", category: str = "", _uid: str = Depends(get_current_user)):
    with db() as conn:
        rows = conn.execute("SELECT id, name, category, equipment FROM exercises ORDER BY category, name").fetchall()
    result = [dict(r) for r in rows]
    if q:
        ql = q.lower()
        result = [r for r in result if ql in r["name"].lower()]
    if category:
        result = [r for r in result if r["category"] == category]
    return result


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
            SELECT id, name, template_id, started_at, finished_at
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
        conn.execute(
            "UPDATE workout_sessions SET finished_at=datetime('now') WHERE id=?", (sid,)
        )
    return {"status": "finished"}


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
        # Find most recent finished session containing this exercise
        row = conn.execute("""
            SELECT ws.session_id
            FROM workout_sets ws
            JOIN workout_sessions sess ON sess.id = ws.session_id
            WHERE ws.exercise_id = ? AND sess.finished_at IS NOT NULL
            ORDER BY sess.started_at DESC LIMIT 1
        """, (exercise_id,)).fetchone()
        if not row:
            return {"summary": None, "sets": []}
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
    summary  = _fmt_performance([{**s, "exercise_id": exercise_id} for s in set_list])
    return {
        "summary": summary,
        "sets": set_list,
        "session_date": session["started_at"][:10] if session else None,
    }
