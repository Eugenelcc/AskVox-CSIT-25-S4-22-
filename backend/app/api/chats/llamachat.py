from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Literal
from fastapi.responses import StreamingResponse
import os
import json
import httpx
import time  # ✅ NEW
from dotenv import load_dotenv

# Load env vars
load_dotenv()

router = APIRouter(prefix="/llamachats", tags=["llamachat"])

# --- CONFIGURATION ---
LLAMA_CLOUDRUN_URL = os.getenv("LLAMA_CLOUDRUN_URL", "") 

# --- INITIALIZATION: LOCAL MODEL ---
# We try to load the local model. If it fails (or if we are on a tiny cloud server),
# we just log it and set local_llm to None.
local_llm = None

print(f"--- Llama Configuration ---")
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

class ChatResponse(BaseModel):
    answer: str


# --- LOGIC 1: CLOUD GENERATION ---
async def generate_cloud(message: str, history: List[HistoryItem]) -> str:
    if not LLAMA_CLOUDRUN_URL:
        raise HTTPException(status_code=500, detail="LLAMA_CLOUDRUN_URL is missing in .env")

    # Build a simple chat-style prompt from history + message
    SYSTEM_PROMPT = "You are AskVox, a safe educational AI tutor."
    parts = [f"[SYSTEM] {SYSTEM_PROMPT}"]

    for h in history[-3:]:
        if h.role == "user":
            parts.append(f"[USER] {h.content}")
        else:
            parts.append(f"[ASSISTANT] {h.content}")

    parts.append(f"[USER] {message}")
    parts.append("[ASSISTANT]")  # model continues this

    prompt = "\n".join(parts)

    print(f"☁️ Sending request to Cloud Run: {LLAMA_CLOUDRUN_URL}")
    async with httpx.AsyncClient(timeout=120.0) as client:
        t0 = time.perf_counter()  # ✅ start timer
        try:
            # Cloud Run service exposes POST /chat and expects {"prompt": "..."}
            resp = await client.post(
                LLAMA_CLOUDRUN_URL,
                json={"prompt": prompt},
            )
            t1 = time.perf_counter()
            print(f"⏱️ Cloud Run round-trip time: {t1 - t0:.2f}s")  # ✅ log latency
        except httpx.RequestError as e:
            t1 = time.perf_counter()
            print(f"❌ [CloudRun RequestError] {e} (after {t1 - t0:.2f}s)")
            # Network/connection issues
            raise HTTPException(
                status_code=502,
                detail=f"Cloud Run request failed: {str(e)}",
            )

    # Log status + body for debugging
    print(f"🌐 Cloud Run status: {resp.status_code}")
    text_body = resp.text
    if resp.status_code >= 400:
        print(f"📄 Cloud Run error body: {text_body[:500]}")

        raise HTTPException(
            status_code=502,
            detail=f"Cloud Run returned {resp.status_code}: {text_body[:200]}",
        )

    # Parse JSON
    try:
        data = resp.json()
    except Exception as e:
        print(f"❌ [CloudRun JSON Error] {e} | Raw body: {text_body[:500]}")
        raise HTTPException(
            status_code=502,
            detail="Cloud Run returned invalid JSON",
        )

    answer = (data.get("response") or "").strip()
    if not answer:
        print(f"⚠️ Cloud Run JSON did not contain 'response'. Full JSON: {json.dumps(data)[:500]}")
        raise HTTPException(
            status_code=502,
            detail="Cloud Run response missing 'response' field",
        )

    return answer


# --- LOGIC 2: LOCAL GENERATION ---
async def generate_local(message: str, history: List[HistoryItem]) -> str:
    if not local_llm:
        raise HTTPException(status_code=500, detail="Local Model is not loaded (Check logs)")

    # 1. Prepare Prompt
    # Normalize history simple for Llama
    normalized_history = []
    for h in history[-3:]:
        normalized_history.append({"role": h.role, "content": h.content})

    final_messages = [
        {"role": "system", "content": "You are AskVox, a safe educational AI tutor."}
    ] + normalized_history + [{"role": "user", "content": message}]

    # 2. Run Inference (Blocking)
    print("💻 Running Local Inference...")
    try:
        # Note: In a real app, use run_in_executor to avoid blocking event loop
        output = local_llm.create_chat_completion(
            messages=final_messages,
            max_tokens=512,
            temperature=0.3
        )
        return output['choices'][0]['message']['content']
    except Exception as e:
        print(f"❌ Local Error: {e}")
        raise HTTPException(status_code=500, detail=f"Local Generation Failed: {str(e)}")


# --- ENDPOINTS ---

@router.post("/cloud", response_model=ChatResponse)
async def chat_cloud(req: ChatRequest):
    """
    Forces the use of the Google Cloud Run API.
    Requires LLAMA_CLOUDRUN_URL in .env
    """
    answer = await generate_cloud(req.message, req.history)
    return ChatResponse(answer=answer)


@router.post("/local", response_model=ChatResponse)
async def chat_local(req: ChatRequest):
    """
    Forces the use of the Local GGUF Model (RAM).
    Requires model to be loaded locally.
    """
    answer = await generate_local(req.message, req.history)
    return ChatResponse(answer=answer)

