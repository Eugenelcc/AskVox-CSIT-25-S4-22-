import os
import requests
from fastapi import APIRouter, UploadFile, File, HTTPException



ASSEMBLYAI_API_KEY = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
UPLOAD_URL = "https://api.assemblyai.com/v2/upload"
TRANSCRIBE_URL = "https://api.assemblyai.com/v2/transcript"


def _headers() -> dict:
    if not ASSEMBLYAI_API_KEY:
        return {}
    return {"authorization": ASSEMBLYAI_API_KEY}


router = APIRouter(prefix="/stt", tags=["stt"])



 

def upload_to_assemblyai(audio_bytes: bytes) -> str:
    """Uploads audio bytes to AssemblyAI and returns upload_url."""
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(status_code=500, detail="ASSEMBLYAI_API_KEY not configured")
    response = requests.post(
        UPLOAD_URL,
        headers=_headers(),
        data=audio_bytes,
    )

    # Debug: log what AssemblyAI returned so we can see why /stt/ fails.
    try:
        print(f"[STT][/v2/upload] status={response.status_code} body={response.text[:200]}")
    except Exception:
        pass

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to upload audio.")

    return response.json()["upload_url"]


def request_transcription(upload_url: str) -> str:
    """Creates a transcription request and waits for result."""
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(status_code=500, detail="ASSEMBLYAI_API_KEY not configured")
    json_body = {
        "audio_url": upload_url,
        # AssemblyAI requires an explicit speech model. To support
        # additional languages like zh (per their error message), include
        # both universal-3-pro and universal-2.
        "speech_models": ["universal-3-pro", "universal-2"],
    }

    # Start transcription
    res = requests.post(
        TRANSCRIBE_URL,
        json=json_body,
        headers=_headers()
    )

    try:
        print(f"[STT][/v2/transcript] start status={res.status_code} body={res.text[:200]}")
    except Exception:
        pass

    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to start transcription.")

    transcript_id = res.json()["id"]

    # Poll until done
    while True:
        poll_response = requests.get(
            f"{TRANSCRIBE_URL}/{transcript_id}",
            headers=_headers()
        )
        poll_res = poll_response.json()

        status = poll_res["status"]

        if status == "completed":
            return poll_res["text"]
        if status == "error":
            try:
                print(f"[STT][/v2/transcript] poll error body={poll_res}")
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Transcription failed.")

        import time
        time.sleep(0.5)


@router.post("/")
async def stt_endpoint(file: UploadFile = File(...)):
    """Receives audio from frontend, sends to AssemblyAI, returns transcript."""
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(status_code=500, detail="AssemblyAI STT is not configured on this backend")
    audio_bytes = await file.read()
    try:
        print(f"🗣️  [STT] Using AssemblyAI; recv bytes={len(audio_bytes)}")
    except Exception:
        pass

    # 1. Upload recording to AssemblyAI
    upload_url = upload_to_assemblyai(audio_bytes)

    # 2. Request transcription + wait
    text = request_transcription(upload_url)
    try:
        print(f"✍️  [STT] transcript='{(text or '').strip()[:120]}'")
    except Exception:
        pass

    return {"text": text}
