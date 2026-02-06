"""
AskVox SmartRec - Domain-aware recommendation engine
- Uses YOUR RunPod-hosted Llama model for topic generation
- Reads detected_domain from queries table (set by domain_classifier)
- Generates query-anchored topic suggestions
"""
import json
import os
import asyncio
import time
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv
from supabase import create_client, Client
from app.services.domain_classifier import validate_domain  # ✅ Import domain validation

router = APIRouter(prefix="/smartrec", tags=["smartrec"])
load_dotenv()

# ✅ RUNPOD LLAMA CONFIGURATION (UPDATED FOR YOUR SETUP)
# Back-compat: direct HTTP endpoint (OpenAI-compatible or custom)
LLAMA_RUNPOD_URL = os.getenv("LLAMA_RUNPOD_URL", "").strip().rstrip("/")

# RunPod Serverless (job-mode), as used by MultimodalLlamachat.py
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "").strip()
RUNPOD_AUTH_HEADER = os.getenv("RUNPOD_AUTH_HEADER", "Authorization").strip()
RUNPOD_RUN_ENDPOINT = os.getenv("RUNPOD_RUN_ENDPOINT", "").strip()
RUNPOD_STATUS_ENDPOINT = os.getenv("RUNPOD_STATUS_ENDPOINT", "").strip()
RUNPOD_MAX_WAIT_SEC = float(os.getenv("RUNPOD_MAX_WAIT_SEC", "180"))
RUNPOD_POLL_INTERVAL_SEC = float(os.getenv("RUNPOD_POLL_INTERVAL_SEC", "1.5"))

# Optional identifier for OpenAI-compatible shims
LLAMA_MODEL_NAME = os.getenv("LLAMA_MODEL_NAME", "meta-llama/Llama-3-8b-chat-hf")

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
    "Technology": "Technology",
    "Health & Wellness": "Health & Wellness",
    # legacy / variants
    "History": "History and World Events",
    "History & World Events": "History and World Events",
    "Cooking": "Cooking & Food",
    "Astronomy & Space": "Astronomy",
    "Geography": "Geography and Travel",
    "Travel": "Geography and Travel",
    "Geography & Travel": "Geography and Travel",
    "Art/Music/Literature": "Art, Music and Literature",
    "Art, Music & Literature": "Art, Music and Literature",
    "general": "general",
}
ALLOWED_DOMAINS = set(DOMAIN_CANONICAL.values())

TOPICS_PER_DOMAIN = 1
GEN_POOL_PER_DOMAIN = 14
RECENT_SERVE_LOOKBACK_DAYS = 14


class GenerateReq(BaseModel):
    user_id: str
    history_limit: int = 30


class GenerateProfileReq(BaseModel):
    user_id: str
    limit: int = 80


class ClickReq(BaseModel):
    user_id: str
    recommendation_id: str


def _require_env():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Missing SUPABASE credentials in .env")
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not initialized")
    if not (LLAMA_RUNPOD_URL or RUNPOD_RUN_ENDPOINT):
        raise HTTPException(
            status_code=500,
            detail="No Llama endpoint configured: set LLAMA_RUNPOD_URL (direct) or RUNPOD_RUN_ENDPOINT (job-mode) in .env",
        )
    if RUNPOD_RUN_ENDPOINT and not RUNPOD_API_KEY:
        # Job-mode requires auth in your MultimodalLlamachat setup
        raise HTTPException(status_code=500, detail="RUNPOD_API_KEY missing")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canon_domain(d: str | None) -> str:
    raw = (d or "general").strip()
    return DOMAIN_CANONICAL.get(raw, "general")


