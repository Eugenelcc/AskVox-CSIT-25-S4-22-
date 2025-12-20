from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException,status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core import security
from app.db.session import get_db
from app.models.users import User, UserRole
from app.models.user_sessions import UserSession
import secrets

from app.api.deps import get_current_user, bearer as auth_bearer
from fastapi.security import HTTPAuthorizationCredentials
import httpx
from typing import Optional

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


# In-memory OTP store for tests
OTP_STORE: dict[str, str] = {}


class EmailIn(BaseModel):
    email: str


class OTPIn(BaseModel):
    email: str
    otp: str

# Simple in-memory stores for tests (not for production)
PAYMENT_STORE: dict[int, dict] = {}
PAYMENT_OTP: dict[tuple[int, str], str] = {}
CHAT_STORE: dict[int, list[dict]] = {}


class CardIn(BaseModel):
    number: str
    exp_month: int
    exp_year: int
    cvc: str


class CardConfirmIn(BaseModel):
    token: str
    otp: str


class TranscribeIn(BaseModel):
    audio: str  # for tests we accept text


class ChatIn(BaseModel):
    text: str
    session_id: Optional[int] = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class DeleteAccountIn(BaseModel):
    confirm: bool


@router.post("/register", response_model=dict)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == payload.email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")
    u = User(
        email=payload.email,
        password_hash=security.hash_password(payload.password),
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
    if not user or not user.is_active or not security.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # create session (refresh)
    raw_refresh = security.create_refresh_token()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=security.hash_refresh_token(raw_refresh),
        expires_at=UserSession.default_expiry(settings.refresh_token_expire_days),
    )
    db.add(session)
    await db.commit()

    access = security.create_access_token(user_id=user.id, role=user.role)
    return TokenOut(access_token=access, refresh_token=raw_refresh)


@router.post("/refresh", response_model=TokenOut)
async def refresh(payload: RefreshIn, db: AsyncSession = Depends(get_db)):
    token_hash = security.hash_refresh_token(payload.refresh_token)

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

    new_refresh = security.create_refresh_token()
    new_session = UserSession(
        user_id=user.id,
        refresh_token_hash=security.hash_refresh_token(new_refresh),
        expires_at=UserSession.default_expiry(settings.refresh_token_expire_days),
        
    )
    db.add(new_session)

    await db.commit()

    access = security.create_access_token(user_id=user.id, role=user.role)
    return TokenOut(access_token=access, refresh_token=new_refresh)


@router.post("/logout", response_model=dict)
async def logout(payload: RefreshIn, db: AsyncSession = Depends(get_db)):
    token_hash = security.hash_refresh_token(payload.refresh_token)
    res = await db.execute(select(UserSession).where(UserSession.refresh_token_hash == token_hash))
    session = res.scalar_one_or_none()
    if not session:
        # logout should be idempotent
        return {"ok": True}

    session.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.post("/send-otp", response_model=dict)
def send_otp(payload: EmailIn):
    """Test-only helper: send OTP for an email and return it (not for production)."""
    otp = f"{secrets.randbelow(900000)+100000}"
    OTP_STORE[payload.email] = otp
    return {"ok": True, "otp": otp}


@router.post("/verify-otp", response_model=dict)
def verify_otp(payload: OTPIn):
    expected = OTP_STORE.get(payload.email)
    if not expected or expected != payload.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    del OTP_STORE[payload.email]
    return {"ok": True}


@router.post("/change-password", response_model=dict)
async def change_password(payload: ChangePasswordIn, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Change password endpoint for tests. The `current_user` dependency should be overridden in tests."""
    user = current_user
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not security.verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")
    user.password_hash = security.hash_password(payload.new_password)
    db.add(user)
    await db.commit()
    return {"ok": True}


@router.post("/delete-account", response_model=dict)
async def delete_account(payload: DeleteAccountIn, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Delete/deactivate account for tests. Expects JSON {"confirm": true}."""
    user = current_user
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required")
    user.is_active = False
    db.add(user)
    await db.commit()
    return {"ok": True}


@router.post("/delete-account-supabase", response_model=dict)
async def delete_account_supabase(
    creds: HTTPAuthorizationCredentials | None = Depends(auth_bearer),
):
    """Delete the Supabase Auth user associated with the provided Supabase access token.
    Uses direct HTTP calls to GoTrue Admin API; requires Service Role Key in settings.
    """
    base = settings.supabase_url
    service_key = settings.supabase_service_role_key
    anon_key = settings.supabase_anon_key
    if not base or not service_key:
        raise HTTPException(status_code=500, detail="Supabase admin not configured")
    if not anon_key:
        raise HTTPException(status_code=500, detail="Supabase anon key not configured")

    if not creds:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    access_token = creds.credentials
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # 1) Resolve user from the provided Supabase access token
            uresp = await client.get(
                f"{base}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "apikey": anon_key,
                },
            )
            if uresp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")
            uid = uresp.json().get("id")
            if not uid:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")

            # 2) Delete the user via admin endpoint
            dresp = await client.delete(
                f"{base}/auth/v1/admin/users/{uid}",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                },
            )
            if dresp.status_code not in (200, 204):
                raise HTTPException(status_code=500, detail="Delete failed")
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/payments/add-card")
def add_card(payload: CardIn, user=Depends(get_current_user)):
    token = secrets.token_urlsafe(12)
    last4 = payload.number[-4:]
    PAYMENT_STORE.setdefault(user.id, {})[token] = {"last4": last4, "confirmed": False}
    otp = f"{secrets.randbelow(900000)+100000}"
    PAYMENT_OTP[(user.id, token)] = otp
    return {"token": token, "last4": last4, "otp": otp}  # otp returned for tests


@router.post("/payments/confirm")
def confirm_card(payload: CardConfirmIn, user=Depends(get_current_user)):
    key = (user.id, payload.token)
    expected = PAYMENT_OTP.get(key)
    if not expected or expected != payload.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    PAYMENT_STORE[user.id][payload.token]["confirmed"] = True
    del PAYMENT_OTP[key]
    return {"ok": True}


@router.post("/transcribe")
def transcribe(payload: TranscribeIn, user=Depends(get_current_user)):
    # For tests we simply echo the provided audio as transcript
    transcript = payload.audio
    return {"transcript": transcript}


@router.post("/chat/send")
def chat_send(payload: ChatIn, user=Depends(get_current_user)):
    session_id = payload.session_id or len(CHAT_STORE.get(user.id, [])) + 1
    CHAT_STORE.setdefault(user.id, []).append({"session_id": session_id, "from_user": True, "text": payload.text})
    # simple bot reply
    reply = f"echo: {payload.text}"
    CHAT_STORE[user.id].append({"session_id": session_id, "from_user": False, "text": reply})
    return {"session_id": session_id, "reply": reply}


@router.get("/recommendations")
def recommendations(user=Depends(get_current_user)):
    # naive recommendations: top last words seen in chat history
    items = CHAT_STORE.get(user.id, [])
    words = []
    for m in items:
        if m.get("from_user"):
            words.extend(m.get("text", "").split())
    # return up to 3 unique words as recommendations
    recs = []
    for w in reversed(words):
        if w.lower() not in recs:
            recs.append(w.lower())
        if len(recs) >= 3:
            break
    return {"recommendations": recs}