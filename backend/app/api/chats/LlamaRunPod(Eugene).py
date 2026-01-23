from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import re
from typing import List, Literal, Optional, Dict, Any, Tuple
import os
import json
import time
import httpx
import hashlib
import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/llamachats-multi", tags=["llamachat-plus"])

# -----------------------
# ENV
# -----------------------
LLAMA_RUNPOD_URL = os.getenv("LLAMA_RUNPOD_URL", "")
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "your-api-key")
RUNPOD_INPUT_KEY = os.getenv("RUNPOD_INPUT_KEY", "message")


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

# -----------------------
# PROMPT SIZE GUARDS
# -----------------------
MAX_PROMPT_CHARS = 3500
MAX_ARTICLE_CHARS = 1200
MAX_RAG_CHARS = 600
MAX_EVIDENCE_CHARS = 1400
MAX_HISTORY_CHARS = 500
MAX_MESSAGE_CHARS = 800

# -----------------------
# PROMPTS
# -----------------------
FORMAT_INSTRUCTION = (
    "Always format your answer clearly.\n"
    "- Start with at most 1 short sentence introduction.\n"
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

MODEL_JSON_INSTRUCTION = f"""
You MUST respond in STRICT JSON with this schema (no markdown fences, no extra text before/after):

{{
  "answer_markdown": "string",
  "need_web_sources": true/false,
  "need_images": true/false,
  "need_youtube": true/false,

  "web_query": "string (short query if need_web_sources)",
  "image_query": "string (short query if need_images)",
  "youtube_query": "string (short query if need_youtube)"
}}

Rules:
- answer_markdown is the final answer the user sees. It should be a full, informative response.
- Apply these formatting rules:
{FORMAT_INSTRUCTION}

{CITATION_TOKEN_RULES}

- If need_web_sources=false then web_query must be "" (same for image/youtube).
- Do not invent citations. Only cite if evidence exists.
- If the user includes a specific year (e.g., 2026), the web_query MUST include that year when relevant.
"""

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

class ChatResponse(BaseModel):
    answer: str
    payload: AssistantPayload

# -----------------------
# Option A: Keyword Router + Option C: Escalation + Tool Budget
# -----------------------
_MEDIA_WORDS_RE = re.compile(r"\b(video|videos|youtube|yt|watch|tutorial|guide|how to|walkthrough)\b", re.I)
_IMAGE_WORDS_RE = re.compile(r"\b(image|images|picture|pictures|photo|photos|png|jpg|jpeg|sticker|diagram|infographic|show me)\b", re.I)

# ✅ UPDATED: web triggers are more "explicit web intent" + year-based "released in 2026"
# - remove "now" and the generic "202[0-9]" trigger because it causes accidental web routing
_WEB_WORDS_RE = re.compile(
    r"\b(latest|news|today|current|update|updated|recent|price|release|released|schedule|announcement|"
    r"source|sources|link|links|cite|citation|according to|reference)\b",
    re.I,
)

# ✅ NEW: "year request" signals a time-sensitive lookup (e.g., "released in 2026")
_YEAR_WEB_INTENT_RE = re.compile(r"\b(released|release|airing|air|premiere|premiered|new|best)\b.*\b(20\d{2})\b", re.I)

_UNCERTAIN_RE = re.compile(
    r"\b(i (don't|do not) know|not sure|can't verify|cannot verify|unsure|might be|may be|could be|depends|"
    r"check online|look it up|search|verify|as of|recently)\b",
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

# ✅ FIX: Empty answer is NOT a signal that "web is needed"
def looks_like_needs_web(answer_md: str) -> bool:
    if not answer_md or not answer_md.strip():
        return False
    return bool(_UNCERTAIN_RE.search(answer_md))

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
    if not (user_flags.get("want_images") or FORCE_IMAGES):
        need_img = False
    if not (user_flags.get("want_youtube") or FORCE_YOUTUBE):
        need_yt = False

    # Web is handled by "hard gate" policy in caller
    return need_web, need_img, need_yt

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
    params = {
        "key": YOUTUBE_API_KEY,
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": min(num, 5),
        "safeSearch": "strict",
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
    return out

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

    # ✅ more robust: first "{" to last "}"
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    candidate = text[start:end+1]
    try:
        return json.loads(candidate)
    except Exception:
        return {}

def extract_fallback_answer(text: str) -> str:
    if not text:
        return ""
    # Try to recover answer_markdown from malformed JSON
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            ans = (data.get("answer_markdown") or "").strip()
            if ans:
                return ans
    except Exception:
        pass

    match = re.search(r"\"answer_markdown\"\s*:\s*\"(.*?)\"", text, re.S)
    if match:
        raw_str = match.group(1)
        try:
            return json.loads(f"\"{raw_str}\"").strip()
        except Exception:
            return raw_str.strip()

    return ""

def hash_identifier(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]

def log_debug(event: str, data: Dict[str, Any]) -> None:
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **(data or {}),
    }
    try:
        print(json.dumps(payload, default=str), flush=True)
    except Exception:
        print(payload, flush=True)

def strip_prompt_echo(text: str) -> str:
    if not text:
        return ""
    cut_points = ["\n[USER]", "\n[ASSISTANT]", "\n[SYSTEM]"]
    end = None
    for token in cut_points:
        idx = text.find(token)
        if idx > 0 and (end is None or idx < end):
            end = idx
    cleaned = text[:end] if end is not None else text
    return cleaned.strip()

def prefer_clean_raw_answer(answer_md: str, raw: str, plan: Dict[str, Any]) -> str:
    if not raw:
        return answer_md
    has_plan_answer = bool(((plan or {}).get("answer_markdown", "")).strip()) if isinstance(plan, dict) else False
    if has_plan_answer:
        return answer_md
    cleaned = strip_prompt_echo(raw)
    if cleaned:
        return cleaned
    return answer_md

def normalize_media_query(text: str, max_len: int = 80) -> str:
    if not text:
        return ""
    q = re.sub(r"^Regarding the article\s+", "", text.strip(), flags=re.I)
    q = re.sub(r"\"", "", q)
    q = re.sub(r"\s+", " ", q).strip()
    return q[:max_len]

def build_prompt(
    message: str,
    history: List[HistoryItem],
    rag_block: str = "",
    web_evidence_block: str = "",
    article_block: str = "",
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

    p = f"[SYSTEM]\n{MODEL_JSON_INSTRUCTION}\n"
    if safe_article:
        p += "\n[INSTRUCTION] Use the provided ARTICLE_CONTEXT as the primary source for the user's question.\n"
        p += f"\n{safe_article}\n"
    if safe_rag:
        p += f"\n{safe_rag}\n"
    if safe_evidence:
        p += f"\n{safe_evidence}\n"

    remaining_history_chars = MAX_HISTORY_CHARS
    for h in history:
        role_tag = "USER" if h.role == "user" else "ASSISTANT"
        if remaining_history_chars <= 0:
            break
        content = _truncate(h.content, 260)
        if len(content) > remaining_history_chars:
            content = _truncate(content, max(0, remaining_history_chars))
        remaining_history_chars -= len(content)
        p += f"\n[{role_tag}] {content}\n"

    p += f"\n[USER] {safe_message}\n[ASSISTANT]"
    if len(p) > MAX_PROMPT_CHARS:
        p = p[:MAX_PROMPT_CHARS] + "..."
    return p

def _normalize_runpod_output(data: Any) -> str:
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        if data and isinstance(data[0], str):
            return data[0]
        # Instead of json.dumps, join or stringify
        return str(data[0]) if data else ""
    if not isinstance(data, dict):
        return str(data)

    # Handle wrapped output (e.g., { "output": { ... } })
    output = data.get("output", data)
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output and isinstance(output[0], str):
        return output[0]
    if isinstance(output, dict):
        # 🔑 Check "response" FIRST — this matches your RunPod
        for key in ("response", "message", "text", "result", "data"):
            val = output.get(key)
            if isinstance(val, str) and val.strip():
                return val
        # Handle OpenAI-style choices
        choices = output.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] or {}
            if isinstance(first, dict):
                msg = first.get("message") or {}
                if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                    return msg["content"]
                if isinstance(first.get("text"), str):
                    return first["text"]
    
    # ❌ NEVER return json.dumps(data) — it causes double encoding!
    # Instead, try to extract ANY string
    def extract_string(obj):
        if isinstance(obj, str):
            return obj
        if isinstance(obj, dict):
            for v in obj.values():
                s = extract_string(v)
                if s:
                    return s
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                s = extract_string(item)
                if s:
                    return s
        return ""

    fallback = extract_string(data)
    return fallback if fallback else "[No response content]"

def _build_runpod_urls(base_url: str) -> Tuple[str, str, str]:
    base = (base_url or "").rstrip("/")
    run_url = base  # POST inference
    status_url = base + "/status"
    ping_url = base + "/ping"
    return run_url, status_url, ping_url

async def call_runpod_service(prompt: str, timeout: httpx.Timeout, request_id: Optional[str] = None):
    if not LLAMA_RUNPOD_URL:
        raise HTTPException(status_code=500, detail="LLAMA_RUNPOD_URL missing in .env")

    run_url, status_url, _ = _build_runpod_urls(LLAMA_RUNPOD_URL)
    payload = {"input": {RUNPOD_INPUT_KEY: prompt}}
    if request_id:
        payload["input"]["request_id"] = request_id

    headers = {
        "Authorization": f"Bearer {RUNPOD_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(run_url, json=payload, headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"RunPod request failed: {str(e)}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid API Key or Token.")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"RunPod returned {resp.status_code}: {resp.text[:500]}")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to parse response from RunPod.")

    job_id = None
    if isinstance(data, dict):
        job_id = data.get("id") or data.get("job_id") or data.get("request_id")
        if not job_id and isinstance(data.get("output"), (str, dict, list)):
            return _normalize_runpod_output(data.get("output"))

    if not job_id:
        return _normalize_runpod_output(data)

    start = time.monotonic()
    max_wait = max(5.0, float(getattr(timeout, "read", 300.0) or 300.0))
    poll_delay = 0.5

    while True:
        if time.monotonic() - start > max_wait:
            raise HTTPException(status_code=504, detail="RunPod timed out while waiting for completion.")
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                status_resp = await client.get(f"{status_url}/{job_id}", headers=headers)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"RunPod status check failed: {str(e)}")

        if status_resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"RunPod status returned {status_resp.status_code}: {status_resp.text[:500]}")

        try:
            status_data = status_resp.json()
        except Exception:
            raise HTTPException(status_code=502, detail="Failed to parse RunPod status response.")

        status = (status_data.get("status") or "").upper() if isinstance(status_data, dict) else ""
        if status in {"COMPLETED", "SUCCESS"}:
            return _normalize_runpod_output(status_data.get("output") if isinstance(status_data, dict) else status_data)
        if status in {"FAILED", "CANCELLED", "TIMED_OUT", "ERROR"}:
            err = status_data.get("error") if isinstance(status_data, dict) else None
            raise HTTPException(status_code=502, detail=f"RunPod job failed: {err or status} :: {json.dumps(status_data)[:800]}")

        await asyncio.sleep(poll_delay)
        poll_delay = min(3.0, poll_delay + 0.5)


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
# RUNPOD CALL
# -----------------------
async def generate_cloud_structured(
    message: str,
    history: List[HistoryItem],
    article_title: Optional[str] = None,
    article_url: Optional[str] = None,
    article_context: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    request_id: Optional[str] = None,
    user_id: Optional[str] = None,
    max_history: int = 3,
) -> AssistantPayload:
    if not LLAMA_RUNPOD_URL:
        raise HTTPException(status_code=500, detail="LLAMA_RUNPOD_URL missing in .env")

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
    log_debug(
        "article_context",
        {
            "request_id": request_id,
            "used": bool(article_block),
            "length": len(article_block),
        },
    )

    # Internal RAG placeholder
    rag_chunks = await rag_retrieve(message, k=4)
    rag_block = build_rag_block(rag_chunks)

    timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)
    trimmed_history = history[-max_history:] if max_history and max_history > 0 else []
    # ✅ Deterministic keyword routing (early for hybrid flow)
    user_flags = keyword_router(message)

    log_debug(
        "request_metadata",
        {
            "request_id": request_id,
            "session_id": hash_identifier(session_id),
            "user_id": hash_identifier(user_id),
        },
    )

    raw = ""
    raw_fix = ""
    answer_md = ""
    plan: Dict[str, Any] = {}

    need_web = False
    need_img = False
    need_yt = False
    web_q = ""
    img_q = ""
    yt_q = ""

    sources: List[SourceItem] = []
    images: List[ImageItem] = []
    youtube: List[YouTubeItem] = []
    evidence_chunks: List[Dict[str, str]] = []

    allow_web_base = bool(user_flags.get("want_web")) or FORCE_WEB_SOURCES
    allow_web = allow_web_base
    escalate_web = False

    def log_stage(stage: str, article: str, rag: str, evidence: str = "", prompt_len: int = 0) -> None:
        log_debug(
            "prompt_stage",
            {
                "request_id": request_id,
                "pass": stage,
                "article_len": len(article) if article else 0,
                "rag_len": len(rag) if rag else 0,
                "evidence_len": len(evidence) if evidence else 0,
                "history_len": sum(len(h.content or "") for h in trimmed_history),
                "prompt_len": prompt_len,
            },
        )

    async def fetch_web_sources(query: str) -> Tuple[List[SourceItem], List[Dict[str, str]]]:
        t0 = time.monotonic()

        google_task = google_web_search(query, num=3)
        tavily_task = internet_rag_search_and_extract(query, max_sources=3)
        google_res, tav_res = await asyncio.gather(google_task, tavily_task, return_exceptions=True)

        base_sources: List[SourceItem] = []
        evidence: List[Dict[str, str]] = []

        if isinstance(google_res, Exception):
            log_debug(
                "web_fetch_error",
                {
                    "request_id": request_id,
                    "provider": "google",
                    "error": str(google_res),
                },
            )
        else:
            base_sources = google_res or []

        if isinstance(tav_res, Exception):
            log_debug(
                "web_fetch_error",
                {
                    "request_id": request_id,
                    "provider": "tavily",
                    "error": str(tav_res),
                },
            )
        else:
            tav_sources, tav_chunks = tav_res
            if tav_sources:
                seen = {s.url.lower(): s for s in base_sources if s.url}
                for s in tav_sources:
                    key = (s.url or "").lower()
                    if not key or key in seen:
                        continue
                    base_sources.append(s)
                    seen[key] = s
            evidence = tav_chunks or []

        log_debug(
            "web_fetch",
            {
                "request_id": request_id,
                "web_q": (query or "")[:120],
                "sources_count": len(base_sources),
                "evidence_chunks_count": len(evidence),
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )
        return base_sources, evidence

    # --- Hybrid: single-pass with evidence if user requested web ---
    if allow_web_base:
        need_web = True
        web_q = make_fallback_query(article_title or message, max_len=120)
        web_q = enforce_web_query_constraints(message, web_q)

        if web_q:
            sources, evidence_chunks = await fetch_web_sources(web_q)

        web_evidence_block = build_web_evidence_block(sources, evidence_chunks)
        prompt = build_prompt(
            message,
            trimmed_history,
            rag_block=rag_block,
            web_evidence_block=web_evidence_block,
            article_block=article_block,
        )
        log_stage("web_pass", article_block, rag_block, web_evidence_block, prompt_len=len(prompt))

        t_model = time.monotonic()
        raw = await call_runpod_service(prompt, timeout=timeout, request_id=request_id)
        print("RUNPOD RAW (web_pass):", raw, flush=True)
        log_debug(
            "model_call",
            {
                "request_id": request_id,
                "pass": "web_pass",
                "raw_len": len(raw),
                "duration_ms": int((time.monotonic() - t_model) * 1000),
            },
        )
        plan = extract_json(raw)

        if not plan or "answer_markdown" not in plan or not (plan.get("answer_markdown") or "").strip():
            repair_prompt = repair_json_instruction(message) + "\n\nMODEL OUTPUT TO REPAIR:\n" + raw[:2000]
            raw_fix = await call_runpod_service(repair_prompt, timeout=timeout, request_id=request_id)
            print("RUNPOD RAW FIX (web_pass):", raw_fix, flush=True)
            plan = extract_json(raw_fix) or plan or {}

        answer_md = (plan.get("answer_markdown") or "").strip()
        if not answer_md:
            answer_md = extract_fallback_answer(raw)
        if not answer_md and raw_fix:
            answer_md = extract_fallback_answer(raw_fix)
        if not answer_md and raw:
            answer_md = raw.strip()

        answer_md = prefer_clean_raw_answer(answer_md, raw, plan)

        log_debug(
            "model_output",
            {
                "request_id": request_id,
                "pass": "web_pass",
                "answer_len": len(answer_md),
                "json_parse_ok": bool(plan) and "answer_markdown" in plan,
            },
        )

        need_img = bool(plan.get("need_images"))
        need_yt = bool(plan.get("need_youtube"))
        img_q = (plan.get("image_query") or "").strip()
        yt_q = (plan.get("youtube_query") or "").strip()
    else:
        # --- Single-pass without web, then optional second pass only if needed ---
        prompt = build_prompt(message, trimmed_history, rag_block=rag_block, article_block=article_block)
        log_stage("no_web_pass", article_block, rag_block, prompt_len=len(prompt))
        t_model = time.monotonic()
        raw = await call_runpod_service(prompt, timeout=timeout, request_id=request_id)
        print("RUNPOD RAW (no_web_pass):", raw, flush=True)
        log_debug(
            "model_call",
            {
                "request_id": request_id,
                "pass": "no_web_pass",
                "raw_len": len(raw),
                "duration_ms": int((time.monotonic() - t_model) * 1000),
            },
        )
        plan = extract_json(raw)

        if not plan or "answer_markdown" not in plan or not (plan.get("answer_markdown") or "").strip():
            repair_prompt = repair_json_instruction(message) + "\n\nMODEL OUTPUT TO REPAIR:\n" + raw[:2000]
            raw_fix = await call_runpod_service(repair_prompt, timeout=timeout, request_id=request_id)
            print("RUNPOD RAW FIX (no_web_pass):", raw_fix, flush=True)
            plan = extract_json(raw_fix) or plan or {}

        answer_md = (plan.get("answer_markdown") or "").strip()
        if not answer_md:
            answer_md = extract_fallback_answer(raw)
        if not answer_md and raw_fix:
            answer_md = extract_fallback_answer(raw_fix)
        if not answer_md and raw:
            answer_md = raw.strip()

        answer_md = prefer_clean_raw_answer(answer_md, raw, plan)

        log_debug(
            "model_output",
            {
                "request_id": request_id,
                "pass": "no_web_pass",
                "answer_len": len(answer_md),
                "json_parse_ok": bool(plan) and "answer_markdown" in plan,
            },
        )

        need_web = bool(plan.get("need_web_sources"))
        need_img = bool(plan.get("need_images"))
        need_yt = bool(plan.get("need_youtube"))
        web_q = (plan.get("web_query") or "").strip()
        img_q = (plan.get("image_query") or "").strip()
        yt_q = (plan.get("youtube_query") or "").strip()

        # Escalate web only when needed
        uncertain = looks_like_needs_web(answer_md)
        escalate_web = bool(user_flags.get("want_web")) or uncertain
        if uncertain:
            log_debug(
                "uncertainty_detected",
                {
                    "request_id": request_id,
                    "message": "enabling web sources",
                },
            )
        allow_web = bool(user_flags.get("want_web")) or FORCE_WEB_SOURCES or escalate_web
        if allow_web and (need_web or escalate_web):
            need_web = True
            years = extract_years(message)
            if years:
                web_q = make_fallback_query(message, max_len=120)
            elif not web_q:
                web_q = make_fallback_query(article_title or message, max_len=120)
            web_q = enforce_web_query_constraints(message, web_q)

            if web_q:
                sources, evidence_chunks = await fetch_web_sources(web_q)

            web_evidence_block = build_web_evidence_block(sources, evidence_chunks)
            prompt2 = build_prompt(
                message,
                trimmed_history,
                rag_block=rag_block,
                web_evidence_block=web_evidence_block,
                article_block=article_block,
            )
            log_stage("web_second_pass", article_block, rag_block, web_evidence_block, prompt_len=len(prompt2))

            raw2 = ""
            try:
                t_model2 = time.monotonic()
                raw2 = await call_runpod_service(prompt2, timeout=timeout, request_id=request_id)
                print("RUNPOD RAW (web_second_pass):", raw2, flush=True)
                log_debug(
                    "model_call",
                    {
                        "request_id": request_id,
                        "pass": "web_second_pass",
                        "raw_len": len(raw2),
                        "duration_ms": int((time.monotonic() - t_model2) * 1000),
                    },
                )
            except HTTPException as e:
                log_debug(
                    "error",
                    {
                        "request_id": request_id,
                        "pass": "web_second_pass",
                        "status": e.status_code,
                        "message": e.detail,
                    },
                )

            plan2 = extract_json(raw2) if raw2 else {}
            if raw2 and (not plan2 or "answer_markdown" not in plan2 or not (plan2.get("answer_markdown") or "").strip()):
                try:
                    repair2 = repair_json_instruction(message) + "\n\nMODEL OUTPUT TO REPAIR:\n" + raw2[:2000]
                    raw2_fix = await call_runpod_service(repair2, timeout=timeout, request_id=request_id)
                    print("RUNPOD RAW FIX (web_second_pass):", raw2_fix, flush=True)
                    plan2 = extract_json(raw2_fix) or plan2 or {}
                except HTTPException as e:
                    print("SECOND PASS REPAIR FAILED:", e.detail, flush=True)

            if plan2 and (plan2.get("answer_markdown") or "").strip():
                answer_md = (plan2.get("answer_markdown") or "").strip()
            if not answer_md:
                answer_md = extract_fallback_answer(raw2)
            if not answer_md and raw2:
                answer_md = raw2.strip()

            answer_md = prefer_clean_raw_answer(answer_md, raw2, plan2)

            log_debug(
                "model_output",
                {
                    "request_id": request_id,
                    "pass": "web_second_pass",
                    "answer_len": len(answer_md),
                    "json_parse_ok": bool(plan2) and "answer_markdown" in plan2,
                },
            )

            if plan2:
                need_img = bool(plan2.get("need_images", need_img))
                need_yt = bool(plan2.get("need_youtube", need_yt))
                img_q = (plan2.get("image_query") or img_q).strip()
                yt_q = (plan2.get("youtube_query") or yt_q).strip()
        else:
            need_web = False
            web_q = ""

    # Env force flags
    if FORCE_WEB_SOURCES:
        need_web = True
    if FORCE_IMAGES:
        need_img = True
    if FORCE_YOUTUBE:
        need_yt = True

    # Explicit user request overrides model
    if user_flags.get("want_images"):
        need_img = True
    if user_flags.get("want_youtube"):
        need_yt = True

    # ✅ Tool budget: prevent unwanted media spam
    need_web, need_img, need_yt = apply_tool_budget(user_flags, need_web, need_img, need_yt)

    log_debug(
        "routing",
        {
            "request_id": request_id,
            "want_web": bool(user_flags.get("want_web")),
            "want_images": bool(user_flags.get("want_images")),
            "want_youtube": bool(user_flags.get("want_youtube")),
            "allow_web": allow_web,
            "escalate_web": escalate_web,
        },
    )

    # ✅ Query fallbacks
    if need_img and not img_q:
        img_q = make_fallback_query(message, max_len=120)
    if need_yt and not yt_q:
        yt_q = make_fallback_query(message, max_len=120)

    log_debug(
        "routed_flags",
        {
            "request_id": request_id,
            "need_web": need_web,
            "web_q": (web_q or "")[:120],
            "need_img": need_img,
            "img_q": (img_q or "")[:120],
            "need_yt": need_yt,
            "yt_q": (yt_q or "")[:120],
            "answer_len": len(answer_md),
        },
    )

    # 4) Images
    if need_img and img_q:
        t_img = time.monotonic()
        img_results = await google_image_search(img_q, num=4)
        log_debug(
            "image_search",
            {
                "request_id": request_id,
                "img_q": (img_q or "")[:120],
                "images_count": len(img_results),
                "duration_ms": int((time.monotonic() - t_img) * 1000),
            },
        )

        for it in img_results[:4]:
            if not USE_SUPABASE_STORAGE_FOR_IMAGES:
                images.append(ImageItem(
                    url=it.get("image_url") or "",
                    alt=it.get("title") or img_q,
                    source_url=it.get("page_url") or it.get("image_url"),
                ))
                continue

            uploaded = await supabase_upload_image_from_url(it["image_url"], filename_hint=img_q)
            if uploaded:
                uploaded.alt = it.get("title") or img_q
                uploaded.source_url = it.get("page_url") or it.get("image_url")
                images.append(uploaded)

        images = [im for im in images if im.url]

    # 5) YouTube
    if need_yt and yt_q:
        yt_q = normalize_media_query(yt_q) or make_fallback_query(message, max_len=80)
        t_yt = time.monotonic()
        youtube = await youtube_search(yt_q, num=2)
        log_debug(
            "youtube_search",
            {
                "request_id": request_id,
                "yt_q": (yt_q or "")[:120],
                "youtube_count": len(youtube),
                "duration_ms": int((time.monotonic() - t_yt) * 1000),
            },
        )
        if not youtube:
            retry_q = f"{make_fallback_query(message, max_len=60)} explainer".strip()
            t_yt_retry = time.monotonic()
            youtube = await youtube_search(retry_q, num=2)
            log_debug(
                "youtube_search_retry",
                {
                    "request_id": request_id,
                    "yt_q": retry_q,
                    "youtube_count": len(youtube),
                    "duration_ms": int((time.monotonic() - t_yt_retry) * 1000),
                },
            )

    # 6) Final fallback if answer_md still empty
    if not answer_md:
        answer_md = (
            "I couldn’t generate the full response just now, but I’ve gathered the requested resources below. "
            "Try asking again or rephrasing and I’ll retry."
        )

    # 7) Validate citation tokens
    if sources:
        answer_md = validate_and_clean_citations(answer_md, sources)
    else:
        answer_md = _CITE_TOKEN_RE.sub("", answer_md).strip()

    log_debug(
        "summary",
        {
            "request_id": request_id,
            "sources_count": len(sources),
            "evidence_chunks_count": len(evidence_chunks),
            "images_count": len(images),
            "youtube_count": len(youtube),
            "answer_len": len(answer_md),
        },
    )

    return AssistantPayload(
        answer_markdown=answer_md,
        sources=sources,
        images=images,
        youtube=youtube,
    )

# -----------------------
# Persist assistant payload into chat_messages.meta (optional)
# -----------------------
async def persist_assistant_message(
    session_id: str,
    user_id: str,
    answer_md: str,
    payload: AssistantPayload,
    model_used: str = "llama2-cloud+web",
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
        request_id=req.query_id,
        user_id=req.user_id,
        max_history=4 if req.user_id else 2,
    )

    if req.session_id and req.user_id:
        await persist_assistant_message(
            session_id=req.session_id,
            user_id=req.user_id,
            answer_md=payload.answer_markdown,
            payload=payload,
        )

    return ChatResponse(answer=payload.answer_markdown, payload=payload)
