import os
import requests
from fastapi import APIRouter, UploadFile, File, HTTPException



ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not ASSEMBLYAI_API_KEY:
    raise RuntimeError("Missing ASSEMBLYAI_API_KEY in environment")
UPLOAD_URL = "https://api.assemblyai.com/v2/upload"
TRANSCRIBE_URL = "https://api.assemblyai.com/v2/transcript"

headers = {
    "authorization": ASSEMBLYAI_API_KEY,
}


router = APIRouter(prefix="/stt", tags=["stt"])



 

def upload_to_assemblyai(audio_bytes: bytes) -> str:
    """Uploads audio bytes to AssemblyAI and returns upload_url."""
    response = requests.post(
        UPLOAD_URL,
        headers=headers,
        data=audio_bytes,
    )

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to upload audio.")

    return response.json()["upload_url"]


def request_transcription(upload_url: str) -> str:
    """Creates a transcription request and waits for result."""
    json_body = {
        "audio_url": upload_url
    }

    # Start transcription
    res = requests.post(
        TRANSCRIBE_URL,
        json=json_body,
        headers=headers
    )

    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to start transcription.")

    transcript_id = res.json()["id"]

    # Poll until done
    while True:
        poll_res = requests.get(
            f"{TRANSCRIBE_URL}/{transcript_id}",
            headers=headers
        ).json()

        status = poll_res["status"]

        if status == "completed":
            return poll_res["text"]

        if status == "error":
            raise HTTPException(status_code=500, detail="Transcription failed.")

        import time
        time.sleep(0.5)


@router.post("/")
async def stt_endpoint(file: UploadFile = File(...)):
    """Receives audio from frontend, sends to AssemblyAI, returns transcript."""
    audio_bytes = await file.read()

    # 1. Upload recording to AssemblyAI
    upload_url = upload_to_assemblyai(audio_bytes)

    # 2. Request transcription + wait
    text = request_transcription(upload_url)

    return {"text": text}
