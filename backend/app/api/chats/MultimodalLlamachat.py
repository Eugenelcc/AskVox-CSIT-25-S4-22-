
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import re
from typing import List, Literal, Optional, Dict, Any, Tuple
import os
import json
import time
import httpx
from datetime import datetime, timezone
import asyncio
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/llamachats-multi", tags=["llamachat-plus"])

# -----------------------
# ENV
# -----------------------
LLAMA_CLOUDRUN_URL = os.getenv("LLAMA_CLOUDRUN_URL", "")

# RunPod Serverless (job-mode)
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "").strip()
RUNPOD_AUTH_HEADER = os.getenv("RUNPOD_AUTH_HEADER", "Authorization").strip()
RUNPOD_RUN_ENDPOINT = os.getenv("RUNPOD_RUN_ENDPOINT", "").strip()
RUNPOD_STATUS_ENDPOINT = os.getenv("RUNPOD_STATUS_ENDPOINT", "").strip()
RUNPOD_MAX_WAIT_SEC = float(os.getenv("RUNPOD_MAX_WAIT_SEC", "180"))
RUNPOD_POLL_INTERVAL_SEC = float(os.getenv("RUNPOD_POLL_INTERVAL_SEC", "1.5"))

# Supabase (REST + Storage)
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "chat-images")

# Google APIs
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", "")  # Custom Search Engine ID
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")

# Internet RAG provider (optional)
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

USE_SUPABASE_STORAGE_FOR_IMAGES = os.getenv("USE_SUPABASE_STORAGE_FOR_IMAGES", "0") == "1"
FORCE_WEB_SOURCES = os.getenv("FORCE_WEB_SOURCES", "0") == "1"
FORCE_YOUTUBE = os.getenv("FORCE_YOUTUBE", "0") == "1"
FORCE_IMAGES = os.getenv("FORCE_IMAGES", "0") == "1"

# Explicitly log CloudRun usage (no local model by default)
if LLAMA_CLOUDRUN_URL:
    print(
        f"☁️ CloudRun mode enabled. Target: {LLAMA_CLOUDRUN_URL} (local model disabled)",
        flush=True,
    )

# One-time meta logging
cloud_meta_logged: bool = False

async def _log_cloudrun_meta_once() -> None:
    global cloud_meta_logged
    if cloud_meta_logged or not LLAMA_CLOUDRUN_URL:
        return
    try:
        base = LLAMA_CLOUDRUN_URL.rstrip('/')
        if base.endswith('/chat'):
            base = base[: -len('/chat')]
        meta_url = f"{base}/meta"
        root_url = f"{base}/"
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(meta_url)
            if r.status_code >= 400:
                r = await client.get(root_url)
            data = r.json() if r.headers.get('content-type','').startswith('application/json') else {}
            n_ctx = data.get('n_ctx')
            n_threads = data.get('n_threads')
            max_tokens = data.get('max_tokens')
            system = data.get('system')
            model_path = data.get('model_path')
            if any(v is not None for v in (n_ctx, n_threads, max_tokens, model_path, system)):
                print(
                    "☁️ CloudRun LLaMA config:",
                    {
                        "n_ctx": n_ctx,
                        "n_threads": n_threads,
                        "max_tokens": max_tokens,
                        "model_path": model_path,
                        "system": system,
                    },
                    flush=True,
                )
            else:
                print(
                    "☁️ CloudRun meta endpoint not exposing config. Optional: add /meta to Cloud app to return n_ctx, n_threads, max_tokens.",
                    flush=True,
                )
    except Exception:
        # Silent fail; do not block startup if meta unreachable
        pass
    finally:
        cloud_meta_logged = True

# -----------------------
# Local Llama (optional debug)
# Mirrors Cloud Run app.py style loading
# -----------------------
ENABLE_LOCAL_LLAMA = os.getenv("ENABLE_LOCAL_LLAMA", "0") == "1"
local_llm = None
if ENABLE_LOCAL_LLAMA:
    try:
        # Import locally to avoid crashing if library is missing
        from llama_cpp import Llama
        # Config similar to Cloud app.py
        LOCAL_MODEL_PATH = os.getenv("LOCAL_MODEL_PATH", "./model.gguf")
        N_CTX = int(os.getenv("N_CTX", "2048"))
        N_THREADS = int(os.getenv("N_THREADS", "4"))

        if os.path.exists(LOCAL_MODEL_PATH):
            print("--- Llama Configuration ---", flush=True)
            print(f"💻 Loading local model from {LOCAL_MODEL_PATH}...", flush=True)
            try:
                local_llm = Llama(
                    model_path=LOCAL_MODEL_PATH,
                    n_ctx=N_CTX,
                    n_threads=N_THREADS,
                    n_gpu_layers=0,  # CPU-only by default; set to -1 if you have GPU layers
                    verbose=False,
                )
                print("✅ Local Model Loaded Successfully.", flush=True)
            except Exception as e:
                print(f"⚠️ Failed to load local Llama model: {e}", flush=True)
        # If path is missing, stay silent and keep using Cloud
    except Exception as e:
        # If llama_cpp isn't installed, silently skip local mode
        pass

# -----------------------
# PROMPT SIZE GUARDS
# -----------------------
MAX_PROMPT_CHARS = 6000
MAX_ARTICLE_CHARS = 1200
MAX_RAG_CHARS = 600
MAX_EVIDENCE_CHARS = 1400
MAX_HISTORY_CHARS = 900
MAX_MESSAGE_CHARS = 800

# -----------------------
# PROMPTS
# -----------------------
FORMAT_INSTRUCTION = (
    "Always format your answer clearly.\n"
    "- When giving multiple suggestions, use a numbered list with ONE item per line.\n"
    "- Avoid giant wall-of-text paragraphs.\n"
)

CITATION_TOKEN_RULES = """
CITATIONS RULES (VERY IMPORTANT):
- When you use a fact from the provided evidence, add a citation token immediately after the sentence, like: [[cite:1]]
- Only cite from the sources provided in [SOURCES] below.
- Do NOT use [1] style. ONLY use [[cite:1]] tokens.
- If you are not sure / not supported by evidence, say so and do not cite.
"""

MODEL_JSON_INSTRUCTION = (
    "When appropriate, respond using a VALID JSON object matching the schema below.\n\n"
        "CRITICAL RULES:\n"
        "- Do NOT rewrite, summarize, shorten, or rephrase the answer.\n"
        "- Preserve ALL tone, emojis, formatting, markdown, lists, and wording exactly.\n"
        "- Simply PLACE the answer inside \"answer_markdown\".\n"
        "- No text before or after JSON.\n\n"
        "Schema:\n"
        "{\n"
        "  \"answer_markdown\": \"string\",\n"
        "  \"need_web_sources\": true/false,\n"
        "  \"need_images\": true/false,\n"
        "  \"need_youtube\": true/false,\n\n"
        "  \"web_query\": \"string (short query if need_web_sources)\",\n"
        "  \"image_query\": \"string (short query if need_images)\",\n"
        "  \"youtube_query\": \"string (short query if need_youtube)\"\n"
        "}\n\n"
        "Additional guidance:\n"
        "- answer_markdown is the final answer the user sees.\n"
        "- Apply these formatting rules:\n"
        + FORMAT_INSTRUCTION
        + "\n\n"
        + CITATION_TOKEN_RULES
        + "\n\n"
        "- If need_web_sources=false then web_query must be \"\" (same for image/youtube).\n"
        "- Do not invent citations. Only cite if evidence exists.\n"
        "- If the user includes a specific year (e.g., 2026), the web_query MUST include that year when relevant.\n"
)