# ✅ UPDATED: RunPod Llama API Integration
async def _runpod_llama_completion(messages: list[dict], temperature: float = 0.55, max_tokens: int = 450) -> str:
    """
    Call your RunPod-hosted Llama model.
    Handles both OpenAI-compatible endpoints and custom RunPod endpoints.
    """
    # Preferred: RunPod serverless job-mode (matches MultimodalLlamachat.py)
    if RUNPOD_RUN_ENDPOINT:
        prompt_lines: list[str] = []
        for m in messages or []:
            if not isinstance(m, dict):
                continue
            role = (m.get("role") or "user").upper()
            content = m.get("content")
            if content is None:
                continue
            if not isinstance(content, str):
                content = str(content)
            content = content.strip()
            if not content:
                continue
            prompt_lines.append(f"{role}: {content}")
        prompt_lines.append("ASSISTANT:")
        prompt = "\n".join(prompt_lines)

        headers = {RUNPOD_AUTH_HEADER or "Authorization": f"Bearer {RUNPOD_API_KEY}"}
        payload = {"input": {"prompt": prompt, "stop": ["<|eot_id|>"]}}

        try:
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
            immediate_output = (run_data.get("output") or {}).get("response") or run_data.get("response")
            if immediate_output:
                return str(immediate_output).strip()
            raise HTTPException(status_code=502, detail="RunPod /run response missing job id")

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
            if status == "COMPLETED":
                out = st_data.get("output") or {}
                if isinstance(out, dict):
                    ans = out.get("response") or out.get("answer") or out.get("reply")
                    if ans:
                        return str(ans).strip()
                if isinstance(out, str) and out:
                    return out.strip()
                ans2 = st_data.get("response") or st_data.get("answer") or st_data.get("reply")
                if ans2:
                    return str(ans2).strip()
                raise HTTPException(status_code=502, detail="RunPod status completed but no output.response")
            if status in {"FAILED", "ERROR", "CANCELLED"}:
                raise HTTPException(status_code=502, detail=f"RunPod job {status}")

            await asyncio.sleep(RUNPOD_POLL_INTERVAL_SEC)

        raise HTTPException(status_code=504, detail=f"RunPod job timed out (last_status={last_status})")

    # Back-compat: direct HTTP endpoint
    if not LLAMA_RUNPOD_URL:
        raise HTTPException(status_code=500, detail="LLAMA_RUNPOD_URL is not configured")
    
    headers = {
        "Content-Type": "application/json",
    }
    
    # Add API key if configured (some direct endpoints use X-API-Key)
    if RUNPOD_API_KEY:
        headers["X-API-Key"] = RUNPOD_API_KEY  # Standard RunPod header
    
    # Detect endpoint type from URL
    is_openai_compatible = "/v1/chat/completions" in LLAMA_RUNPOD_URL.lower()
    
    if is_openai_compatible:
        # OpenAI-compatible format (vLLM, Text Generation Inference with OpenAI shim)
        payload = {
            "model": LLAMA_MODEL_NAME,
            "messages": messages,
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
            "stream": False,
        }
    else:
        # Custom RunPod endpoint format (common pattern)
        # Adjust based on your RunPod endpoint's expected payload
        payload = {
            "input": {
                "messages": messages,
                "parameters": {
                    "temperature": float(temperature),
                    "max_new_tokens": int(max_tokens),
                    "do_sample": True,
                    "top_p": 0.9,
                    "repetition_penalty": 1.1,
                }
            }
        }
    
    try:
        async with httpx.AsyncClient(timeout=90) as client:  # Longer timeout for Llama
            res = await client.post(LLAMA_RUNPOD_URL, headers=headers, json=payload)
            res.raise_for_status()
            data = res.json()
    except httpx.HTTPError as e:
        detail = f"{e}"
        try:
            if res.status_code == 401:
                detail += " | Authentication failed (check RUNPOD_API_KEY)"
            elif res.status_code == 404:
                detail += " | Endpoint not found (check LLAMA_RUNPOD_URL)"
            elif res.status_code == 422:
                detail += " | Invalid payload format"
            detail += f" | status={res.status_code}, response={res.text[:500]}"
        except Exception:
            pass
        raise HTTPException(
            status_code=502,
            detail=f"RunPod Llama request failed: {detail}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error calling RunPod: {str(e)}"
        )
    
    # Parse response based on endpoint type
    try:
        if is_openai_compatible:
            # OpenAI format: choices[0].message.content
            return data["choices"][0]["message"]["content"].strip()
        else:
            # Common RunPod custom endpoint formats
            if "output" in data and "response" in data["output"]:
                return data["output"]["response"].strip()
            elif "generated_text" in data:
                return data["generated_text"].strip()
            elif "text" in data:
                return data["text"].strip()
            elif isinstance(data, str):
                return data.strip()
            else:
                # Fallback: try to find any text field
                print(f"⚠️ Unrecognized RunPod response format: {list(data.keys())}")
                return str(data).strip()
    except (KeyError, IndexError, TypeError) as e:
        print(f"❌ Error parsing RunPod response: {e}")
        print(f"   Response keys: {data.keys() if isinstance(data, dict) else 'N/A'}")
        print(f"   Full response: {data}")
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
    by_dom: dict[str, list[dict]] = {}
    for r in active_rows:
        dom = r.get("domain") or "general"
        by_dom.setdefault(dom, []).append({"id": r.get("id"), "topic": r.get("topic")})
    
    out = []
    for d in sorted(by_dom.keys()):
        out.append({"domain": d, "topics": by_dom[d][:TOPICS_PER_DOMAIN]})
    return out


