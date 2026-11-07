import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import AdminSession, AdminUser

SESSION_COOKIE = "aig_admin_session"
SESSION_LIFETIME = timedelta(hours=8)
LOCKOUT_AFTER_FAILURES = 5
LOCKOUT_DURATION = timedelta(minutes=15)
password_hasher = PasswordHasher()


def _now() -> datetime:
    return datetime.now(UTC)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def csrf_token(session_token: str) -> str:
    return hmac.new(settings.session_secret.encode("utf-8"), f"csrf:{session_token}".encode("utf-8"), hashlib.sha256).hexdigest()


def create_session(database: Session, user: AdminUser) -> str:
    raw_token = secrets.token_urlsafe(32)
    database.add(AdminSession(token_hash=_token_hash(raw_token), admin_user_id=user.id, expires_at=_now() + SESSION_LIFETIME))
    database.commit()
    return raw_token


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=settings.app_env == "production",
        samesite="lax",
        path="/",
    )


def get_current_user(session_token: str | None, database: Session) -> AdminUser:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    session = database.scalar(select(AdminSession).where(AdminSession.token_hash == _token_hash(session_token)))
    if session is None or session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= _now() or not session.user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
    return session.user


def require_admin(
    request: Request,
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    submitted_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    database: Session = Depends(get_db),
) -> AdminUser:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    user = get_current_user(session_token, database)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        expected = csrf_token(session_token)
        if not submitted_csrf_token or not hmac.compare_digest(expected, submitted_csrf_token):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    return user


def verify_password(database: Session, user: AdminUser, password: str) -> bool:
    now = _now()
    if user.locked_until and user.locked_until > now:
        return False
    if user.locked_until and user.locked_until <= now:
        user.locked_until = None
        user.failed_attempts = 0
    try:
        valid = password_hasher.verify(user.password_hash, password)
    except (VerifyMismatchError, VerificationError):
        valid = False
    if valid:
        user.failed_attempts = 0
        user.locked_until = None
    else:
        user.failed_attempts += 1
        if user.failed_attempts >= LOCKOUT_AFTER_FAILURES:
            user.locked_until = now + LOCKOUT_DURATION
    database.commit()
    return valid
