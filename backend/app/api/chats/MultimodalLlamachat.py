from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import re
from typing import List, Literal, Optional, Dict, Any, Tuple
import os
import json
import time
import httpx
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

# -----------------------
# PROMPTS - edit later for google
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
#  Internet RAG extraction (using tavily)
# -----------------------
async def internet_rag_search_and_extract(
    query: str, max_sources: int = 6
) -> Tuple[List[SourceItem], List[Dict[str, str]]]:
    # disabled unless you implement it
    if not TAVILY_API_KEY or not query.strip():
        return [], []
    return [], []

def build_web_evidence_block(sources: List[SourceItem], evidence_chunks: List[Dict[str, str]]) -> str:
    if not sources:
        return ""
    lines = ["[SOURCES]"]
    for i, s in enumerate(sources, start=1):
        lines.append(f"[{i}] Title: {s.title}\n    URL: {s.url}")
    if evidence_chunks:
        lines.append("\n[EVIDENCE EXCERPTS]")
        for j, ch in enumerate(evidence_chunks[:10], start=1):
            si = ch.get("source_index") or ""
            content = (ch.get("content") or "").strip()
            if not si or not content:
                continue
            suffix = chr(ord("a") + (j - 1) % 26)
            lines.append(f"[{si}{suffix}] {content}")
    return "\n".join(lines).strip()

# -----------------------
# Google web sources the CSE API
# -----------------------
async def google_web_search(query: str, num: int = 6) -> List[SourceItem]:
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID and query.strip()):
        return []
    url = "https://www.googleapis.com/customsearch/v1"
    params = {"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID, "q": query, "num": min(num, 10)}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        if r.status_code >= 400:
            # helpful debug
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
# Supabase storage upload for images - still need to refineee
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
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}

def build_prompt(message: str, history: List[HistoryItem], rag_block: str = "", web_evidence_block: str = "") -> str:
    p = f"[SYSTEM]\n{MODEL_JSON_INSTRUCTION}\n"
    if rag_block:
        p += f"\n{rag_block}\n"
    if web_evidence_block:
        p += f"\n{web_evidence_block}\n"
    for h in history[-3:]:
        role_tag = "USER" if h.role == "user" else "ASSISTANT"
        p += f"\n[{role_tag}] {h.content}\n"
    p += f"\n[USER] {message}\n[ASSISTANT]"
    return p

async def call_cloudrun(prompt: str, timeout: httpx.Timeout) -> str:
    payload = {"message": prompt}
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(LLAMA_CLOUDRUN_URL, json=payload)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Cloud Run request failed: {str(e)}")

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
# ✅ Inline citation token validation - need to work on it more
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
async def generate_cloud_structured(message: str, history: List[HistoryItem]) -> AssistantPayload:
    if not LLAMA_CLOUDRUN_URL:
        raise HTTPException(status_code=500, detail="LLAMA_CLOUDRUN_URL missing in .env")

    # Moderation just a placeholdher for now
    mod = await moderation_check(message)
    if not mod.get("allowed", True):
        return AssistantPayload(
            answer_markdown="I can’t help with that request. If you want, rephrase it in a safe, respectful way and I’ll try again.",
            sources=[],
            images=[],
            youtube=[],
        )

    # 1) Internal RAG (placeholder for now will do later)
    rag_chunks = await rag_retrieve(message, k=4)
    rag_block = build_rag_block(rag_chunks)

    timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)

    # 2) Planning call (STRICT JSON) with repair if needed
    raw = await call_cloudrun(build_prompt(message, history, rag_block=rag_block), timeout=timeout)
    plan = extract_json(raw)

    if not plan or "answer_markdown" not in plan:
        raw_fix = await call_cloudrun(repair_json_instruction(message), timeout=timeout)
        plan = extract_json(raw_fix) or plan

    answer_md = (plan.get("answer_markdown") or "").strip()
    need_web = bool(plan.get("need_web_sources"))
    need_img = bool(plan.get("need_images"))
    need_yt = bool(plan.get("need_youtube"))
    web_q = (plan.get("web_query") or "").strip()
    img_q = (plan.get("image_query") or "").strip()
    yt_q = (plan.get("youtube_query") or "").strip()

    # sensible fallbacks
    if need_web and not web_q:
        web_q = message[:120]
    if need_img and not img_q:
        img_q = message[:120]
    if need_yt and not yt_q:
        yt_q = message[:120]

    sources: List[SourceItem] = []
    images: List[ImageItem] = []
    youtube: List[YouTubeItem] = []

    # 3) Web sources + evidence + second pass answer
    evidence_chunks: List[Dict[str, str]] = []
    if need_web and web_q:
        sources = await google_web_search(web_q, num=7)

        tav_sources, tav_chunks = await internet_rag_search_and_extract(
            web_q, max_sources=min(6, len(sources) or 6)
        )
        if tav_sources:
            sources = tav_sources
        evidence_chunks = tav_chunks

        web_evidence_block = build_web_evidence_block(sources, evidence_chunks)

        # second pass answer (with evidence block) + repair if needed
        raw2 = await call_cloudrun(build_prompt(message, history, rag_block=rag_block, web_evidence_block=web_evidence_block), timeout=timeout)
        plan2 = extract_json(raw2)
        if not plan2 or "answer_markdown" not in plan2:
            raw2_fix = await call_cloudrun(repair_json_instruction(message), timeout=timeout)
            plan2 = extract_json(raw2_fix) or plan2

        if plan2 and (plan2.get("answer_markdown") or "").strip():
            answer_md = (plan2.get("answer_markdown") or "").strip()

        # update media flags / queries 
        need_img = bool(plan2.get("need_images", need_img)) if plan2 else need_img
        need_yt = bool(plan2.get("need_youtube", need_yt)) if plan2 else need_yt
        img_q = (plan2.get("image_query") or img_q).strip() if plan2 else img_q
        yt_q = (plan2.get("youtube_query") or yt_q).strip() if plan2 else yt_q
        if need_img and not img_q:
            img_q = web_q or message[:120]
        if need_yt and not yt_q:
            yt_q = web_q or message[:120]

    
    print("MEDIA FLAGS:", {"need_img": need_img, "img_q": img_q, "need_yt": need_yt, "yt_q": yt_q}, flush=True)

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

            # Otherwise upload to Supabase storage
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

    # 6) Fallback if answer_md empty
    if not answer_md:
        def _clean(text: str) -> str:
            cut_markers = ["\n[USER]", "\nUSER:", "\n[SYSTEM]", "\nSYSTEM:"]
            cut_positions = [text.find(m) for m in cut_markers if m in text]
            if cut_positions:
                cut_idx = min([p for p in cut_positions if p >= 0])
                text = text[:cut_idx]
            text = re.sub(r"\s*\[(?:USER|ASSISTANT|SYSTEM)\]\s*", " ", text)
            text = re.sub(r"\b(?:USER|ASSISTANT|SYSTEM):\s*", " ", text)
            return re.sub(r"\s+", " ", text).strip()
        answer_md = _clean(raw)

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
    payload = await generate_cloud_structured(req.message, req.history)

    
    if req.session_id and req.user_id:
        await persist_assistant_message(
            session_id=req.session_id,
            user_id=req.user_id,
            answer_md=payload.answer_markdown,
            payload=payload,
        )

    return ChatResponse(answer=payload.answer_markdown, payload=payload)
