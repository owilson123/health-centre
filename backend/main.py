"""Health Centre FastAPI backend."""
import logging
import os
import secrets
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import init_db, db, _current_user
from auth import get_current_user, make_token, USERS, _hash
from garmin_sync import sync_all, test_credentials, get_stored_credentials, reset_client, _clients as _garmin_clients
from metrics import calc_sleep_score, calc_recovery_score, calc_strain_score, calc_calories
from training import router as training_router, init_training_db
from running import router as running_router, init_running_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Health Centre API", version="1.0.0")
app.include_router(training_router)
app.include_router(running_router)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── startup ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    for uid in USERS:
        init_db(uid)
        init_training_db(uid)
        init_running_db(uid)
        logger.info(f"Database initialised for user {uid}")


# ─── app login ───────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    user_id: str
    password: str


@app.post("/login")
def login(req: LoginRequest):
    user = USERS.get(req.user_id)
    if not user or not secrets.compare_digest(user["hash"], _hash(req.password)):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = make_token(req.user_id)
    return {"token": token, "user_id": req.user_id, "display": user["display"]}


@app.get("/me")
def me(user_id: str = Depends(get_current_user)):
    return {"user_id": user_id, "display": USERS[user_id]["display"]}


# ─── garmin auth ─────────────────────────────────────────────────────────────

class GarminCredentials(BaseModel):
    email: str
    password: str


@app.get("/auth/status")
def auth_status(user_id: str = Depends(get_current_user)):
    creds = get_stored_credentials(user_id)
    if creds:
        with db(user_id) as conn:
            row = conn.execute("SELECT connected_at FROM credentials WHERE id=1").fetchone()
        return {"connected": True, "email": creds[0], "connected_at": row[0] if row else None}
    return {"connected": False}


