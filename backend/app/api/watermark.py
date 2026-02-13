from __future__ import annotations

import random
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

CYRILLIC_LOOKALIKES = {
    "A": "А",
    "B": "В",
    "C": "С",
    "E": "Е",
    "H": "Н",
    "K": "К",
    "M": "М",
    "O": "О",
    "P": "Р",
    "T": "Т",
    "X": "Х",
    "a": "а",
    "c": "с",
    "e": "е",
    "o": "о",
    "p": "р",
    "x": "х",
    "y": "у",
}


def insert_watermark(text: str, density: float = 0.05) -> str:
    """
    Insert invisible watermark characters (zero-width spaces) into text.
    
    Args:
        text: The text to watermark
        density: Fraction of positions to watermark (0.0 to 1.0). Default 0.05 = 5%
    
    Returns:
        Watermarked text with invisible characters inserted
    """
    if not text or density <= 0:
        return text
    
    # Convert to list for easier manipulation
    chars = list(text)

    insert_candidates = []
    replace_candidates = []

    for i in range(len(chars)):
        if i > 0 and chars[i - 1] in {" ", ",", ".", "!", "?", ";", ":", "\n"}:
            insert_candidates.append(i)
        if chars[i] in CYRILLIC_LOOKALIKES:
            replace_candidates.append(i)

    markers = list(ZERO_WIDTH | THIN_SPACES)

    if insert_candidates and markers:
        insert_count = max(1, int(len(insert_candidates) * density))
        selected_inserts = random.sample(insert_candidates, min(insert_count, len(insert_candidates)))
        selected_inserts.sort(reverse=True)
        for pos in selected_inserts:
            chars.insert(pos, random.choice(markers))

    if replace_candidates:
        replace_count = max(1, int(len(replace_candidates) * density))
        selected_replacements = random.sample(replace_candidates, min(replace_count, len(replace_candidates)))
        for pos in selected_replacements:
            chars[pos] = CYRILLIC_LOOKALIKES[chars[pos]]

    return "".join(chars)


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
