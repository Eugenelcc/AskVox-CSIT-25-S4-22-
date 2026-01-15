import os
import json
import asyncio
import httpx
from typing import Literal, List, Optional, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/quiz", tags=["quiz"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
API_BASE_LOCAL = os.getenv("API_BASE_LOCAL", "http://localhost:8000").rstrip("/")

# --- Gemini config ---
GEMINI_BASE_URL = os.getenv(
    "GEMINI_BASE_URL",
    "https://generativelanguage.googleapis.com/v1beta"
).rstrip("/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# Choose provider: set QUIZ_PROVIDER=gemini or llama in .env
QUIZ_PROVIDER = os.getenv("QUIZ_PROVIDER", "gemini").lower().strip()

QuizMode = Literal["A", "B", "C"]


class GenerateQuizReq(BaseModel):
    mode: QuizMode
    user_id: str
    session_id: Optional[str] = None
    topic: Optional[str] = None
    num_questions: int = 3


class QuizQuestion(BaseModel):
    id: str
    q: str
    options: List[str]
    answerIndex: int


class GenerateQuizRes(BaseModel):
    title: str
    questions: List[QuizQuestion]


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
    """
    Extract JSON even if the model adds extra words.
    1) Try json.loads
    2) Brace-balanced extraction from first '{'
    """
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
                chunk = t[start : i + 1]
                try:
                    return json.loads(chunk)
                except Exception:
                    return {}

    return {}


async def _fetch_queries(user_id: str, session_id: Optional[str], limit: int) -> List[dict]:
    _require_supabase()

    params = {
        "select": "transcribed_text,created_at,detected_domain,input_mode,session_id",
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if session_id:
        params["session_id"] = f"eq.{session_id}"

    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{SUPABASE_URL}/rest/v1/queries",
            headers=_sb_headers(),
            params=params,
        )
        if res.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Supabase queries fetch failed: {res.text[:200]}",
            )
        return res.json() or []


async def _get_last_prompt_from_queries(user_id: str, session_id: Optional[str]) -> str:
    rows = await _fetch_queries(user_id=user_id, session_id=session_id, limit=1)
    if not rows:
        return ""
    return (rows[0].get("transcribed_text") or "").strip()


def _build_context_from_rows(rows: List[dict]) -> str:
    """
    Convert query rows into a compact context block for the model.
    Oldest first (so it reads like a conversation).
    """
    if not rows:
        return ""

    ordered = list(reversed(rows))  # oldest -> newest
    lines: List[str] = []
    for r in ordered:
        txt = (r.get("transcribed_text") or "").strip()
        if not txt:
            continue
        dom = (r.get("detected_domain") or "general").strip()
        mode = (r.get("input_mode") or "").strip()
        lines.append(f"- [{dom} | {mode}] {txt}")

    return "\n".join(lines).strip()


