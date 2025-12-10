import os
import base64
from fastapi import APIRouter, UploadFile, File, HTTPException
from google.cloud import speech
import httpx
from google.cloud.speech import SpeechAsyncClient

router = APIRouter(prefix="/gstt", tags=["gstt"])


# --- 1. CONFIGURATION ---
# Point to your keys
GOOGLE_API_KEY = os.getenv("GOOGLE_SST_API_KEY")
GOOGLE_URL = "https://speech.googleapis.com/v1/speech:recognize"

@router.post("/transcribe")
async def transcribe_audio(file: UploadFile):
    # 1. Read audio file
    audio_content = await file.read()

    # 2. Base64 Encode (Required for Google REST API)
    # The REST API cannot take raw binary; it needs a text string.
    audio_b64 = base64.b64encode(audio_content).decode("utf-8")

    # 3. Construct the JSON Payload
    payload = {
        "config": {
            "encoding": "WEBM_OPUS",  # Standard for browser mic audio
            "sampleRateHertz": 48000,
            "languageCode": "en-US",
            "enableAutomaticPunctuation": True
        },
        "audio": {
            "content": audio_b64
        }
    }

    # 4. Send Request to Google
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{GOOGLE_URL}?key={GOOGLE_API_KEY}",
                json=payload,
                timeout=30.0
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)

            data = response.json()
            
            # 5. Extract Text
            # Google returns: { "results": [ { "alternatives": [ { "transcript": "..." } ] } ] }
            results = data.get("results", [])
            if not results:
                return {"text": ""}
                
            full_transcript = " ".join([r["alternatives"][0]["transcript"] for r in results])
            return {"text": full_transcript}

        except Exception as e:
            print(f"Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# To run: uvicorn main:app --reload