@app.post("/auth/connect")
def connect_garmin(
    creds: GarminCredentials,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    try:
        verified_client = test_credentials(creds.email, creds.password, user_id)
    except Exception as e:
        logger.error(f"[{user_id}] Garmin login failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail=f"Garmin login failed: {type(e).__name__}: {str(e)}")

    # Cache the just-verified client so the first sync doesn't have to re-login
    _garmin_clients[user_id] = verified_client

    # Wipe all previously synced health data before saving new credentials.
    # This guarantees the user only ever sees data from the account they just
    # connected — no stale data from a previous account or from a credential leak.
    _HEALTH_TABLES = ["sleep", "hrv", "body_battery", "stress", "steps",
                      "activities", "user_profile", "sync_log"]
    with db(user_id) as conn:
        for t in _HEALTH_TABLES:
            try:
                conn.execute(f"DELETE FROM {t}")
            except Exception:
                pass
        conn.execute("""
            INSERT INTO credentials (id, garmin_email, garmin_password, connected_at)
            VALUES (1, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                garmin_email=excluded.garmin_email,
                garmin_password=excluded.garmin_password,
                connected_at=excluded.connected_at
        """, (creds.email, creds.password))
    logger.info(f"[{user_id}] Garmin connected as {creds.email} — health data wiped for fresh sync")

    background_tasks.add_task(_do_sync, user_id)
    return {"status": "connected", "email": creds.email}


@app.post("/auth/disconnect")
def disconnect_garmin(user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        conn.execute("DELETE FROM credentials WHERE id=1")
    reset_client(user_id)
    return {"status": "disconnected"}


# ─── admin ───────────────────────────────────────────────────────────────────

@app.get("/admin/clear-sleep")
def clear_sleep_data(user_id: str = Depends(get_current_user)):
    with db(user_id) as conn:
        conn.execute("DELETE FROM sleep")
        conn.execute("DELETE FROM sync_log")
    return {"status": "cleared", "message": "Sleep data wiped. Pull to refresh on the app to re-sync."}


@app.delete("/admin/wipe-my-data")
def wipe_all_data(user_id: str = Depends(get_current_user)):
    """Wipe every table for the current user's health DB and disconnect Garmin."""
    tables = [
        "sleep", "hrv", "body_battery", "stress", "steps",
        "activities", "user_profile", "sync_log", "credentials",
    ]
    with db(user_id) as conn:
        for t in tables:
            try:
                conn.execute(f"DELETE FROM {t}")
            except Exception:
                pass  # table may not exist on older schemas
    reset_client(user_id)
    logger.info(f"[{user_id}] All health data wiped by user request")
    return {"status": "wiped", "user": user_id, "tables_cleared": tables}


@app.get("/admin/recalculate-strain")
def recalculate_strain(days: int = 90, user_id: str = Depends(get_current_user)):
    from garmin_sync import _backfill_strain
    end = date.today()
    start = end - timedelta(days=days)
    _backfill_strain(user_id, start, end)
    return {"status": "done", "message": f"Strain recalculated for {days} days ending {end}"}


# ─── sync ─────────────────────────────────────────────────────────────────────

def _should_sync(user_id: str) -> bool:
    with db(user_id) as conn:
        row = conn.execute(
            "SELECT synced_at FROM sync_log WHERE status='ok' ORDER BY synced_at DESC LIMIT 1"
        ).fetchone()
        if not row:
            return True
        last = datetime.fromisoformat(row[0])
        return (datetime.utcnow() - last).total_seconds() > 1800


@app.post("/sync")
def trigger_sync(background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    background_tasks.add_task(_do_sync, user_id)
    return {"status": "syncing"}


def _do_sync(user_id: str):
    # Also set ContextVar so metrics.py (which still uses it internally) routes correctly
    _current_user.set(user_id)
    try:
        sync_all(user_id, days=90)
    except Exception as e:
        logger.error(f"[{user_id}] Sync failed: {e}")
        with db(user_id) as conn:
            conn.execute("INSERT INTO sync_log (status, message) VALUES (?, ?)", ("error", str(e)))


# ─── dashboard ───────────────────────────────────────────────────────────────

@app.get("/dashboard")
def get_dashboard(user_id: str = Depends(get_current_user)):
    # Also set ContextVar so metrics.py (which still uses it internally) routes correctly
    _current_user.set(user_id)

    if _should_sync(user_id):
        try:
            sync_all(user_id, days=7)
        except Exception as e:
            logger.warning(f"[{user_id}] Auto-sync failed: {e}")

    today = date.today()

    with db(user_id) as conn:
        has_today_sleep = conn.execute(
            "SELECT 1 FROM sleep WHERE date=? AND total_sleep_seconds > 0", (today.isoformat(),)
        ).fetchone()
    sleep_date = today if has_today_sleep else today - timedelta(days=1)

    sleep    = calc_sleep_score(sleep_date)
    recovery = calc_recovery_score(today, sleep_score=sleep["score"])
    strain   = calc_strain_score(today, recovery_score=recovery["score"])
    calories = calc_calories(today)

    # ── Strength strain: merge app sessions + unmatched Garmin strength activities ──
    # Garmin strength-type activities are excluded from TRIMP (see metrics.py) because
    # HR-based TRIMP is unreliable for lifting. Instead we use INOL from the training
    # tab. But if someone didn't log a session on the app, we fall back to a
    # calories/duration estimate from the Garmin activity so the day isn't zero.
    #
    # Matching strategy: 1 app session "covers" 1 Garmin session (by count, ordered by
    # time). Any Garmin sessions beyond the app session count are "unmatched" and get a
    # fallback strain derived from calories burned or active duration.

    _STRENGTH_TYPES = (
        "strength_training", "gym_and_fitness_equipment",
        "functional_training", "crossfit", "weightlifting",
    )
    _placeholders = ",".join("?" * len(_STRENGTH_TYPES))

    with db(user_id) as conn:
        today_str = today.isoformat()

        # App sessions completed today with a computed INOL strain
        app_strength_rows = conn.execute("""
            SELECT strength_strain FROM workout_sessions
            WHERE DATE(started_at) = ? AND finished_at IS NOT NULL AND strength_strain > 0
            ORDER BY started_at
        """, (today_str,)).fetchall()

        # Garmin strength activities synced for today (excluded from TRIMP)
        garmin_strength_rows = conn.execute(f"""
            SELECT duration_seconds, calories FROM activities
            WHERE date = ? AND type IN ({_placeholders})
            ORDER BY id
        """, (today_str, *_STRENGTH_TYPES)).fetchall()

        last_sync_row = conn.execute(
            "SELECT synced_at FROM sync_log WHERE status='ok' ORDER BY synced_at DESC LIMIT 1"
        ).fetchone()

    n_app    = len(app_strength_rows)
    n_garmin = len(garmin_strength_rows)

    # App INOL strain for logged sessions
    app_strain = sum(r["strength_strain"] for r in app_strength_rows)

    # Fallback strain for Garmin sessions that have no matching app session.
    # We assume sessions pair off 1-to-1 by time order; extras are unmatched.
    unmatched_garmin = garmin_strength_rows[n_app:]
    garmin_fallback = 0.0
    for row in unmatched_garmin:
        cal = row["calories"] or 0
        dur = row["duration_seconds"] or 0
        if cal > 0:
            # ~5 calories per strain point is a reasonable proxy for moderate lifting
            garmin_fallback += min(70.0, cal / 5.0)
        elif dur > 0:
            # Assume ~0.7 strain per minute as a conservative floor
            garmin_fallback += min(60.0, (dur / 60.0) * 0.7)

    total_strength_strain = app_strain + garmin_fallback

    if total_strength_strain > 0 or n_garmin > 0:
        garmin_cardio_strain = strain.get("score", 0)
        # Clean addition: cardio (TRIMP) and lifting (INOL) are fully independent signals
        combined = round(min(100, garmin_cardio_strain + total_strength_strain))
        strain = {
            **strain,
            "score": combined,
            "strength_strain": round(total_strength_strain, 1),
            "strength_sessions_today": n_app,
            "garmin_strength_sessions_today": n_garmin,
        }

    return {
        "sleep": sleep,
        "recovery": recovery,
        "strain": strain,
        "calories": calories,
        "last_synced": last_sync_row[0] if last_sync_row else None,
        "date": today.isoformat(),
    }


# ─── activities ──────────────────────────────────────────────────────────────

@app.get("/activities")
def get_activities(days: int = 14, user_id: str = Depends(get_current_user)):
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with db(user_id) as conn:
        rows = conn.execute(
            """SELECT id, date, type, name, duration_seconds, distance_meters,
               avg_hr, max_hr, calories, strain, training_effect,
               zone1_seconds, zone2_seconds, zone3_seconds, zone4_seconds, zone5_seconds
               FROM activities WHERE date >= ? ORDER BY date DESC""",
            (cutoff,)
        ).fetchall()

    return [
        {
            "id": r["id"], "date": r["date"], "type": r["type"], "name": r["name"],
            "duration_seconds": r["duration_seconds"], "distance_meters": r["distance_meters"],
            "avg_hr": r["avg_hr"], "max_hr": r["max_hr"], "calories": r["calories"],
            "strain": r["strain"], "training_effect": r["training_effect"],
            "hr_zones": {
                "zone1": r["zone1_seconds"], "zone2": r["zone2_seconds"],
                "zone3": r["zone3_seconds"], "zone4": r["zone4_seconds"],
                "zone5": r["zone5_seconds"],
            },
        }
        for r in rows
    ]


# ─── trends ──────────────────────────────────────────────────────────────────

@app.get("/trends")
def get_trends(days: int = 90, user_id: str = Depends(get_current_user)):
    # Set ContextVar so metrics.py routes correctly for this user
    _current_user.set(user_id)
    end   = date.today()
    start = end - timedelta(days=days)
    points = []

    with db(user_id) as conn:
        sleep_rows = {r["date"]: r for r in conn.execute(
            "SELECT date, total_sleep_seconds FROM sleep WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat())
        ).fetchall()}
        hrv_rows = {r["date"]: r for r in conn.execute(
            "SELECT date, hrv_value FROM hrv WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat())
        ).fetchall()}
        step_rows = {r["date"]: r for r in conn.execute(
            "SELECT date, total_calories, resting_hr FROM steps WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat())
        ).fetchall()}

    d = start
    while d <= end:
        ds = d.isoformat()
        sleep_rec = sleep_rows.get(ds)
        hrv_rec   = hrv_rows.get(ds)
        step_rec  = step_rows.get(ds)

        sleep_score = recovery_score = strain_score = acwr_val = None

        if sleep_rec:
            try:
                sl = calc_sleep_score(d - timedelta(days=1))
                sleep_score = sl["score"]
                rec = calc_recovery_score(d, sleep_score=sleep_score)
                recovery_score = rec["score"]
                acwr_val = rec["acwr"]
                st = calc_strain_score(d, recovery_score=recovery_score)
                strain_score = st["score"]
            except Exception:
                pass

        points.append({
            "date": ds, "sleep": sleep_score, "recovery": recovery_score,
            "strain": strain_score,
            "calories": step_rec["total_calories"] if step_rec else None,
            "hrv": hrv_rec["hrv_value"] if hrv_rec else None,
            "resting_hr": step_rec["resting_hr"] if step_rec else None,
            "acwr": acwr_val,
        })
        d += timedelta(days=1)

    return points
