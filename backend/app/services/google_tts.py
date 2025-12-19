import os
import base64
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
import httpx


router = APIRouter(prefix="/tts", tags=["tts"])

# Prefer explicit TTS API key for REST calls
GOOGLE_TTS_API_KEY = os.getenv("GOOGLE_TTS_API_KEY")
GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"


@router.post("/google")
async def google_tts(payload: dict):
    """
    Synthesize speech via Google Cloud Text-to-Speech REST API.
    Expects JSON: { text: str, language_code?: str, voice_name?: str, speaking_rate?: float }
    Returns: audio/mpeg (MP3 bytes)
    """
    text: str = (payload or {}).get("text") or ""
    language_code: str = (payload or {}).get("language_code") or "en-US"
    voice_name: str = payload.get("voice_name") or "en-US-Neural2-F"
    speaking_rate = (payload or {}).get("speaking_rate")

    if not text:
        raise HTTPException(status_code=400, detail="Missing 'text' for TTS")

    if not GOOGLE_TTS_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_TTS_API_KEY not configured")

    voice = {"languageCode": language_code}
    if voice_name:
        voice["name"] = voice_name

    audio_config: dict = {"audioEncoding": "MP3"}
    if speaking_rate is not None:
        audio_config["speakingRate"] = speaking_rate

    req_body = {
        "input": {"text": text},
        "voice": voice,
        "audioConfig": audio_config,
    }

    # Debug logging
    try:
        print(f"🔊 [TTS] Google REST synth: lang={language_code} voice={voice_name or 'default'} len(text)={len(text)}")
    except Exception:
        pass

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{GOOGLE_TTS_URL}?key={GOOGLE_TTS_API_KEY}",
                json=req_body,
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        data = resp.json()
        audio_b64 = data.get("audioContent")
        if not audio_b64:
            raise HTTPException(status_code=500, detail="No audioContent in TTS response")
        audio_bytes = base64.b64decode(audio_b64)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except HTTPException:
        raise
    except Exception as e:
        print("[TTS] Error:", e)
        raise HTTPException(status_code=500, detail=str(e))
