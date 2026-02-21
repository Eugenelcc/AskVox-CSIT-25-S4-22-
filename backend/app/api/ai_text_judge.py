from __future__ import annotations

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llama_judge import judge_ai_text

router = APIRouter(prefix="/detect", tags=["detect"])


class AIDetectRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)


class AIDetectResponse(BaseModel):
    ai_percentage: int
    human_percentage: int
    rationale: str | None = None
    raw: dict | None = None


@router.post("/ai-text", response_model=AIDetectResponse)
async def detect_ai_text(req: AIDetectRequest) -> AIDetectResponse:
    """Estimate likelihood that text is AI-generated using LLaMA as a judge.

    This is probabilistic and not proof.
    """
    result = await judge_ai_text(req.text)

    ai_pct = int(result.get("ai_percentage", 0))
    ai_pct = max(0, min(100, ai_pct))
    return AIDetectResponse(
        ai_percentage=ai_pct,
        human_percentage=100 - ai_pct,
        rationale=result.get("rationale"),
        raw=result,
    )
