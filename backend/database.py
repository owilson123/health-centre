import os
import sqlite3
from pathlib import Path
from contextlib import contextmanager

# On Railway, set DB_PATH env var to /data/health.db (persistent volume mounted at /data)
# Locally defaults to backend/health.db
_db_env = os.environ.get("DB_PATH")
DB_PATH = Path(_db_env) if _db_env else Path(__file__).parent / "health.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS sleep (
            date TEXT PRIMARY KEY,
            total_sleep_seconds INTEGER,
            efficiency REAL,
            deep_sleep_seconds INTEGER,
            rem_sleep_seconds INTEGER,
            light_sleep_seconds INTEGER,
            awake_seconds INTEGER,
            hrv_overnight REAL,
            resting_hr REAL,
            sleep_start TEXT,
            sleep_end TEXT,
            synced_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS body_battery (
            date TEXT PRIMARY KEY,
            start_value INTEGER,
            end_value INTEGER,
            synced_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS stress (
            date TEXT PRIMARY KEY,
            avg_stress INTEGER,
            synced_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS steps (
            date TEXT PRIMARY KEY,
            steps INTEGER,
            active_calories INTEGER,
            total_calories INTEGER,
            resting_hr INTEGER,
            synced_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS hrv (
            date TEXT PRIMARY KEY,
            hrv_value REAL,
            hrv_status TEXT,
            synced_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            garmin_id TEXT UNIQUE,
            date TEXT,
            type TEXT,
            name TEXT,
            duration_seconds INTEGER,
            distance_meters REAL,
            avg_hr REAL,
            max_hr REAL,
            calories INTEGER,
            strain REAL DEFAULT 0,
            training_effect REAL,
            epoc REAL,
            zone1_seconds INTEGER DEFAULT 0,
            zone2_seconds INTEGER DEFAULT 0,
            zone3_seconds INTEGER DEFAULT 0,
            zone4_seconds INTEGER DEFAULT 0,
            zone5_seconds INTEGER DEFAULT 0,
            synced_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            age INTEGER,
            weight_kg REAL,
            height_cm REAL,
            max_hr_recorded INTEGER,
            vo2max REAL,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            synced_at TEXT DEFAULT (datetime('now')),
            status TEXT,
            message TEXT
        );

        CREATE TABLE IF NOT EXISTS credentials (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            garmin_email TEXT NOT NULL,
            garmin_password TEXT NOT NULL,
            connected_at TEXT DEFAULT (datetime('now'))
        );
        """)
