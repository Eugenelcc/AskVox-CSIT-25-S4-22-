
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY", "").strip()
TOGETHER_API_URL = "https://api.together.xyz/v1/chat/completions"
LLAMA_GUARD_MODEL = "meta-llama/Llama-Guard-4-12B"

MODERATION_ENABLED = os.getenv("MODERATION_ENABLED", "1").strip() == "1"
MODERATION_FAIL_OPEN = os.getenv("MODERATION_FAIL_OPEN", "1").strip() == "1"
MODERATION_TIMEOUT_SEC = float(os.getenv("MODERATION_TIMEOUT_SEC", "6.0"))


# ──────────
# # Severity
# ──────────
# Llama Guard returns categories .
# our group the most dangerous ones to "critical", rest to "medium".
_CRITICAL_CATEGORIES = {
    "S1",   # Violent Crimes
    "S2",   # Non-Violent Crimes
    "S5",   # Specialized Advice (weapons, drugs)
    "S10",  # Sexual Content involving minors
    "S12",  # Child Sexual Exploitation
}


def _classify_severity(categories: list[str]) -> str:
    cats = set(categories)
    if cats & _CRITICAL_CATEGORIES:
        return "critical"
    if categories:
        return "medium"
    return "low"


def _build_response(severity: str) -> str:
    if severity == "critical":
        return (
            "I'm not able to respond to this message as it contains content "
            "that goes against our safety guidelines. "
            "AskVox is designed to be a safe learning environment for everyone.\n\n"
            "If you believe this was flagged in error, try rephrasing your question. "
        )

    if severity == "medium":
        return (
            "Hmm, I wasn't quite able to process that one - "
            "our content guidelines flagged something in your message. "
            "No worries though!\n\n"
            "Could you try rephrasing? I'm happy to help with any learning question."
        )

    # low
    return (
        "That message was flagged by our content filter, but it might just "
        "need a small rephrase. Could you try asking in a slightly different way? "
        "I'm ready to help!"
    )


# ──────────────────────────────────────────────
# Parse Llama Guard output
# ────────────────────────────────────────��─────
def _parse_guard_response(text: str) -> Dict[str, Any]:

    text = (text or "").strip()

    if not text:
        return {"safe": True, "categories": []}

    lines = text.strip().splitlines()
    verdict = lines[0].strip().lower()

    if verdict == "safe":
        return {"safe": True, "categories": []}

    # "unsafe" 
    categories: list[str] = []
    for line in lines[1:]:
       
        for part in line.replace(",", " ").split():
            part = part.strip()
            if part.startswith("S") and len(part) <= 4:
                categories.append(part)

    return {"safe": False, "categories": categories}


# ──────────────────────
# Core moderation function
# ──────────────────────
async def moderate_message(
    text: str,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:

    safe_result: Dict[str, Any] = {
        "allowed": True,
        "severity": "none",
        "reason": "",
        "response": "",
        "categories": [],
    }

    
    if not MODERATION_ENABLED:
        return safe_result
    if not TOGETHER_API_KEY:
        return safe_result
    if not (text or "").strip():
        return safe_result

    # ── Call Together API with Llama Guard 4 ──
    headers = {
        "Authorization": f"Bearer {TOGETHER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": LLAMA_GUARD_MODEL,
        "messages": [
            {"role": "user", "content": text.strip()[:4000]},
        ],
        "max_tokens": 100,
        "temperature": 0.0,
    }

    try:
        async with httpx.AsyncClient(timeout=MODERATION_TIMEOUT_SEC) as client:
            resp = await client.post(TOGETHER_API_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:

        if MODERATION_FAIL_OPEN:
            return safe_result
        return {
            **safe_result,
            "allowed": False,
            "severity": "unknown",
            "reason": f"moderation_error: {e}",
            "response": (
                "I'm having trouble processing your message right now. "
                "Please try again in a moment."
            ),
        }

    # ── Parse response ──
    guard_text = ""
    try:
        choices = data.get("choices") or []
        if choices:
            guard_text = (choices[0].get("message") or {}).get("content", "")
    except Exception:
        guard_text = ""

    parsed = _parse_guard_response(guard_text)

    # ── Safe → allow through ──
    if parsed["safe"]:
        return safe_result

    # ── Unsafe → block before LLaMA 3 ──
    categories = parsed["categories"]
    severity = _classify_severity(categories)
    response_text = _build_response(severity)

    return {
        "allowed": False,
        "severity": severity,
        "reason": f"Flagged: {', '.join(categories) if categories else 'unsafe'}",
        "response": response_text,
        "categories": categories,
    }