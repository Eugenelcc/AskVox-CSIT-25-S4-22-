import asyncio
import base64
import json
import os
import re
import time
from typing import Optional, List

import numpy as np
from fastapi import APIRouter, Body, Query, Request
import httpx
from app.core.config import settings
from rapidfuzz import fuzz

try:
    import whisper
except Exception as e: 
    whisper = None

try:
    import vosk
except Exception:
    vosk = None


USER_WAKE_PHRASE = os.getenv("USER_WAKE_PHRASE", "Hey AskVox")
WAKE_THRESHOLD = int(os.getenv("WAKE_THRESHOLD", "70"))
WAKE_ENGINE = os.getenv("WAKE_ENGINE", "vosk").strip().lower()  # vosk | whisper
WAKE_DEBUG = os.getenv("WAKE_DEBUG", "0").strip().lower() in {"1", "true", "yes"}
WAKE_CONCURRENCY = int(os.getenv("WAKE_CONCURRENCY", "2"))
WAKE_MAX_BYTES = int(os.getenv("WAKE_MAX_BYTES", "2000000"))
WAKE_MAX_SECONDS = float(os.getenv("WAKE_MAX_SECONDS", "8"))
WAKE_PHRASE_CACHE_TTL_SECONDS = int(os.getenv("WAKE_PHRASE_CACHE_TTL_SECONDS", "60"))

VOSK_MODEL_PATH = os.getenv("VOSK_MODEL_PATH", "/opt/vosk-model-small-en-us-0.15")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "en")
WHISPER_TEMPERATURE = float(os.getenv("WHISPER_TEMPERATURE", "0.0"))
WHISPER_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
WHISPER_NO_SPEECH = float(os.getenv("WHISPER_NO_SPEECH", "0.6"))
CORE_ONLY_THRESHOLD = int(os.getenv("CORE_ONLY_THRESHOLD", "78"))

router = APIRouter(prefix="/wake", tags=["wake"])


def _log(msg: str) -> None:
    if not WAKE_DEBUG:
        return
    try:
        print(msg)
    except Exception:
        pass


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _extract_wake_window(text: str, max_words: int = 5) -> str:
    return " ".join(text.split()[:max_words])


_model: Optional[object] = None
_vosk_model: Optional[object] = None

_wake_sem = asyncio.Semaphore(max(1, WAKE_CONCURRENCY))

# Cache wake phrase by user id (from JWT sub)
_wake_phrase_cache: dict[str, tuple[float, str]] = {}


def _get_model():
    global _model
    if _model is None:
        if whisper is None:
            raise RuntimeError("whisper is not installed; ensure openai-whisper is in requirements")
        try:
            _log(f"🛎️  [Wake] Loading Whisper model: {WHISPER_MODEL}")
        except Exception:
            pass
        _model = whisper.load_model(WHISPER_MODEL)
        try:
            _log(f"✅ [Wake] Whisper model loaded: {WHISPER_MODEL}")
        except Exception:
            pass
    return _model


def _get_vosk_model():
    global _vosk_model
    if _vosk_model is None:
        if vosk is None:
            raise RuntimeError("vosk is not installed; ensure vosk is in requirements")
        if not VOSK_MODEL_PATH or not os.path.isdir(VOSK_MODEL_PATH):
            raise RuntimeError(f"Vosk model path not found: {VOSK_MODEL_PATH}")
        _log(f"🛎️  [Wake] Loading Vosk model: {VOSK_MODEL_PATH}")
        _vosk_model = vosk.Model(VOSK_MODEL_PATH)
        _log("✅ [Wake] Vosk model loaded")
    return _vosk_model


GREETINGS = {"hey", "hi", "hello", "yo", "ok", "okay"}


def _core_words(wake_norm: str) -> List[str]:
    return [w for w in wake_norm.split() if w and w not in GREETINGS]


def _build_initial_prompt(wake_phrase: str) -> str:
    custom = os.getenv("WAKE_PROMPT")
    if custom:
        return custom
    wake_norm = _normalize(wake_phrase)
    cores = _core_words(wake_norm)
    core = cores[0] if cores else wake_norm.split()[-1]
    spelled = " ".join(list(core.upper()))
    return (
        f"The assistant wake phrase is '{wake_phrase}'. "
        f"If you hear it, transcribe it exactly. The name '{core}' is spelled {spelled} and pronounced 'nee-roo-bah'. "
        f"Do not substitute with similar words like 'hello' or 'new baba'."
    )