# -----------------------
# PERFORMANCE: lightweight in-memory caches and time budgets
# -----------------------
_CACHE_TTL_SEC = 300  # 5 minutes
_cache_google: Dict[Tuple[str, int], Tuple[float, List['SourceItem']]] = {}
_cache_tavily: Dict[Tuple[str, int], Tuple[float, Tuple[List['SourceItem'], List[Dict[str, str]]]]] = {}
_cache_images: Dict[Tuple[str, int], Tuple[float, List[Dict[str, str]]]] = {}
_cache_youtube: Dict[Tuple[str, int], Tuple[float, List['YouTubeItem']]] = {}

async def fast_google_web_search(query: str, num: int = 6, timeout_sec: float = 3.5) -> List['SourceItem']:
    key = (query or "", int(num))
    now = time.perf_counter()
    cached = _cache_google.get(key)
    if cached and (now - cached[0] <= _CACHE_TTL_SEC):
        return cached[1]
    try:
        res = await asyncio.wait_for(google_web_search(query, num=num), timeout=timeout_sec)
    except Exception:
        res = []
    _cache_google[key] = (now, res)
    return res

async def fast_tavily(query: str, max_sources: int = 6, timeout_sec: float = 4.5) -> Tuple[List['SourceItem'], List[Dict[str, str]]]:
    key = (query or "", int(max_sources))
    now = time.perf_counter()
    cached = _cache_tavily.get(key)
    if cached and (now - cached[0] <= _CACHE_TTL_SEC):
        return cached[1]
    try:
        res = await asyncio.wait_for(internet_rag_search_and_extract(query, max_sources=max_sources), timeout=timeout_sec)
    except Exception:
        res = ([], [])
    _cache_tavily[key] = (now, res)
    return res

async def fast_images(query: str, num: int = 4, timeout_sec: float = 3.0) -> List[Dict[str, str]]:
    key = (query or "", int(num))
    now = time.perf_counter()
    cached = _cache_images.get(key)
    if cached and (now - cached[0] <= _CACHE_TTL_SEC):
        return cached[1]
    try:
        res = await asyncio.wait_for(google_image_search(query, num=num), timeout=timeout_sec)
    except Exception:
        res = []
    _cache_images[key] = (now, res)
    return res

async def fast_youtube(query: str, num: int = 2, timeout_sec: float = 3.0) -> List['YouTubeItem']:
    key = (query or "", int(num))
    now = time.perf_counter()
    cached = _cache_youtube.get(key)
    if cached and (now - cached[0] <= _CACHE_TTL_SEC):
        return cached[1]
    try:
        res = await asyncio.wait_for(youtube_search(query, num=num), timeout=timeout_sec)
    except Exception:
        res = []
    _cache_youtube[key] = (now, res)
    return res

# Overall time budget for a single multimodal request (soft)
_TOTAL_BUDGET_SEC = float(os.getenv("MM_TOTAL_BUDGET_SEC", "9.0"))

# YouTube result sizing (hard cap + default returned count)
_YOUTUBE_MAX_RESULTS = max(1, min(int(os.getenv("MM_YOUTUBE_MAX_RESULTS", "5")), 10))
_YOUTUBE_DEFAULT_RESULTS = max(1, min(int(os.getenv("MM_YOUTUBE_DEFAULT_RESULTS", "2")), _YOUTUBE_MAX_RESULTS))

# -----------------------
# DATA MODELS
# -----------------------
class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[HistoryItem] = []
    query_id: Optional[str] = None
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    article_title: Optional[str] = None
    article_url: Optional[str] = None

class SourceItem(BaseModel):
    title: str
    url: str
    snippet: Optional[str] = None
    icon_url: Optional[str] = None

class ImageItem(BaseModel):
    url: str
    storage_path: Optional[str] = None
    alt: Optional[str] = None
    source_url: Optional[str] = None

class YouTubeItem(BaseModel):
    title: str
    url: str
    video_id: str
    channel: Optional[str] = None
    thumbnail_url: Optional[str] = None

class AssistantPayload(BaseModel):
    answer_markdown: str
    sources: List[SourceItem] = Field(default_factory=list)
    images: List[ImageItem] = Field(default_factory=list)
    youtube: List[YouTubeItem] = Field(default_factory=list)
    # UI helpers
    source_count: int = 0
    cite_available: bool = False
    cite_label: Optional[str] = None

class ChatResponse(BaseModel):
    answer: str
    payload: AssistantPayload

# -----------------------
# Option A: Keyword Router + Option C: Escalation + Tool Budget
# -----------------------
# NOTE: avoid overly generic triggers like "how to" which match many normal questions.
_MEDIA_WORDS_RE = re.compile(r"\b(video|videos|youtube|yt|watch|tutorial|guide|how to|walkthrough)\b", re.I)
_IMAGE_WORDS_RE = re.compile(r"\b(image|images|picture|pictures|photo|photos|png|jpg|jpeg|sticker|diagram|infographic|show me)\b", re.I)

# ✅ UPDATED: web triggers are more "explicit web intent" + year-based "released in 2026"
# - remove "now" and the generic "202[0-9]" trigger because it causes accidental web routing
_WEB_WORDS_RE = re.compile(
    r"\b(latest|news|today|current|update|updated|recent|price|release|released|schedule|announcement|"
    r"source|sources|link|links|cite|citation|according to|resources|reference)\b",
    re.I,
)

# ✅ NEW: "year request" signals a time-sensitive lookup (e.g., "released in 2026")
_YEAR_WEB_INTENT_RE = re.compile(r"\b(released|release|airing|air|premiere|premiered|new|best)\b.*\b(20\d{2})\b", re.I)

_UNCERTAIN_RE = re.compile(
    r"\b(i (don't|do not) know|not sure|can't verify|cannot verify|unsure|might be|may be|could be|depends|"
    r"check online|look it up|search|verify|as of|recently)\b",
    re.I,
)

_DEFLECTION_RE = re.compile(
    r"\b(i can't|i cannot|i'm unable to|i am unable to|don't have access|do not have access|"
    r"i don't have (real\s*-?time|realtime) data|i cannot browse|i can't browse|"
    r"as an ai|i'm just an ai|cannot guarantee|no guarantees)\b",
    re.I,
)

_FACT_SEEKING_RE = re.compile(
    r"\b(who|what|when|where|which)\b|"
    r"\b(how many|how much)\b|"
    r"\b(compare|vs\.?|difference between)\b",
    re.I,
)

_YEAR_RE = re.compile(r"\b(20\d{2})\b")

def extract_years(text: str) -> List[str]:
    return _YEAR_RE.findall(text or "")

def keyword_router(message: str) -> Dict[str, bool]:
    msg = (message or "").strip()
    want_web = bool(_WEB_WORDS_RE.search(msg)) or bool(_YEAR_WEB_INTENT_RE.search(msg))
    return {
        "want_youtube": bool(_MEDIA_WORDS_RE.search(msg)),
        "want_images": bool(_IMAGE_WORDS_RE.search(msg)),
        "want_web": want_web,
    }

# ✅ NEW: smalltalk/identity detection to avoid pointless web sources
_SMALLTALK_RE = re.compile(
    r"(\bhi\b|\bhello\b|\bhey\b|\bhiya\b|\bsup\b|\bhow are you\b|\bthanks\b|\bthank you\b|\bbye\b|\bgoodbye\b|"
    r"\bwho are you\b|\bwhat are you\b|\bintroduce yourself\b|\bwhat can you do\b|\bwho am i\b)",
    re.I,
)

def is_smalltalk_or_identity(message: str) -> bool:
    msg = (message or "").strip()
    if not msg:
        return False
    return bool(_SMALLTALK_RE.search(msg))

# ✅ FIX: Empty answer is NOT a signal that "web is needed"
def looks_like_needs_web(answer_md: str) -> bool:
    if not answer_md or not answer_md.strip():
        return False
    return bool(_UNCERTAIN_RE.search(answer_md))

