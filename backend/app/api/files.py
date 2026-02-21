from __future__ import annotations

import io
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/files", tags=["files"])


MAX_BYTES = 10 * 1024 * 1024  # 10MB


def _ext_from_upload(file: UploadFile) -> str:
    name = file.filename or ""
    ext = Path(name).suffix.lower().lstrip(".")
    if ext:
        return ext
    # fallback to content-type
    ct = (file.content_type or "").lower()
    if "pdf" in ct:
        return "pdf"
    if "word" in ct or "docx" in ct:
        return "docx"
    if "text" in ct:
        return "txt"
    if "png" in ct:
        return "png"
    if "jpeg" in ct or "jpg" in ct:
        return "jpg"
    return ""


def _extract_text_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t:
            parts.append(t)
    return "\n".join(parts).strip()


def _extract_text_docx(data: bytes) -> str:
    import docx  # python-docx

    document = docx.Document(io.BytesIO(data))
    parts = [p.text for p in document.paragraphs if p.text]
    return "\n".join(parts).strip()


@router.post("/extract-text")
async def extract_text(file: UploadFile = File(...)):
    """Extract text from PDF/DOCX/TXT.

    For lightweight Railway deploys, image OCR is not enabled.
    The frontend expects JSON with either:
      - {"text": "..."}
      - or {"error": "..."}
    """

    data = await file.read()
    if len(data) > MAX_BYTES:
        return JSONResponse({"error": "File too large. Max 10MB."})

    ext = _ext_from_upload(file)

    try:
        if ext == "pdf":
            text = _extract_text_pdf(data)
        elif ext == "docx":
            text = _extract_text_docx(data)
        elif ext in {"txt", "md", "csv"} or (file.content_type or "").lower().startswith("text/"):
            text = data.decode("utf-8", errors="ignore").strip()
        elif ext in {"png", "jpg", "jpeg", "webp"} or (file.content_type or "").lower().startswith("image/"):
            return JSONResponse(
                {
                    "error": "Image OCR is not enabled on this deployment. Please upload a PDF/DOCX or paste text directly."
                }
            )
        else:
            return JSONResponse({"error": "Unsupported file type. Please upload PDF/DOCX or paste text."})

        if not text:
            return JSONResponse({"error": "No extractable text found in this file. If it's a scanned PDF/image, please paste text instead."})

        return {"text": text}
    except Exception:
        # Keep error messages generic for security; the UI will still show a friendly message.
        return JSONResponse({"error": "Failed to extract text from file."})
