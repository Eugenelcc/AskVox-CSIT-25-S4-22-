import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise ValueError("Password too long for bcrypt (max 72 bytes). Please use a shorter password.")
    return pwd_context.hash(password)



def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(*, user_id: int, role: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=int(settings.access_token_expire_minutes))
    payload = {"sub": str(user_id), "role": role, "iat": int(now.timestamp()), "exp": exp}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token() -> str:
    # raw token given to client once
    return secrets.token_urlsafe(48)


def hash_refresh_token(raw_token: str) -> str:
    # store only hash in DB; add secret as "pepper"
    data = f"{settings.secret_key}:{raw_token}".encode("utf-8")
    return hashlib.sha256(data).hexdigest()