def looks_like_deflection_or_nonanswer(answer_md: str) -> bool:
    if not answer_md or not answer_md.strip():
        return True
    text = answer_md.strip()
    if len(text) < 120:
        return True
    return bool(_DEFLECTION_RE.search(text))

def is_fact_seeking_question(message: str) -> bool:
    msg = (message or "").strip()
    if not msg:
        return False
    # Avoid escalating purely general how-to/advice prompts.
    if is_general_advice_question(msg) and not _FACTUAL_WEB_INTENT_RE.search(msg):
        return False
    return bool(_FACT_SEEKING_RE.search(msg) or _FACTUAL_WEB_INTENT_RE.search(msg))

_FACTUAL_WEB_INTENT_RE = re.compile(
    r"\b(as of|current|latest|updated|recent|today|news)\b|"
    r"\b(price|cost|salary|net\s*worth|market\s*cap|population|gdp|revenue|statistics|statistic|percent|%|how many|how much|number of)\b|"
    r"\b(is it true|true that|evidence|proof|study|research|paper)\b|"
    r"\b(released|release date|premiere|premiered|announced|launch|deadline|schedule)\b|"
    r"\b(20\d{2})\b",
    re.I,
)

_GENERAL_ADVICE_RE = re.compile(
    r"\b(how do i|how to|tips|advice|learn|improve|practice|study|start|begin|roadmap|plan)\b",
    re.I,
)

_LEARNING_REQUEST_RE = re.compile(
    r"\b(teach me|step\s*-?by\s*-?step|walk me through|tutorial|guide|documentation|docs|resources|course|learn)\b",
    re.I,
)

def _has_web_providers() -> bool:
    return bool((GOOGLE_API_KEY and GOOGLE_CSE_ID) or TAVILY_API_KEY)

def is_general_advice_question(message: str) -> bool:
    msg = (message or "").strip()
    if not msg:
        return False
    return bool(_GENERAL_ADVICE_RE.search(msg))

def wants_learning_resources(message: str) -> bool:
    msg = (message or "").strip()
    if not msg:
        return False
    return bool(_LEARNING_REQUEST_RE.search(msg))

def infer_need_web_sources(
    message: str,
    answer_md: str,
    user_flags: Dict[str, bool],
    model_need_web: bool,
    elapsed_sec: Optional[float] = None,
) -> Tuple[bool, str]:
    """Decide whether to fetch web sources.

    Returns: (need_web, reason)
    """
    if not _has_web_providers():
        return False, "no_providers"

    if is_smalltalk_or_identity(message):
        return False, "smalltalk_or_identity"

    if user_flags.get("want_web"):
        return True, "explicit_web_intent"

    # Soft time-budget guard: avoid web escalation when we're already close to the total budget.
    # (Still allow explicit requests via want_web above.)
    if elapsed_sec is not None:
        remaining = _TOTAL_BUDGET_SEC - float(elapsed_sec)
        if remaining < 2.0:
            return False, "budget_exhausted"

    # Option C: for learning prompts, fetch sources proactively.
    if wants_learning_resources(message):
        return True, "learning_resources"

    if model_need_web:
        return True, "model_suggested"

    if looks_like_needs_web(answer_md):
        return True, "model_uncertain"

    # If the draft answer is likely a deflection/non-answer AND the user asked a fact-seeking question,
    # escalate to web even if the model didn't explicitly say it needs web.
    if looks_like_deflection_or_nonanswer(answer_md) and is_fact_seeking_question(message):
        return True, "draft_nonanswer_fact_seeking"

    msg = (message or "").strip()
    if msg and is_fact_seeking_question(msg) and not is_general_advice_question(msg):
        return True, "factual_or_time_sensitive"

    return False, "not_needed"

def make_fallback_query(message: str, max_len: int = 120) -> str:
    if not message:
        return ""
    q = message.strip()
    q = re.sub(
        r"\b(show me|give me|find|search|look for|video|videos|youtube|yt|image|images|picture|pictures|photo|photos)\b",
        "",
        q,
        flags=re.I,
    )
    q = re.sub(r"\s+", " ", q).strip()
    return (q[:max_len] if q else message[:max_len])

def enforce_web_query_constraints(user_message: str, web_q: str) -> str:
    
    msg = (user_message or "").strip()
    q = (web_q or "").strip()

    years = extract_years(msg)
   

    # If model gave nothing, use user message
    if not q:
        q = msg[:120]

    # If user specified year(s), enforce year presence
    if years:
        if not any(y in q for y in years):
            q = f"{q} {years[0]}"

     
    q = re.sub(r"\s+", " ", q).strip()
    return q[:120]

def apply_tool_budget(
    user_flags: Dict[str, bool],
    need_web: bool,
    need_img: bool,
    need_yt: bool,
) -> Tuple[bool, bool, bool]:
    # Media only when user explicitly asked OR forced by env
    if not (user_flags.get("want_images") or user_flags.get("auto_images") or FORCE_IMAGES):
        need_img = False
    if not (user_flags.get("want_youtube") or user_flags.get("auto_youtube") or FORCE_YOUTUBE):
        need_yt = False

    # Web is handled by "hard gate" policy in caller
    return need_web, need_img, need_yt

def normalize_markdown_spacing(text: str) -> str:
    if not text:
        return ""
    # Collapse ALL multiple blank lines into ONE
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    # Remove blank line between title + description (title line followed by blank, then capitalized desc)
    text = re.sub(r"([^\n])\n\n([A-Z])", r"\1\n\2", text)
    return text.strip()

    

# -----------------------
# PLACEHOLDER: Moderation
# -----------------------
async def moderation_check(text: str) -> Dict[str, Any]:
    return {"allowed": True, "label": "ok", "score": 0.0, "reason": ""}

# -----------------------
# PLACEHOLDER: Internal RAG
# -----------------------
async def rag_retrieve(query: str, k: int = 4) -> List[Dict[str, str]]:
    return []

def build_rag_block(chunks: List[Dict[str, str]]) -> str:
    if not chunks:
        return ""
    lines = ["[RAG_CONTEXT] Use this context if relevant (do not mention this label):"]
    for i, ch in enumerate(chunks[:6], start=1):
        title = ch.get("title") or f"Chunk {i}"
        src = ch.get("source") or ""
        content = (ch.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"- ({i}) {title} {f'[{src}]' if src else ''}\n  {content}")
    return "\n".join(lines).strip()

# -----------------------
# Internet RAG extraction (Tavily)
# -----------------------
async def internet_rag_search_and_extract(
    query: str, max_sources: int = 6
) -> Tuple[List[SourceItem], List[Dict[str, str]]]:
    if not TAVILY_API_KEY or not query.strip():
        return [], []
    url = "https://api.tavily.com/search"
    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "max_results": max(1, min(max_sources, 10)),
        "include_answer": False,
        "include_raw_content": False,
        "search_depth": "advanced",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code >= 400:
            print("TAVILY ERROR:", resp.status_code, resp.text[:300], flush=True)
            return [], []
        data = resp.json() or {}
    except Exception as e:
        print(f"TAVILY EXCEPTION: {e}", flush=True)
        return [], []

    results = data.get("results") or []
    sources: List[SourceItem] = []
    evidence_chunks: List[Dict[str, str]] = []

    for idx, it in enumerate(results[:max_sources], start=1):
        title = (it.get("title") or "Source").strip()
        link = (it.get("url") or "").strip()
        snippet = (it.get("content") or "").strip()
        if not link:
            continue

        sources.append(SourceItem(title=title, url=link, snippet=snippet or None))
        if snippet:
            evidence_chunks.append({"source_index": idx, "content": snippet[:800]})

    return sources, evidence_chunks

