"""
AskVox SmartRec (rewritten)
- Domain cards + topics are STRICTLY based on the user's latest query + detected domain
- Topics are generated as "next things to learn" (query-anchored expansions)
- Refresh generates genuinely new topics by avoiding:
  1) clicked topics
  2) currently active topics
  3) recently served topics (even if not clicked) within a lookback window

NOTE (recommended DB tweak):
To avoid repeating topics across refresh, we should NOT hard-delete active recs.
Instead, we "expire" them by setting dismissed_at.

Run this once in Supabase SQL editor:
  alter table public.recommendations
  add column if not exists dismissed_at timestamptz null;

If you don't add dismissed_at, the code will fallback to deleting active recs (less good).
"""

import json
import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv
from supabase import create_client, Client

router = APIRouter(prefix="/smartrec", tags=["smartrec"])
load_dotenv()

GEMINI_BASE_URL = os.getenv(
    "GEMINI_BASE_URL",
    "https://generativelanguage.googleapis.com/v1beta"
).rstrip("/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

supabase: Client | None = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)



# --- DOMAIN NORMALIZATION (match your UI options exactly) ---
DOMAIN_CANONICAL = {
    # exact UI domains
    "Science": "Science",
    "History and World Events": "History and World Events",
    "Current Affairs": "Current Affairs",
    "Sports": "Sports",
    "Cooking & Food": "Cooking & Food",
    "Astronomy": "Astronomy",
    "Geography and Travel": "Geography and Travel",
    "Art, Music and Literature": "Art, Music and Literature",
    # legacy / variants
    "History": "History and World Events",
    "History & World Events": "History and World Events",
    "Cooking": "Cooking & Food",
    "Astronomy & Space": "Astronomy",
    "Geography & Travel": "Geography and Travel",
    "Art/Music/Literature": "Art, Music and Literature",
    "Art, Music & Literature": "Art, Music and Literature",
    "general": "general",
}
ALLOWED_DOMAINS = set(DOMAIN_CANONICAL.values())

TOPICS_PER_DOMAIN = 1         # what you show per domain
GEN_POOL_PER_DOMAIN = 14        # ask model for more, then filter
RECENT_SERVE_LOOKBACK_DAYS = 14 # avoid repeating served topics across refresh


class GenerateReq(BaseModel):
    user_id: str
    # how many recent queries to use as context for the model (same-domain only)
    history_limit: int = 30


class GenerateProfileReq(BaseModel):
    user_id: str
    # generate for multiple domains user asked about recently (profile mode)
    limit: int = 80


class ClickReq(BaseModel):
    user_id: str
    recommendation_id: str


def _require_env():
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY in .env")
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not initialized")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canon_domain(d: str | None) -> str:
    raw = (d or "general").strip()
    return DOMAIN_CANONICAL.get(raw, "general")


async def _gemini_completion(messages: list[dict], temperature: float = 0.55, max_tokens: int = 450) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY in .env")

    # If GEMINI_BASE_URL is already the full generateContent endpoint, DO NOT append anything.
    endpoint = f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent"  # e.g. https://.../v1beta/models/gemini-2.0-flash:generateContent

    # Gemini uses X-goog-api-key (or ?key=)
    headers = {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY,
    }

    # Convert OpenAI-like messages -> Gemini contents
    # Gemini roles are typically "user" and "model".
    contents = []
    system_texts = []

    for m in messages:
        role = (m.get("role") or "user").lower()
        text = (m.get("content") or "").strip()
        if not text:
            continue

        if role == "system":
            system_texts.append(text)
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": text}]})
        else:
            contents.append({"role": "user", "parts": [{"text": text}]})

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": float(temperature),
            "maxOutputTokens": int(max_tokens),
        },
    }

    # If you used system messages, attach them as systemInstruction (supported in v1beta)
    if system_texts:
        payload["systemInstruction"] = {"parts": [{"text": "\n".join(system_texts)}]}

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(endpoint, headers=headers, json=payload)
            res.raise_for_status()
            data = res.json()
    except httpx.HTTPError as e:
        # If Google returns useful JSON error, include it
        detail = str(e)
        try:
            detail += f" | body={res.text}"
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"Gemini request failed: {detail}")

    # Extract text from Gemini response
    # Typical shape: candidates[0].content.parts[0].text
    try:
        return (data["candidates"][0]["content"]["parts"][0]["text"]).strip()
    except Exception:
        return ""


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
            return json.loads(t[a : b + 1])
        except Exception:
            return {}
    return {}