# --------------------- SUPABASE HELPERS (UNCHANGED) ---------------------
# [All helper functions remain exactly as in your original code]
# _get_latest_query, _get_user_domains_profile, _get_clicked_topics, 
# _get_active_rows, _get_active_topics_for_domain, _get_recently_served_topics,
# _dismiss_active_for_user, _insert_active_topics, _get_domain_history_for_prompt
# (Copy these directly from your existing smartrec.py - no changes needed)

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
    res = (
        supabase.table("recommendations")
        .select("id, domain, topic, clicked_at, dismissed_at, created_at")
        .eq("user_id", user_id)
        .is_("clicked_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []
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
            dt = datetime.fromisoformat(ca.replace("Z", "+00:00")) if isinstance(ca, str) else None
        except Exception:
            dt = None
        
        if dt is None or dt >= cutoff:
            out.add(t.lower())
    return out


def _dismiss_active_for_user(user_id: str):
    try:
        supabase.table("recommendations").update({"dismissed_at": _utc_now_iso()})\
            .eq("user_id", user_id).is_("clicked_at", "null").is_("dismissed_at", "null").execute()
    except Exception:
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


# --------------------- TOPIC GENERATION (Uses RunPod Llama) ---------------------

async def _gen_topics_for_domain_query_anchored(user_id: str, domain: str, latest_query_text: str, history: list[dict], need: int) -> list[str]:
    """
    Generate topics using YOUR RunPod-hosted Llama model
    """
    clicked = _get_clicked_topics(user_id, domain)
    active = _get_active_topics_for_domain(user_id, domain)
    recent = _get_recently_served_topics(user_id, domain)
    
    # ✅ SYSTEM PROMPT for Llama (optimized for RunPod)
    system_prompt = f"""You are AskVox SmartRec, an AI that generates educational topic suggestions.
Return ONLY valid JSON in this exact format: {{"topics": ["topic 1", "topic 2", ...]}}

CRITICAL RULES:
- Generate topics that are "next things to learn" after the user's query
- Topics MUST stay STRICTLY within the "{domain}" domain
- Return exactly {GEN_POOL_PER_DOMAIN} topics
- Each topic: 3-8 words
- Make topics specific and actionable (e.g., "How solar flares affect Earth's magnetic field")
- Do NOT repeat the user's exact wording
- NO generic topics like "Basics of X" or "Introduction to Y"
- Mix variety: techniques, comparisons, common mistakes, troubleshooting, creative applications
- Avoid punctuation-heavy titles (no colons, semicolons, or excessive commas)
- If unsure, skip the topic rather than risk irrelevance"""
    
    user_prompt = f"""USER'S CONTEXT:
Detected domain: "{domain}"
Latest query: "{latest_query_text}"

Recent queries in this domain (newest first):
{json.dumps(history[:12], ensure_ascii=False, indent=2)}

TASK:
Generate exactly {GEN_POOL_PER_DOMAIN} topic suggestions that feel like natural "what to learn next" extensions.
Return ONLY the JSON object with "topics" array. NO other text."""
    
    raw = await _runpod_llama_completion(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.7,  # Slightly higher for creativity
        max_tokens=500,
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
        
        # Filter repeats and invalid topics
        if key in seen or key in clicked or key in active or key in recent:
            continue
        
        wcount = len(tt.split())
        if wcount < 3 or wcount > 8:
            continue
        
        # Additional quality filters
        if tt.startswith(("What is", "How to", "Why does", "Explain")):
            continue  # Too question-like
        if any(bad in tt.lower() for bad in ["basics", "introduction", "overview", "101", "guide"]):
            continue
        
        seen.add(key)
        out.append(tt)
        if len(out) >= need:
            break
    
    return out


async def _ensure_topics_for_domain(user_id: str, domain: str, latest_query_text: str, history_limit: int):
    current = (
        supabase.table("recommendations")
        .select("id, topic, dismissed_at, clicked_at")
        .eq("user_id", user_id)
        .eq("domain", domain)
        .is_("clicked_at", "null")
        .execute()
    ).data or []
    
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


async def _smartrec_click_background(user_id: str, session_id: str, auto_q: str, domain: str, latest_text: str):
    """Run slow work for /smartrec/click after the HTTP response is returned."""
    # Refill topic in same domain (uses Llama)
    try:
        await _ensure_topics_for_domain(user_id, domain, latest_text, 25)
    except Exception:
        pass

    # Generate assistant reply (uses Llama)
    try:
        reply = await _runpod_llama_completion(
            [
                {
                    "role": "system",
                    "content": (
                        "You are AskVox, a safe educational AI tutor. "
                        "Explain clearly, be factual, and respond in plain text suitable for TTS. "
                        "Do NOT use Markdown, asterisks, code fences, tables, or bullets. "
                        "Keep responses concise (2-4 sentences) and focused on education."
                    ),
                },
                {"role": "user", "content": auto_q},
            ],
            temperature=0.3,
            max_tokens=600,
        )
    except Exception:
        reply = ""

    if reply:
        try:
            supabase.table("chat_messages").insert({
                "session_id": session_id,
                "user_id": user_id,
                "role": "assistant",
                "content": reply,
                "display_name": "AskVox",
            }).execute()
        except Exception:
            pass


# --------------------- ROUTES (UPDATED) ---------------------

@router.post("/generate")
async def generate(req: GenerateReq):
    """
    Generate SmartRec topics for user's latest query domain
    - Uses detected_domain from queries table (set by domain_classifier)
    - Generates topics with YOUR RunPod-hosted Llama model
    """
    _require_env()  # Now checks RunPod config too
    
    latest = _get_latest_query(req.user_id)
    if not latest:
        return {"domains": []}
    
    domain = latest["domain"]
    latest_text = latest["text"]
    
    # Validate domain (security)
    if not validate_domain(domain):
        raise HTTPException(status_code=400, detail=f"Invalid domain: {domain}")
    
    # Refresh: dismiss active recs to avoid repeats
    _dismiss_active_for_user(req.user_id)
    
    await _ensure_topics_for_domain(req.user_id, domain, latest_text, req.history_limit)
    
    active_rows = _get_active_rows(req.user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") == domain]
    return {"domains": _group_domains(active_rows)}


@router.get("/list")
def list_recommendations(user_id: str):
    """List current active topics for latest domain"""
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
    """Generate topics for multiple domains user asked about recently"""
    _require_env()
    
    domains = _get_user_domains_profile(req.user_id, req.limit)
    if not domains:
        return {"domains": []}
    
    _dismiss_active_for_user(req.user_id)
    
    for dom in domains:
        hist = _get_domain_history_for_prompt(req.user_id, dom, 20)
        if not hist:
            continue
        latest_text = hist[0]["text"]
        await _ensure_topics_for_domain(req.user_id, dom, latest_text, 25)
    
    active_rows = _get_active_rows(req.user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") in set(domains)]
    return {"domains": _group_domains(active_rows)}


@router.post("/click")
async def click(req: ClickReq, background_tasks: BackgroundTasks):
    """Handle topic click - create chat session, then generate response asynchronously"""
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
    
    # Mark clicked permanently
    supabase.table("recommendations").update({"clicked_at": _utc_now_iso()}).eq("id", rec["id"]).execute()

    # Prepare refill context (but don't run generation yet)
    hist = _get_domain_history_for_prompt(req.user_id, domain, 25)
    latest_text = hist[0]["text"] if hist else topic

    # Create chat session FIRST (so UI can navigate even if model is slow)
    auto_q = _auto_query(domain, topic)
    
    sess_res = supabase.table("chat_sessions").insert({"user_id": req.user_id, "title": f"{topic[:30]}..."}).execute()
    session_row = (sess_res.data or [None])[0]
    if not session_row or not session_row.get("id"):
        raise HTTPException(status_code=500, detail="Failed to create chat session")
    session_id = session_row["id"]
    
    # Save query with detected_domain
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

    # Return immediately; generate reply + refill in the background.
    background_tasks.add_task(
        _smartrec_click_background,
        req.user_id,
        session_id,
        auto_q,
        domain,
        latest_text,
    )
    
    # Return updated active list for the latest domain
    active_rows = _get_active_rows(req.user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") == domain]
    return {
        "session_id": session_id,
        "domain": domain,
        "topic": topic,
        "pending_reply": True,
        "domains": _group_domains(active_rows),
    }

@router.get("/list_profile")
def list_profile(user_id: str, limit: int = 200):
    """List active topics for all domains user asked about recently"""
    _require_env()
    
    domains = _get_user_domains_profile(user_id, limit)
    if not domains:
        return {"domains": []}
    
    active_rows = _get_active_rows(user_id)
    active_rows = [r for r in active_rows if (r.get("domain") or "general") in set(domains)]
    return {"domains": _group_domains(active_rows)}


@router.get("/domains")
def get_domains():
    """Get list of all supported domains"""
    return {"domains": sorted(list(ALLOWED_DOMAINS))}