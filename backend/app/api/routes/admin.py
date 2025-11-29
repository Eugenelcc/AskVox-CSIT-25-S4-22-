from fastapi import APIRouter, Depends
from app.api.deps import require_roles
from app.models.users import User

router = APIRouter(prefix="/admin", tags=["admin"])

@router.get("/ping")
async def ping_admin(_: User = Depends(require_roles("admin"))):
    return {"admin": True}