# -------------------------
# LLaMA call (detached)
# -------------------------
async def _call_llama(prompt: str) -> str:
    """
    Calls your existing /llamachats/cloud route BUT detached from user's real chat.
    """
    url = f"{API_BASE_LOCAL}/llamachats/cloud"
    payload = {
        "message": prompt,
        "history": [],
        "query_id": None,
        "session_id": None,  # detach
        "user_id": None,     # detach
    }

    timeout = httpx.Timeout(connect=10.0, read=220.0, write=20.0, pool=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(url, json=payload)
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Quiz model call failed: {res.text[:200]}")
        data = res.json() or {}
        return (data.get("answer") or "").strip()


# -------------------------
# ✅ Gemini call (bigger timeouts + retry + ReadError)
# -------------------------
async def _call_gemini(prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY")

    url = f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent"
    params = {"key": GEMINI_API_KEY}

    # Keep output smaller so connection is less likely to get cut mid-stream
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 900,  # ✅ reduce output
        },
    }

    # ✅ bigger connect + read timeouts
    timeout = httpx.Timeout(connect=45.0, read=240.0, write=30.0, pool=20.0)

    # ✅ more robust transport
    limits = httpx.Limits(max_keepalive_connections=10, max_connections=20, keepalive_expiry=30.0)
    transport = httpx.AsyncHTTPTransport(retries=0)  # we do our own retries

    async with httpx.AsyncClient(timeout=timeout, limits=limits, transport=transport) as client:
        last_exc: Exception | None = None

        for attempt in range(1, 5):  # ✅ 4 tries
            try:
                res = await client.post(url, params=params, json=body)
                if res.status_code >= 400:
                    raise HTTPException(status_code=502, detail=f"Gemini failed: {res.text[:200]}")
                data = res.json() or {}

                try:
                    return (data["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
                except Exception:
                    # fall back for debugging
                    return json.dumps(data)[:800]

            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ReadError) as e:
                last_exc = e
                # small backoff
                await asyncio.sleep(0.6 * attempt)
                continue

        raise HTTPException(status_code=502, detail=f"Gemini network error after retries: {last_exc}")


async def _call_model(prompt: str) -> str:
    if QUIZ_PROVIDER == "gemini":
        return await _call_gemini(prompt)
    return await _call_llama(prompt)


def _build_quiz_prompt(base_text: str, num_questions: int, must_avoid: List[str]) -> str:
    avoid_block = ""
    if must_avoid:
        avoid_block = "DO NOT repeat these exact question texts:\n" + "\n".join([f"- {x}" for x in must_avoid])

    return f"""
You are AskVox Quiz Generator.

Return ONLY valid JSON. No markdown, no extra text.
Your response MUST start with "{{" and end with "}}".

Create a {num_questions}-question multiple choice quiz based ONLY on the content below.

CONTENT:
{base_text}

{avoid_block}

STRICT RULES:
- Each question has EXACTLY 4 options.
- Each option MUST be a full, meaningful answer choice (2–10 words).
- DO NOT use placeholder options like "A", "B", "C", "D", "Option A", "Option 1".
- Exactly one correct answer.
- answerIndex is 0-3.
- Avoid trick questions. Prefer clear factual/understanding questions.

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
Do not add explanations. Do not add markdown.

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

Pick the correct answerIndex (0-3) for the multiple-choice question.

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


async def _generate_fill_to_n(
    base_text: str,
    target_n: int,
    max_rounds: int = 6,
) -> List[QuizQuestion]:
    collected: List[QuizQuestion] = []
    avoid: List[str] = []

    for _round in range(max_rounds):
        remaining = target_n - len(collected)
        if remaining <= 0:
            break

        prompt = _build_quiz_prompt(base_text, remaining, avoid)
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

    for q in collected:
        try:
            q.answerIndex = await _verify_answer_index(q.q, q.options)
        except Exception:
            pass

    return collected[:target_n]


@router.post("/generate", response_model=GenerateQuizRes)
async def generate_quiz(req: GenerateQuizReq):
    if req.num_questions < 1 or req.num_questions > 10:
        raise HTTPException(status_code=400, detail="num_questions must be between 1 and 10.")

    if req.mode == "A":
        last_prompt = await _get_last_prompt_from_queries(req.user_id, req.session_id)
        if not last_prompt:
            raise HTTPException(status_code=400, detail="No last prompt found yet. Send a chat message first.")

        title = "Quiz from Last Prompt"
        base_text = f'User prompt: "{last_prompt}"'

    elif req.mode == "B":
        topic = (req.topic or "").strip()
        if not topic:
            raise HTTPException(status_code=400, detail="Mode B requires 'topic'.")

        title = f"Quiz: {topic}"
        base_text = f"""
Topic: {topic}

Generate questions ONLY about this topic.
Do NOT use unrelated prior chat topics.
""".strip()

    else:  # "C"
        rows = await _fetch_queries(req.user_id, req.session_id, limit=60)
        ctx = _build_context_from_rows(rows)
        if not ctx:
            raise HTTPException(status_code=400, detail="No discussion found yet. Chat first, then generate Mode C.")

        title = "Quiz from Current Discussion"
        base_text = f"Conversation context (oldest → newest):\n{ctx}".strip()

    questions = await _generate_fill_to_n(base_text, req.num_questions)

    if not questions:
        raise HTTPException(status_code=502, detail="Parsed quiz had no valid questions.")

    questions = questions[: req.num_questions]

    for i, q in enumerate(questions, start=1):
        q.id = f"q{i}"

    return GenerateQuizRes(title=title, questions=questions)
