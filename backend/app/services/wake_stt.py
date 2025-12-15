import os
import re
from typing import Optional, List

import numpy as np
from fastapi import APIRouter, Body, Query
from rapidfuzz import fuzz

try:
    import whisper
except Exception as e:  # pragma: no cover
    whisper = None


USER_WAKE_PHRASE = os.getenv("USER_WAKE_PHRASE", "Hey AskVox")
WAKE_THRESHOLD = int(os.getenv("WAKE_THRESHOLD", "75"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "en")
WHISPER_TEMPERATURE = float(os.getenv("WHISPER_TEMPERATURE", "0.0"))
WHISPER_BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
WHISPER_NO_SPEECH = float(os.getenv("WHISPER_NO_SPEECH", "0.6"))
CORE_ONLY_THRESHOLD = int(os.getenv("CORE_ONLY_THRESHOLD", "78"))

router = APIRouter(prefix="/wake", tags=["wake"])


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _extract_wake_window(text: str, max_words: int = 5) -> str:
    return " ".join(text.split()[:max_words])


_model: Optional[object] = None


def _get_model():
    global _model
    if _model is None:
        if whisper is None:
            raise RuntimeError("whisper is not installed; ensure openai-whisper is in requirements")
        _model = whisper.load_model(WHISPER_MODEL)
    return _model


GREETINGS = {"hey", "hi", "hello", "yo", "ok", "okay"}


def _core_words(wake_norm: str) -> List[str]:
    return [w for w in wake_norm.split() if w and w not in GREETINGS]


def _build_initial_prompt() -> str:
    custom = os.getenv("WAKE_PROMPT")
    if custom:
        return custom
    wake_norm = _normalize(USER_WAKE_PHRASE)
    cores = _core_words(wake_norm)
    core = cores[0] if cores else wake_norm.split()[-1]
    spelled = " ".join(list(core.upper()))
    return (
        f"The assistant wake phrase is '{USER_WAKE_PHRASE}'. "
        f"If you hear it, transcribe it exactly. The name '{core}' is spelled {spelled} and pronounced 'nee-roo-bah'. "
        f"Do not substitute with similar words like 'hello' or 'new baba'."
    )


@router.post("/transcribe_pcm")
async def transcribe_pcm(
    body: bytes = Body(..., media_type="application/octet-stream"),
    sr: int = Query(16000, description="Sample rate of the incoming Float32 PCM"),
):
    try:
        audio = np.frombuffer(body, dtype=np.float32)
    except Exception:
        audio = np.array([], dtype=np.float32)

    samples = int(audio.size)
    dur = samples / float(sr or 1)
    try:
        print(f"🎧 [Wake] recv sr={sr} bytes={len(body)} samples={samples} dur={dur:.2f}s")
    except Exception:
        pass

    # Guards: minimum duration and minimum RMS energy
    MIN_DURATION = 0.8  # seconds
    rms = float(np.sqrt(np.mean(audio ** 2))) if audio.size else 0.0
    if dur < MIN_DURATION:
        return {
            "text": "",
            "wake_phrase": USER_WAKE_PHRASE,
            "score": 0,
            "wake_match": False,
            "command": "",
            "reason": "audio_too_short",
        }
    MIN_RMS = float(os.getenv("MIN_WAKE_RMS", "0.005"))
    if rms < MIN_RMS:
        return {
            "text": "",
            "wake_phrase": USER_WAKE_PHRASE,
            "score": 0,
            "wake_match": False,
            "command": "",
            "reason": "silence",
        }

    # Resample to 16k for Whisper
    target_sr = 16000
    if sr and sr != target_sr and samples > 0:
        x_old = np.linspace(0, dur, num=samples, endpoint=False)
        new_len = int(round(dur * target_sr)) or 1
        x_new = np.linspace(0, dur, num=new_len, endpoint=False)
        audio = np.interp(x_new, x_old, audio).astype(np.float32)
        try:
            print(f"🎧 [Wake] resampled -> samples={audio.size} dur={audio.size/target_sr:.2f}s @16k")
        except Exception:
            pass
    else:
        target_sr = sr or 16000

    # Make array writable to avoid PyTorch warning
    audio = np.array(audio, dtype=np.float32, copy=True)
    model = _get_model()
    result = model.transcribe(
        audio,
        fp16=False,
        initial_prompt=_build_initial_prompt(),
        language=WHISPER_LANGUAGE,
        temperature=WHISPER_TEMPERATURE,
        beam_size=WHISPER_BEAM_SIZE,
        no_speech_threshold=WHISPER_NO_SPEECH,
        condition_on_previous_text=False,
        suppress_tokens=[-1],
    )
    raw_text = result.get("text", "") or ""
    text = _normalize(raw_text)
    try:
        print(f"🗒️  [Wake] raw='{raw_text}'")
        print(f"🧼  [Wake] norm='{text}'")
    except Exception:
        pass

    wake_norm = _normalize(USER_WAKE_PHRASE)
    wake_window = _extract_wake_window(text, max_words=5)
    score = int(fuzz.partial_ratio(wake_window, wake_norm))
    wake_match = score >= WAKE_THRESHOLD
    wake_words = [w for w in wake_norm.split() if w]
    # Require presence of at least one core (non-greeting) word, e.g., 'askvox' or 'niruba'
    core_words = [w for w in wake_words if w not in GREETINGS]
    core_present = sum(1 for w in core_words if w in wake_window)
    if len(core_words) > 0:
        if core_present < 1:
            wake_match = False
    else:
        # Fallback: if no core words identified, require at least 2 tokens present
        present = sum(1 for w in wake_words if w in wake_window)
        if present < min(2, len(wake_words)):
            wake_match = False

    # Secondary acceptance: if the core name appears very early (<= first 3 tokens),
    # allow slightly lower similarity using a core-only comparison.
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

    try:
        print(
            f"🔍 [Wake] phrase='{USER_WAKE_PHRASE}' window='{wake_window}' "
            f"score={score} core_score={core_score} core_present={core_present}/{len(core_words)} "
            f"earliest_core_pos={earliest_core_pos} match={wake_match}"
        )
        print({
            "duration": round(dur, 2),
            "rms": round(rms, 6),
            "raw": raw_text,
            "norm": text,
            "score": score,
            "match": wake_match,
        })
    except Exception:
        pass

    command = text
    if wake_match and wake_norm:
        # Robust stripping: drop matching wake tokens from the start in order
        tokens = text.split()
        wake_tokens = wake_norm.split()
        while tokens and wake_tokens and tokens[0] == wake_tokens[0]:
            tokens.pop(0)
            wake_tokens.pop(0)
        command = " ".join(tokens).strip()
        if len(command.split()) < 2:
            command = ""
        try:
            print(f"🧾 [Command] '{command}'")
        except Exception:
            pass

    return {
        "text": text,
        "wake_phrase": USER_WAKE_PHRASE,
        "score": score,
        "wake_match": wake_match,
        "command": command,
    }
