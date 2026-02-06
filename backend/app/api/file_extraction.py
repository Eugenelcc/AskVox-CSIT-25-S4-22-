from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse
import fitz  # PyMuPDF for PDF
import docx
from PIL import Image
import io
import os
from pathlib import Path
import tempfile
import uuid
from app.core.config import settings

router = APIRouter(prefix="/files", tags=["file-extraction"])

# Try to import pytesseract (lighter option), fallback to EasyOCR if not available
try:
    import pytesseract
    OCR_ENGINE = "tesseract"
    # For Windows deployment, check if tesseract is in PATH
    if os.name == 'nt' and os.path.exists(r"C:\Program Files\Tesseract-OCR\tesseract.exe"):
        pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
except ImportError:
    try:
        import easyocr
        OCR_ENGINE = "easyocr"
        ocr_reader = None
    except ImportError:
        OCR_ENGINE = None

def get_ocr_reader():
    """Get EasyOCR reader (only if using EasyOCR)"""
    global ocr_reader
    if OCR_ENGINE == "easyocr" and ocr_reader is None:
        import easyocr
        ocr_reader = easyocr.Reader(['en'], gpu=False)
    return ocr_reader


# Optional local vision models (YOLOv8 + BLIP)
VISION_AVAILABLE = False
YOLO = None
torch = None
BlipProcessor = None
BlipForConditionalGeneration = None

try:
    from ultralytics import YOLO
    import torch
    from transformers import BlipProcessor, BlipForConditionalGeneration
    VISION_AVAILABLE = True
except Exception as e:
    print(f"[Vision] Import failed: {e}")

yolo_model = None
blip_processor = None
blip_model = None


def get_yolo_model():
    global yolo_model
    if yolo_model is None:
        try:
            yolo_model = YOLO("yolov8n.pt", verbose=False)
        except Exception as e:
            print(f"[YOLO] Failed to load: {e}")
            raise
    return yolo_model


def get_blip():
    global blip_processor, blip_model
    if blip_processor is None or blip_model is None:
        try:
            blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
            blip_model = BlipForConditionalGeneration.from_pretrained(
                "Salesforce/blip-image-captioning-base"
            )
            # Use CPU by default (no GPU)
            device = "cpu"
            blip_model = blip_model.to(device)
        except Exception as e:
            print(f"[BLIP] Failed to load: {e}")
            raise
    return blip_processor, blip_model


def save_temp_upload(contents: bytes, filename: str) -> str:
    temp_dir = Path(tempfile.gettempdir()) / "askvox_uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}_{Path(filename).name}"
    path = temp_dir / safe_name
    path.write_bytes(contents)
    return str(path)


@router.post("/extract-text")
async def extract_text(file: UploadFile = File(...)):
    """
    Extract text from PDF, DOCX, or image files.
    
    Supported formats:
    - PDF: Direct text extraction
    - DOCX: Paragraph extraction
    - Images (PNG, JPG, JPEG, WEBP, GIF, HEIC): OCR using EasyOCR (no Tesseract needed!)
    """
    filename = file.filename.lower()
    text = ""
    
    try:
        contents = await file.read()
        
        # PDF extraction
        if filename.endswith(".pdf"):
            doc = fitz.open(stream=contents, filetype="pdf")
            for page in doc:
                text += page.get_text()
            doc.close()
        
        # DOCX extraction
        elif filename.endswith(".docx"):
            document = docx.Document(io.BytesIO(contents))
            for para in document.paragraphs:
                text += para.text + "\n"
        
        # Image OCR (auto-detects Tesseract or EasyOCR)
        elif filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic")):
            if OCR_ENGINE is None:
                raise HTTPException(
                    status_code=501, 
                    detail="OCR not available. Install pytesseract or easyocr for image text extraction."
                )
            
            image = Image.open(io.BytesIO(contents))
            
            # Convert RGBA to RGB if needed
            if image.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
                image = background
            elif image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Use available OCR engine
            if OCR_ENGINE == "tesseract":
                text = pytesseract.image_to_string(image)
            else:  # easyocr
                reader = get_ocr_reader()
                result = reader.readtext(image, detail=0)
                text = "\n".join(result)
        
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Supported: PDF, DOCX, PNG, JPG, JPEG, WEBP, GIF, HEIC")
        
        return JSONResponse(content={"text": text.strip()})
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.post("/analyze-image")
async def analyze_image(
    file: UploadFile = File(...),
    mode: str = Query("both", pattern="^(labels|caption|both)$"),
):
    """
    Analyze image using Google Generative AI (Gemini) for high accuracy.
    - Fast: Instant API response, no model downloads
    - Accurate: State-of-the-art vision model
    """
    filename = (file.filename or "").lower()
    if not filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic")):
        raise HTTPException(status_code=400, detail="Unsupported image type")

    try:
        import google.generativeai as genai
        from PIL import Image
        import io
        
        api_key = settings.google_api_key
        if not api_key:
            raise HTTPException(
                status_code=501,
                detail="GOOGLE_API_KEY not configured in environment"
            )
        
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-flash-latest")
        
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        # Convert to RGB if needed
        if image.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
            image = background
        elif image.mode != 'RGB':
            image = image.convert('RGB')
        
        labels = []
        caption = ""
        
        # Object detection with Gemini
        if mode in ("labels", "both"):
            prompt = "List all the main objects, landmarks, or things you can identify in this image. Provide a comma-separated list of 3-8 objects. Be specific and accurate. Examples: building, sky, clouds, people, car, tree. Only list the objects, no explanation."
            response = model.generate_content([prompt, image])
            if response.text:
                # Clean and split the response
                text = response.text.strip()
                labels = [x.strip() for x in text.split(",") if x.strip()][:8]
                print(f"✅ [Gemini] Objects detected: {labels}")
        
        # Image captioning with Gemini
        if mode in ("caption", "both"):
            prompt = "Describe what you see in this image in one clear, concise sentence (max 20 words). Focus on the main subject or landmark."
            response = model.generate_content([prompt, image])
            if response.text:
                caption = response.text.strip()
                print(f"✅ [Gemini] Caption: {caption}")
        
        return JSONResponse(
            content={
                "labels": labels,
                "caption": caption,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [Gemini] Error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error analyzing image: {str(e)}")