def build_web_evidence_block(sources: List[SourceItem], evidence_chunks: List[Dict[str, str]]) -> str:
    if not sources:
        return ""
    lines = ["[SOURCES]"]
    for i, s in enumerate(sources[:6], start=1):
        lines.append(f"[{i}] Title: {s.title}\n    URL: {s.url}")
    if evidence_chunks:
        lines.append("\n[EVIDENCE EXCERPTS]")
        for j, ch in enumerate(evidence_chunks[:4], start=1):
            si = ch.get("source_index") or ""
            content = (ch.get("content") or "").strip()
            if not si or not content:
                continue
            suffix = chr(ord("a") + (j - 1) % 26)
            lines.append(f"[{si}{suffix}] {content[:350]}")
    block = "\n".join(lines).strip()
    if len(block) > MAX_EVIDENCE_CHARS:
        block = block[:MAX_EVIDENCE_CHARS] + "..."
    return block

# -----------------------
# Google web sources (CSE)
# -----------------------
async def google_web_search(query: str, num: int = 6) -> List[SourceItem]:
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID and query.strip()):
        return []
    url = "https://www.googleapis.com/customsearch/v1"
    params = {"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID, "q": query, "num": min(num, 10)}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        if r.status_code >= 400:
            print("WEB SEARCH ERROR:", r.status_code, r.text[:300], flush=True)
            return []
        data = r.json()

    out: List[SourceItem] = []
    for it in (data.get("items") or []):
        link = it.get("link") or ""
        if not link:
            continue
        out.append(SourceItem(
            title=it.get("title") or "Source",
            url=link,
            snippet=it.get("snippet"),
        ))
    return out

# -----------------------
# Google image search (CSE image)
# -----------------------
async def google_image_search(query: str, num: int = 4) -> List[Dict[str, str]]:
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID and query.strip()):
        return []
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": GOOGLE_API_KEY,
        "cx": GOOGLE_CSE_ID,
        "q": query,
        "searchType": "image",
        "num": min(num, 10),
        "safe": "active",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        if r.status_code >= 400:
            print("IMAGE SEARCH ERROR:", r.status_code, r.text[:300], flush=True)
            return []
        data = r.json()

    results: List[Dict[str, str]] = []
    for it in (data.get("items") or []):
        results.append({
            "image_url": it.get("link") or "",
            "page_url": (it.get("image", {}) or {}).get("contextLink") or "",
            "title": it.get("title") or "",
        })
    return [x for x in results if x.get("image_url")]

# -----------------------
# Supabase storage upload for images
# -----------------------
async def supabase_upload_image_from_url(image_url: str, filename_hint: str) -> Optional[ImageItem]:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and image_url):
        return None

    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        img_resp = await client.get(image_url)
        if img_resp.status_code >= 400:
            return None
        content_type = img_resp.headers.get("content-type", "image/jpeg")
        img_bytes = img_resp.content

    ext = "jpg"
    if "png" in content_type:
        ext = "png"
    elif "webp" in content_type:
        ext = "webp"

    storage_path = f"{int(time.time())}_{re.sub(r'[^a-zA-Z0-9_-]+','_', filename_hint)[:40]}.{ext}"
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{storage_path}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }

    async with httpx.AsyncClient(timeout=25) as client:
        up = await client.post(upload_url, headers=headers, content=img_bytes)
        if up.status_code >= 400:
            print("SUPABASE UPLOAD ERROR:", up.status_code, up.text[:300], flush=True)
            return None

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_STORAGE_BUCKET}/{storage_path}"
    return ImageItem(url=public_url, storage_path=storage_path, source_url=image_url)

