from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from llama_cpp import Llama
from typing import List, Literal

from dotenv import load_dotenv
load_dotenv()
import re
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor


# --- Configuration ---
# Define FastAPI router
router = APIRouter(prefix="/chats", tags=["chat"])

# --- Model Path Configuration ---
# This section constructs a path to the model file relative to this script.
# This makes the path work correctly for anyone who clones the repository,
# regardless of where they clone it.

# The GGUF model file should be placed in `backend/models/`
MODEL_FILENAME = "llama-2-7b-chat.Q4_K_M.gguf"

# Get the absolute path to the directory containing this script
# e.g., C:/.../AskVox/backend/app/api/chats
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Construct the path to the model file by going up from the script's directory
# to the `backend` directory, then into the `models` folder.
# SCRIPT_DIR -> ../../.. -> backend/
MODEL_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", "llm", MODEL_FILENAME))

# --- Model Loading ---
# This section runs only once when the application starts.
# It's much faster than loading the full transformers model.
print(f"Attempting to load model from: {MODEL_PATH}")

# Check if the model file actually exists before trying to load it
if not os.path.exists(MODEL_PATH):
    print(f"---")
    print(f"ERROR: Model file not found at the path: {MODEL_PATH}")
    print(f"Please make sure the model file '{MODEL_FILENAME}' exists in the 'backend/models/' directory.")
    print(f"---")
    llm = None
else:
    try:
        # n_gpu_layers=-1 tells it to offload layers to the GPU when available.
        # n_ctx increases the context window (if supported by the model file/build).
        # n_threads lets llama.cpp use multiple CPU threads for faster inference.
        cpu_count = os.cpu_count() or 4
        # cap threads to avoid oversubscription; keep at most 8
        threads = max(1, min(8, cpu_count - 1))

        # create a shared threadpool for offloading blocking calls
        _EXECUTOR = ThreadPoolExecutor(max_workers=threads)

        llm = Llama(
            model_path=MODEL_PATH,
            n_gpu_layers=0,  # force CPU-only for predictable behavior
            n_ctx=1024,       # smaller context to reduce memory and speed up attention
            n_threads=threads,
            verbose=False,
        )
        print("Model loaded successfully.")
    except Exception as e:
        print(f"Error loading model: {e}")
        llm = None

# --- Data Models ---
class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[HistoryItem] = []

class ChatResponse(BaseModel):
    answer: str

