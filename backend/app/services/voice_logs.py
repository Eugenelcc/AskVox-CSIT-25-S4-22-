from fastapi import APIRouter

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/log")
async def voice_log(payload: dict):
    text = payload.get("text", "")
    kind = payload.get("kind", "log")
    try:
        print(f"👂 Heard ({kind}): {text}")
    except Exception:
        pass
    return {"ok": True}
