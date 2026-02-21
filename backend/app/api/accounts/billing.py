from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
import httpx
import stripe as stripe_sdk

from app.core.config import settings
from app.api.deps import bearer as auth_bearer


router = APIRouter(prefix="/billing", tags=["billing"])

# Module-level Stripe secret for routes that don't set it explicitly
secret = settings.stripe_secret_key


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
    secret = settings.stripe_secret_key
    secret = settings.stripe_secret_key
    secret = settings.stripe_secret_key
    secret = settings.stripe_secret_key
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
    # Card fields optional when using saved Stripe PaymentMethod
    card_number: str | None = None
    card_holder_name: str | None = None
    expiry_date: str | None = None
    card_type: str | None = None
    payment_method_id: str | None = None
    # Frontend currently sends the billing cycle in the field named `plan_type`.
    # Interpret it as the billing period: "monthly" | "yearly".
    plan_type: str = "monthly"
    # Subscription type: "paid" | "education" (default paid)
    subscription_type: str = "paid"
    amount: float
    cvv: str | None = None
    use_saved_card: bool = False


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

            # 1) When a different card is provided:
            #    - If the user ALREADY has a saved card in Supabase, create or use the provided PM
            #      WITHOUT attaching it to the customer (prevents duplicate saved cards on Stripe) and
            #      DO NOT update Supabase metadata nor change the customer's default.
            #    - If the user has NO saved card, create or use the PM, ATTACH it, set as default,
            #      and persist masked metadata to Supabase for future payments.
            if (payload.payment_method_id or payload.card_number) and not payload.use_saved_card:
                if not secret:
                    raise HTTPException(status_code=500, detail="Stripe not configured")
                # Initialize Stripe
                stripe_sdk.api_key = secret

                # Resolve or create customer (reuse logic from attach route)
                customer_id = None
                get_card = await client.get(
                    f"{base}/rest/v1/user_payment_cards",
                    headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
                    params={"user_id": f"eq.{uid}", "select": "stripe_customer_id,card_brand,last4,exp_month,exp_year", "limit": 1},
                )
                if get_card.status_code in (200, 206):
                    rows = get_card.json() or []
                    existing_card_row = rows[0] if rows else None
                    if existing_card_row:
                        customer_id = existing_card_row.get("stripe_customer_id")
                if not customer_id:
                    get_prof = await client.get(
                        f"{base}/rest/v1/profiles",
                        headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
                        params={"id": f"eq.{uid}", "select": "id,stripe_customer_id", "limit": 1},
                    )
                    if get_prof.status_code in (200, 206):
                        rows = get_prof.json() or []
                        if rows:
                            customer_id = rows[0].get("stripe_customer_id")
                if not customer_id:
                    cust = stripe_sdk.Customer.create(metadata={"user_id": uid})
                    customer_id = cust.id
                    # Try save on profiles (ignore failure if column absent)
                    await client.patch(
                        f"{base}/rest/v1/profiles",
                        headers={
                            "Authorization": f"Bearer {service_key}",
                            "apikey": service_key,
                            "Content-Type": "application/json",
                            "Prefer": "return=minimal",
                        },
                        params={"id": f"eq.{uid}"},
                        json={"stripe_customer_id": customer_id},
                    )

                # Parse expiry ONLY when creating server-side PM from raw card fields
                mm = 0; yy = 0
                creating_server_pm = bool(payload.card_number) and not bool(payload.payment_method_id)
                if creating_server_pm:
                    try:
                        exp = (payload.expiry_date or "").strip()
                        if len(exp) == 5 and "/" in exp:
                            mm = int(exp.split("/")[0])
                            yy = int(exp.split("/")[1])
                            yy = 2000 + yy if yy < 100 else yy
                    except Exception:
                        pass
                    if mm < 1 or mm > 12:
                        raise HTTPException(status_code=400, detail="Invalid expiry")

                # Create or use provided PaymentMethod
                if payload.payment_method_id:
                    pm = stripe_sdk.PaymentMethod.retrieve(payload.payment_method_id)
                else:
                    pm = stripe_sdk.PaymentMethod.create(
                        type="card",
                        card={
                            "number": payload.card_number,
                            "exp_month": mm,
                            "exp_year": yy,
                            "cvc": payload.cvv or "",
                        },
                        billing_details={"name": (payload.card_holder_name or "").strip() or None},
                    )

                # Only attach/set default/persist metadata when the user has no saved card yet.
                willPersistAsDefault = not (get_card.status_code in (200, 206) and existing_card_row)
                if willPersistAsDefault:
                    # Attach to the customer and make it the default.
                    stripe_sdk.PaymentMethod.attach(pm.id, customer=customer_id)
                    stripe_sdk.Customer.modify(customer_id, invoice_settings={"default_payment_method": pm.id})

                card = pm.get("card", {}) or {}
                brand = card.get("brand") or (payload.card_type or "card")
                last4 = card.get("last4") or (payload.card_number[-4:] if payload.card_number else "0000")
                exp_month = card.get("exp_month") or mm
                exp_year = card.get("exp_year") or yy

                if willPersistAsDefault:
                    upayload = {
                        "user_id": uid,
                        "stripe_customer_id": customer_id,
                        "stripe_payment_method_id": pm.id,
                        "card_brand": brand,
                        "last4": last4,
                        "exp_month": int(exp_month),
                        "exp_year": int(exp_year),
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
                "description": "AskVox Educational Subscription" if (payload.subscription_type or "paid").lower() == "education" else "AskVox Premium Subscription",
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
            # Map to new schema: plan_type ('free'|'paid'|'education'), billing_period,
            # amount_charged (cents), currency 'USD'.
            billing_period = "yearly" if payload.plan_type == "yearly" else "monthly"
            end = now.replace(year=now.year + 1) if billing_period == "yearly" else (now + timedelta(days=30))
            # Amount based on subscription type
            if (payload.subscription_type or "paid").lower() == "education":
                amount_cents = 480000 if billing_period == "yearly" else 40000
            else:
                amount_cents = 26400 if billing_period == "yearly" else 2200

            sub_payload = {
                "user_id": uid,
                "plan_type": (payload.subscription_type or "paid").lower(),
                "billing_period": billing_period,
                "amount_charged": amount_cents,
                "currency": "USD",
                "start_date": now.isoformat() + "Z",
                "end_date": end.isoformat() + "Z",
                "is_active": True,
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

            # 4) Update profile role (best-effort)
            sub_type = (payload.subscription_type or "paid").lower()
            if sub_type in ("education", "paid"):
                # Do not clobber platform_admin
                try:
                    get_prof = await client.get(
                        f"{base}/rest/v1/profiles",
                        headers={
                            "Authorization": f"Bearer {service_key}",
                            "apikey": service_key,
                            "Accept": "application/json",
                        },
                        params={"id": f"eq.{uid}", "select": "role", "limit": 1},
                    )
                    cur_role = ""
                    if get_prof.status_code in (200, 206):
                        rows = get_prof.json() or []
                        cur_role = ((rows[0].get("role") if rows else None) or "").strip().lower()
                    if cur_role != "platform_admin":
                        next_role = "educational_user" if sub_type == "education" else "paid_user"
                        upd = await client.patch(
                            f"{base}/rest/v1/profiles?id=eq.{uid}",
                            headers={
                                "Authorization": f"Bearer {service_key}",
                                "apikey": service_key,
                                "Content-Type": "application/json",
                                "Prefer": "return=representation",
                            },
                            json={"role": next_role},
                        )
                        if upd.status_code not in (200, 204):
                            return {"ok": True, "role_update_error": upd.text}
                except Exception:
                    # Don't fail checkout on role update
                    pass

            # Back-compat: keep older behavior for education plan
            if (payload.subscription_type or "").lower() == "education":
                upd = await client.patch(
                    f"{base}/rest/v1/profiles?id=eq.{uid}",
                    headers={
                        "Authorization": f"Bearer {service_key}",
                        "apikey": service_key,
                        "Content-Type": "application/json",
                        "Prefer": "return=representation",
                    },
                    json={"role": "educational_user"},
                )
                if upd.status_code not in (200, 204):
                    # Don't fail checkout on role update; log-like error via response
                    return {"ok": True, "role_update_error": upd.text}

            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class StripeAttachIn(BaseModel):
    payment_method_id: str


@router.post("/stripe/attach-payment-method", summary="Attach Stripe PaymentMethod to customer and persist metadata")
async def stripe_attach_payment_method(
    payload: StripeAttachIn,
    creds: HTTPAuthorizationCredentials | None = Depends(auth_bearer),
):
    base = settings.supabase_url
    service_key = settings.supabase_service_role_key
    anon_key = settings.supabase_anon_key
    secret = settings.stripe_secret_key
    if not base or not service_key or not anon_key:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    if not secret:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    if not creds:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    access_token = creds.credentials

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Resolve Supabase user id
            uresp = await client.get(
                f"{base}/auth/v1/user",
                headers={"Authorization": f"Bearer {access_token}", "apikey": anon_key},
            )
            if uresp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")
            uid = uresp.json().get("id")
            if not uid:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")

            # Init Stripe
            stripe_sdk.api_key = secret

            # First try to find existing customer id in user_payment_cards (most reliable)
            customer_id = None
            get_card = await client.get(
                f"{base}/rest/v1/user_payment_cards",
                headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
                params={"user_id": f"eq.{uid}", "select": "stripe_customer_id", "limit": 1},
            )
            if get_card.status_code in (200, 206):
                rows = get_card.json() or []
                if rows:
                    customer_id = rows[0].get("stripe_customer_id")

            # Fallback: look on profiles (if column exists)
            if not customer_id:
                get_prof = await client.get(
                    f"{base}/rest/v1/profiles",
                    headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
                    params={"id": f"eq.{uid}", "select": "id,stripe_customer_id", "limit": 1},
                )
                if get_prof.status_code in (200, 206):
                    rows = get_prof.json() or []
                    if rows:
                        customer_id = rows[0].get("stripe_customer_id")

            # Create customer once if still missing, then attempt to persist id
            if not customer_id:
                cust = stripe_sdk.Customer.create(metadata={"user_id": uid})
                customer_id = cust.id
                # Try save on profiles (ignore failure if column absent)
                await client.patch(
                    f"{base}/rest/v1/profiles",
                    headers={
                        "Authorization": f"Bearer {service_key}",
                        "apikey": service_key,
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    params={"id": f"eq.{uid}"},
                    json={"stripe_customer_id": customer_id},
                )

            # Attach PaymentMethod and set as default
            stripe_sdk.PaymentMethod.attach(payload.payment_method_id, customer=customer_id)
            stripe_sdk.Customer.modify(customer_id, invoice_settings={"default_payment_method": payload.payment_method_id})

            pm = stripe_sdk.PaymentMethod.retrieve(payload.payment_method_id)
            card = pm.get("card", {}) or {}
            brand = card.get("brand") or "card"
            last4 = card.get("last4") or "0000"
            exp_month = card.get("exp_month") or 12
            exp_year = card.get("exp_year") or 2030

            # Upsert Supabase user_payment_cards using your schema
            upayload = {
                "user_id": uid,
                "stripe_customer_id": customer_id,
                "stripe_payment_method_id": payload.payment_method_id,
                "card_brand": brand,
                "last4": last4,
                "exp_month": int(exp_month),
                "exp_year": int(exp_year),
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


@router.delete("/card", summary="Remove current user's saved payment card (Service Role + detach from Stripe)")
async def delete_saved_card(
    creds: HTTPAuthorizationCredentials | None = Depends(auth_bearer),
):
    base = settings.supabase_url
    service_key = settings.supabase_service_role_key
    anon_key = settings.supabase_anon_key
    secret = settings.stripe_secret_key
    if not base or not service_key or not anon_key:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    if not creds:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    access_token = creds.credentials

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Resolve Supabase user id
            uresp = await client.get(
                f"{base}/auth/v1/user",
                headers={"Authorization": f"Bearer {access_token}", "apikey": anon_key},
            )
            if uresp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")
            uid = uresp.json().get("id")
            if not uid:
                raise HTTPException(status_code=401, detail="Invalid Supabase token")

            # Look up saved card to get Stripe identifiers
            get_card = await client.get(
                f"{base}/rest/v1/user_payment_cards",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Accept": "application/json",
                },
                params={
                    "user_id": f"eq.{uid}",
                    "select": "stripe_customer_id,stripe_payment_method_id",
                    "limit": 1,
                },
            )
            if get_card.status_code not in (200, 206):
                raise HTTPException(status_code=get_card.status_code, detail=get_card.text)
            rows = get_card.json() or []
            cust_id = rows[0].get("stripe_customer_id") if rows else None
            pm_id = rows[0].get("stripe_payment_method_id") if rows else None

            # Best-effort: detach PM and clear default on Stripe
            if secret:
                try:
                    stripe_sdk.api_key = secret
                    if pm_id:
                        stripe_sdk.PaymentMethod.detach(pm_id)
                    if cust_id:
                        stripe_sdk.Customer.modify(cust_id, invoice_settings={"default_payment_method": None})
                        # Optionally delete the customer to remove the row in Stripe dashboard
                        try:
                            stripe_sdk.Customer.delete(cust_id)
                        except Exception:
                            # Safe to ignore if deletion is blocked by existing objects
                            pass
                except Exception:
                    # Continue with Supabase delete even if Stripe step fails
                    pass

            # Delete user_payment_cards row for this user
            dresp = await client.delete(
                f"{base}/rest/v1/user_payment_cards",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Prefer": "return=minimal",
                },
                params={"user_id": f"eq.{uid}"},
            )
            if dresp.status_code not in (200, 204):
                raise HTTPException(status_code=dresp.status_code, detail=dresp.text)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/education-status", summary="Check if user has approved educational verification")
async def education_status(
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

            # Query education_verification_requests using service role to bypass RLS
            resp = await client.get(
                f"{base}/rest/v1/education_verification_requests",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Accept": "application/json",
                },
                params={
                    "user_id": f"eq.{uid}",
                    "status": "eq.approved",
                    "select": "id",
                    "limit": 1,
                },
            )
            if resp.status_code not in (200, 206):
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            rows = resp.json() or []
            approved = isinstance(rows, list) and len(rows) > 0
            return {"approved": approved}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/subscription", summary="Delete current user's subscription (Service Role, bypass RLS)")
async def delete_subscription(
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

            # Delete all subscription rows for this user via PostgREST using service role
            dresp = await client.delete(
                f"{base}/rest/v1/subscriptions",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Prefer": "return=minimal",
                },
                params={
                    "user_id": f"eq.{uid}",
                },
            )
            if dresp.status_code not in (200, 204):
                raise HTTPException(status_code=dresp.status_code, detail=dresp.text)
            # Reset profile role back to 'user' if currently 'educational_user', 'educational' or 'paid_user'
            get_profile = await client.get(
                f"{base}/rest/v1/profiles",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                    "Accept": "application/json",
                },
                params={
                    "id": f"eq.{uid}",
                    "select": "role",
                    "limit": 1,
                },
            )
            role_update_error = None
            if get_profile.status_code in (200, 206):
                rows = get_profile.json() or []
                cur_role = (rows[0].get("role") if rows else None) or ""
                cur_role_norm = cur_role.strip().lower() if isinstance(cur_role, str) else ""
                if cur_role_norm != "platform_admin" and cur_role_norm in ("educational", "educational_user", "paid_user", "paid"):
                    upd = await client.patch(
                        f"{base}/rest/v1/profiles",
                        headers={
                            "Authorization": f"Bearer {service_key}",
                            "apikey": service_key,
                            "Content-Type": "application/json",
                            "Prefer": "return=representation",
                        },
                        params={
                            "id": f"eq.{uid}",
                        },
                        json={"role": "user"},
                    )
                    if upd.status_code not in (200, 204):
                        role_update_error = upd.text

            return {"ok": True, **({"role_update_error": role_update_error} if role_update_error else {})}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
