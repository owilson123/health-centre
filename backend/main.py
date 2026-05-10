"""Health Centre FastAPI backend."""
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import init_db, db
from garmin_sync import sync_all, test_credentials, get_stored_credentials, reset_client
from metrics import calc_sleep_score, calc_recovery_score, calc_strain_score, calc_calories

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Health Centre API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Database initialised")


# ─── garmin auth ────────────────────────────────────────────────────

class GarminCredentials(BaseModel):
    email: str
    password: str


@app.get("/auth/status")
def auth_status():
    """Returns whether Garmin credentials are stored."""
    creds = get_stored_credentials()
    if creds:
        with db() as conn:
            row = conn.execute("SELECT connected_at FROM credentials WHERE id=1").fetchone()
        return {"connected": True, "email": creds[0], "connected_at": row[0] if row else None}
    return {"connected": False}


@app.post("/auth/connect")
def connect_garmin(creds: GarminCredentials, background_tasks: BackgroundTasks):
    """Validate Garmin credentials and store them, then kick off initial sync."""
    try:
        test_credentials(creds.email, creds.password)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Garmin login failed: {str(e)}")

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
    background_tasks.add_task(_do_sync)
    return {"status": "connected", "email": creds.email}


@app.post("/auth/disconnect")
def disconnect_garmin():
    """Remove stored credentials."""
    with db() as conn:
        conn.execute("DELETE FROM credentials WHERE id=1")
    reset_client()
    return {"status": "disconnected"}


# ─── sync ───────────────────────────────────────────────────────────

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
def trigger_sync(background_tasks: BackgroundTasks):
    background_tasks.add_task(_do_sync)
    return {"status": "syncing"}


def _do_sync():
    try:
        sync_all(days=90)
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        with db() as conn:
            conn.execute("INSERT INTO sync_log (status, message) VALUES (?, ?)", ("error", str(e)))


# ─── dashboard ──────────────────────────────────────────────────────

@app.get("/dashboard")
def get_dashboard():
    if _should_sync():
        try:
            sync_all(days=7)
        except Exception as e:
            logger.warning(f"Auto-sync failed: {e}")

    today = date.today()
    yesterday = today - timedelta(days=1)

    sleep = calc_sleep_score(yesterday)
    recovery = calc_recovery_score(today, sleep_score=sleep["score"])
    strain = calc_strain_score(today, recovery_score=recovery["score"])
    calories = calc_calories(today)

    with db() as conn:
        last_sync_row = conn.execute(
            "SELECT synced_at FROM sync_log WHERE status='ok' ORDER BY synced_at DESC LIMIT 1"
        ).fetchone()
    last_synced = last_sync_row[0] if last_sync_row else None

    return {
        "sleep": sleep,
        "recovery": recovery,
        "strain": strain,
        "calories": calories,
        "last_synced": last_synced,
        "date": today.isoformat(),
    }


# ─── activities ──────────────────────────────────────────────────────

@app.get("/activities")
def get_activities(days: int = 14):
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
            "id": r["id"],
            "date": r["date"],
            "type": r["type"],
            "name": r["name"],
            "duration_seconds": r["duration_seconds"],
            "distance_meters": r["distance_meters"],
            "avg_hr": r["avg_hr"],
            "max_hr": r["max_hr"],
            "calories": r["calories"],
            "strain": r["strain"],
            "training_effect": r["training_effect"],
            "hr_zones": {
                "zone1": r["zone1_seconds"],
                "zone2": r["zone2_seconds"],
                "zone3": r["zone3_seconds"],
                "zone4": r["zone4_seconds"],
                "zone5": r["zone5_seconds"],
            },
        }
        for r in rows
    ]


# ─── trends ──────────────────────────────────────────────────────────

@app.get("/trends")
def get_trends(days: int = 90):
    end = date.today()
    start = end - timedelta(days=days)
    points = []

    with db() as conn:
        sleep_rows = {
            r["date"]: r for r in conn.execute(
                "SELECT date, total_sleep_seconds FROM sleep WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat())
            ).fetchall()
        }
        hrv_rows = {
            r["date"]: r for r in conn.execute(
                "SELECT date, hrv_value FROM hrv WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat())
            ).fetchall()
        }
        step_rows = {
            r["date"]: r for r in conn.execute(
                "SELECT date, total_calories, resting_hr FROM steps WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat())
            ).fetchall()
        }

    d = start
    while d <= end:
        ds = d.isoformat()
        sleep_rec = sleep_rows.get(ds)
        hrv_rec = hrv_rows.get(ds)
        step_rec = step_rows.get(ds)

        sleep_score = None
        recovery_score = None
        strain_score = None
        acwr_val = None

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
            "date": ds,
            "sleep": sleep_score,
            "recovery": recovery_score,
            "strain": strain_score,
            "calories": step_rec["total_calories"] if step_rec else None,
            "hrv": hrv_rec["hrv_value"] if hrv_rec else None,
            "resting_hr": step_rec["resting_hr"] if step_rec else None,
            "acwr": acwr_val,
        })
        d += timedelta(days=1)

    return points
