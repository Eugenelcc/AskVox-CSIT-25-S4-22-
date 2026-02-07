import asyncio
import base64
import json
import os
import re
import time
import zipfile
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

VOSK_MODEL_DIRNAME = os.getenv("VOSK_MODEL_DIRNAME", "vosk-model-small-en-us-0.15").strip() or "vosk-model-small-en-us-0.15"
VOSK_MODEL_PATH = os.getenv("VOSK_MODEL_PATH", "").strip()  # may be empty; we'll probe defaults
VOSK_AUTO_DOWNLOAD = os.getenv("VOSK_AUTO_DOWNLOAD", "1").strip().lower() in {"1", "true", "yes"}
VOSK_MODEL_ZIP_URL = os.getenv(
    "VOSK_MODEL_ZIP_URL",
    "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
).strip()
VOSK_MODEL_DOWNLOAD_DIR = os.getenv("VOSK_MODEL_DOWNLOAD_DIR", "/tmp").strip() or "/tmp"
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


# Helpful one-time boot diagnostics (shows up in Railway logs when WAKE_DEBUG=1)
try:
    _log(
        "🧭 [Wake] boot "
        + json.dumps(
            {
                "wake_engine": WAKE_ENGINE,
                "vosk_installed": bool(vosk),
                "whisper_installed": bool(whisper),
                "vosk_model_path_env": VOSK_MODEL_PATH,
                "vosk_model_dirname": VOSK_MODEL_DIRNAME,
                "vosk_auto_download": VOSK_AUTO_DOWNLOAD,
                "vosk_model_download_dir": VOSK_MODEL_DOWNLOAD_DIR,
            }
        )
    )
except Exception:
    pass


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _extract_wake_window(text: str, max_words: int = 5) -> str:
    return " ".join(text.split()[:max_words])


_model: Optional[object] = None
_vosk_model: Optional[object] = None
_vosk_model_path_runtime: Optional[str] = None
_vosk_prepare_lock = asyncio.Lock()

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
        model_path = _vosk_model_path_runtime or VOSK_MODEL_PATH
        if not model_path or not os.path.isdir(model_path):
            raise RuntimeError(f"Vosk model path not found: {model_path or '(empty)'}")
        _log(f"🛎️  [Wake] Loading Vosk model: {model_path}")
        _vosk_model = vosk.Model(model_path)
        _log("✅ [Wake] Vosk model loaded")
    return _vosk_model


def _candidate_vosk_paths() -> List[str]:
    # Prefer explicit env var, then Docker-baked path, then runtime download dir.
    cands = [
        (_vosk_model_path_runtime or "").strip(),
        (VOSK_MODEL_PATH or "").strip(),
        f"/opt/{VOSK_MODEL_DIRNAME}",
        os.path.join(VOSK_MODEL_DOWNLOAD_DIR, VOSK_MODEL_DIRNAME),
        f"/tmp/{VOSK_MODEL_DIRNAME}",
    ]
    out: List[str] = []
    seen = set()
    for p in cands:
        p = (p or "").strip()
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


@router.get("/health")
async def wake_health():
    """Lightweight diagnostics for production.

    Use this on Railway to confirm if Vosk is installed and whether the model exists.
    """
    paths = _candidate_vosk_paths()
    exists = {p: bool(p and os.path.isdir(p)) for p in paths}
    preview_phrase = USER_WAKE_PHRASE
    try:
        preview_aliases = _wake_alias_norms(preview_phrase)
    except Exception:
        preview_aliases = []

    return {
        "wake_engine": WAKE_ENGINE,
        "wake_debug": WAKE_DEBUG,
        "vosk_installed": bool(vosk),
        "whisper_installed": bool(whisper),
        "wake_phrase_default": preview_phrase,
        "wake_aliases_env": WAKE_ALIASES,
        "wake_aliases_default": _DEFAULT_WAKE_ALIASES,
        "wake_aliases_preview_norm": preview_aliases,
        "vosk_model_dirname": VOSK_MODEL_DIRNAME,
        "vosk_model_path_env": VOSK_MODEL_PATH,
        "vosk_auto_download": VOSK_AUTO_DOWNLOAD,
        "vosk_model_zip_url_set": bool(VOSK_MODEL_ZIP_URL),
        "vosk_model_download_dir": VOSK_MODEL_DOWNLOAD_DIR,
        "candidate_paths": paths,
        "candidate_paths_exist": exists,
    }


