import os
from typing import List, Literal

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel



# Load environment before importing modules that expect keys
load_dotenv()

from app.services.stt_router import router as stt_router

SEALION_BASE_URL = os.getenv("SEALION_BASE_URL", "https://api.sea-lion.ai/v1").rstrip("/")
SEALION_API_KEY = os.getenv("SEALION_API_KEY")
SEALION_MODEL = os.getenv("SEALION_MODEL", "aisingapore/Gemma-SEA-LION-v4-27B-IT")

if not SEALION_API_KEY:
    raise RuntimeError("SEALION_API_KEY is not set in .env")



router = APIRouter(prefix="/chats", tags=["chat"])

Role = Literal["user", "assistant"]


class HistoryItem(BaseModel):
    role: Role
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[HistoryItem] = []


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
                "Explain clearly, be factual, and avoid harmful or sensitive content."
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

    return answer.strip()



@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    answer = await sealion_generate(req.message, req.history)
    return ChatResponse(answer=answer)


#app.include_router(stt_ws_router)