def _auto_query(domain: str, topic: str) -> str:
    return (
        f"Teach me about {topic} in the {domain} domain. "
        f"Give a simple definition and key facts."
    )


def _group_domains(active_rows: list[dict]) -> list[dict]:
    """
    Return:
    [{"domain":"Cooking & Food","topics":[{"id":"...","topic":"..."}, ...]}]
    """
    by_dom: dict[str, list[dict]] = {}
    for r in active_rows:
        dom = r.get("domain") or "general"
        by_dom.setdefault(dom, []).append({"id": r.get("id"), "topic": r.get("topic")})

    # Keep stable order (only 1 domain in query-mode, but still fine)
    out = []
    for d in sorted(by_dom.keys()):
        out.append({"domain": d, "topics": by_dom[d][:TOPICS_PER_DOMAIN]})
    return out


# --------------------- SUPABASE HELPERS ---------------------

def _get_latest_query(user_id: str) -> dict | None:
    qres = (
        supabase.table("queries")
        .select("transcribed_text, detected_domain, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = qres.data or []
    if not rows:
        return None
    r = rows[0]
    txt = (r.get("transcribed_text") or "").strip()
    dom = _canon_domain(r.get("detected_domain"))
    if not txt:
        return None
    return {"text": txt, "domain": dom, "created_at": r.get("created_at")}


def _get_user_domains_profile(user_id: str, limit: int) -> list[str]:
    """
    Profile mode: domains user asked about recently (unique)
    """
    qres = (
        supabase.table("queries")
        .select("detected_domain, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = qres.data or []
    seen = set()
    domains = []
    for r in rows:
        dom = _canon_domain(r.get("detected_domain"))
        if dom not in ALLOWED_DOMAINS:
            dom = "general"
        if dom not in seen:
            seen.add(dom)
            domains.append(dom)
    return domains


def _get_clicked_topics(user_id: str, domain: str) -> set[str]:
    res = (
        supabase.table("recommendations")
        .select("topic, clicked_at")
        .eq("user_id", user_id)
        .eq("domain", domain)
        .not_.is_("clicked_at", "null")
        .execute()
    )
    return {((r.get("topic") or "").strip().lower()) for r in (res.data or []) if (r.get("topic") or "").strip()}


def _get_active_rows(user_id: str) -> list[dict]:
    # Active = not clicked and not dismissed (if column exists, we filter below safely)
    # We'll fetch a bit wider and filter in Python if needed.
    res = (
        supabase.table("recommendations")
        .select("id, domain, topic, clicked_at, dismissed_at, created_at")
        .eq("user_id", user_id)
        .is_("clicked_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []
    # keep only not dismissed
    return [r for r in rows if r.get("dismissed_at") is None]


def _get_active_topics_for_domain(user_id: str, domain: str) -> set[str]:
    res = (
        supabase.table("recommendations")
        .select("topic, dismissed_at, clicked_at")
        .eq("user_id", user_id)
        .eq("domain", domain)
        .is_("clicked_at", "null")
        .execute()
    )
    rows = res.data or []
    return {
        ((r.get("topic") or "").strip().lower())
        for r in rows
        if (r.get("topic") or "").strip() and r.get("dismissed_at") is None
    }


def _get_recently_served_topics(user_id: str, domain: str, lookback_days: int = RECENT_SERVE_LOOKBACK_DAYS) -> set[str]:
    """
    Topics served recently (clicked OR not clicked), to avoid repeat across refresh.
    Requires NOT deleting history rows. Works best with dismissed_at approach.
    """
    # fetch last N rows and filter by created_at cutoff
    res = (
        supabase.table("recommendations")
        .select("topic, created_at")
        .eq("user_id", user_id)
        .eq("domain", domain)
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    rows = res.data or []
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    out = set()
    for r in rows:
        t = (r.get("topic") or "").strip()
        if not t:
            continue
        ca = r.get("created_at")
        try:
            # supabase returns ISO; Python can parse via fromisoformat in most cases
            dt = datetime.fromisoformat(ca.replace("Z", "+00:00")) if isinstance(ca, str) else None
        except Exception:
            dt = None

        # If can't parse, still include to be safe (prevents repeats)
        if dt is None or dt >= cutoff:
            out.add(t.lower())
    return out


def _dismiss_active_for_user(user_id: str):
    """
    Refresh behavior:
    - Best: set dismissed_at for all currently active rows (keeps history to prevent repeats)
    - Fallback: delete active rows if dismissed_at column doesn't exist
    """
    try:
        # If dismissed_at column exists, this update works.
        supabase.table("recommendations").update({"dismissed_at": _utc_now_iso()})\
            .eq("user_id", user_id).is_("clicked_at", "null").is_("dismissed_at", "null").execute()
    except Exception:
        # fallback: old behavior
        supabase.table("recommendations").delete().eq("user_id", user_id).is_("clicked_at", "null").execute()


def _insert_active_topics(user_id: str, domain: str, topics: list[str]):
    if not topics:
        return
    payload = [{
        "user_id": user_id,
        "domain": domain,
        "topic": t,
        "clicked_at": None,
        "dismissed_at": None,
    } for t in topics]
    supabase.table("recommendations").insert(payload).execute()


def _get_domain_history_for_prompt(user_id: str, domain: str, limit: int) -> list[dict]:
    qres = (
        supabase.table("queries")
        .select("transcribed_text, detected_domain, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(max(10, limit))
        .execute()
    )
    rows = qres.data or []
    out = []
    for r in rows:
        dom = _canon_domain(r.get("detected_domain"))
        if dom != domain:
            continue
        txt = (r.get("transcribed_text") or "").strip()
        if txt:
            out.append({"text": txt, "domain": dom, "created_at": r.get("created_at")})
        if len(out) >= limit:
            break
    return out


# --------------------- TOPIC GENERATION ---------------------

async def _gen_topics_for_domain_query_anchored(user_id: str, domain: str, latest_query_text: str, history: list[dict], need: int) -> list[str]:
    """
    Generate topics strictly within domain, inspired by latest_query_text.
    Filters out clicked, active, and recently served topics.
    """
    clicked = _get_clicked_topics(user_id, domain)
    active = _get_active_topics_for_domain(user_id, domain)
    recent = _get_recently_served_topics(user_id, domain)

    prompt = f"""
You are AskVox SmartRec.
Return ONLY valid JSON.

Detected domain: "{domain}"
User's latest query in this domain:
"{latest_query_text}"

Task:
Generate topic suggestions that feel like "next things to learn" after the query.
They MUST be strongly related to the query AND remain STRICTLY within "{domain}".

Return format:
{{"topics":[...] }}

Constraints:
- Return exactly {GEN_POOL_PER_DOMAIN} topics
- Each topic: 3–8 words
- Make topics specific, not generic
- Do NOT repeat the user's exact wording
- No "Basics / Introduction / Overview" style topics
- Avoid punctuation-heavy titles
- Mix variety: techniques, comparisons, mistakes, troubleshooting, creative variations

Context (recent queries in this domain, newest first):
{json.dumps(history[:12], ensure_ascii=False)}
""".strip()

    raw = await _gemini_completion(
        [
            {"role": "system", "content": "Return JSON only."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.6,
        max_tokens=450,
    )

    parsed = _safe_parse_json(raw)
    topics = parsed.get("topics") or []

    out: list[str] = []
    seen = set()

    for t in topics:
        if not isinstance(t, str):
            continue
        tt = t.strip()
        if not tt:
            continue
        key = tt.lower()

        # Filter repeats
        if key in seen or key in clicked or key in active or key in recent:
            continue

        # Prevent too-short / too-long titles
        wcount = len(tt.split())
        if wcount < 3 or wcount > 8:
            continue

        seen.add(key)
        out.append(tt)
        if len(out) >= need:
            break

    return out


async def _ensure_topics_for_domain(user_id: str, domain: str, latest_query_text: str, history_limit: int):
    """
    Ensure TOPICS_PER_DOMAIN active topics exist for domain.
    """
    current = (
        supabase.table("recommendations")
        .select("id, topic, dismissed_at, clicked_at")
        .eq("user_id", user_id)
        .eq("domain", domain)
        .is_("clicked_at", "null")
        .execute()
    ).data or []

    # active = clicked_at is null AND dismissed_at is null
    active_current = [r for r in current if r.get("dismissed_at") is None]
    missing = TOPICS_PER_DOMAIN - len(active_current)
    if missing <= 0:
        return

    history = _get_domain_history_for_prompt(user_id, domain, history_limit)

    new_topics = await _gen_topics_for_domain_query_anchored(
        user_id=user_id,
        domain=domain,
        latest_query_text=latest_query_text,
        history=history,
        need=missing,
    )
    _insert_active_topics(user_id, domain, new_topics)


# --------------------- ROUTES ---------------------

@router.post("/generate")
async def generate(req: GenerateReq):
    """
    Query-mode (what you asked for):
    - Domain shown MUST be based on the user's latest query detected domain
    - Topics MUST be based on domain + latest query
    - Refresh always generates a new list
    """
    _require_env()

    latest = _get_latest_query(req.user_id)
    if not latest:
        return {"domains": []}

    domain = latest["domain"]
    latest_text = latest["text"]

    # refresh behavior: dismiss active recs (keep history) so we can avoid repeats
    _dismiss_active_for_user(req.user_id)

    await _ensure_topics_for_domain(req.user_id, domain, latest_text, req.history_limit)

    active_rows = _get_active_rows(req.user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") == domain]
    return {"domains": _group_domains(active_rows)}


@router.get("/list")
def list_recommendations(user_id: str):
    """
    List current active topics for the LATEST domain.
    (Keeps frontend consistent with query-mode.)
    """
    _require_env()

    latest = _get_latest_query(user_id)
    if not latest:
        return {"domains": []}

    domain = latest["domain"]
    active_rows = _get_active_rows(user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") == domain]
    return {"domains": _group_domains(active_rows)}


@router.post("/generate_profile")
async def generate_profile(req: GenerateProfileReq):
    """
    Optional: profile mode
    - generate topics for multiple domains user asked about recently
    - still query-anchored per domain (uses most recent query in that domain)
    """
    _require_env()

    domains = _get_user_domains_profile(req.user_id, req.limit)
    if not domains:
        return {"domains": []}

    _dismiss_active_for_user(req.user_id)

    for dom in domains:
        # need a latest query for this domain
        # grab from recent queries
        hist = _get_domain_history_for_prompt(req.user_id, dom, 20)
        if not hist:
            continue
        latest_text = hist[0]["text"]
        await _ensure_topics_for_domain(req.user_id, dom, latest_text, 25)

    active_rows = _get_active_rows(req.user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") in set(domains)]
    return {"domains": _group_domains(active_rows)}


@router.post("/click")
async def click(req: ClickReq):
    """
    Click behavior:
    - marks clicked_at permanently
    - immediately refills 1 new topic in same domain (still query-anchored)
    - creates a chat session and pushes the auto query into queries/chat_messages
    """
    _require_env()

    rec_res = (
        supabase.table("recommendations")
        .select("id, domain, topic, clicked_at, dismissed_at")
        .eq("id", req.recommendation_id)
        .eq("user_id", req.user_id)
        .single()
        .execute()
    )
    rec = rec_res.data
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    domain = _canon_domain(rec.get("domain"))
    topic = rec.get("topic") or ""

    # mark clicked permanently
    supabase.table("recommendations").update({"clicked_at": _utc_now_iso()}).eq("id", rec["id"]).execute()

    # refill: anchor to latest query in this domain (if none, anchor to clicked topic text)
    hist = _get_domain_history_for_prompt(req.user_id, domain, 25)
    latest_text = hist[0]["text"] if hist else topic

    await _ensure_topics_for_domain(req.user_id, domain, latest_text, 25)

    # existing behavior: create chat session + messages
    auto_q = _auto_query(domain, topic)

    sess_res = supabase.table("chat_sessions").insert({"user_id": req.user_id, "title": f"{topic[:30]}..."}).execute()
    session_row = (sess_res.data or [None])[0]
    if not session_row or not session_row.get("id"):
        raise HTTPException(status_code=500, detail="Failed to create chat session")
    session_id = session_row["id"]

    supabase.table("queries").insert({
        "session_id": session_id,
        "user_id": req.user_id,
        "input_mode": "text",
        "transcribed_text": auto_q,
        "detected_domain": domain,
    }).execute()

    supabase.table("chat_messages").insert({
        "session_id": session_id,
        "user_id": req.user_id,
        "role": "user",
        "content": auto_q,
        "display_name": "User",
    }).execute()

    reply = await _gemini_completion(
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

    # return updated active list for the latest domain
    active_rows = _get_active_rows(req.user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") == domain]
    return {
        "session_id": session_id,
        "domain": domain,
        "topic": topic,
        "domains": _group_domains(active_rows),
    }

@router.get("/list_profile")
def list_profile(user_id: str, limit: int = 200):
    """
    Profile list mode (NO model call):
    - shows active topics for ALL domains the user asked about recently
    - does not generate anything
    """
    _require_env()

    domains = _get_user_domains_profile(user_id, limit)
    if not domains:
        return {"domains": []}

    active_rows = _get_active_rows(user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") in set(domains)]
    return {"domains": _group_domains(active_rows)}