def _download_and_extract_vosk_model() -> str:
    # Blocking function; call via asyncio.to_thread.
    os.makedirs(VOSK_MODEL_DOWNLOAD_DIR, exist_ok=True)
    zip_path = os.path.join(VOSK_MODEL_DOWNLOAD_DIR, "vosk-model.zip")
    _log(f"⬇️  [Wake] Downloading Vosk model zip -> {zip_path}")
    with httpx.Client(timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)) as client:
        r = client.get(VOSK_MODEL_ZIP_URL)
        r.raise_for_status()
        with open(zip_path, "wb") as f:
            f.write(r.content)
    _log(f"📦 [Wake] Extracting Vosk model zip -> {VOSK_MODEL_DOWNLOAD_DIR}")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(VOSK_MODEL_DOWNLOAD_DIR)
    try:
        os.remove(zip_path)
    except Exception:
        pass
    expected = os.path.join(VOSK_MODEL_DOWNLOAD_DIR, VOSK_MODEL_DIRNAME)
    if os.path.isdir(expected):
        return expected
    # Fallback: pick first directory with 'vosk-model' prefix
    try:
        for name in os.listdir(VOSK_MODEL_DOWNLOAD_DIR):
            if name.startswith("vosk-model"):
                cand = os.path.join(VOSK_MODEL_DOWNLOAD_DIR, name)
                if os.path.isdir(cand):
                    return cand
    except Exception:
        pass
    raise RuntimeError("Vosk model extraction completed but model directory was not found")


async def _ensure_vosk_model_path() -> Optional[str]:
    """Ensure a Vosk model directory exists and return its path.

    Works for both Docker (pre-baked /opt) and Railway/Nixpacks (auto-download to /tmp).
    """
    global _vosk_model_path_runtime

    for p in _candidate_vosk_paths():
        if p and os.path.isdir(p):
            _vosk_model_path_runtime = p
            return p

    if not VOSK_AUTO_DOWNLOAD:
        return None
    if not VOSK_MODEL_ZIP_URL:
        return None

    async with _vosk_prepare_lock:
        # Re-check after acquiring lock
        for p in _candidate_vosk_paths():
            if p and os.path.isdir(p):
                _vosk_model_path_runtime = p
                return p
        try:
            model_dir = await asyncio.to_thread(_download_and_extract_vosk_model)
            _vosk_model_path_runtime = model_dir
            _log(f"✅ [Wake] Vosk model ready at: {model_dir}")
            return model_dir
        except Exception as e:
            _log(f"⚠️  [Wake] Vosk model auto-download failed: {e}")
            return None


GREETINGS = {"hey", "hi", "hello", "yo", "ok", "okay"}

# Vosk often cannot recognize made-up brand words (e.g. "askvox") because they're not in the model vocabulary.
# Provide alias phrases that are more likely to decode, and match against the best alias.
_DEFAULT_WAKE_ALIASES = ["ask vox", "ask box", "ask fox"]
WAKE_ALIASES = os.getenv("WAKE_ALIASES", "").strip()


def _core_words(wake_norm: str) -> List[str]:
    return [w for w in wake_norm.split() if w and w not in GREETINGS]


def _wake_alias_norms(user_phrase: str) -> List[str]:
    """Return normalized wake phrase variants.

    Example: "Hey AskVox" -> ["hey askvox", "hey ask vox", "hey ask box", "hey ask fox"].
    """
    base = _normalize(user_phrase)
    if not base:
        return []

    extra_raw: List[str] = []

    # Common brand split: askvox -> ask vox
    if "askvox" in base.replace(" ", ""):
        extra_raw.append(base.replace("askvox", "ask vox"))
        for tail in _DEFAULT_WAKE_ALIASES:
            extra_raw.append(re.sub(r"\baskvox\b", tail, base))

    # Allow env-provided aliases (pipe/comma/semicolon separated).
    if WAKE_ALIASES:
        parts = re.split(r"[|,;\n]+", WAKE_ALIASES)
        parts = [p.strip() for p in parts if p and p.strip()]
        for p in parts:
            extra_raw.append(re.sub(r"\baskvox\b", p, base))

    norms: List[str] = []
    seen = set()
    for s in [base, *extra_raw]:
        n = _normalize(s)
        if not n or n in seen:
            continue
        seen.add(n)
        norms.append(n)
    return norms


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
    parts: List[str] = []
    for wake_norm in _wake_alias_norms(wake_phrase):
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


def _best_wake_match(wake_window: str, wake_phrase: str) -> tuple[int, str]:
    """Return (score, alias_norm) for the best alias."""
    best_score = 0
    best_alias = _normalize(wake_phrase)
    for alias in _wake_alias_norms(wake_phrase):
        s = int(fuzz.partial_ratio(wake_window, alias))
        if s > best_score:
            best_score = s
            best_alias = alias
    return best_score, best_alias


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
        # Keep this configurable; short wake phrases can be < 0.8s in real use.
        try:
            MIN_DURATION = float(os.getenv("MIN_WAKE_SECONDS", "0.6"))
        except Exception:
            MIN_DURATION = 0.6
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
                model_path = await _ensure_vosk_model_path()
                if not model_path:
                    raise RuntimeError("Vosk model not available (set VOSK_MODEL_PATH or enable VOSK_AUTO_DOWNLOAD)")
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

        wake_window = _extract_wake_window(text, max_words=5)
        score, best_alias = _best_wake_match(wake_window, user_phrase)
        wake_match = score >= WAKE_THRESHOLD
        wake_words = [w for w in best_alias.split() if w]
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
            f"🔍 [Wake] phrase='{user_phrase}' best_alias='{best_alias}' window='{wake_window}' "
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
        if wake_match and best_alias:
            tokens2 = text.split()
            wake_tokens = best_alias.split()
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
