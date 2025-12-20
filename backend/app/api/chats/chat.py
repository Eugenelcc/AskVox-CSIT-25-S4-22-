
import os
from typing import List, Literal

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel



# Load environment before importing modules that expect keys
load_dotenv()

# Gemini config (replace SeaLion)
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is not set in .env")



router = APIRouter(prefix="/geminichats", tags=["geminichat"])  # keep route stable for frontend

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


async def gemini_generate(message: str, history: List[HistoryItem]) -> str:
    # Use history as-is to avoid dropping context; sanitize empty entries.
    clean_history = [
        {"role": h.role, "content": h.content}
        for h in history
        if isinstance(h.content, str) and h.content.strip()
    ]

    # Build Gemini payload
    system_text = (
        "You are AskVox, a safe educational AI tutor. "
        "Explain clearly and be factual. "
        "Respond in plain text suitable for Text-to-Speech. "
        "Do NOT use Markdown, asterisks, emojis, code fences, tables, or bullets. "
        "Keep sentences concise and natural to say aloud."
    )

    # Convert history to Gemini contents (user/model)
    contents = []
    for h in clean_history:
        role = h.get("role")
        text = h.get("content", "")
        if not text:
            continue
        contents.append({
            "role": "user" if role == "user" else "model",
            "parts": [{"text": text}],
        })

    # Append current user message
    contents.append({"role": "user", "parts": [{"text": message}]})

    endpoint = f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent"
    headers = {"Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY}
    payload = {
        "contents": contents,
        "systemInstruction": {"parts": [{"text": system_text}]},
        "generationConfig": {"maxOutputTokens": 700, "temperature": 0.2},
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except httpx.RequestError as e:
        print("Error contacting Gemini:", e)
        raise HTTPException(status_code=502, detail="Cannot reach Gemini API")

    if resp.status_code != 200:
        print("Gemini error:", resp.status_code, resp.text)
        raise HTTPException(status_code=500, detail="Gemini API error")

    data = resp.json()
    # Extract answer
    try:
        final_answer = (
            data["candidates"][0]["content"]["parts"][0]["text"]
        ).strip()
    except Exception:
        raise HTTPException(status_code=500, detail="Empty answer from Gemini")

    try:
        oneline = " ".join(final_answer.split())
        print(f"🌟 [Gemini] answer(len={len(final_answer)}): {oneline}")
    except Exception:
        pass
    return final_answer



@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # Log prompt and attempt to ensure history is present. If client didn't send
    # history but provided a session_id, reconstruct from Supabase chat_messages.
    try:
        print(f"🌟 [Gemini] prompt='{(req.message or '').strip()[:160]}'")
    except Exception:
        pass

    final_history: List[HistoryItem] = req.history or []

    if (not final_history) and req.session_id and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            }
            # Fetch last 40 messages for the session in chronological order
            url = (
                f"{SUPABASE_URL}/rest/v1/chat_messages"
                f"?select=role,content,created_at"
                f"&session_id=eq.{req.session_id}"
                f"&order=created_at.asc"
                f"&limit=40"
            )
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                rows = resp.json() or []
                # Map to HistoryItem-like dicts, keep only valid role/content
                rebuilt: List[HistoryItem] = []
                for r in rows:
                    role = r.get("role")
                    content = r.get("content")
                    if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                        rebuilt.append(HistoryItem(role=role, content=content))
                if rebuilt:
                    final_history = rebuilt
            else:
                print("⚠️ Failed to load chat history from Supabase:", resp.status_code, resp.text[:300])
        except Exception as e:
            print("⚠️ Error reconstructing history from Supabase:", e)

    try:
        if final_history:
            print(f"🌟 [Gemini] history turns={len(final_history)}")
    except Exception:
        pass

    answer = await gemini_generate(req.message, final_history)
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
                        "model_used": f"gemini:{GEMINI_MODEL}",
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
