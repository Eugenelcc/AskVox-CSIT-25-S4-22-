"""
Watermark detection API endpoints
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.watermark_detector import WatermarkDetector

router = APIRouter(prefix="/watermark", tags=["watermark"])

detector = WatermarkDetector()


class TextAnalysisRequest(BaseModel):
    text: str


class TextAnalysisResponse(BaseModel):
    has_watermark: bool
    ai_percentage: int
    human_percentage: int
    details: dict


@router.post("/analyze", response_model=TextAnalysisResponse)
async def analyze_text(request: TextAnalysisRequest):
    """
    Analyze text for AI watermarks and return detection results
    """
    if not request.text or len(request.text.strip()) == 0:
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    try:
        result = detector.analyze_text(request.text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
