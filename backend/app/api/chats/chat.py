
import os
from typing import List, Literal

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel



# Load environment before importing modules that expect keys
load_dotenv()

SEALION_BASE_URL = os.getenv("SEALION_BASE_URL", "https://api.sea-lion.ai/v1").rstrip("/")
SEALION_API_KEY = os.getenv("SEALION_API_KEY")
SEALION_MODEL = os.getenv("SEALION_MODEL", "aisingapore/Gemma-SEA-LION-v4-27B-IT")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SEALION_API_KEY:
    raise RuntimeError("SEALION_API_KEY is not set in .env")



router = APIRouter(prefix="/sealionchats", tags=["sealionchat"])

Role = Literal["user", "assistant"]


class HistoryItem(BaseModel):
    role: Role
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[HistoryItem] = []
    # Optional linkage for DB persistence (mirror llamachat)
    query_id: str | None = None
    session_id: str | None = None
    user_id: str | None = None


class ChatResponse(BaseModel):
    answer: str


async def sealion_generate(message: str, history: List[HistoryItem]) -> str:
    # Normalize history so roles always alternate user/assistant starting with user.
    normalized_history = []
    expected_role: Role = "user"
    for h in history:
        if h.role != expected_role or not h.content.strip():
            continue
        normalized_history.append(
            {"role": "user" if h.role == "user" else "assistant", "content": h.content}
        )
        expected_role = "assistant" if expected_role == "user" else "user"

    # If history ends with a user message, drop it to keep alternation before adding the new user prompt.
    if normalized_history and normalized_history[-1]["role"] == "user":
        normalized_history = normalized_history[:-1]

    # Build OpenAI-style messages array
    messages = [
        {
            "role": "system",
            "content": (
                "You are AskVox, a safe educational AI tutor. "
                "Explain clearly and be factual. "
                "Respond in plain text suitable for Text-to-Speech. "
                "Do NOT use Markdown, asterisks, emojis, code fences, tables, or bullets. "
                "Keep sentences concise and natural to say aloud."
            ),
        }
    ]

    messages.extend(normalized_history)

    messages.append({"role": "user", "content": message})

    headers = {
        "Authorization": f"Bearer {SEALION_API_KEY}",
        "Content-Type": "application/json",
    }

    url = f"{SEALION_BASE_URL}/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": SEALION_MODEL,
                    "messages": messages,
                    "max_tokens": 700,
                    "temperature": 0.2,
                },
            )
    except httpx.RequestError as e:
        print("Error contacting SeaLion:", e)
        raise HTTPException(status_code=502, detail="Cannot reach SeaLion API")

    if resp.status_code != 200:
        print("SeaLion error:", resp.status_code, resp.text)
        raise HTTPException(status_code=500, detail="SeaLion API error")

    data = resp.json()

    # OpenAI-compatible structure
    answer = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )

    if not answer:
        raise HTTPException(status_code=500, detail="Empty answer from SeaLion")

    final_answer = answer.strip()
    # Debug full answer (single-line), so frontend and logs can validate TTS text
    try:
        oneline = " ".join(final_answer.split())
        print(f"🦭 [Sealion] answer(len={len(final_answer)}): {oneline}")
    except Exception:
        pass
    return final_answer



@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    try:
        print(f"🦭 [Sealion] prompt='{(req.message or '').strip()[:160]}'")
        if req.history:
            print(f"🦭 [Sealion] history turns={len(req.history)}")
    except Exception:
        pass
    answer = await sealion_generate(req.message, req.history)
    # Persist response + assistant chat_message to Supabase if linkage provided
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        async with httpx.AsyncClient() as client:
            # Insert into responses (backend-only)
            if req.query_id:
                try:
                    payload = {
                        "query_id": req.query_id,
                        "response_text": answer,
                        "model_used": f"sealion:{SEALION_MODEL}",
                    }
                    await client.post(f"{SUPABASE_URL}/rest/v1/responses", headers=headers, json=payload)
                except Exception as e:
                    print(f"⚠️ Failed to insert response into Supabase: {e}")

            # Optionally mirror assistant message in chat_messages
            if req.session_id:
                try:
                    payload = {
                        "session_id": req.session_id,
                        "user_id": req.user_id,
                        "role": "assistant",
                        "content": answer,
                        "display_name": "AskVox",
                    }

                    await client.post(f"{SUPABASE_URL}/rest/v1/chat_messages", headers=headers, json=payload)
                except Exception as e:
                    print(f"⚠️ Failed to insert assistant chat_message: {e}")

    return ChatResponse(answer=answer)


#app.include_router(stt_ws_router)
