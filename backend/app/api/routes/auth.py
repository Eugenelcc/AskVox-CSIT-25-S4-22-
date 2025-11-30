from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException,status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
)
from app.db.session import get_db
from app.models.users import User, UserRole
from app.models.user_sessions import UserSession


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str  # add password rules later


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


@router.post("/register", response_model=dict)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == payload.email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")
    u = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.user.value,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return {"id": u.id, "email": u.email, "role": u.role}


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == payload.email))
    user = res.scalar_one_or_none()
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # create session (refresh)
    raw_refresh = create_refresh_token()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(raw_refresh),
        expires_at=UserSession.default_expiry(settings.refresh_token_expire_days),
    )
    db.add(session)
    await db.commit()

    access = create_access_token(user_id=user.id, role=user.role)
    return TokenOut(access_token=access, refresh_token=raw_refresh)


@router.post("/refresh", response_model=TokenOut)
async def refresh(payload: RefreshIn, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(payload.refresh_token)

    res = await db.execute(select(UserSession).where(UserSession.refresh_token_hash == token_hash))
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    if session.revoked_at is not None or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked")

    # rotate refresh token: revoke old & create new
    session.revoked_at = datetime.now(timezone.utc)

    res2 = await db.execute(select(User).where(User.id == session.user_id))
    user = res2.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    new_refresh = create_refresh_token()
    new_session = UserSession(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(new_refresh),
        expires_at=UserSession.default_expiry(settings.refresh_token_expire_days),
        
    )
    db.add(new_session)

    await db.commit()

    access = create_access_token(user_id=user.id, role=user.role)
    return TokenOut(access_token=access, refresh_token=new_refresh)


@router.post("/logout", response_model=dict)
async def logout(payload: RefreshIn, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(payload.refresh_token)
    res = await db.execute(select(UserSession).where(UserSession.refresh_token_hash == token_hash))
    session = res.scalar_one_or_none()
    if not session:
        # logout should be idempotent
        return {"ok": True}

    session.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}
