import hashlib
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException, Request, Response

from .config import COOKIE_SECURE, SESSION_DAYS
from .db import db

COOKIE = "wl_session"
_hasher = PasswordHasher()

# Login throttle: after MAX_FAILS wrong passwords, logins are refused for LOCK_SECONDS.
MAX_FAILS = 5
LOCK_SECONDS = 60
_fails = {"count": 0, "locked_until": 0.0}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(pw_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(pw_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def check_throttle() -> None:
    wait = _fails["locked_until"] - time.time()
    if wait > 0:
        raise HTTPException(429, f"Zu viele Fehlversuche. In {int(wait) + 1} s erneut versuchen.")


def record_login(success: bool) -> None:
    if success:
        _fails["count"] = 0
        return
    _fails["count"] += 1
    if _fails["count"] >= MAX_FAILS:
        _fails["count"] = 0
        _fails["locked_until"] = time.time() + LOCK_SECONDS


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _secure(request: Request) -> bool:
    if COOKIE_SECURE in ("1", "true", "yes"):
        return True
    if COOKIE_SECURE in ("0", "false", "no"):
        return False
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto == "https"


def start_session(request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    expires = time.time() + SESSION_DAYS * 86400
    with db() as con:
        con.execute("DELETE FROM session WHERE expires < ?", (time.time(),))
        con.execute("INSERT INTO session(token_hash, expires) VALUES(?, ?)", (_digest(token), expires))
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="strict",
        secure=_secure(request),
        path="/",
    )


def end_session(request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        with db() as con:
            con.execute("DELETE FROM session WHERE token_hash = ?", (_digest(token),))
    response.delete_cookie(COOKIE, path="/")


def end_all_sessions() -> None:
    with db() as con:
        con.execute("DELETE FROM session")


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE)
    if not token:
        return False
    with db() as con:
        row = con.execute("SELECT expires FROM session WHERE token_hash = ?", (_digest(token),)).fetchone()
    return bool(row and row["expires"] > time.time())


def require_user(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(401, "Nicht angemeldet.")
