"""Shared auth dependency — imported by main.py and routers alike."""
import hashlib
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from database import _current_user

SECRET_KEY = os.environ.get("APP_SECRET_KEY", "hc-dev-secret-change-in-prod-please")
ALGORITHM  = "HS256"
TOKEN_TTL_DAYS = 60


def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _user_hash(env_key: str, fallback: str) -> str:
    """Read password from env var (plain text), fall back to hardcoded default.
    Set OW_PASSWORD and OB_PASSWORD on Railway to override."""
    pw = os.environ.get(env_key)
    return _hash(pw) if pw else _hash(fallback)

USERS: dict[str, dict] = {
    "ow": {"hash": _user_hash("OW_PASSWORD", "ow123"), "display": "OW"},
    "ob": {"hash": _user_hash("OB_PASSWORD", "ob123"), "display": "OB"},
}

_bearer = HTTPBearer(auto_error=False)


def make_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS)
    return jwt.encode({"sub": user_id, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> str:
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
    user_id = decode_token(credentials.credentials)
    if user_id not in USERS:
        raise HTTPException(status_code=401, detail="Unknown user")
    _current_user.set(user_id)
    return user_id
