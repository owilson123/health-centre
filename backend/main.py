"""Health Centre FastAPI backend."""
import hashlib
import logging
import os
import secrets
from datetime import date, datetime, timedelta
from typing import Optional

import jwt
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from database import init_db, db, _current_user
from garmin_sync import sync_all, test_credentials, get_stored_credentials, reset_client
from metrics import calc_sleep_score, calc_recovery_score, calc_strain_score, calc_calories
from training import router as training_router, init_training_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Health Centre API", version="1.0.0")
app.include_router(training_router)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── app-level auth ──────────────────────────────────────────────────────────

SECRET_KEY = os.environ.get("APP_SECRET_KEY", "hc-dev-secret-change-in-prod-please")
ALGORITHM  = "HS256"
TOKEN_TTL_DAYS = 60

# Users: {user_id: {password_hash, display}}
def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

USERS: dict[str, dict] = {
    "ow": {"hash": _hash("ow123"), "display": "OW"},
    "ob": {"hash": _hash("ob123"), "display": "OB"},
}

_bearer = HTTPBearer(auto_error=False)


def _make_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS)
    return jwt.encode({"sub": user_id, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> str:
    """Return user_id or raise 401."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = _decode_token(credentials.credentials)
    if user_id not in USERS:
        raise HTTPException(status_code=401, detail="Unknown user")
    _current_user.set(user_id)
    return user_id


# ─── startup ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    for uid in USERS:
        init_db(uid)
        init_training_db(uid)
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
    token = _make_token(req.user_id)
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
    creds = get_stored_credentials()
    if creds:
        with db() as conn:
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
        verified_client = test_credentials(creds.email, creds.password)
    except Exception as e:
        logger.error(f"[{user_id}] Garmin login failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail=f"Garmin login failed: {type(e).__name__}: {str(e)}")

    import garmin_sync
    garmin_sync._clients[user_id] = verified_client

    with db() as conn:
        conn.execute("""
            INSERT INTO credentials (id, garmin_email, garmin_password, connected_at)
            VALUES (1, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                garmin_email=excluded.garmin_email,
                garmin_password=excluded.garmin_password,
                connected_at=excluded.connected_at
        """, (creds.email, creds.password))

    reset_client()
    background_tasks.add_task(_do_sync, user_id)
    return {"status": "connected", "email": creds.email}


@app.post("/auth/disconnect")
def disconnect_garmin(user_id: str = Depends(get_current_user)):
    with db() as conn:
        conn.execute("DELETE FROM credentials WHERE id=1")
    reset_client()
    return {"status": "disconnected"}


# ─── admin ───────────────────────────────────────────────────────────────────

@app.get("/admin/clear-sleep")
def clear_sleep_data(user_id: str = Depends(get_current_user)):
    with db() as conn:
        conn.execute("DELETE FROM sleep")
        conn.execute("DELETE FROM sync_log")
    return {"status": "cleared", "message": "Sleep data wiped. Pull to refresh on the app to re-sync."}


@app.get("/admin/recalculate-strain")
def recalculate_strain(days: int = 90, user_id: str = Depends(get_current_user)):
    from garmin_sync import _backfill_strain
    end = date.today()
    start = end - timedelta(days=days)
    _backfill_strain(start, end)
    return {"status": "done", "message": f"Strain recalculated for {days} days ending {end}"}


# ─── sync ─────────────────────────────────────────────────────────────────────

def _should_sync() -> bool:
    with db() as conn:
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
    _current_user.set(user_id)
    try:
        sync_all(days=90)
    except Exception as e:
        logger.error(f"[{user_id}] Sync failed: {e}")
        with db() as conn:
            conn.execute("INSERT INTO sync_log (status, message) VALUES (?, ?)", ("error", str(e)))


# ─── dashboard ───────────────────────────────────────────────────────────────

@app.get("/dashboard")
def get_dashboard(user_id: str = Depends(get_current_user)):
    if _should_sync():
        try:
            sync_all(days=7)
        except Exception as e:
            logger.warning(f"[{user_id}] Auto-sync failed: {e}")

    today = date.today()

    with db() as conn:
        has_today_sleep = conn.execute(
            "SELECT 1 FROM sleep WHERE date=? AND total_sleep_seconds > 0", (today.isoformat(),)
        ).fetchone()
    sleep_date = today if has_today_sleep else today - timedelta(days=1)

    sleep    = calc_sleep_score(sleep_date)
    recovery = calc_recovery_score(today, sleep_score=sleep["score"])
    strain   = calc_strain_score(today, recovery_score=recovery["score"])
    calories = calc_calories(today)

    with db() as conn:
        last_sync_row = conn.execute(
            "SELECT synced_at FROM sync_log WHERE status='ok' ORDER BY synced_at DESC LIMIT 1"
        ).fetchone()

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
    with db() as conn:
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
    end   = date.today()
    start = end - timedelta(days=days)
    points = []

    with db() as conn:
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
