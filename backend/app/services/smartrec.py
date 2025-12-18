import json
import os
from datetime import datetime, timezone
from collections import Counter
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv
from supabase import create_client, Client

router = APIRouter(prefix="/smartrec", tags=["smartrec"])

# Load env
load_dotenv()

SEALION_BASE_URL = os.getenv("SEALION_BASE_URL", "https://api.sea-lion.ai/v1").rstrip("/")
SEALION_API_KEY = os.getenv("SEALION_API_KEY")
SEALION_MODEL = os.getenv("SEALION_MODEL", "aisingapore/Gemma-SEA-LION-v4-27B-IT")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ✅ Create Supabase client directly here (server-side only)
# NOTE: service role bypasses RLS. Keep it on backend only.
supabase: Client | None = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

SEALION_CHAT_ENDPOINT = f"{SEALION_BASE_URL}/chat/completions"

ALLOWED_DOMAINS = {
    "Science",
    "History",
    "Sports",
    "Cooking",
    "Astronomy & Space",
    "Geography & Travel",
    "Art/Music/Literature",
    "Current Affairs",
    "general",
}

# ---------- request models ----------

class GenerateReq(BaseModel):
    user_id: str
    limit: int = 30  # how many recent queries to analyze

class ClickReq(BaseModel):
    user_id: str
    recommendation_id: str

# ---------- env / supabase helpers ----------

def _require_env():
    if not SEALION_API_KEY:
        raise HTTPException(status_code=500, detail="Missing SEALION_API_KEY in .env")
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not initialized")

def _sb_ok(res, label: str):
    """
    Supabase-py returns objects that may contain `.error`.
    This converts hidden Supabase failures into clear FastAPI 500 messages.
    """
    err = getattr(res, "error", None)
    if err:
        msg = getattr(err, "message", str(err))
        raise HTTPException(status_code=500, detail=f"Supabase {label} failed: {msg}")
    return res

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ---------- SeaLion helpers ----------