async def _resolve_user_wake_phrase(request: Request) -> str:
    """Resolve the user's custom wake word from Supabase profiles, falling back to env."""
    default_phrase = USER_WAKE_PHRASE
    try:
        auth = request.headers.get("authorization") or request.headers.get("Authorization")
        if not auth or not auth.lower().startswith("bearer "):
            return default_phrase
        token = auth.split(" ", 1)[1]
        base = settings.supabase_url or os.getenv("SUPABASE_URL")
        anon = settings.supabase_anon_key or os.getenv("SUPABASE_ANON_KEY")
        if not base or not anon:
            return default_phrase

        def _jwt_sub(tok: str) -> Optional[str]:
            try:
                parts = tok.split(".")
                if len(parts) < 2:
                    return None
                payload = parts[1]
                payload += "=" * (-len(payload) % 4)
                data = base64.urlsafe_b64decode(payload.encode("utf-8"))
                obj = json.loads(data.decode("utf-8"))
                sub = obj.get("sub")
                return sub if isinstance(sub, str) and sub else None
            except Exception:
                return None

        uid = _jwt_sub(token)
        if uid:
            cached = _wake_phrase_cache.get(uid)
            if cached and cached[0] > time.time():
                return cached[1]

        async with httpx.AsyncClient(timeout=5.0) as client:
            if not uid:
                # Fallback: resolve uid via Auth endpoint if JWT parsing failed
                uresp = await client.get(
                    f"{base}/auth/v1/user",
                    headers={"Authorization": f"Bearer {token}", "apikey": anon},
                )
                if uresp.status_code != 200:
                    return default_phrase
                uid = (uresp.json() or {}).get("id")
                if not uid:
                    return default_phrase

                cached = _wake_phrase_cache.get(uid)
                if cached and cached[0] > time.time():
                    return cached[1]

            # Fetch profile wake_word
            presp = await client.get(
                f"{base}/rest/v1/profiles",
                headers={"Authorization": f"Bearer {token}", "apikey": anon},
                params={"id": f"eq.{uid}", "select": "wake_word"},
            )
            if presp.status_code != 200:
                return default_phrase
            rows = presp.json() or []
            if not rows:
                return default_phrase
            wake_word = (rows[0] or {}).get("wake_word")
            if isinstance(wake_word, str) and wake_word.strip():
                phrase = wake_word.strip()
            else:
                phrase = default_phrase

            if uid:
                _wake_phrase_cache[uid] = (time.time() + max(1, WAKE_PHRASE_CACHE_TTL_SECONDS), phrase)
            return phrase
    except Exception:
        return default_phrase


def _float32_to_int16_bytes(audio: np.ndarray) -> bytes:
    if audio.size == 0:
        return b""
    a = np.clip(audio, -1.0, 1.0)
    i16 = (a * 32767.0).astype(np.int16)
    return i16.tobytes()


def _build_vosk_grammar(wake_phrase: str) -> str:
    wake_norm = _normalize(wake_phrase)
    parts: List[str] = []
    if wake_norm:
        parts.append(wake_norm)
        parts.extend(wake_norm.split())
    parts.extend(sorted(GREETINGS))
    parts.append("[unk]")
    # unique, keep order
    uniq: List[str] = []
    seen = set()
    for p in parts:
        p = p.strip()
        if not p or p in seen:
            continue
        seen.add(p)
        uniq.append(p)
    return json.dumps(uniq)


def _vosk_transcribe(text_audio_i16: bytes, sr: int, wake_phrase: str) -> str:
    model = _get_vosk_model()
    # KaldiRecognizer accepts an optional JSON grammar to constrain decoding
    grammar = _build_vosk_grammar(wake_phrase)
    rec = vosk.KaldiRecognizer(model, float(sr), grammar)
    try:
        rec.SetWords(False)
    except Exception:
        pass
    rec.AcceptWaveform(text_audio_i16)
    res = json.loads(rec.FinalResult() or "{}")
    return (res.get("text") or "").strip()


