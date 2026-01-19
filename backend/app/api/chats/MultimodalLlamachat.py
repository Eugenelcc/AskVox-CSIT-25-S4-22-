from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import re
from typing import List, Literal, Optional, Dict, Any, Tuple
import os
import json
import time
import httpx
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/llamachats", tags=["llamachat-plus"])

# -----------------------
# ENV
# -----------------------
LLAMA_CLOUDRUN_URL = os.getenv("LLAMA_CLOUDRUN_URL", "")

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
- answer_markdown is the final answer the user sees.
- Apply these formatting rules:
{FORMAT_INSTRUCTION}

{CITATION_TOKEN_RULES}

- If need_web_sources=false then web_query must be "" (same for image/youtube).
- Do not invent citations. Only cite if evidence exists.
- If the user includes a specific year (e.g., 2026), the web_query MUST include that year and "kdrama"/"korean drama" when relevant.
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
    """
    Guardrail: don't trust model's web_query completely (Llama 2 planner can hallucinate titles like "Vagabond").

    If user asked for a year (e.g., 2026), enforce that year in web_q.
    If user is asking about Kdrama, enforce 'kdrama' keyword.
    """
    msg = (user_message or "").strip()
    q = (web_q or "").strip()

    years = extract_years(msg)
    wants_kdrama = bool(re.search(r"\b(kdrama|k-drama|k drama|korean drama|k-drama)\b", msg, re.I)) or bool(
        re.search(r"\b(kdrama|korean drama)\b", q, re.I)
    )

    # If model gave nothing, use user message
    if not q:
        q = msg[:120]

    # If user specified year(s), enforce year presence
    if years:
        if not any(y in q for y in years):
            q = f"{q} {years[0]}"

    # Enforce topic keyword when it's clearly a kdrama query
    # (If user said "Kdrama", we ensure query stays in that domain.)
    if re.search(r"\b(kdrama|k-drama|korean drama)\b", msg, re.I) and not re.search(
        r"\b(kdrama|k-drama|korean drama)\b", q, re.I
    ):
        q = f"{q} kdrama"

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

async def call_cloudrun(prompt: str, timeout: httpx.Timeout) -> str:
    payload = {"message": prompt}

    async def _post(client: httpx.AsyncClient) -> httpx.Response:
        return await client.post(LLAMA_CLOUDRUN_URL, json=payload)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await _post(client)
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
                resp = await _post(retry_client)
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
    if not LLAMA_CLOUDRUN_URL:
        raise HTTPException(status_code=500, detail="LLAMA_CLOUDRUN_URL missing in .env")

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

    # ✅ Draft answer first (no tools yet)
    raw = await call_cloudrun(
        build_prompt(message, trimmed_history, rag_block=rag_block, article_block=article_block),
        timeout=timeout,
    )
    plan = extract_json(raw)

    # ✅ Better repair (include broken output)
    if not plan or "answer_markdown" not in plan or not (plan.get("answer_markdown") or "").strip():
        repair_prompt = repair_json_instruction(message) + "\n\nMODEL OUTPUT TO REPAIR:\n" + raw[:2000]
        raw_fix = await call_cloudrun(repair_prompt, timeout=timeout)
        plan = extract_json(raw_fix) or plan or {}

    answer_md = (plan.get("answer_markdown") or "").strip()

    # Model suggestions (soft)
    need_web = bool(plan.get("need_web_sources"))
    need_img = bool(plan.get("need_images"))
    need_yt = bool(plan.get("need_youtube"))
    web_q = (plan.get("web_query") or "").strip()
    img_q = (plan.get("image_query") or "").strip()
    yt_q = (plan.get("youtube_query") or "").strip()

    # ✅ Deterministic keyword routing
    user_flags = keyword_router(message)

    # ✅ Escalate web only when truly needed (and NOT due to empty answer)
    escalate_web = bool(user_flags.get("want_web")) or looks_like_needs_web(answer_md)

    # ✅ HARD POLICY GATE: allow web only if user asked OR forced OR escalation
    allow_web = bool(user_flags.get("want_web")) or FORCE_WEB_SOURCES or escalate_web
    if not allow_web:
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

    # Only elevate web if allowed by policy
    if allow_web and escalate_web:
        need_web = True
    if not allow_web:
        need_web = False
        web_q = ""

    # ✅ Tool budget: prevent unwanted media spam
    need_web, need_img, need_yt = apply_tool_budget(user_flags, need_web, need_img, need_yt)

    # ✅ Query fallbacks + keyword constraint enforcement
    if need_web:
        years = extract_years(message)
        # If user asked for a year, lock query to the user's message (don't trust model's web_q)
        if years:
            web_q = make_fallback_query(message, max_len=120)
        elif not web_q:
            web_q = make_fallback_query(article_title or message, max_len=120)

        web_q = enforce_web_query_constraints(message, web_q)

    if need_img and not img_q:
        img_q = make_fallback_query(message, max_len=120)
    if need_yt and not yt_q:
        yt_q = make_fallback_query(message, max_len=120)

    print(
        "ROUTED FLAGS:",
        {
            "need_web": need_web,
            "web_q": web_q,
            "need_img": need_img,
            "img_q": img_q,
            "need_yt": need_yt,
            "yt_q": yt_q,
            "answer_len": len(answer_md),
            "user_flags": user_flags,
            "escalate_web": escalate_web,
            "allow_web": allow_web,
        },
        flush=True,
    )

    sources: List[SourceItem] = []
    images: List[ImageItem] = []
    youtube: List[YouTubeItem] = []

    # 3) Web sources + evidence + second pass answer (only if need_web)
    evidence_chunks: List[Dict[str, str]] = []
    if need_web and web_q:
        sources = await google_web_search(web_q, num=7)

        tav_sources, tav_chunks = await internet_rag_search_and_extract(
            web_q, max_sources=min(6, len(sources) or 6)
        )
        if tav_sources:
            seen = {s.url.lower(): s for s in sources if s.url}
            for s in tav_sources:
                key = (s.url or "").lower()
                if not key or key in seen:
                    continue
                sources.append(s)
                seen[key] = s
        evidence_chunks = tav_chunks

        web_evidence_block = build_web_evidence_block(sources, evidence_chunks)

        # ✅ second pass should fail-soft (no 502)
        raw2 = ""
        try:
            raw2 = await call_cloudrun(
                build_prompt(
                    message,
                    trimmed_history,
                    rag_block=rag_block,
                    web_evidence_block=web_evidence_block,
                    article_block=article_block,
                ),
                timeout=timeout,
            )
        except HTTPException as e:
            print("SECOND PASS CLOUDRUN FAILED:", e.detail, flush=True)

        plan2 = extract_json(raw2) if raw2 else {}

        # ✅ Repair second pass too (include broken output)
        if raw2 and (not plan2 or "answer_markdown" not in plan2 or not (plan2.get("answer_markdown") or "").strip()):
            try:
                repair2 = repair_json_instruction(message) + "\n\nMODEL OUTPUT TO REPAIR:\n" + raw2[:2000]
                raw2_fix = await call_cloudrun(repair2, timeout=timeout)
                plan2 = extract_json(raw2_fix) or plan2 or {}
            except HTTPException as e:
                print("SECOND PASS REPAIR FAILED:", e.detail, flush=True)

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
        img_results = await google_image_search(img_q, num=4)
        print("IMAGE RESULTS:", len(img_results), flush=True)

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
        youtube = await youtube_search(yt_q, num=2)
        print("YOUTUBE RESULTS:", len(youtube), flush=True)

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