# -----------------------
# YouTube search
# -----------------------
async def youtube_search(query: str, num: int = 2) -> List[YouTubeItem]:
    if not (YOUTUBE_API_KEY and query.strip()):
        return []
    url = "https://www.googleapis.com/youtube/v3/search"

    # Enforce a strict upper bound regardless of caller to avoid returning huge lists.
    max_results = max(1, min(int(num), _YOUTUBE_MAX_RESULTS, 50))
    params = {
        "key": YOUTUBE_API_KEY,
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": max_results,
        "safeSearch": "strict",
        "order": "relevance",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        if r.status_code >= 400:
            print("YOUTUBE SEARCH ERROR:", r.status_code, r.text[:300], flush=True)
            return []
        data = r.json()

    out: List[YouTubeItem] = []
    for it in data.get("items", []):
        vid = (it.get("id") or {}).get("videoId")
        snip = it.get("snippet") or {}
        if not vid:
            continue
        out.append(YouTubeItem(
            title=snip.get("title") or "YouTube video",
            video_id=vid,
            url=f"https://www.youtube.com/watch?v={vid}",
            channel=snip.get("channelTitle"),
            thumbnail_url=((snip.get("thumbnails") or {}).get("medium") or {}).get("url"),
        ))

    # Final guard (belt-and-suspenders) to ensure we never exceed max_results.
    return out[:max_results]

# -----------------------
# Helpers: extract JSON from model
# -----------------------
def extract_json(text: str) -> Dict[str, Any]:
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass
    # Try to find the first balanced JSON object in the text
    s = str(text)
    n = len(s)
    for i in range(n):
        if s[i] == '{':
            depth = 0
            for j in range(i, n):
                if s[j] == '{':
                    depth += 1
                elif s[j] == '}':
                    depth -= 1
                    if depth == 0:
                        candidate = s[i:j+1]
                        try:
                            return json.loads(candidate)
                        except Exception:
                            break
    return {}

def safe_wrap_json(raw_text: str) -> Dict[str, Any]:
    rt = (raw_text or "").strip()
    rt = cleanup_model_text(rt)
    return {
        "answer_markdown": rt,
        "need_web_sources": False,
        "need_images": False,
        "need_youtube": False,
        "web_query": "",
        "image_query": "",
        "youtube_query": "",
    }

def cleanup_model_text(text: str) -> str:
    if not text:
        return ""
    out = text
    # Remove any embedded schema/YAML-like lines the model may echo
    schema_keys = [
        r"^\s*answer_markdown\s*:\s*.*$",
        r"^\s*need_web_sources\s*:\s*.*$",
        r"^\s*need_images\s*:\s*.*$",
        r"^\s*need_youtube\s*:\s*.*$",
        r"^\s*web_query\s*:\s*.*$",
        r"^\s*image_query\s*:\s*.*$",
        r"^\s*youtube_query\s*:\s*.*$",
    ]
    for pat in schema_keys:
        out = re.sub(pat, "", out, flags=re.MULTILINE)
    # Remove inline citation tokens like [[cite:1]] (sources will be shown separately)
    out = re.sub(r"\[\[\s*cite\s*:\s*\d+\s*\]\]", "", out, flags=re.IGNORECASE)
    # Strip leaked special tokens (e.g., <|eot_id|>, <|start_header_id|>)
    out = re.sub(r"<\|.*?\|>", "", out)
    # Remove [USER] and [ASSISTANT] tags (model echoes)
    out = re.sub(r"^\s*\[(USER|ASSISTANT)\]\s*", "", out, flags=re.MULTILINE)
    # Remove trailing [SOURCES] section entirely (frontend shows clickable sources separately)
    m = re.search(r"\n\[SOURCES\]", out, flags=re.IGNORECASE)
    if m:
        out = out[: m.start()]  # drop everything from [SOURCES] downward
    # Normalize excessive blank lines
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out

def strip_meta_prompts(text: str) -> str:
    if not text:
        return ""

    patterns = [
        r"^💡?\s*Need web sources\??.*$",
        r"^\s*yes\s*$",
        r"^\s*no\s*$",
        r"^Sure!?\s*Here are some web sources.*$",
        r"^Here are some web sources.*$",
    ]

    out = text
    for p in patterns:
        out = re.sub(p, "", out, flags=re.IGNORECASE | re.MULTILINE)

    return re.sub(r"\n{3,}", "\n\n", out).strip()

def build_prompt(
    message: str,
    history: List[HistoryItem],
    rag_block: str = "",
    web_evidence_block: str = "",
    article_block: str = "",
    chat_mode: bool = False,
) -> str:
    def _truncate(text: str, limit: int) -> str:
        if not text:
            return ""
        if len(text) <= limit:
            return text
        return text[:limit] + "..."

    safe_message = _truncate(message, MAX_MESSAGE_CHARS)
    safe_article = _truncate(article_block, MAX_ARTICLE_CHARS)
    safe_rag = _truncate(rag_block, MAX_RAG_CHARS)
    safe_evidence = _truncate(web_evidence_block, MAX_EVIDENCE_CHARS)

    # LLaMA-3.3 Instruct chat headers
    if chat_mode:
        p = (
            "<|begin_of_text|>"
            "<|start_header_id|>system<|end_header_id|>\n"
            "You are AskVox, a friendly, knowledgeable AI assistant. "
            "Provide clear, detailed, and helpful responses with examples when useful.\n"
            "<|eot_id|>"
        )

        # Include recent history so the model gets conversational context.
        filtered_history = []
        seen = set()
        for h in history:
            if not h.content or not h.content.strip():
                continue
            # If the caller already included the current user message in history,
            # avoid duplicating it (we append safe_message at the end).
            if h.role == "user" and h.content.strip() == safe_message.strip():
                continue
            key = (h.role, h.content.strip())
            if key in seen:
                continue
            seen.add(key)
            filtered_history.append(h)
        filtered_history = filtered_history[-4:]

        print(
            "🧠 CHAT_MODE prompt context:",
            {"history_items_included": len(filtered_history)},
            flush=True,
        )

        remaining_history_chars = MAX_HISTORY_CHARS
        for h in filtered_history:
            role = "user" if h.role == "user" else "assistant"
            if remaining_history_chars <= 0:
                break
            content = _truncate(h.content, 260)
            if len(content) > remaining_history_chars:
                content = _truncate(content, max(0, remaining_history_chars))
            remaining_history_chars -= len(content)
            p += (
                f"<|start_header_id|>{role}<|end_header_id|>\n"
                f"{content}<|eot_id|>"
            )

        p += (
            "<|start_header_id|>user<|end_header_id|>\n"
            f"{safe_message}<|eot_id|>"
            "<|start_header_id|>assistant<|end_header_id|>\n"
        )
        if len(p) > MAX_PROMPT_CHARS:
            p = p[:MAX_PROMPT_CHARS] + "..."
        print("🧠 CHAT_MODE prompt length:", len(p), flush=True)
        print("\n==== PROMPT SENT TO MODEL ====".ljust(40, "="), flush=True)
        print(p[:1200] + ("..." if len(p) > 1200 else ""), flush=True)
        print("="*40, flush=True)
        return p

    # Structured mode with JSON instruction and optional context blocks
    p = (
        "<|begin_of_text|>"
        "<|start_header_id|>system<|end_header_id|>\n"
    )
    p += MODEL_JSON_INSTRUCTION
    if safe_article:
        p += "\nUse the provided ARTICLE_CONTEXT as the primary source for the user's question.\n"
        p += f"\n{safe_article}\n"
    if safe_rag:
        p += f"\n{safe_rag}\n"
    if safe_evidence:
        p += f"\n{safe_evidence}\n"
    p += "<|eot_id|>"

    # Filter out empty or duplicate history entries (keep last 2 exchanges)
    filtered_history = []
    seen = set()
    for h in history:
        if not h.content or not h.content.strip():
            continue
        # If the caller already included the current user message in history,
        # avoid duplicating it (we append safe_message at the end).
        if h.role == "user" and h.content.strip() == safe_message.strip():
            continue
        key = (h.role, h.content.strip())
        if key in seen:
            continue
        seen.add(key)
        filtered_history.append(h)
    filtered_history = filtered_history[-4:]

    remaining_history_chars = MAX_HISTORY_CHARS
    for h in filtered_history:
        role = "user" if h.role == "user" else "assistant"
        if remaining_history_chars <= 0:
            break
        content = _truncate(h.content, 260)
        if len(content) > remaining_history_chars:
            content = _truncate(content, max(0, remaining_history_chars))
        remaining_history_chars -= len(content)
        p += (
            f"<|start_header_id|>{role}<|end_header_id|>\n"
            f"{content}<|eot_id|>"
        )

    p += (
        "<|start_header_id|>user<|end_header_id|>\n"
        f"{safe_message}<|eot_id|>"
        "<|start_header_id|>assistant<|end_header_id|>\n"
    )

    if len(p) > MAX_PROMPT_CHARS:
        p = p[:MAX_PROMPT_CHARS] + "..."

    # Debug print for prompt sent to model
    print("\n==== PROMPT SENT TO MODEL ====".ljust(40, "="), flush=True)
    print(p[:1200] + ("..." if len(p) > 1200 else ""), flush=True)
    print("="*40, flush=True)

    return p

async def call_cloudrun(prompt: str, timeout: httpx.Timeout) -> str:
    payload = {"message": prompt}

    # Debug: show Cloud Run target and measure request time
    try:
        await _log_cloudrun_meta_once()
    except Exception:
        pass
    print("☁️ Sending request to Cloud Run:", LLAMA_CLOUDRUN_URL, flush=True)
    t0 = time.perf_counter()

    async def _post(client: httpx.AsyncClient) -> httpx.Response:
        return await client.post(LLAMA_CLOUDRUN_URL, json=payload)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await _post(client)
            t1 = time.perf_counter()
            print(f"⏱️ CloudRun generation time: {t1 - t0:.2f}s", flush=True)
    except httpx.ReadTimeout as e:
        req_url = getattr(getattr(e, "request", None), "url", None)
        print(
            "CLOUD RUN READ TIMEOUT: retrying once",
            {"url": str(req_url) if req_url else None, "error": str(e) or repr(e)},
            flush=True,
        )
        retry_timeout = httpx.Timeout(
            connect=timeout.connect,
            read=max(timeout.read or 0, 600.0),
            write=timeout.write,
            pool=timeout.pool,
        )
        try:
            async with httpx.AsyncClient(timeout=retry_timeout) as retry_client:
                t_retry0 = time.perf_counter()
                resp = await _post(retry_client)
                t_retry1 = time.perf_counter()
                print(f"⏱️ CloudRun retry generation time: {t_retry1 - t_retry0:.2f}s", flush=True)
        except httpx.RequestError as e2:
            req_url = getattr(getattr(e2, "request", None), "url", None)
            err_type = type(e2).__name__
            err_text = str(e2) or repr(e2)
            print(
                "CLOUD RUN REQUEST ERROR:",
                {"type": err_type, "url": str(req_url) if req_url else None, "error": err_text},
                flush=True,
            )
            raise HTTPException(
                status_code=502,
                detail=f"Cloud Run request failed ({err_type}): {err_text}",
            )
    except httpx.RequestError as e:
        req_url = getattr(getattr(e, "request", None), "url", None)
        err_type = type(e).__name__
        err_text = str(e) or repr(e)
        print(
            "CLOUD RUN REQUEST ERROR:",
            {"type": err_type, "url": str(req_url) if req_url else None, "error": err_text},
            flush=True,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Cloud Run request failed ({err_type}): {err_text}",
        )

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Cloud Run returned {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Invalid JSON from Cloud Run")

    raw = data.get("response") or data.get("answer") or data.get("reply") or ""
    if not raw:
        raise HTTPException(status_code=502, detail="Cloud Run response missing answer field")
    return raw

async def call_runpod_job_prompt(prompt: str) -> str:
    """
    Submit a job to RunPod `/run` and poll `/status/{id}` until COMPLETED.
    Expects `RUNPOD_API_KEY` and `RUNPOD_RUN_ENDPOINT` in env.
    """
    if not RUNPOD_RUN_ENDPOINT:
        raise HTTPException(status_code=500, detail="RUNPOD_RUN_ENDPOINT not configured")
    if not RUNPOD_API_KEY:
        raise HTTPException(status_code=500, detail="RUNPOD_API_KEY missing")

    headers = {RUNPOD_AUTH_HEADER or "Authorization": f"Bearer {RUNPOD_API_KEY}"}
    payload = {"input": {"prompt": prompt, "stop": ["<|eot_id|>"]}}

    try:
        print(f"🚀 Submitting RunPod job: {RUNPOD_RUN_ENDPOINT}", flush=True)
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)) as client:
            run_resp = await client.post(RUNPOD_RUN_ENDPOINT, json=payload, headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"RunPod run request failed: {e}")

    if run_resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"RunPod /run returned {run_resp.status_code}: {run_resp.text[:200]}")

    try:
        run_data = run_resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Invalid JSON from RunPod /run")

    job_id = run_data.get("id") or run_data.get("jobId") or run_data.get("job_id")
    if not job_id:
        # Some pods may return output immediately
        immediate_output = (run_data.get("output") or {}).get("response") or run_data.get("response")
        if immediate_output:
            return str(immediate_output)
        raise HTTPException(status_code=502, detail="RunPod /run response missing job id")

    # Derive status base URL
    status_base = RUNPOD_STATUS_ENDPOINT.strip() if RUNPOD_STATUS_ENDPOINT else ""
    if not status_base:
        if RUNPOD_RUN_ENDPOINT.endswith("/run"):
            status_base = RUNPOD_RUN_ENDPOINT[: -len("/run")] + "/status"
        else:
            status_base = RUNPOD_RUN_ENDPOINT.rstrip("/") + "/status"

    t0 = time.perf_counter()
    last_status = ""
    while (time.perf_counter() - t0) < RUNPOD_MAX_WAIT_SEC:
        url = f"{status_base}/{job_id}"
        if not last_status:
            print(f"⏳ Polling RunPod status: {url}", flush=True)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)) as client:
                st_resp = await client.get(url, headers=headers)
        except httpx.RequestError as e:
            last_status = f"request_error: {e}"
            await asyncio.sleep(RUNPOD_POLL_INTERVAL_SEC)
            continue

        if st_resp.status_code >= 400:
            last_status = f"http_{st_resp.status_code}"
            await asyncio.sleep(RUNPOD_POLL_INTERVAL_SEC)
            continue

        try:
            st_data = st_resp.json()
        except Exception:
            last_status = "bad_json"
            await asyncio.sleep(RUNPOD_POLL_INTERVAL_SEC)
            continue

        status = (st_data.get("status") or st_data.get("state") or "").upper()
        last_status = status or last_status
        if status:
            print(f"🔄 RunPod status: {status}", flush=True)
        if status == "COMPLETED":
            out = st_data.get("output") or {}
            if isinstance(out, dict):
                ans = out.get("response") or out.get("answer") or out.get("reply")
                if ans:
                    return str(ans)
            # Handle alternative shapes
            if isinstance(out, str) and out:
                return out
            # Fallback: try top-level fields
            ans2 = st_data.get("response") or st_data.get("answer") or st_data.get("reply")
            if ans2:
                return str(ans2)
            raise HTTPException(status_code=502, detail="RunPod status completed but no output.response")
        if status in {"FAILED", "ERROR", "CANCELLED"}:
            print(f"❌ RunPod job: {status}", flush=True)
            raise HTTPException(status_code=502, detail=f"RunPod job {status}")

        await asyncio.sleep(RUNPOD_POLL_INTERVAL_SEC)

    print(f"⏰ RunPod job timed out (last_status={last_status})", flush=True)
    raise HTTPException(status_code=504, detail=f"RunPod job timed out (last_status={last_status})")

