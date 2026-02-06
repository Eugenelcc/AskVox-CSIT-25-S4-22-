import os
import json
import asyncio
import time
import logging
import httpx
from contextvars import ContextVar
from typing import Literal, List, Optional, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Per-request override so you can switch providers without changing .env.
_quiz_provider_override: ContextVar[str | None] = ContextVar("quiz_provider_override", default=None)


def _normalize_quiz_provider(provider: str | None) -> str | None:
    if provider is None:
        return None
    v = str(provider).strip().lower()
    if not v:
        return None
    if v in {"llama", "runpod", "llama_runpod", "llama-runpod", "llama_runpod_default"}:
        return "llama_runpod"
    if v in {"gemini", "gemni"}:
        return "gemini"
    return None

router = APIRouter(prefix="/quiz", tags=["quiz"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
API_BASE_LOCAL = os.getenv("API_BASE_LOCAL", "http://localhost:8000").rstrip("/")

# --- Gemini config ---
GEMINI_BASE_URL = os.getenv(
    "GEMINI_BASE_URL",
    "https://generativelanguage.googleapis.com/v1beta"
).rstrip("/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# --- RunPod Llama config (shared with SmartRec/Multimodal chat) ---
# Direct HTTP endpoint (OpenAI-compatible or custom)
LLAMA_RUNPOD_URL = os.getenv("LLAMA_RUNPOD_URL", "").strip().rstrip("/")

# RunPod Serverless job-mode
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "").strip()
RUNPOD_AUTH_HEADER = os.getenv("RUNPOD_AUTH_HEADER", "Authorization").strip()
RUNPOD_RUN_ENDPOINT = os.getenv("RUNPOD_RUN_ENDPOINT", "").strip()
RUNPOD_STATUS_ENDPOINT = os.getenv("RUNPOD_STATUS_ENDPOINT", "").strip()
RUNPOD_MAX_WAIT_SEC = float(os.getenv("RUNPOD_MAX_WAIT_SEC", "180"))
RUNPOD_POLL_INTERVAL_SEC = float(os.getenv("RUNPOD_POLL_INTERVAL_SEC", "1.5"))

# Optional identifier for OpenAI-compatible shims
LLAMA_MODEL_NAME = os.getenv("LLAMA_MODEL_NAME", "meta-llama/Llama-3-8b-chat-hf")

# Choose provider: default to RunPod Llama; Gemini is optional/fallback.
# Back-compat: accepts QUIZ_PROVIDER or QUIZ_LLM_PROVIDER
QUIZ_PROVIDER = (
    os.getenv("QUIZ_PROVIDER")
    or os.getenv("QUIZ_LLM_PROVIDER")
    or "llama_runpod"
).lower().strip()

# Print provider + prompt preview for quick verification
QUIZ_PRINT_PROMPT = os.getenv("QUIZ_PRINT_PROMPT", "1").strip() in ("1", "true", "yes", "on")
QUIZ_PROMPT_PREVIEW_CHARS = int(os.getenv("QUIZ_PROMPT_PREVIEW_CHARS", "900"))

# Startup log toggle
QUIZ_STARTUP_LOG = os.getenv("QUIZ_STARTUP_LOG", "1").strip() in ("1", "true", "yes", "on")

# Verifier toggle (you usually want this ON)
VERIFY_ANSWERS = os.getenv("QUIZ_VERIFY", "1").strip() in ("1", "true", "yes", "on")

QuizMode = Literal["A", "B", "C"]


def _log_quiz_provider_startup() -> None:
    if not QUIZ_STARTUP_LOG:
        return

    default_provider = _normalize_quiz_provider(QUIZ_PROVIDER) or "llama_runpod"

    runpod_configured = bool(RUNPOD_RUN_ENDPOINT) and bool(RUNPOD_API_KEY)
    gemini_configured = bool(GEMINI_API_KEY)

    msg = (
        "[QUIZ_STARTUP] "
        f"default_provider={default_provider} "
        f"(QUIZ_PROVIDER={QUIZ_PROVIDER!r}) "
        f"runpod_job_mode={'on' if runpod_configured else 'off'} "
        f"runpod_run_endpoint_set={'yes' if bool(RUNPOD_RUN_ENDPOINT) else 'no'} "
        f"gemini_key_set={'yes' if gemini_configured else 'no'} "
        f"gemini_model={GEMINI_MODEL}"
    )

    # stdout print for quick visibility in dev + log for deployments
    print(msg)
    logger.info(msg)

    if default_provider == "gemini" and not gemini_configured:
        warn = "[QUIZ_STARTUP] WARNING: default_provider=gemini but GEMINI_API_KEY is not set"
        print(warn)
        logger.warning(warn)
    if default_provider == "llama_runpod" and not runpod_configured:
        warn = "[QUIZ_STARTUP] WARNING: default_provider=llama_runpod but RUNPOD_RUN_ENDPOINT/RUNPOD_API_KEY not fully set"
        print(warn)
        logger.warning(warn)


try:
    _log_quiz_provider_startup()
except Exception:
    # Never fail import due to logging
    pass


class GenerateQuizReq(BaseModel):
    mode: QuizMode
    user_id: str
    session_id: Optional[str] = None
    topic: Optional[str] = None
    num_questions: int = 3
    # Optional: override model provider for THIS request: "llama_runpod" or "gemini".
    # (Also accepts "llama", "runpod", and common misspelling "gemni".)
    provider: Optional[str] = None
    # Optional: prevent repeats and request related variations for follow-up quizzes
    avoid_questions: Optional[List[str]] = None
    related: bool = False


class QuizQuestion(BaseModel):
    id: str
    q: str
    options: List[str]
    answerIndex: int


class GenerateQuizRes(BaseModel):
    title: str
    questions: List[QuizQuestion]
    quiz_id: Optional[str] = None  # stored Supabase quiz id (added for persistence)


# ---------- NEW: Feedback ----------
class QuizFeedbackReq(BaseModel):
    title: str
    questions: List[QuizQuestion]
    userAnswers: List[Optional[int]]  # same length as questions
    user_id: str                      # needed to store attempts under user
    quiz_id: Optional[str] = None     # pass quiz id if available
    # Optional: override provider for THIS feedback generation call
    provider: Optional[str] = None


class QuizFeedbackRes(BaseModel):
    strengths: List[str]
    weakAreas: List[str]
    recommended: str


# -------------------------
# Supabase helpers
# -------------------------
def _require_supabase():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        )


def _sb_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _safe_json_extract(text: str) -> dict:
    t = (text or "").strip()
    if not t:
        return {}
    try:
        return json.loads(t)
    except Exception:
        pass

    start = t.find("{")
    if start == -1:
        return {}

    depth = 0
    for i in range(start, len(t)):
        if t[i] == "{":
            depth += 1
        elif t[i] == "}":
            depth -= 1
            if depth == 0:
                chunk = t[start: i + 1]
                try:
                    return json.loads(chunk)
                except Exception:
                    return {}
    return {}


async def _fetch_queries(user_id: str, session_id: Optional[str], limit: int) -> List[dict]:
    """
    queries table: must include id uuid + transcribed_text + created_at + detected_domain + input_mode + session_id
    """
    _require_supabase()

    params = {
        "select": "id,transcribed_text,created_at,detected_domain,input_mode,session_id",
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if session_id:
        params["session_id"] = f"eq.{session_id}"

    timeout = httpx.Timeout(connect=15.0, read=30.0, write=15.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.get(f"{SUPABASE_URL}/rest/v1/queries", headers=_sb_headers(), params=params)
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Supabase queries fetch failed: {res.text[:200]}")
        return res.json() or []


# -------------------------
# Supabase persistence helpers (new)
# -------------------------
async def _sb_insert_quiz(user_id: str, title: str, quiz_type: str, topic: Optional[str], mode: str) -> str:
    """Insert a quiz row and return its id."""
    payload = [{
        "user_id": user_id,
        "title": title,
        "quiz_type": quiz_type,
        "topic": (topic or None),
        "mode": mode,
    }]

    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(f"{SUPABASE_URL}/rest/v1/quizzes", headers={**_sb_headers(), "Prefer": "return=representation"}, json=payload)
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Create quiz failed: {res.text[:200]}")
        rows = res.json() or []
        if not rows or not rows[0].get("id"):
            raise HTTPException(status_code=502, detail="Create quiz returned no id")
        return str(rows[0]["id"])


async def _sb_bulk_insert_questions_and_options(quiz_id: str, questions: List[QuizQuestion]) -> None:
    """Insert all questions and their options in bulk."""
    # First insert questions
    q_rows = [{
        "quiz_id": quiz_id,
        "text": q.q,
    } for q in questions]

    async with httpx.AsyncClient(timeout=30) as client:
        q_res = await client.post(
            f"{SUPABASE_URL}/rest/v1/quiz_questions",
            headers={**_sb_headers(), "Prefer": "return=representation"},
            json=q_rows,
        )
        if q_res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Insert quiz_questions failed: {q_res.text[:200]}")
        inserted_questions = q_res.json() or []
        if len(inserted_questions) != len(questions):
            # proceed but warn
            pass

        # Build options rows mapping order
        opt_rows = []
        for idx, (src_q, dst_q) in enumerate(zip(questions, inserted_questions)):
            qid = str(dst_q.get("id"))
            if not qid:
                continue
            for oi, opt_text in enumerate(src_q.options):
                opt_rows.append({
                    "question_id": qid,
                    "text": str(opt_text)[:128],
                    "is_correct": (oi == src_q.answerIndex),
                })

        if opt_rows:
            o_res = await client.post(
                f"{SUPABASE_URL}/rest/v1/quiz_answer_options",
                headers={**_sb_headers(), "Prefer": "return=representation"},
                json=opt_rows,
            )
            if o_res.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Insert quiz_answer_options failed: {o_res.text[:200]}")


async def _find_latest_quiz_by_title(user_id: str, title: str) -> Optional[str]:
    params = {
        "select": "id,title,user_id,created_at",
        "user_id": f"eq.{user_id}",
        "title": f"eq.{title}",
        "order": "created_at.desc",
        "limit": "1",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"{SUPABASE_URL}/rest/v1/quizzes", headers=_sb_headers(), params=params)
        if res.status_code >= 400:
            return None
        rows = res.json() or []
        if not rows:
            return None
        return str(rows[0].get("id")) if rows[0].get("id") else None


async def _sb_insert_attempt(user_id: str, quiz_id: str, score: int) -> Optional[str]:
    payload = [{
        "user_id": user_id,
        "quiz_id": quiz_id,
        "score": score,
    }]
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(f"{SUPABASE_URL}/rest/v1/quiz_attempts", headers={**_sb_headers(), "Prefer": "return=representation"}, json=payload)
        if res.status_code >= 400:
            return None
        rows = res.json() or []
        return str(rows[0].get("id")) if rows else None


async def _sb_insert_feedback(attempt_id: str, strengths: List[str], weaknesses: List[str], recommendation: str) -> None:
    payload = [{
        "attempt_id": attempt_id,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "recommendation": recommendation,
    }]
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(f"{SUPABASE_URL}/rest/v1/quiz_attempt_feedback", headers={**_sb_headers(), "Prefer": "return=representation"}, json=payload)
        if res.status_code >= 400:
            # don't break user flow; just skip storing feedback
            pass


async def _sb_bulk_insert_attempt_answers(attempt_id: str, questions: List[QuizQuestion], user_answers: List[Optional[int]]) -> None:
    """Persist per-question user answers for a given attempt. Tolerant: skips on error.
    Table expected: quiz_attempt_answers(attempt_id, question_text, options_json, correct_index, user_index)
    """
    rows = []
    for q, ua in zip(questions, user_answers):
        rows.append({
            "attempt_id": attempt_id,
            "question_text": q.q,
            "options_json": q.options,
            "correct_index": q.answerIndex,
            "user_index": ua if ua is not None else None,
        })

    if not rows:
        return

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            res = await client.post(
                f"{SUPABASE_URL}/rest/v1/quiz_attempt_answers",
                headers={**_sb_headers(), "Prefer": "return=representation"},
                json=rows,
            )
            # If table doesn't exist or RLS blocks, ignore
            if res.status_code >= 400:
                return
        except Exception:
            return


async def _sb_get_attempt_detail(attempt_id: str) -> dict:
    """Fetch attempt details including quiz meta, answers and feedback."""
    async with httpx.AsyncClient(timeout=30) as client:
        # Attempt + quiz (include quiz_id for counts)
        params = {
            "select": "id,score,created_at,quiz_id,quizzes ( id,title,topic,mode )",
            "id": f"eq.{attempt_id}",
            "limit": "1",
        }
        res = await client.get(f"{SUPABASE_URL}/rest/v1/quiz_attempts", headers=_sb_headers(), params=params)
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Load attempt failed: {res.text[:200]}")
        rows = res.json() or []
        if not rows:
            raise HTTPException(status_code=404, detail="Attempt not found")
        row = rows[0]

        # Feedback
        fb_params = {
            "select": "attempt_id,strengths,weaknesses,recommendation",
            "attempt_id": f"eq.{attempt_id}",
            "limit": "1",
        }
        fb_res = await client.get(f"{SUPABASE_URL}/rest/v1/quiz_attempt_feedback", headers=_sb_headers(), params=fb_params)
        fb = fb_res.json()[0] if fb_res.status_code < 400 and (fb_res.json() or []) else None

        # Answers
        ans_params = {
            "select": "question_text,options_json,correct_index,user_index",
            "attempt_id": f"eq.{attempt_id}",
            "order": "id.asc",
        }
        ans_res = await client.get(f"{SUPABASE_URL}/rest/v1/quiz_attempt_answers", headers=_sb_headers(), params=ans_params)
        answers = ans_res.json() if ans_res.status_code < 400 else []

        # Total questions fallback via quiz_questions count
        quiz_id = row.get("quiz_id")
        total_count = 0
        if answers:
            total_count = len(answers)
        elif quiz_id:
            q_params = {
                "select": "id",
                "quiz_id": f"eq.{quiz_id}",
            }
            q_res = await client.get(f"{SUPABASE_URL}/rest/v1/quiz_questions", headers=_sb_headers(), params=q_params)
            if q_res.status_code < 400:
                total_count = len(q_res.json() or [])

    # Build response shape for frontend
    qmeta = row.get("quizzes") or {}
    created = row.get("created_at")
    created_text = ""
    try:
        if created:
            from datetime import datetime
            created_text = datetime.fromisoformat(created.replace("Z", "+00:00")).date().strftime("%m/%d/%Y")
    except Exception:
        created_text = ""

    questions_out: List[QuizQuestion] = []
    user_answers_out: List[Optional[int]] = []
    for a in answers:
        qs = [str(x) for x in (a.get("options_json") or [])]
        questions_out.append(QuizQuestion(id="", q=str(a.get("question_text") or ""), options=qs, answerIndex=int(a.get("correct_index") or 0)))
        ui = a.get("user_index")
        user_answers_out.append(int(ui) if isinstance(ui, int) else None)

    feedback_out = None
    if fb:
        feedback_out = {
            "strengths": fb.get("strengths") or [],
            "weakAreas": fb.get("weaknesses") or [],
            "recommended": fb.get("recommendation") or "",
        }

    return {
        "attemptId": str(row.get("id")),
        "title": str(qmeta.get("title") or "Quiz"),
        "topic": qmeta.get("topic"),
        "quizType": qmeta.get("mode"),
        "createdAt": created_text,
        "questions": [q.model_dump() for q in questions_out],
        "userAnswers": user_answers_out,
        "feedback": feedback_out,
        "scoreCorrect": int(row.get("score") or 0),
        "total": total_count,
    }


# -------------------------
# Title/Topic derivation (new)
# -------------------------
async def _derive_title_and_topic(base_text: str) -> Tuple[str, str]:
    """Ask the model for a concise quiz title and a general topic label.
    Returns (title, topic) with safe fallbacks.
    """
    prompt = f"""
Return ONLY valid JSON. No extra text.
Your response MUST start with "{{" and end with "}}".

Given the content below, produce a concise subject `title` (2–5 words)
and a general `topic` label (1–3 words), e.g., "Planets", "Biology", "History".

FORMAT:
{{"title": "...", "topic": "..."}}

CONTENT:
{base_text}
""".strip()

    raw = await _call_model(prompt)
    parsed = _safe_json_extract(raw)
    if not parsed:
        parsed = await _repair_to_json(raw)

    title = str(parsed.get("title") or "Generated Quiz").strip()
    topic = str(parsed.get("topic") or "General").strip()

    # light sanitization
    if len(title) > 64:
        title = title[:64]
    if len(topic) > 64:
        topic = topic[:64]
    return title or "Generated Quiz", topic or "General"


async def _fetch_latest_response_for_query(query_id: str) -> str:
    """
    responses table: must include response_text + generated_at + query_id
    """
    _require_supabase()
    if not query_id:
        return ""

    params = {
        "select": "response_text,generated_at,model_used,query_id",
        "query_id": f"eq.{query_id}",
        "order": "generated_at.desc",
        "limit": "1",
    }

    timeout = httpx.Timeout(connect=15.0, read=30.0, write=15.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.get(f"{SUPABASE_URL}/rest/v1/responses", headers=_sb_headers(), params=params)
        if res.status_code >= 400:
            return ""
        rows = res.json() or []
        if not rows:
            return ""
        return (rows[0].get("response_text") or "").strip()


async def _get_last_turn(user_id: str, session_id: Optional[str]) -> Tuple[str, str]:
    """
    Returns (last_user_prompt, last_assistant_response)
    """
    rows = await _fetch_queries(user_id=user_id, session_id=session_id, limit=1)
    if not rows:
        return "", ""
    last_prompt = (rows[0].get("transcribed_text") or "").strip()
    qid = str(rows[0].get("id") or "")
    last_resp = await _fetch_latest_response_for_query(qid)
    return last_prompt, last_resp


async def _fetch_turns_with_responses(user_id: str, session_id: Optional[str], limit: int) -> List[Tuple[str, str]]:
    """
    Returns list of (user_prompt, assistant_response) oldest -> newest
    """
    rows = await _fetch_queries(user_id=user_id, session_id=session_id, limit=limit)
    if not rows:
        return []

    rows = list(reversed(rows))  # oldest -> newest
    out: List[Tuple[str, str]] = []
    for r in rows:
        prompt = (r.get("transcribed_text") or "").strip()
        if not prompt:
            continue
        qid = str(r.get("id") or "")
        resp = await _fetch_latest_response_for_query(qid)
        out.append((prompt, resp))
    return out


# -------------------------
# Model calls (DETACHED)
# -------------------------
def _print_quiz_llm_usage(provider: str, prompt: str) -> None:
    """Prints which LLM is being used for quiz + a prompt preview.

    Intentionally prints only a preview by default to avoid log bloat.
    """
    provider_norm = (provider or "").strip().lower() or "(unknown)"
    preview_len = max(0, int(QUIZ_PROMPT_PREVIEW_CHARS))
    prompt_preview = (prompt or "")
    if preview_len and len(prompt_preview) > preview_len:
        prompt_preview = prompt_preview[:preview_len] + "\n... [truncated]"

    extra = ""
    if provider_norm in {"llama", "llama_runpod", "runpod"}:
        extra = f" runpod_url={(LLAMA_RUNPOD_URL or RUNPOD_RUN_ENDPOINT or '(not set)')} model={LLAMA_MODEL_NAME}"
    elif provider_norm == "gemini":
        extra = f" gemini_model={GEMINI_MODEL}"

    msg = f"[QUIZ_LLM] provider={provider_norm}.{extra}"
    # stdout print for quick visibility in dev
    print(msg)
    logger.info(msg)

    if QUIZ_PRINT_PROMPT:
        print("[QUIZ_LLM] prompt_preview:\n" + prompt_preview)


async def _runpod_llama_completion(messages: list[dict], temperature: float = 0.25, max_tokens: int = 900) -> str:
    """Call your RunPod-hosted Llama model.

    Supports:
    - Serverless job-mode: RUNPOD_RUN_ENDPOINT (+ RUNPOD_API_KEY)
    - Direct endpoint: LLAMA_RUNPOD_URL (OpenAI-compatible or custom)
    """
    # Preferred: RunPod serverless job-mode
    if RUNPOD_RUN_ENDPOINT:
        if not RUNPOD_API_KEY:
            raise HTTPException(status_code=500, detail="RUNPOD_API_KEY missing")

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

    # Direct endpoint mode
    if not LLAMA_RUNPOD_URL:
        raise HTTPException(
            status_code=500,
            detail="No RunPod Llama endpoint configured: set RUNPOD_RUN_ENDPOINT (job-mode) or LLAMA_RUNPOD_URL (direct)",
        )

    headers = {"Content-Type": "application/json"}
    if RUNPOD_API_KEY:
        headers["X-API-Key"] = RUNPOD_API_KEY

    is_openai_compatible = "/v1/chat/completions" in LLAMA_RUNPOD_URL.lower()
    if is_openai_compatible:
        payload = {
            "model": LLAMA_MODEL_NAME,
            "messages": messages,
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
            "stream": False,
        }
    else:
        payload = {
            "input": {
                "messages": messages,
                "parameters": {
                    "temperature": float(temperature),
                    "max_new_tokens": int(max_tokens),
                    "do_sample": True,
                    "top_p": 0.9,
                    "repetition_penalty": 1.1,
                },
            }
        }

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            res = await client.post(LLAMA_RUNPOD_URL, headers=headers, json=payload)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"RunPod Llama request failed: {e}")

    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"RunPod Llama returned {res.status_code}: {res.text[:200]}")

    try:
        data = res.json()
    except Exception:
        return (res.text or "").strip()

    try:
        if is_openai_compatible:
            return (data["choices"][0]["message"]["content"] or "").strip()
        out = data.get("output") if isinstance(data, dict) else None
        if isinstance(out, dict):
            for k in ("response", "answer", "reply"):
                if out.get(k):
                    return str(out.get(k)).strip()
        for k in ("generated_text", "text", "response", "answer", "reply"):
            if isinstance(data, dict) and data.get(k):
                return str(data.get(k)).strip()
        if isinstance(data, str):
            return data.strip()
        return str(data).strip()
    except Exception:
        return str(data).strip()


async def _call_llama_detached(prompt: str) -> str:
    """
    Uses your RunPod Llama model (DETACHED) so it won't log quiz/verifier/feedback text into chat tables.
    """
    messages = [{"role": "user", "content": prompt}]
    return await _runpod_llama_completion(messages=messages, temperature=0.25, max_tokens=900)


async def _call_gemini(prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY")

    url = f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent"
    params = {"key": GEMINI_API_KEY}

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 900,
        },
    }

    timeout = httpx.Timeout(connect=60.0, read=300.0, write=60.0, pool=30.0)
    limits = httpx.Limits(max_keepalive_connections=10, max_connections=20, keepalive_expiry=30.0)
    transport = httpx.AsyncHTTPTransport(retries=0)

    async with httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        transport=transport,
        http2=True,
        follow_redirects=True,
    ) as client:
        last_exc: Exception | None = None
        for attempt in range(1, 5):
            try:
                res = await client.post(url, params=params, json=body)
                if res.status_code >= 400:
                    raise HTTPException(status_code=502, detail=f"Gemini failed: {res.text[:200]}")
                data = res.json() or {}

                try:
                    return (data["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
                except Exception:
                    return json.dumps(data)[:800]

            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ReadError, httpx.RemoteProtocolError) as e:
                last_exc = e
                await asyncio.sleep(0.8 * attempt)
                continue

        raise HTTPException(status_code=502, detail=f"Gemini network error after retries: {last_exc}")


async def _call_model(prompt: str) -> str:
    provider_raw = _quiz_provider_override.get() or QUIZ_PROVIDER
    provider = _normalize_quiz_provider(provider_raw) or "llama_runpod"
    prefer_gemini = provider == "gemini"

    if prefer_gemini:
        _print_quiz_llm_usage("gemini", prompt)
        try:
            return await _call_gemini(prompt)
        except Exception as e:
            # Optional fallback to RunPod if configured
            _print_quiz_llm_usage("llama_runpod", prompt)
            logger.warning(f"Gemini failed for quiz; falling back to RunPod Llama: {e}")
            return await _call_llama_detached(prompt)

    # Default path: RunPod Llama
    _print_quiz_llm_usage("llama_runpod", prompt)
    try:
        return await _call_llama_detached(prompt)
    except Exception as e:
        # Optional fallback to Gemini if API key is present
        if GEMINI_API_KEY:
            _print_quiz_llm_usage("gemini", prompt)
            logger.warning(f"RunPod Llama failed for quiz; falling back to Gemini: {e}")
            return await _call_gemini(prompt)
        raise


# -------------------------
# Prompting - QUIZ
# -------------------------
def _build_quiz_prompt(base_text: str, num_questions: int, must_avoid: List[str], related: bool = False) -> str:
    avoid_block = ""
    if must_avoid:
        avoid_block = "DO NOT repeat these exact question texts:\n" + "\n".join([f"- {x}" for x in must_avoid])

    related_block = ""
    if related:
        related_block = (
            "\nEXPANSION RULES:\n"
            "- Explore adjacent or related subtopics not explicitly stated in the content.\n"
            "- Prefer fresh angles and new facts that extend learning beyond the given text.\n"
            "- Keep questions thematically related and educational.\n"
        )

    basis_line = (
        f"Create a {num_questions}-question multiple choice quiz based PRIMARILY on the content below and closely related concepts."
        if related
        else f"Create a {num_questions}-question multiple choice quiz based ONLY on the content below."
    )

    return f"""
You are AskVox Quiz Generator.

Return ONLY valid JSON. No markdown, no extra text.
Your response MUST start with "{{" and end with "}}".

{basis_line}

IMPORTANT:
- Questions must test SUBJECT KNOWLEDGE from the content (facts/concepts/understanding).
- DO NOT ask meta questions about the conversation itself.
- DO NOT ask things like: "primary focus", "what is discussed", "what kind of notes", "what is the discussion about".
{related_block}

CONTENT:
{base_text}

{avoid_block}

STRICT RULES:
- Each question has EXACTLY 4 options.
- Options must be short but meaningful (1–8 words).
- Exactly one correct answer.
- answerIndex is 0-3.
- No placeholders like "A", "B", "Option A".
- Keep questions direct (e.g., "What is a dwarf planet?").

Return format exactly:
{{
  "questions": [
    {{
      "id": "q1",
      "q": "...",
      "options": ["...", "...", "...", "..."],
      "answerIndex": 2
    }}
  ]
}}
""".strip()


def _normalize_and_validate_questions(parsed: dict) -> Tuple[List[QuizQuestion], List[str]]:
    questions_raw = parsed.get("questions") or []
    if not isinstance(questions_raw, list):
        return [], []

    out: List[QuizQuestion] = []
    qs_texts: List[str] = []

    bad = {"a", "b", "c", "d", "option a", "option b", "option c", "option d"}

    for i, q in enumerate(questions_raw, start=1):
        if not isinstance(q, dict):
            continue

        qid = str(q.get("id") or f"q{i}")
        qq = str(q.get("q") or "").strip()
        opts = q.get("options") or []
        ans = q.get("answerIndex")

        if not qq or not isinstance(opts, list) or len(opts) != 4:
            continue
        if not isinstance(ans, int) or ans < 0 or ans > 3:
            continue

        opts_clean = [str(x).strip() for x in opts]
        if all(o.lower() in bad for o in opts_clean):
            continue

        out.append(QuizQuestion(id=qid, q=qq, options=opts_clean, answerIndex=ans))
        qs_texts.append(qq)

    return out, qs_texts


async def _repair_to_json(raw: str) -> dict:
    repair = f"""
Return ONLY valid JSON. No extra text.
Your response MUST start with "{{" and end with "}}".

Convert the following into VALID JSON ONLY.
TEXT:
{raw}
""".strip()
    raw2 = await _call_model(repair)
    return _safe_json_extract(raw2)


async def _verify_answer_index(question: str, options: List[str]) -> int:
    if len(options) != 4:
        return 0

    verify_prompt = f"""
Return ONLY valid JSON. No extra text.
Your response MUST start with "{{" and end with "}}".

Pick the correct answerIndex (0-3) for this multiple-choice question.

FORMAT:
{{"answerIndex": 0}}

Question: {question}

Options:
0) {options[0]}
1) {options[1]}
2) {options[2]}
3) {options[3]}
""".strip()

    raw = await _call_model(verify_prompt)
    parsed = _safe_json_extract(raw)
    ai = parsed.get("answerIndex")
    if isinstance(ai, int) and 0 <= ai <= 3:
        return ai

    parsed2 = await _repair_to_json(raw)
    ai2 = parsed2.get("answerIndex")
    if isinstance(ai2, int) and 0 <= ai2 <= 3:
        return ai2

    return 0


async def _generate_fill_to_n(base_text: str, target_n: int, max_rounds: int = 6, *, seed_avoid: Optional[List[str]] = None, related: bool = False) -> List[QuizQuestion]:
    collected: List[QuizQuestion] = []
    avoid: List[str] = list(seed_avoid or [])

    for _round in range(max_rounds):
        remaining = target_n - len(collected)
        if remaining <= 0:
            break

        prompt = _build_quiz_prompt(base_text, remaining, avoid, related=related)
        raw = await _call_model(prompt)
        parsed = _safe_json_extract(raw)

        if not isinstance(parsed.get("questions"), list) or not parsed.get("questions"):
            parsed = await _repair_to_json(raw)

        new_questions, new_qtexts = _normalize_and_validate_questions(parsed)

        existing = set(q.q.strip().lower() for q in collected)
        for q in new_questions:
            qt = q.q.strip().lower()
            if qt in existing:
                continue
            collected.append(q)
            existing.add(qt)

        avoid.extend(new_qtexts)

    if VERIFY_ANSWERS:
        for q in collected:
            try:
                q.answerIndex = await _verify_answer_index(q.q, q.options)
            except Exception:
                pass

    return collected[:target_n]


# -------------------------
# Prompting - FEEDBACK
# -------------------------
def _build_feedback_prompt(title: str, correct: List[dict], wrong: List[dict]) -> str:
    return f"""
You are AskVox Learning Feedback Engine.

Return ONLY valid JSON.
NO markdown. NO explanations.
Response MUST start with "{{" and end with "}}".

Quiz Title:
{title}

CORRECTLY ANSWERED (user understands these areas):
{json.dumps(correct, ensure_ascii=False)}

INCORRECTLY ANSWERED (user struggled here):
{json.dumps(wrong, ensure_ascii=False)}

TASK:
- Infer learning strengths from correct answers
- Infer weak knowledge areas from incorrect answers
- MUST be topic-specific (no generic phrases like "good effort")

RULES:
- strengths: 2–4 short phrases (3–8 words)
- weakAreas: 2–4 short phrases
- recommended: ONE short learning suggestion sentence

Return JSON format:
{{
  "strengths": ["..."],
  "weakAreas": ["..."],
  "recommended": "..."
}}
""".strip()


# -------------------------
# Routes
# -------------------------
@router.post("/generate", response_model=GenerateQuizRes)
async def generate_quiz(req: GenerateQuizReq):
    token = None
    normalized = _normalize_quiz_provider(req.provider)
    if normalized:
        token = _quiz_provider_override.set(normalized)

    try:
        if req.num_questions < 1 or req.num_questions > 10:
            raise HTTPException(status_code=400, detail="num_questions must be between 1 and 10.")

        # Build content per mode
        if req.mode == "A":
            # Enforce using the CURRENT chat session only
            if not (req.session_id and str(req.session_id).strip()):
                raise HTTPException(status_code=400, detail="Mode A requires current session_id.")

            last_prompt, last_resp = await _get_last_turn(req.user_id, req.session_id)
            if not last_prompt:
                raise HTTPException(status_code=400, detail="No last prompt found yet. Send a chat message first.")

            title = "Quiz from Last Prompt"
            base_text = f"""
USER ASKED:
{last_prompt}

ASSISTANT ANSWERED:
{last_resp if last_resp else "(No assistant response found.)"}
""".strip()

            derived_title, derived_topic = await _derive_title_and_topic(base_text)
            store_title = derived_title
            store_quiz_type = "mcq"
            store_topic = derived_topic

        elif req.mode == "B":
            topic = (req.topic or "").strip()
            if not topic:
                raise HTTPException(status_code=400, detail="Mode B requires 'topic'.")

            title = f"Quiz: {topic}"
            base_text = f"""
TOPIC:
{topic}

Make questions ONLY about this topic.
Do NOT use any other topics.
""".strip()

            derived_title, derived_topic = await _derive_title_and_topic(f"TOPIC:\n{topic}")
            store_title = derived_title or topic
            store_quiz_type = "mcq"
            store_topic = topic

        else:  # "C"
            # Enforce using the CURRENT chat session only and fetch full session turns
            if not (req.session_id and str(req.session_id).strip()):
                raise HTTPException(status_code=400, detail="Mode C requires current session_id.")

            # Fetch all turns in this session (high cap to cover entire chat)
            turns = await _fetch_turns_with_responses(req.user_id, req.session_id, limit=1000)
            if not turns:
                raise HTTPException(status_code=400, detail="No discussion found yet. Chat first, then generate Mode C.")

            title = "Quiz from Current Discussion"

            lines: List[str] = []
            for (p, a) in turns:
                lines.append(f"USER: {p}")
                if a:
                    lines.append(f"ASSISTANT: {a}")
            base_text = "\n".join(lines).strip()

            derived_title, derived_topic = await _derive_title_and_topic(base_text)
            store_title = derived_title
            store_quiz_type = "mcq"
            store_topic = derived_topic

        seed_avoid = [str(x)[:256] for x in (req.avoid_questions or []) if isinstance(x, str) and x.strip()]
        questions = await _generate_fill_to_n(base_text, req.num_questions, seed_avoid=seed_avoid, related=req.related)
        if not questions:
            raise HTTPException(status_code=502, detail="Parsed quiz had no valid questions.")

        questions = questions[: req.num_questions]
        for i, q in enumerate(questions, start=1):
            q.id = f"q{i}"

        # Persist quiz + questions + options to Supabase
        try:
            quiz_id = await _sb_insert_quiz(
                user_id=req.user_id,
                title=store_title,
                quiz_type=store_quiz_type,
                topic=store_topic,
                mode=req.mode,
            )
            await _sb_bulk_insert_questions_and_options(quiz_id, questions)
        except HTTPException:
            # If storage fails, still return quiz to the client
            quiz_id = None

        return GenerateQuizRes(title=title, questions=questions, quiz_id=quiz_id)
    finally:
        if token is not None:
            _quiz_provider_override.reset(token)


@router.post("/feedback", response_model=QuizFeedbackRes)
async def quiz_feedback(req: QuizFeedbackReq):
    token = None
    normalized = _normalize_quiz_provider(req.provider)
    if normalized:
        token = _quiz_provider_override.set(normalized)

    try:
        if len(req.questions) != len(req.userAnswers):
            raise HTTPException(status_code=400, detail="userAnswers length must match questions length")

        correct, wrong = [], []

        for q, ans in zip(req.questions, req.userAnswers):
            entry = {
                "question": q.q,
                "options": q.options,
                "correctIndex": q.answerIndex,
                "userIndex": ans,
            }
            if ans is None:
                wrong.append(entry)
            elif ans == q.answerIndex:
                correct.append(entry)
            else:
                wrong.append(entry)

        prompt = _build_feedback_prompt(req.title, correct, wrong)

        raw = await _call_model(prompt)
        parsed = _safe_json_extract(raw)
        if not parsed:
            parsed = await _repair_to_json(raw)

        strengths = parsed.get("strengths") or []
        weak = parsed.get("weakAreas") or []
        rec = (parsed.get("recommended") or "").strip()

        # Hard fallbacks
        if not isinstance(strengths, list) or not strengths:
            strengths = ["Core topic understanding"]
        if not isinstance(weak, list) or not weak:
            weak = ["Advanced topic details"]
        if not rec:
            rec = "Review the incorrect questions and try another quiz."

        strengths = [str(x).strip() for x in strengths if str(x).strip()][:4]
        weak = [str(x).strip() for x in weak if str(x).strip()][:4]

        # Store attempt + feedback in Supabase
        try:
            # Determine quiz id to attach attempt to
            quiz_id = req.quiz_id or await _find_latest_quiz_by_title(req.user_id, req.title)
            # compute score: count correct answers where user answered
            score = 0
            for q, ans in zip(req.questions, req.userAnswers):
                if ans is not None and ans == q.answerIndex:
                    score += 1
            if quiz_id:
                attempt_id = await _sb_insert_attempt(req.user_id, quiz_id, score)
                if attempt_id:
                    await _sb_insert_feedback(attempt_id, strengths, weak, rec)
                    # Also store per-question answers for later review
                    try:
                        await _sb_bulk_insert_attempt_answers(attempt_id, req.questions, req.userAnswers)
                    except Exception:
                        pass
        except Exception:
            # non-fatal; continue returning feedback
            pass

        return QuizFeedbackRes(
            strengths=strengths,
            weakAreas=weak,
            recommended=rec,
        )
    finally:
        if token is not None:
            _quiz_provider_override.reset(token)


@router.get("/attempt/{attempt_id}")
async def get_attempt_detail(attempt_id: str):
    """Return attempt detail for review: questions, user answers, and feedback."""
    try:
        return await _sb_get_attempt_detail(attempt_id)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to load attempt detail: {e}")
