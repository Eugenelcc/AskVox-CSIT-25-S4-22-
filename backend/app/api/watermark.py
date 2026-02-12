from __future__ import annotations

import unicodedata
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/watermark", tags=["watermark"])


class WatermarkAnalyzeReq(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)


ZERO_WIDTH = {
    "\u200b",  # ZERO WIDTH SPACE
    "\u200c",  # ZERO WIDTH NON-JOINER
    "\u200d",  # ZERO WIDTH JOINER
    "\u2060",  # WORD JOINER
    "\ufeff",  # ZERO WIDTH NO-BREAK SPACE / BOM
}

THIN_SPACES = {
    "\u2009",  # THIN SPACE
    "\u200a",  # HAIR SPACE
    "\u202f",  # NARROW NO-BREAK SPACE
    "\u205f",  # MEDIUM MATHEMATICAL SPACE
}


def _is_cyrillic(ch: str) -> bool:
    if not ch or len(ch) != 1:
        return False
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return False
    return "CYRILLIC" in name


@router.post("/analyze")
async def analyze_watermark(req: WatermarkAnalyzeReq) -> dict[str, Any]:
    """Lightweight heuristic analysis.

    The frontend expects:
      - ai_percentage (number)
      - human_percentage (number)
      - details (object)

    We treat the presence of watermark-like characters (zero-width/thin spaces/cyrillic)
    as an indicator.
    """

    text = req.text
    text_len = len(text)

    cyrillic_count = 0
    zero_width_count = 0
    thin_spaces_count = 0
    watermarked_positions: list[int] = []

    for idx, ch in enumerate(text):
        marked = False
        if ch in ZERO_WIDTH:
            zero_width_count += 1
            marked = True
        if ch in THIN_SPACES:
            thin_spaces_count += 1
            marked = True
        if _is_cyrillic(ch):
            # Cyrillic can be legitimate language; we still report it.
            cyrillic_count += 1
            marked = True

        if marked:
            watermarked_positions.append(idx)

    total_markers = cyrillic_count + zero_width_count + thin_spaces_count

    # Simple, deterministic scoring for the UI.
    if total_markers > 0:
        ai_percentage = 80
        human_percentage = 20
    else:
        ai_percentage = 20
        human_percentage = 80

    return {
        "ai_percentage": ai_percentage,
        "human_percentage": human_percentage,
        "details": {
            "cyrillic_count": cyrillic_count,
            "zero_width_count": zero_width_count,
            "thin_spaces_count": thin_spaces_count,
            "total_markers": total_markers,
            "text_length": text_len,
            "watermarked_positions": watermarked_positions,
        },
    }