async def _sealion_completion(messages: list[dict], temperature: float = 0.2, max_tokens: int = 700) -> str:
    headers = {
        "Authorization": f"Bearer {SEALION_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": SEALION_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(SEALION_CHAT_ENDPOINT, headers=headers, json=payload)
            res.raise_for_status()
            data = res.json()
    except httpx.HTTPError as e:
        # Surface a useful message so you can debug quickly
        raise HTTPException(status_code=502, detail=f"SeaLion request failed: {str(e)}")

    return (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )

# ---------- parsing helpers ----------

def _safe_parse_json(text: str) -> dict:
    t = (text or "").strip()
    if not t:
        return {}
    try:
        return json.loads(t)
    except Exception:
        pass
    a = t.find("{")
    b = t.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(t[a:b+1])
        except Exception:
            return {}
    return {}

def _normalize_recs(payload: dict) -> list[dict]:
    recs = payload.get("recommendations") or []
    out = []
    if not isinstance(recs, list):
        return out

    for r in recs:
        if not isinstance(r, dict):
            continue
        domain = (r.get("domain") or "").strip()
        topic = (r.get("topic") or r.get("title") or "").strip()

        if not domain or not topic:
            continue
        if domain not in ALLOWED_DOMAINS:
            continue
        if len(topic) > 80:
            topic = topic[:80].rstrip()

        out.append({"domain": domain, "topic": topic})

    uniq = []
    seen = set()
    for r in out:
        key = (r["domain"].lower(), r["topic"].lower())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    return uniq[:6]

def _auto_query(domain: str, topic: str) -> str:
    return (
        f"Teach me about {topic} in the {domain} domain. "
        f"Give a simple definition, key facts, and 2-3 examples."
    )

def _fallback_recs(queries: list[dict]) -> list[dict]:
    if not queries:
        return []

    domain_counts = Counter([q.get("domain") or "general" for q in queries])
    top_domains = [d for d, _ in domain_counts.most_common()]

    recs: list[dict] = []
    seen = set()
    for q in queries:
        dom = q.get("domain") or "general"
        if dom not in ALLOWED_DOMAINS:
            dom = "general"
        if dom not in top_domains:
            continue

        text = (q.get("text") or "").strip()
        if not text:
            continue

        topic = text.split(".")[0][:80].rstrip()
        if len(topic) < 8:
            topic = f"Learn more about {dom}"

        key = (dom.lower(), topic.lower())
        if key in seen:
            continue
        seen.add(key)

        recs.append({"domain": dom, "topic": topic})
        if len(recs) >= 4:
            break

    return recs

async def _sealion_generate_recs_from_queries(queries: list[dict]) -> list[dict]:
    prompt = f"""
You are AskVox SmartRec.
Analyze the user's past queries and their detected domains, then output ONLY valid JSON.

Return format:
{{
  "recommendations": [
    {{"domain":"Astronomy & Space","topic":"Black Holes Explained Simply"}},
    {{"domain":"Cooking","topic":"How to Bake Macarons"}}
  ]
}}

Rules:
- 4 to 6 recommendations
- domain MUST be one of:
  Science, History, Sports, Cooking, Astronomy & Space, Geography & Travel, Art/Music/Literature, Current Affairs, general
- topic must be derived from user patterns (NO random topics)
- topic length 3-8 words preferred
- output JSON only, no markdown

User history (most recent first):
{json.dumps(queries, ensure_ascii=False)}
""".strip()

    messages = [
        {"role": "system", "content": "You are AskVox SmartRec. Respond with JSON only."},
        {"role": "user", "content": prompt},
    ]

    raw = await _sealion_completion(messages, temperature=0.25, max_tokens=700)
    parsed = _safe_parse_json(raw)
    return _normalize_recs(parsed)

# ---------- routes ----------

@router.post("/generate")
async def generate(req: GenerateReq):
    qres = (
        supabase.table("queries")
        .select("transcribed_text, detected_domain, created_at")
        .eq("user_id", req.user_id)
        .order("created_at", desc=True)
        .limit(req.limit)
        .execute()
    )

    rows = qres.data or []
    if not rows:
        return {"recommendations": []}

    compact = []
    for r in rows:
        txt = (r.get("transcribed_text") or "").strip()
        dom = (r.get("detected_domain") or "general").strip()
        if not txt:
            continue
        compact.append({"text": txt, "domain": dom, "created_at": r.get("created_at")})

    if not compact:
        return {"recommendations": []}

    try:
        recs = await _sealion_generate_recs_from_queries(compact)
    except Exception:
        recs = []

    if not recs:
        recs = _fallback_recs(compact)

    if not recs:
        return {"recommendations": []}

    # ✅ table name is plural
    supabase.table("recommendations").delete().eq("user_id", req.user_id).execute()

    # Insert all at once (simpler + faster)
    payload = [
        {
            "user_id": req.user_id,
            "domain": r["domain"],
            "topic": r["topic"],
            "clicked_at": None,
        }
        for r in recs
    ]

    ins = supabase.table("recommendations").insert(payload).execute()
    inserted = ins.data or []

    # Return just the fields frontend needs
    cleaned = [
        {"id": x.get("id"), "domain": x.get("domain"), "topic": x.get("topic"), "clicked_at": x.get("clicked_at")}
        for x in inserted
    ]
    return {"recommendations": cleaned}


@router.get("/list")
def list_recommendations(user_id: str, limit: int = 10):
    res = (
        supabase.table("recommendations")
        .select("id, domain, topic, clicked_at")
        .eq("user_id", user_id)
        .order("clicked_at", desc=False, nullsfirst=True)
        .limit(limit)
        .execute()
    )
    return {"recommendations": res.data or []}


@router.post("/click")
async def click(req: ClickReq):
    rec_res = (
        supabase.table("recommendations")
        .select("id, domain, topic")
        .eq("id", req.recommendation_id)
        .eq("user_id", req.user_id)
        .single()
        .execute()
    )

    if not rec_res.data:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    domain = rec_res.data["domain"]
    topic = rec_res.data["topic"]
    auto_q = _auto_query(domain, topic)

    # mark clicked
    supabase.table("recommendations").update({"clicked_at": _utc_now_iso()}).eq("id", rec_res.data["id"]).execute()

    # create chat session (NO .select() chaining)
    sess_res = supabase.table("chat_sessions").insert({
        "user_id": req.user_id,
        "title": f"{topic[:30]}...",
    }).execute()

    session_row = (sess_res.data or [None])[0]
    if not session_row or not session_row.get("id"):
        raise HTTPException(status_code=500, detail="Failed to create chat session")

    session_id = session_row["id"]

    # create query row
    qrow_res = supabase.table("queries").insert({
        "session_id": session_id,
        "user_id": req.user_id,
        "input_mode": "text",
        "transcribed_text": auto_q,
        "detected_domain": domain,
    }).execute()

    # insert user message
    supabase.table("chat_messages").insert({
        "session_id": session_id,
        "user_id": req.user_id,
        "role": "user",
        "content": auto_q,
        "display_name": "User",
    }).execute()

    # call SeaLion for the answer
    reply = await _sealion_completion(
        [
            {
                "role": "system",
                "content": (
                    "You are AskVox, a safe educational AI tutor. "
                    "Explain clearly, be factual, and respond in plain text suitable for TTS. "
                    "Do NOT use Markdown, asterisks, code fences, tables, or bullets."
                ),
            },
            {"role": "user", "content": auto_q},
        ],
        temperature=0.3,
        max_tokens=600,
    )

    if reply:
        supabase.table("chat_messages").insert({
            "session_id": session_id,
            "user_id": req.user_id,
            "role": "assistant",
            "content": reply,
            "display_name": "AskVox",
        }).execute()

    return {"session_id": session_id, "domain": domain, "topic": topic}
