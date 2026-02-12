from __future__ import annotations

import os
import time
import asyncio
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional, Tuple

import httpx
from fastapi import HTTPException, Request

from app.core.config import settings


REGISTERED_RPM = int(os.getenv("REGISTERED_CHAT_RPM", "30"))
PAID_RPM = int(os.getenv("PAID_CHAT_RPM", "120"))
WINDOW_SECONDS = int(os.getenv("CHAT_RATE_WINDOW_SECONDS", "60"))

PAID_CACHE_TTL_SECONDS = int(os.getenv("PAID_CACHE_TTL_SECONDS", "60"))


@dataclass
class _Bucket:
    hits: Deque[float]
    lock: asyncio.Lock


_buckets: Dict[str, _Bucket] = {}
_paid_cache: Dict[str, Tuple[bool, float]] = {}


async def _get_bucket(key: str) -> _Bucket:
    bucket = _buckets.get(key)
    if bucket is None:
        bucket = _Bucket(hits=deque(), lock=asyncio.Lock())
        _buckets[key] = bucket
    return bucket


async def is_user_paid(user_id: str) -> bool:
    now = time.time()
    cached = _paid_cache.get(user_id)
    if cached and cached[1] > now:
        return cached[0]

    base = settings.supabase_url
    service_key = settings.supabase_service_role_key
    if not base or not service_key:
        _paid_cache[user_id] = (False, now + min(30, PAID_CACHE_TTL_SECONDS))
        return False

    params = {
        "user_id": f"eq.{user_id}",
        "select": "is_active,end_date",
        "order": "end_date.desc",
        "limit": "1",
    }
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{base}/rest/v1/subscriptions", headers=headers, params=params)
        if resp.status_code in (200, 206):
            rows = resp.json() or []
            paid = bool(rows and rows[0].get("is_active"))
            if paid:
                _paid_cache[user_id] = (True, now + PAID_CACHE_TTL_SECONDS)
                return True

        # Manual override support: profiles.role = 'paid_user'
        async with httpx.AsyncClient(timeout=5) as client:
            presp = await client.get(
                f"{base}/rest/v1/profiles",
                headers=headers,
                params={"id": f"eq.{user_id}", "select": "role", "limit": "1"},
            )
        if presp.status_code in (200, 206):
            prows = presp.json() or []
            role = ((prows[0].get("role") if prows else None) or "").strip().lower()
            if role in ("paid_user", "paid"):
                _paid_cache[user_id] = (True, now + PAID_CACHE_TTL_SECONDS)
                return True

        _paid_cache[user_id] = (False, now + PAID_CACHE_TTL_SECONDS)
        return False
    except Exception:
        _paid_cache[user_id] = (False, now + min(30, PAID_CACHE_TTL_SECONDS))
        return False


async def enforce_chat_rate_limit(request: Request, user_id: Optional[str]) -> None:
    limit = REGISTERED_RPM
    if user_id:
        try:
            if await is_user_paid(user_id):
                limit = PAID_RPM
        except Exception:
            limit = REGISTERED_RPM
        key = f"user:{user_id}"
    else:
        host = (request.client.host if request.client else "unknown")
        key = f"ip:{host}"

    bucket = await _get_bucket(key)
    now = time.time()
    cutoff = now - WINDOW_SECONDS

    async with bucket.lock:
        while bucket.hits and bucket.hits[0] < cutoff:
            bucket.hits.popleft()

        if len(bucket.hits) >= limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        bucket.hits.append(now)
