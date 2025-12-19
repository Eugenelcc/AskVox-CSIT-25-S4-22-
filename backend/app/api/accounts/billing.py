from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
import httpx

from app.core.config import settings
from app.api.deps import bearer as auth_bearer


router = APIRouter(prefix="/billing", tags=["billing"])


class CardUpsertIn(BaseModel):
    card_number: str
    card_holder_name: str
    expiry_date: str  # MM/YY
    card_type: str | None = None  # visa/mastercard/amex
    cvv: str


@router.post("/card", summary="Upsert user's payment card using Service Role")
async def upsert_card(
    payload: CardUpsertIn,
    creds: HTTPAuthorizationCredentials | None = Depends(auth_bearer),
):
    base = settings.supabase_url
    service_key = settings.supabase_service_role_key
    anon_key = settings.supabase_anon_key
    if not base or not service_key or not anon_key:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    if not creds:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    access_token = creds.credentials

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Resolve Supabase user id from provided user JWT
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

            # Upsert card via PostgREST (RLS bypass with service role)
            upayload = {
                "user_id": uid,
                "card_number": payload.card_number,
                "card_holder_name": payload.card_holder_name,
                "expiry_date": payload.expiry_date,
                "card_type": payload.card_type,
                "cvv": payload.cvv,
            }
            presp = await client.post(
                f"{base}/rest/v1/user_payment_cards?on_conflict=user_id",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
                json=[upayload],
            )
            if presp.status_code not in (200, 201):
                raise HTTPException(status_code=presp.status_code, detail=presp.text)
            rows = presp.json() or []
            row = rows[0] if isinstance(rows, list) and rows else upayload
            return {"ok": True, "card": row}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CheckoutIn(BaseModel):
    card_number: str
    card_holder_name: str
    expiry_date: str
    card_type: str | None = None
    plan_type: str = "monthly"  # "monthly" | "yearly"
    amount: float
    cvv: str


@router.post("/checkout", summary="Complete payment and activate subscription")
async def checkout(
    payload: CheckoutIn,
    creds: HTTPAuthorizationCredentials | None = Depends(auth_bearer),
):
    base = settings.supabase_url
    service_key = settings.supabase_service_role_key
    anon_key = settings.supabase_anon_key
    if not base or not service_key or not anon_key:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    if not creds:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    access_token = creds.credentials

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Resolve Supabase user
            uresp = await client.get(
                f"{base}/auth/v1/user",
                headers={"Authorization": f"Bearer {access_token}", "apikey": anon_key},
            )
            if uresp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")
            uid = uresp.json().get("id")
            if not uid:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")

            # 1) Upsert card
            card_payload = {
                "user_id": uid,
                "card_number": payload.card_number,
                "card_holder_name": payload.card_holder_name,
                "expiry_date": payload.expiry_date,
                "card_type": payload.card_type,
                "cvv": payload.cvv,
            }
            c_resp = await client.post(
                f"{base}/rest/v1/user_payment_cards?on_conflict=user_id",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
                json=[card_payload],
            )
            if c_resp.status_code not in (200, 201):
                raise HTTPException(status_code=c_resp.status_code, detail=c_resp.text)

            # 2) Insert payment history
            # Ensure integer amount if the column is integer in DB
            amt = payload.amount
            try:
                amt_int = int(round(float(amt)))
            except Exception:
                amt_int = 0
            pay_payload = {
                "user_id": uid,
                "amount": amt_int,
                "description": "AskVox Premium Subscription",
                "transaction_status": "Completed",
                "method": "Card",
            }
            p_resp = await client.post(
                f"{base}/rest/v1/payment_history",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Content-Type": "application/json",
                },
                json=pay_payload,
            )
            if p_resp.status_code not in (200, 201):
                raise HTTPException(status_code=p_resp.status_code, detail=p_resp.text)

            # 3) Upsert subscription
            from datetime import datetime, timedelta
            now = datetime.utcnow()
            if payload.plan_type == "yearly":
                end = now.replace(year=now.year + 1)
                monthly_charge = 264
            else:
                end = now + timedelta(days=30)
                monthly_charge = 22
            sub_payload = {
                "user_id": uid,
                "plan_type": payload.plan_type,
                "start_date": now.isoformat() + "Z",
                "end_date": end.isoformat() + "Z",
                "is_active": True,
                "monthly_charge": monthly_charge,
            }
            s_resp = await client.post(
                f"{base}/rest/v1/subscriptions?on_conflict=user_id",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
                json=[sub_payload],
            )
            if s_resp.status_code not in (200, 201):
                raise HTTPException(status_code=s_resp.status_code, detail=s_resp.text)

            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
