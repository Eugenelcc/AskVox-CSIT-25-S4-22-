from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import re
from typing import List, Literal
from fastapi.responses import StreamingResponse
import os
import json
import httpx
import time
from dotenv import load_dotenv

# Load env vars
load_dotenv()

router = APIRouter(prefix="/llamachats", tags=["llamachat"])

# --- CONFIGURATION ---
LLAMA_CLOUDRUN_URL = os.getenv("LLAMA_CLOUDRUN_URL", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ⭐ How we want all answers to look
FORMAT_INSTRUCTION = (
    "Always format your answer clearly.\n"
    "- Start with at most 1 short sentence introduction.\n"
    "- When giving multiple suggestions, use a numbered list with ONE item per line, like:\n"
    "  1. First recommendation\n"
    "  2. Second recommendation\n"
    "  3. Third recommendation\n"
    "- Avoid giant wall-of-text paragraphs.\n"
)

# --- INITIALIZATION: LOCAL MODEL ---
local_llm = None

print("--- Llama Configuration ---")
try:
    # Import locally to avoid crashing if library is missing in cloud
    from llama_cpp import Llama
    from concurrent.futures import ThreadPoolExecutor

    HF_REPO = "cakebut/askvox_api"
    HF_FILENAME = "llama-2-7b-chat.Q4_K_M.gguf"

    print("💻 Attempting to load Local Model...")
    # You can change n_gpu_layers to -1 if you have a GPU locally!
    local_llm = Llama.from_pretrained(
        repo_id=HF_REPO,
        filename=HF_FILENAME,
        n_gpu_layers=0,
        n_ctx=1024,
        verbose=False,
    )
    print("✅ Local Model Loaded Successfully.")

except Exception as e:
    print(f"⚠️ Local Model could not be loaded: {e}")
    print("   (This is normal if you only plan to use the /cloud endpoint)")


# --- Data Models ---
class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[HistoryItem] = []
    # Optional linkage for DB persistence
    query_id: str | None = None
    session_id: str | None = None
    user_id: str | None = None


class ChatResponse(BaseModel):
    answer: str


# --- LOGIC 1: CLOUD GENERATION ---
async def generate_cloud(message: str, history: List[HistoryItem]) -> str:
    if not LLAMA_CLOUDRUN_URL:
        raise HTTPException(
            status_code=500,
            detail="LLAMA_CLOUDRUN_URL is missing in .env",
        )

    # ==========================================
    # 1. HISTORY "BAKING" LOGIC (The Important Part)
    # ==========================================
    # We start with the System Prompt / Formatting Rules
    full_prompt = f"[SYSTEM] {FORMAT_INSTRUCTION}\n"
    
    # LOOP THROUGH HISTORY:
    # We take the last 3 turns of history and paste them into the prompt.
    # This ensures the Cloud AI "sees" what was said before.
    for h in history[-3:]:
        role_tag = "USER" if h.role == "user" else "ASSISTANT"
        full_prompt += f"[{role_tag}] {h.content}\n"
    
    # Add the NEW message at the end
    full_prompt += f"[USER] {message}\n[ASSISTANT]"

    # ==========================================
    # 2. PAYLOAD PREPARATION
    # ==========================================
    # We send the entire "script" (full_prompt) as the "message".
    # This tricks the simple Cloud Server into understanding context.
    payload = {
        "message": full_prompt 
    }

    # 3. Setup Timeout (5 Minutes for slow AI)
    timeout = httpx.Timeout(
        connect=10.0,
        read=300.0, 
        write=10.0,
        pool=10.0,
    )

    print(f"☁️ Sending request to Cloud Run: {LLAMA_CLOUDRUN_URL}", flush=True)
    
    # --- LOG START ---
    print(f"🧠 CloudRun LLaMA: generating...", flush=True)

    async with httpx.AsyncClient(timeout=timeout) as client:
        t0 = time.perf_counter()
        try:
            resp = await client.post(
                LLAMA_CLOUDRUN_URL,
                json=payload,
            )
            t1 = time.perf_counter()
            
            # --- LOG END ---
            print(f"⏱️ CloudRun generation time: {t1 - t0:.2f}s", flush=True)

        except httpx.RequestError as e:
            t1 = time.perf_counter()
            print(f"❌ [CloudRun RequestError] {e} (after {t1 - t0:.2f}s)", flush=True)
            raise HTTPException(
                status_code=502,
                detail=f"Cloud Run request failed: {str(e)}",
            )

    # Error Handling
    if resp.status_code >= 400:
        text_body = resp.text
        print(f"📄 Cloud Run error body: {text_body[:500]}", flush=True)
        raise HTTPException(
            status_code=502,
            detail=f"Cloud Run returned {resp.status_code}: {text_body[:200]}",
        )

    # Parse JSON
    try:
        data = resp.json()
    except Exception as e:
        print(f"❌ [CloudRun JSON Error] {e}", flush=True)
        raise HTTPException(status_code=502, detail="Invalid JSON from Cloud Run")

    # Extract Answer
    answer = data.get("response") or data.get("answer") or data.get("reply") or ""
    
    if not answer:
        print(f"⚠️ Cloud Run JSON missing answer field. Keys found: {list(data.keys())}", flush=True)
        raise HTTPException(
            status_code=502,
            detail="Cloud Run response missing 'response' field",
        )

    # Sanitize: strip role tags and cut any trailing script sections
    def _clean(text: str) -> str:
        # Trim at the next user/system cue if model continued the script
        cut_markers = ["\n[USER]", "\nUSER:", "\n[SYSTEM]", "\nSYSTEM:"]
        cut_positions = [text.find(m) for m in cut_markers if m in text]
        if cut_positions:
            cut_idx = min([p for p in cut_positions if p >= 0])
            text = text[:cut_idx]
        # Remove any remaining role tags
        text = re.sub(r"\s*\[(?:USER|ASSISTANT|SYSTEM)\]\s*", " ", text)
        text = re.sub(r"\b(?:USER|ASSISTANT|SYSTEM):\s*", " ", text)
        # Normalize whitespace
        return re.sub(r"\s+", " ", text).strip()

    return _clean(answer)


# --- LOGIC 2: LOCAL GENERATION ---
async def generate_local(message: str, history: List[HistoryItem]) -> str:
    if not local_llm:
        raise HTTPException(
            status_code=500,
            detail="Local Model is not loaded (Check logs)",
        )

    # Normalize history for Llama
    normalized_history = []
    for h in history[-3:]:
        normalized_history.append({"role": h.role, "content": h.content})

    # ⭐ Stronger system prompt with formatting rules
    SYSTEM_PROMPT = (
        "You are AskVox, a safe educational AI tutor.\n"
        f"{FORMAT_INSTRUCTION}"
    )

    final_messages = (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + normalized_history
        + [{"role": "user", "content": message}]
    )

    print("💻 Running Local Inference...")
    try:
        output = local_llm.create_chat_completion(
            messages=final_messages,
            max_tokens=512,
            temperature=0.3,
        )
        return output["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"❌ Local Error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Local Generation Failed: {str(e)}",
        )


# --- ENDPOINTS ---

@router.post("/cloud", response_model=ChatResponse)
async def chat_cloud(req: ChatRequest):
    """
    Uses the Google Cloud Run LLaMA endpoint.
    Requires LLAMA_CLOUDRUN_URL in .env
    """
    answer = await generate_cloud(req.message, req.history)
    print("☁️ Cloud Answer:", answer)
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
                        "model_used": "llama2-cloud",
                    }
                    await client.post(f"{SUPABASE_URL}/rest/v1/responses", headers=headers, json=payload)
                except Exception as e:
                    print(f"⚠️ Failed to insert response into Supabase: {e}")

            # Optionally mirror assistant message in chat_messages
            if req.session_id:
                try:
                    payload = {
                        "session_id": req.session_id,
                        "user_id": req.user_id,   # 👈 SAME USER AS QUERY
                        "role": "assistant",
                        "content": answer,
                        "display_name": "AskVox",
                    }

                    await client.post(f"{SUPABASE_URL}/rest/v1/chat_messages", headers=headers, json=payload)
                except Exception as e:
                    print(f"⚠️ Failed to insert assistant chat_message: {e}")

    return ChatResponse(answer=answer)


@router.post("/local", response_model=ChatResponse)
async def chat_local(req: ChatRequest):
    """
    Uses the Local GGUF Model (RAM).
    Requires model to be loaded locally.
    """
    answer = await generate_local(req.message, req.history)
    print("💻 Local Answer:", answer)
    return ChatResponse(answer=answer)