async def fetch_session_article_context(session_id: str) -> Dict[str, Any]:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and session_id):
        return {}
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{SUPABASE_URL}/rest/v1/chat_sessions?id=eq.{session_id}&select=article_context&limit=1"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {}
            data = resp.json()
        except Exception:
            return {}
    if not data:
        return {}
    row = data[0] if isinstance(data[0], dict) else {}
    article_context = row.get("article_context") if isinstance(row, dict) else None
    return article_context if isinstance(article_context, dict) else {}

def build_article_block_from_cached(article_ctx: Dict[str, Any]) -> str:
    cached = (article_ctx or {}).get("cached_content")
    cached_at = (article_ctx or {}).get("cached_at")
    title = (article_ctx or {}).get("title")
    url = (article_ctx or {}).get("url")

    if not cached or not isinstance(cached, str):
        return ""
    if len(cached.strip()) < 200:
        return ""

    if cached_at:
        try:
            dt = datetime.fromisoformat(str(cached_at).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600
            if age_hours > 24:
                return ""
        except Exception:
            return ""

    text = re.sub(r"\n{3,}", "\n\n", cached).strip()
    if len(text) > MAX_ARTICLE_CHARS:
        text = text[:MAX_ARTICLE_CHARS] + "..."

    header = "[ARTICLE_CONTEXT]\n"
    if title:
        header += f"Title: {title}\n"
    if url:
        header += f"URL: {url}\n"
    return f"{header}\n{text}\n"

async def fetch_article_context(url: str, title: str = "") -> Tuple[str, str]:
    if not url:
        return "", ""
    jina_url = f"https://r.jina.ai/http://{url}" if not url.startswith("http") else f"https://r.jina.ai/{url}"
    timeout = httpx.Timeout(connect=8.0, read=12.0, write=8.0, pool=8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.get(jina_url)
            if resp.status_code >= 400:
                return "", ""
            text = resp.text
        except Exception:
            return "", ""

    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > MAX_ARTICLE_CHARS:
        text = text[:MAX_ARTICLE_CHARS] + "..."
    header = "[ARTICLE_CONTEXT]\n"
    if title:
        header += f"Title: {title}\n"
    header += f"URL: {url}\n"
    return f"{header}\n{text}\n", text

async def update_session_article_cache(
    session_id: Optional[str],
    article_context: Optional[Dict[str, Any]],
    scraped_text: str,
):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and session_id):
        return
    if not article_context or not isinstance(article_context, dict):
        return
    if not scraped_text or len(scraped_text.strip()) < 200:
        return

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    new_ctx = dict(article_context)
    new_ctx["cached_content"] = scraped_text[:1800]
    new_ctx["cached_at"] = datetime.now(timezone.utc).isoformat()

    url = f"{SUPABASE_URL}/rest/v1/chat_sessions?id=eq.{session_id}"
    body = {"article_context": new_ctx}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(url, headers=headers, json=body)
            if resp.status_code >= 400:
                print("CACHE UPDATE ERROR:", resp.status_code, resp.text[:200], flush=True)
    except Exception as e:
        print(f"CACHE UPDATE EXCEPTION: {e}", flush=True)

def repair_json_instruction(user_message: str) -> str:
    return f"""
Return ONLY valid JSON (no extra text, no markdown fences) matching this schema:

{{
  "answer_markdown": "string",
  "need_web_sources": true/false,
  "need_images": true/false,
  "need_youtube": true/false,
  "web_query": "string",
  "image_query": "string",
  "youtube_query": "string"
}}

User message: {user_message}
"""

# -----------------------
# Inline citation token validation
# -----------------------
_CITE_TOKEN_RE = re.compile(r"\[\[cite:(\d+)\]\]")

def validate_and_clean_citations(answer_md: str, sources: List[SourceItem]) -> str:
    max_n = len(sources)

    def repl(match: re.Match) -> str:
        n = int(match.group(1))
        if 1 <= n <= max_n:
            return match.group(0)
        return ""

    out = _CITE_TOKEN_RE.sub(repl, answer_md)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()

# -----------------------
# CLOUD CALL
# -----------------------
async def generate_cloud_structured(
    message: str,
    history: List[HistoryItem],
    article_title: Optional[str] = None,
    article_url: Optional[str] = None,
    article_context: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    max_history: int = 3,
) -> AssistantPayload:
    t_start = time.perf_counter()
    if not (LLAMA_CLOUDRUN_URL or RUNPOD_RUN_ENDPOINT):
        raise HTTPException(status_code=500, detail="No model endpoint configured: set LLAMA_CLOUDRUN_URL or RUNPOD_RUN_ENDPOINT in .env")

    # Moderation placeholder
    mod = await moderation_check(message)
    if not mod.get("allowed", True):
        return AssistantPayload(
            answer_markdown="I can’t help with that request. If you want, rephrase it in a safe, respectful way and I’ll try again.",
            sources=[],
            images=[],
            youtube=[],
        )

    # Article context
    article_block = ""
    cached_block = build_article_block_from_cached(article_context or {}) if article_context else ""
    if cached_block:
        article_block = cached_block
    elif article_url:
        article_block, scraped_text = await fetch_article_context(article_url, article_title or "")
        await update_session_article_cache(
            session_id=session_id,
            article_context=article_context,
            scraped_text=scraped_text,
        )

    # Internal RAG placeholder
    rag_chunks = await rag_retrieve(message, k=4)
    rag_block = build_rag_block(rag_chunks)

    timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)
    trimmed_history = history[-max_history:] if max_history and max_history > 0 else []
    user_flags = keyword_router(message)
    chat_flag = not user_flags.get("want_web", False)


    # ✅ Draft answer first (no tools yet)
    if RUNPOD_RUN_ENDPOINT:
        raw = await call_runpod_job_prompt(
            build_prompt(
                message,
                trimmed_history,
                rag_block=rag_block,
                article_block=article_block,
                chat_mode=chat_flag,
            )
        )
    else:
        raw = await call_cloudrun(
            build_prompt(
                message,
                trimmed_history,
                rag_block=rag_block,
                article_block=article_block,
                chat_mode=chat_flag,
            ),
            timeout=timeout,
        )
    if not chat_flag:
        plan = extract_json(raw)
    else:
        plan = {}


    # ✅ Non-destructive fallback: wrap raw text into JSON without rewriting content
    if not plan or "answer_markdown" not in plan or not (plan.get("answer_markdown") or "").strip():
        plan = safe_wrap_json(raw)

    answer_md = (plan.get("answer_markdown") or "").strip()
    # Immediate fallback: if model didn't return JSON, show raw text
    if not answer_md and raw:
        answer_md = raw.strip()

    # Ensure plan has required keys so downstream logic stays consistent
    if not plan:
        plan = {}
    if "need_web_sources" not in plan:
        plan["need_web_sources"] = False
    if "need_images" not in plan:
        plan["need_images"] = False
    if "need_youtube" not in plan:
        plan["need_youtube"] = False
    plan["web_query"] = (plan.get("web_query") or "").strip()
    plan["image_query"] = (plan.get("image_query") or "").strip()
    plan["youtube_query"] = (plan.get("youtube_query") or "").strip()
    plan["answer_markdown"] = answer_md

    # Model suggestions (soft)
    model_need_web = bool(plan.get("need_web_sources"))
    need_img = bool(plan.get("need_images"))
    need_yt = bool(plan.get("need_youtube"))
    web_q = (plan.get("web_query") or "").strip()
    img_q = (plan.get("image_query") or "").strip()
    yt_q = (plan.get("youtube_query") or "").strip()

    # ✅ Deterministic keyword routing (still used for images/youtube decisions)
    user_flags = keyword_router(message)

    # Option C: for learning prompts, auto-enable web + YouTube.
    auto_learning_media = wants_learning_resources(message)
    if auto_learning_media:
        user_flags["auto_youtube"] = True
        user_flags["auto_images"] = False
        need_yt = True

    # ✅ Smart web decision: explicit intent OR factual/time-sensitive OR model uncertainty
    need_web, need_web_reason = infer_need_web_sources(
        message=message,
        answer_md=answer_md,
        user_flags=user_flags,
        model_need_web=model_need_web,
        elapsed_sec=(time.perf_counter() - t_start),
    )

    # Fetch web sources only when the smart decision says we need them
    sources: List[SourceItem] = []
    evidence_chunks: List[Dict[str, str]] = []
    if not need_web:
        plan["need_web_sources"] = False
        print(
            "🔕 Skipping web sources",
            {"reason": need_web_reason, "message": message[:80]},
            flush=True,
        )

        # If we're skipping only because we're near budget, still fetch a small set of sources quickly
        # (no second-pass generation) so the UI can show helpful links.
        if need_web_reason == "budget_exhausted" and _has_web_providers():
            web_q = enforce_web_query_constraints(message, web_q or message)
            g_task = asyncio.create_task(fast_google_web_search(web_q, num=7, timeout_sec=2.5))
            t_task = asyncio.create_task(fast_tavily(web_q, max_sources=6, timeout_sec=3.0))
            g_res, (tav_sources, tav_chunks) = await asyncio.gather(g_task, t_task)
            sources = g_res or []
            evidence_chunks = tav_chunks or []
            if tav_sources:
                seen = {s.url.lower(): s for s in sources if s.url}
                for s in tav_sources:
                    key = (s.url or "").lower()
                    if key and key not in seen:
                        sources.append(s)
                        seen[key] = s
            if sources:
                print(
                    "🔎 Budget-limited sources fetched (no second pass)",
                    {"count": len(sources), "web_q": web_q},
                    flush=True,
                )
    else:
        web_q = enforce_web_query_constraints(message, web_q or message)
        g_task = asyncio.create_task(google_web_search(web_q, num=7))
        t_task = asyncio.create_task(internet_rag_search_and_extract(web_q, max_sources=6))
        g_res, (tav_sources, tav_chunks) = await asyncio.gather(g_task, t_task)
        sources = g_res or []
        evidence_chunks = tav_chunks
        if tav_sources:
            seen = {s.url.lower(): s for s in sources if s.url}
            for s in tav_sources:
                key = (s.url or "").lower()
                if key and key not in seen:
                    sources.append(s)
                    seen[key] = s

        if not sources:
            need_web = False
            plan["need_web_sources"] = False
            print(
                "🔕 Web requested but no sources available",
                {"reason": need_web_reason, "web_q": web_q},
                flush=True,
            )
    if FORCE_IMAGES:
        need_img = True
    if FORCE_YOUTUBE:
        need_yt = True

    # Explicit user request overrides model
    if user_flags.get("want_images"):
        need_img = True
    if user_flags.get("want_youtube"):
        need_yt = True

    # web_q already enforced; prepare sensible fallback if empty
    if not web_q:
        web_q = make_fallback_query(article_title or message, max_len=120)

    if need_img and not img_q:
        img_q = make_fallback_query(message, max_len=120)
    if need_yt and not yt_q:
        yt_q = make_fallback_query(message, max_len=120)

    print(
        "ROUTED FLAGS:",
        {
            "need_web": need_web,
            "need_web_reason": need_web_reason,
            "web_q": web_q,
            "need_img": need_img,
            "img_q": img_q,
            "need_yt": need_yt,
            "yt_q": yt_q,
            "answer_len": len(answer_md),
            "user_flags": user_flags,
        },
        flush=True,
    )

    # Keep previously fetched sources; initialize media containers
    images: List[ImageItem] = []
    youtube: List[YouTubeItem] = []

    # 3) Web evidence + second pass answer (only if need_web)
    if need_web and web_q:
        web_evidence_block = build_web_evidence_block(sources, evidence_chunks)

        # ✅ second pass should fail-soft (no 502)
        raw2 = ""
        try:
            if RUNPOD_RUN_ENDPOINT:
                raw2 = await call_runpod_job_prompt(
                    build_prompt(
                        message,
                        trimmed_history,
                        rag_block=rag_block,
                        web_evidence_block=web_evidence_block,
                        article_block=article_block,
                        chat_mode=False,
                    )
                )
            else:
                raw2 = await call_cloudrun(
                    build_prompt(
                        message,
                        trimmed_history,
                        rag_block=rag_block,
                        web_evidence_block=web_evidence_block,
                        article_block=article_block,
                        chat_mode=False,
                    ),
                    timeout=timeout,
                )
        except HTTPException as e:
            print("SECOND PASS GENERATION FAILED:", e.detail, flush=True)

        plan2 = extract_json(raw2) if raw2 else {}

        # ✅ Non-destructive fallback for second pass
        if raw2 and (not plan2 or "answer_markdown" not in plan2 or not (plan2.get("answer_markdown") or "").strip()):
            plan2 = safe_wrap_json(raw2)

        if plan2 and (plan2.get("answer_markdown") or "").strip():
            answer_md = (plan2.get("answer_markdown") or "").strip()

        # Soft updates from plan2
        if plan2:
            need_img = bool(plan2.get("need_images", need_img))
            need_yt = bool(plan2.get("need_youtube", need_yt))
            img_q = (plan2.get("image_query") or img_q).strip()
            yt_q = (plan2.get("youtube_query") or yt_q).strip()
            web_q2 = (plan2.get("web_query") or "").strip()
            if web_q2:
                web_q = enforce_web_query_constraints(message, web_q2)

        # ✅ Re-apply tool budget to stop model from forcing media unexpectedly
        need_web, need_img, need_yt = apply_tool_budget(user_flags, need_web, need_img, need_yt)

        # Fallbacks again
        if need_img and not img_q:
            img_q = make_fallback_query(message, max_len=120)
        if need_yt and not yt_q:
            yt_q = make_fallback_query(message, max_len=120)

    # 4) Images
    if need_img and img_q:
        img_results = await fast_images(img_q, num=4)
        print("IMAGE RESULTS:", len(img_results), flush=True)

        for it in img_results[:4]:
            if not USE_SUPABASE_STORAGE_FOR_IMAGES:
                images.append(ImageItem(
                    url=it.get("image_url") or "",
                    alt=it.get("title") or img_q,
                    source_url=it.get("page_url") or it.get("image_url"),
                ))
                continue

            # Upload concurrently for speed
            async def _upload_one(item: Dict[str, str]) -> Optional[ImageItem]:
                up = await supabase_upload_image_from_url(item.get("image_url", ""), filename_hint=img_q)
                if up:
                    up.alt = item.get("title") or img_q
                    up.source_url = item.get("page_url") or item.get("image_url")
                return up
            upload_tasks = [asyncio.create_task(_upload_one(it)) for it in img_results[:4]]
            uploaded_list = await asyncio.gather(*upload_tasks, return_exceptions=True)
            for up in uploaded_list:
                if isinstance(up, Exception) or not up:
                    continue
                images.append(up)

        images = [im for im in images if im.url]

    # 5) YouTube
    if need_yt and yt_q:
        youtube = await fast_youtube(yt_q, num=_YOUTUBE_DEFAULT_RESULTS)
        if len(youtube) > _YOUTUBE_DEFAULT_RESULTS:
            youtube = youtube[:_YOUTUBE_DEFAULT_RESULTS]
        print(
            "YOUTUBE RESULTS:",
            len(youtube),
            {"requested": _YOUTUBE_DEFAULT_RESULTS, "cap": _YOUTUBE_MAX_RESULTS},
            flush=True,
        )

    # 6) Final fallback if answer_md still empty
    if not answer_md:
        answer_md = (
            "I couldn’t generate the full response just now, but I’ve gathered the requested resources below. "
            "Try asking again or rephrasing and I’ll retry."
        )

    # 7) Remove inline citation tokens; sources are presented separately in payload.sources
    answer_md = cleanup_model_text(answer_md)
    answer_md = strip_meta_prompts(answer_md)
    answer_md = normalize_markdown_spacing(answer_md)

    return AssistantPayload(
        answer_markdown=answer_md,
        sources=sources,
        images=images,
        youtube=youtube,
        source_count=len(sources or []),
        cite_available=bool(sources),
        cite_label=(f"Sources ({len(sources)})" if sources else None),
    )

