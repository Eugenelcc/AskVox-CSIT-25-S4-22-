from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from llama_cpp import Llama
from typing import List, Literal
from fastapi.responses import StreamingResponse

from dotenv import load_dotenv
load_dotenv()
import re
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
import time

# --- Configuration ---
# Define FastAPI router
router = APIRouter(prefix="/llamachats", tags=["llamachat"])

# --- Model Path Configuration ---
# --- Model Loading from Hugging Face Hub ---
# Replace with your actual repo ID + filename
HF_REPO = "cakebut/askvox_api"        
HF_FILENAME = "llama-2-7b-chat.Q4_K_M.gguf"      # must match HF file exactly

print(f"Attempting to load model from Hugging Face: {HF_REPO}/{HF_FILENAME}")

try:
    cpu_count = os.cpu_count() or 4
    threads = max(1, min(8, cpu_count - 1))
    _EXECUTOR = ThreadPoolExecutor(max_workers=threads)

    # Automatically downloads + caches from HF
    llm = Llama.from_pretrained(
        repo_id=HF_REPO,
        filename=HF_FILENAME,
        n_gpu_layers=0,
        n_ctx=1024,
        n_threads=threads,
        verbose=False,
    )

    print("Model loaded successfully from Hugging Face Hub.")

except Exception as e:
    print(f"Error loading model from Hugging Face: {e}")
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
            "Do not add long generic safety prefaces for ordinary, benign requests. "
            "Do not include stage directions, actions, or roleplay (for example: 'adjusts glasses', '*smiles*', '(laughs)'); "
            "respond plainly and only with the assistant's text content."
        ),
    }

    trimmed_message = (message or "")[:MAX_CHARS_PER_ITEM]

    final_messages = [SYSTEM_PROMPT] + normalized_history + [{"role": "user", "content": trimmed_message}]

 
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
    def clean_response_text(text: str, history_list: List[dict], user_text: str) -> str:
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
            # Only remove this on follow-up turns (i.e. when history contains previous assistant content).
            if len(history_list) > 1:
                try:
                    cleaned = re.sub(
                        r"^\s*(?:i(?:'m| am)\s+askvox\b[^\.!?]{0,200}[\.!?]\s*|i(?:'m| am)\s+an?\s+ai\s+tutor[^\.!?]{0,200}[\.!?]\s*)",
                        "",
                        cleaned,
                        flags=re.IGNORECASE,
                    ).strip()
                except Exception:
                    pass

        # Remove common model safety prefaces that start the reply.
        try:
            cleaned = re.sub(r"(?is)^\s*(?:As an? AI language model[\s\S]{0,200}?\.|As a responsible[\s\S]{0,200}?\.|I cannot provide recommendations for specific[\s\S]{0,200}?\.)\s*", "", cleaned, count=1)
        except Exception:
            pass

        return cleaned.strip()

    # Pass the original conversation history (previous turns) for duplication checks
    # This ensures we correctly detect whether an assistant reply already exists
    # in prior turns and avoid removing or prepending the intro incorrectly.
    history_for_check = [{"role": h.role, "content": h.content} for h in history]
    cleaned_answer = clean_response_text(answer or "", history_for_check, trimmed_message)

    # Fallback to raw answer if cleaning removed everything
    if not cleaned_answer:
        cleaned_answer = (answer or "").strip()

    # Ensure first-turn introduction includes AskVox identity.
    # If this is the first assistant reply (no prior assistant content) and
    # the model did not introduce itself, prepend a short identity line.
    try:
        prior_assistant = any(m.get("role") == "assistant" for m in history_for_check)
        if not prior_assistant:
            # If the assistant didn't mention AskVox in its reply, add a concise intro.
            if not re.search(r"askvox", cleaned_answer, flags=re.IGNORECASE):
                intro = "Hello — I'm AskVox, your personal learning assistant. "
                cleaned_answer = intro + cleaned_answer
    except Exception:
        pass

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


@router.post("/stream")
async def stream_chat(req: ChatRequest):
    """
    Streams model tokens as Server-Sent Events (SSE). The client can consume
    this using EventSource or a fetch() streaming reader to display tokens
    as they arrive.
    """
    if not llm:
        raise HTTPException(status_code=500, detail="Model is not loaded. Check server logs for errors.")

    # Reuse the same normalization logic as generate_response
    MAX_HISTORY_ITEMS = 3
    MAX_CHARS_PER_ITEM = 2000

    trimmed = req.history[-MAX_HISTORY_ITEMS:]
    normalized_history = []
    expected_role = "user"
    for h in trimmed:
        content = (h.content or "")[:MAX_CHARS_PER_ITEM]
        if not content.strip() or h.role != expected_role:
            continue
        normalized_history.append({"role": "user" if h.role == "user" else "assistant", "content": content})
        expected_role = "assistant" if expected_role == "user" else "user"

    if normalized_history and normalized_history[-1]["role"] == "user":
        normalized_history = normalized_history[:-1]

    SYSTEM_PROMPT = {
        "role": "system",
        "content": (
            "You are AskVox, a safe educational AI tutor. "
            "Explain clearly, be factual, and avoid harmful or sensitive content. "
            "Only include brief safety warnings when the user explicitly asks for or discusses dangerous, illegal, or self-harm content. "
            "Do not add long generic safety prefaces for ordinary, benign requests. "
            "Do not include stage directions, actions, or roleplay; respond plainly."
        ),
    }

    trimmed_message = (req.message or "")[:MAX_CHARS_PER_ITEM]
    final_messages = [SYSTEM_PROMPT] + normalized_history + [{"role": "user", "content": trimmed_message}]

    MAX_GEN_TOKENS = 512

    def event_stream():
        try:
            # The llama-cpp-python client yields chunks when stream=True
            for chunk in llm.create_chat_completion(messages=final_messages, max_tokens=MAX_GEN_TOKENS, temperature=0.3, top_p=0.9, stream=True):
                token = None
                try:
                    token = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                except Exception:
                    pass
                if not token:
                    try:
                        token = chunk.get("choices", [{}])[0].get("text")
                    except Exception:
                        token = None

                if token:
                    # Send as SSE 'data:' event; clients can parse and append tokens
                    yield f"data: {token}\n\n"

            # Indicate stream end
            yield "data: [DONE]\n\n"
        except Exception as e:
            # Surface the error to the client
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
