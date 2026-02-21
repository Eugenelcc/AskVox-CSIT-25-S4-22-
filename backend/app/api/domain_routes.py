"""
FastAPI endpoints for domain classification
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional
import os

from app.services.domain_classifier import (
    classify_domain,
    classify_domain_debug,
    get_available_domains,
    validate_domain,
)

router = APIRouter(prefix="/domain", tags=["domain"])

class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000, description="Query text to classify")
    allowed_domains: Optional[list[str]] = Field(
        None,
        description="Optional list of domains to restrict classification to"
    )
    include_debug: bool = Field(
        False,
        description="If true, includes Google NLP category/confidence and mapping strategy in the response",
    )

class ClassifyResponse(BaseModel):
    domain: str
    text: str
    confidence: str = "high"  # Google doesn't give confidence in free tier

    # Optional debug fields (only returned when include_debug=true or DEBUG_DOMAIN_CLASSIFICATION=true)
    google_top_category: Optional[str] = None
    google_top_confidence: Optional[float] = None
    strategy: Optional[str] = None
    google_categories: Optional[list[dict]] = None

class DomainsResponse(BaseModel):
    domains: list[str]


class DebugLogRequest(BaseModel):
    table: str = Field(..., description="Logical destination table name (e.g. 'queries')")
    payload: dict = Field(..., description="Payload that will be written to Supabase")

@router.post("/classify", response_model=ClassifyResponse)
async def classify_endpoint(req: ClassifyRequest):
    """
    Classify query text into AskVox domain.
    
    - Uses Google NLP for semantic understanding
    - Falls back to keyword matching for custom domains
    - Always returns a valid domain from your whitelist
    """
    try:
        allowed_set = set(req.allowed_domains) if req.allowed_domains else None
        debug_enabled = req.include_debug or os.getenv("DEBUG_DOMAIN_CLASSIFICATION", "false").lower() == "true"

        if debug_enabled:
            domain, dbg = classify_domain_debug(req.text, allowed_domains=allowed_set)

            # Backend-visible debug log (prints to the same terminal running Uvicorn)
            try:
                text_preview = (req.text or "").replace("\n", " ").strip()
                if len(text_preview) > 120:
                    text_preview = text_preview[:120] + "..."
                print(
                    "[domain] ",
                    {
                        "text": text_preview,
                        "google_top_category": dbg.get("google_top_category"),
                        "google_top_confidence": dbg.get("google_top_confidence"),
                        "strategy": dbg.get("strategy"),
                        "mapped_domain": domain,
                    },
                )
            except Exception:
                # Never let logging break the endpoint
                pass

            return ClassifyResponse(
                domain=domain,
                text=req.text,
                google_top_category=dbg.get("google_top_category"),
                google_top_confidence=dbg.get("google_top_confidence"),
                strategy=dbg.get("strategy"),
                google_categories=dbg.get("google_categories"),
            )

        domain = classify_domain(req.text, allowed_domains=allowed_set)
        return ClassifyResponse(domain=domain, text=req.text)
    except Exception as e:
        # Never fail - always return "general" as safe fallback
        print(f"Classification error: {e}")
        return ClassifyResponse(domain="general", text=req.text)

@router.get("/list", response_model=DomainsResponse)
async def list_domains():
    """Get list of all available domains"""
    return DomainsResponse(domains=get_available_domains())

@router.post("/validate")
async def validate(req: dict):
    """Validate if a domain is allowed"""
    domain = req.get("domain", "")
    return {"valid": validate_domain(domain), "domain": domain}


@router.post("/debug-log")
async def debug_log(req: DebugLogRequest, request: Request):
    """Print a backend-terminal debug line for client-side Supabase inserts.

    The frontend inserts into Supabase directly, so the backend can't normally
    see what was written. This endpoint lets the frontend send a copy of the
    payload for logging during development.

    Safety: disabled unless DEBUG_DOMAIN_CLASSIFICATION=true.
    """

    debug_env = os.getenv("DEBUG_DOMAIN_CLASSIFICATION", "false").lower() == "true"

    client_host = None
    try:
        client_host = request.client.host if request.client else None
    except Exception:
        client_host = None

    # Allow loopback without requiring an env var (local dev convenience).
    is_loopback = client_host in {"127.0.0.1", "::1", "localhost"}

    if not debug_env and not is_loopback:
        raise HTTPException(status_code=403, detail="Debug logging disabled")

    try:
        payload = dict(req.payload or {})

        # Never log secrets if someone accidentally includes them.
        for key in [
            "apikey",
            "apiKey",
            "api_key",
            "authorization",
            "Authorization",
            "token",
            "access_token",
            "refresh_token",
            "SUPABASE_SERVICE_ROLE_KEY",
        ]:
            if key in payload:
                payload[key] = "[REDACTED]"

        # Keep logs readable
        if isinstance(payload.get("transcribed_text"), str):
            text_preview = payload["transcribed_text"].replace("\n", " ").strip()
            if len(text_preview) > 200:
                text_preview = text_preview[:200] + "..."
            payload["transcribed_text"] = text_preview

        print("[supabase] client_insert", {"table": req.table, "payload": payload})
    except Exception as e:
        print(f"[supabase] debug-log failed: {e}")

    return {"ok": True}