# -----------------------
# Persist assistant payload into chat_messages.meta (optional)
# -----------------------
async def persist_assistant_message(
    session_id: str,
    user_id: str,
    answer_md: str,
    payload: AssistantPayload,
    model_used: str = "llama2-cloudrag",
):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and session_id):
        return

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    body = {
        "session_id": session_id,
        "user_id": user_id,
        "role": "assistant",
        "content": answer_md,
        "display_name": "AskVox",
        "meta": payload.model_dump(),
    }

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            await client.post(f"{SUPABASE_URL}/rest/v1/chat_messages", headers=headers, json=body)
        except Exception as e:
            print(f"⚠️ Failed to insert assistant chat_message: {e}", flush=True)

# -----------------------
# ENDPOINT
# -----------------------
@router.post("/cloud_plus", response_model=ChatResponse)
async def chat_cloud_plus(req: ChatRequest):
    article_title = req.article_title
    article_url = req.article_url
    article_context = None

    if req.session_id:
        article_context = await fetch_session_article_context(req.session_id)
        article_title = article_title or (article_context or {}).get("title")
        article_url = article_url or (article_context or {}).get("url")

    payload = await generate_cloud_structured(
        req.message,
        req.history,
        article_title=article_title,
        article_url=article_url,
        article_context=article_context,
        session_id=req.session_id,
        max_history=4 if req.user_id else 2,
    )

    # Persist response to Supabase 'responses' table if query_id provided
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and req.query_id:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp_body = {
                    "query_id": req.query_id,
                    "response_text": payload.answer_markdown,
                    "model_used": "llama2-cloudrag",
                }
                r = await client.post(
                    f"{SUPABASE_URL}/rest/v1/responses",
                    headers=headers,
                    json=resp_body,
                )
                if r.status_code >= 400:
                    alt_body = {
                        "query_id": req.query_id,
                        "content": payload.answer_markdown,
                        "model_used": "llama2-cloudrag",
                    }
                    r2 = await client.post(
                        f"{SUPABASE_URL}/rest/v1/responses",
                        headers=headers,
                        json=alt_body,
                    )
                    if r2.status_code >= 400:
                        print(
                            "⚠️ Failed to insert response into Supabase:",
                            r.status_code,
                            r.text[:300],
                            "| alt",
                            r2.status_code,
                            r2.text[:300],
                            flush=True,
                        )
                    else:
                        print("✅ Inserted response (alt schema)", flush=True)
                else:
                    print("✅ Inserted response", flush=True)
        except Exception as e:
            print(f"⚠️ Failed to insert response into Supabase: {e}", flush=True)

    if req.session_id and req.user_id:
        await persist_assistant_message(
            session_id=req.session_id,
            user_id=req.user_id,
            answer_md=payload.answer_markdown,
            payload=payload,
            model_used="llama2-cloudrag",
        )

    return ChatResponse(answer=payload.answer_markdown, payload=payload)