# --- Chat Generation Logic ---
async def generate_response(message: str, history: List[HistoryItem]) -> str:
    """
    Generates a response from the local GGUF model using llama-cpp-python.
    """
    if not llm:
        raise HTTPException(status_code=500, detail="Model is not loaded. Check server logs for errors.")

    # 1. Trim history and normalize it (enforce user/assistant alternation)
    # Keep only the most recent turns and truncate long messages so the prompt
    # fits within the model's context window.
    MAX_HISTORY_ITEMS = 3
    MAX_CHARS_PER_ITEM = 2000

    trimmed = history[-MAX_HISTORY_ITEMS:]

    # Normalize to enforce alternating roles starting with 'user' (like sealion_generate)
    normalized_history = []
    expected_role = "user"
    for h in trimmed:
        content = (h.content or "")[:MAX_CHARS_PER_ITEM]
        # skip empty content or unexpected role
        if not content.strip() or h.role != expected_role:
            continue
        normalized_history.append({"role": "user" if h.role == "user" else "assistant", "content": content})
        expected_role = "assistant" if expected_role == "user" else "user"

    # If history ends with a user message, drop it (we will add the new user prompt below)
    if normalized_history and normalized_history[-1]["role"] == "user":
        normalized_history = normalized_history[:-1]

    # Build final messages: system prompt + normalized history + current user message
    SYSTEM_PROMPT = {
        "role": "system",
        "content": (
            "You are AskVox, a safe educational AI tutor. "
            "Explain clearly, be factual, and avoid harmful or sensitive content. "
            "Do not include stage directions, actions, or roleplay (for example: 'adjusts glasses', '*smiles*', '(laughs)'); "
            "respond plainly and only with the assistant's text content."
        ),
    }

    trimmed_message = (message or "")[:MAX_CHARS_PER_ITEM]

    final_messages = [SYSTEM_PROMPT] + normalized_history + [{"role": "user", "content": trimmed_message}]


    import time
    t0 = time.perf_counter()
    MAX_GEN_TOKENS = 512

    try:
        # Debug: Print the final messages being sent to the model
        print("--- Final Messages to Model ---")
        for msg in final_messages:
            print(f"  - Role: {msg['role']}, Content: '{msg['content'][:100]}...'")
        print("-----------------------------")

        # Offload the blocking model call to a threadpool so FastAPI's event loop stays responsive
        loop = asyncio.get_running_loop()
        func = lambda: llm.create_chat_completion(
            messages=final_messages,
            max_tokens=MAX_GEN_TOKENS,
            temperature=0.3,
            top_p=0.9,
            stream=False,
        )
        completion = await loop.run_in_executor(_EXECUTOR, func)
    except Exception as e:
        print(f"Generation error: {e}")
        # Re-raise as HTTPException so FastAPI returns 500 with the message
        raise HTTPException(status_code=500, detail=str(e))
    t1 = time.perf_counter()
    print(f"Model generation time: {t1-t0:.2f}s")

    # 3. Extract the answer
    answer = completion['choices'][0]['message']['content']

    # Post-process the model output to remove stage directions and repeated greetings.
    def clean_response_text(text: str, history_list: List[dict]) -> str:
        if not text:
            return text

        # Remove asterisk/underscore-emphasized actions and parenthetical actions
        cleaned = re.sub(r"(\*[^*]+\*|_[^_]+_|\([^)]*\))", "", text)

        # Remove some common single-phrase actions (e.g. 'adjusts glasses', 'smiles')
        cleaned = re.sub(r"\b(adjusts|smiles|smiled|smile|nods|laughs|waves|sighs|looks|grins|chuckles|giggles)\b(?:[\s\S]{0,30})?",
                         "", cleaned, flags=re.IGNORECASE)

        # Collapse whitespace
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()

        # If the assistant repeated a simple greeting and the last assistant turn already greeted,
        # drop the duplicated first sentence. This prevents multiple 'Hello' lines.
        try:
            # find last assistant content in the normalized history
            last_assistant = None
            for m in reversed(history_list):
                if m.get("role") == "assistant" and m.get("content", "").strip():
                    last_assistant = m.get("content", "").strip().lower()
                    break

            # detect simple greeting at start of text
            first_sent = re.split(r"[\.\!?]\s+", cleaned, maxsplit=1)[0].strip().lower()
            greetings = ("hello", "hi", "hey", "greetings")
            if last_assistant:
                for g in greetings:
                    if last_assistant.startswith(g) and first_sent.startswith(g):
                        # remove the first sentence (the greeting)
                        parts = re.split(r"([\.\!?])\s*", cleaned, maxsplit=1)
                        if len(parts) >= 3:
                            cleaned = parts[2].strip()
                        else:
                            cleaned = ""
                        break
        except Exception:
            pass

        # Remove repeated assistant identity sentences that restate the system prompt,
        # e.g. "I'm AskVox, a safe and educational AI tutor..." at the start of the reply.
        try:
            cleaned = re.sub(
                r"^\s*(?:i(?:'m| am)\s+askvox\b[^\.!?]{0,200}[\.!?]\s*|i(?:'m| am)\s+an?\s+ai\s+tutor[^\.!?]{0,200}[\.!?]\s*)",
                "",
                cleaned,
                flags=re.IGNORECASE,
            ).strip()
        except Exception:
            pass

        return cleaned.strip()

    # Pass normalized_history (without system prompt) for duplication checks
    history_for_check = [m for m in final_messages if m.get("role") != "system"]
    cleaned_answer = clean_response_text(answer or "", history_for_check)

    # Fallback to raw answer if cleaning removed everything
    if not cleaned_answer:
        cleaned_answer = (answer or "").strip()

    return cleaned_answer

# --- API Endpoint ---
@router.post("/local", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Endpoint to interact with the local Llama-2 GGUF model.
    """
    try:
        answer = await generate_response(req.message, req.history)
        return ChatResponse(answer=answer)
    except Exception as e:
        # Log the full error for debugging
        print(f"An error occurred during chat generation: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating response: {str(e)}")