@router.post("/transcribe_pcm")
async def transcribe_pcm(
    request: Request,
    body: bytes = Body(..., media_type="application/octet-stream"),
    sr: int = Query(16000, description="Sample rate of the incoming Float32 PCM"),
):
    if WAKE_MAX_BYTES and len(body) > WAKE_MAX_BYTES:
        return {
            "text": "",
            "wake_phrase": USER_WAKE_PHRASE,
            "score": 0,
            "wake_match": False,
            "command": "",
            "reason": "payload_too_large",
        }

    await _wake_sem.acquire()
    try:
        try:
            audio = np.frombuffer(body, dtype=np.float32)
        except Exception:
            audio = np.array([], dtype=np.float32)

        samples = int(audio.size)
        dur = samples / float(sr or 1)
        _log(f"🎧 [Wake] recv sr={sr} bytes={len(body)} samples={samples} dur={dur:.2f}s")

        if WAKE_MAX_SECONDS and dur > WAKE_MAX_SECONDS:
            return {
                "text": "",
                "wake_phrase": USER_WAKE_PHRASE,
                "score": 0,
                "wake_match": False,
                "command": "",
                "reason": "audio_too_long",
            }

        # Guards: minimum duration and minimum RMS energy
        MIN_DURATION = 0.8  # seconds
        rms = float(np.sqrt(np.mean(audio ** 2))) if audio.size else 0.0
        user_phrase = await _resolve_user_wake_phrase(request)
        if dur < MIN_DURATION:
            return {
                "text": "",
                "wake_phrase": user_phrase,
                "score": 0,
                "wake_match": False,
                "command": "",
                "reason": "audio_too_short",
            }
        MIN_RMS = float(os.getenv("MIN_WAKE_RMS", "0.005"))
        if rms < MIN_RMS:
            return {
                "text": "",
                "wake_phrase": user_phrase,
                "score": 0,
                "wake_match": False,
                "command": "",
                "reason": "silence",
            }

        # Resample to 16k
        target_sr = 16000
        if sr and sr != target_sr and samples > 0:
            x_old = np.linspace(0, dur, num=samples, endpoint=False)
            new_len = int(round(dur * target_sr)) or 1
            x_new = np.linspace(0, dur, num=new_len, endpoint=False)
            audio = np.interp(x_new, x_old, audio).astype(np.float32)
            _log(f"🎧 [Wake] resampled -> samples={audio.size} dur={audio.size/target_sr:.2f}s @16k")

        raw_text = ""
        text = ""

        engine = WAKE_ENGINE
        if engine == "vosk":
            try:
                pcm_i16 = _float32_to_int16_bytes(audio)
                raw_text = _vosk_transcribe(pcm_i16, 16000, user_phrase)
                text = _normalize(raw_text)
            except Exception as e:
                _log(f"⚠️  [Wake] Vosk failed, falling back to Whisper: {e}")
                engine = "whisper"

        if engine == "whisper":
            audio = np.array(audio, dtype=np.float32, copy=True)
            model = _get_model()
            result = model.transcribe(
                audio,
                fp16=False,
                initial_prompt=_build_initial_prompt(user_phrase),
                language=WHISPER_LANGUAGE,
                temperature=WHISPER_TEMPERATURE,
                beam_size=WHISPER_BEAM_SIZE,
                no_speech_threshold=WHISPER_NO_SPEECH,
                condition_on_previous_text=False,
                suppress_tokens=[-1],
            )
            raw_text = result.get("text", "") or ""
            text = _normalize(raw_text)

        _log(f"🗒️  [Wake] ({engine}) raw='{raw_text}'")
        _log(f"🧼  [Wake] norm='{text}'")

        wake_norm = _normalize(user_phrase)
        wake_window = _extract_wake_window(text, max_words=5)
        score = int(fuzz.partial_ratio(wake_window, wake_norm))
        wake_match = score >= WAKE_THRESHOLD
        wake_words = [w for w in wake_norm.split() if w]
        core_words = [w for w in wake_words if w not in GREETINGS]
        core_present = sum(1 for w in core_words if w in wake_window)
        if len(core_words) > 0:
            if core_present < 1:
                wake_match = False
        else:
            present = sum(1 for w in wake_words if w in wake_window)
            if present < min(2, len(wake_words)):
                wake_match = False

        tokens = wake_window.split()
        earliest_core_pos = None
        for idx, tok in enumerate(tokens[:3]):
            if tok in core_words:
                earliest_core_pos = idx
                break
        core_score = 0
        if core_words:
            core_phrase = " ".join(core_words)
            core_score = int(fuzz.partial_ratio(wake_window, core_phrase))
        if not wake_match and earliest_core_pos is not None and core_score >= CORE_ONLY_THRESHOLD:
            wake_match = True

        _log(
            f"🔍 [Wake] phrase='{user_phrase}' window='{wake_window}' "
            f"score={score} core_score={core_score} core_present={core_present}/{len(core_words)} "
            f"earliest_core_pos={earliest_core_pos} match={wake_match}"
        )
        _log(str({
            "engine": engine,
            "duration": round(dur, 2),
            "rms": round(rms, 6),
            "raw": raw_text,
            "norm": text,
            "score": score,
            "match": wake_match,
        }))

        command = text
        if wake_match and wake_norm:
            tokens2 = text.split()
            wake_tokens = wake_norm.split()
            while tokens2 and wake_tokens and tokens2[0] == wake_tokens[0]:
                tokens2.pop(0)
                wake_tokens.pop(0)
            command = " ".join(tokens2).strip()
            if len(command.split()) < 2:
                command = ""
            _log(f"🧾 [Command] '{command}'")

        return {
            "text": text,
            "wake_phrase": user_phrase,
            "score": score,
            "wake_match": wake_match,
            "command": command,
        }
    finally:
        _wake_sem.release()
