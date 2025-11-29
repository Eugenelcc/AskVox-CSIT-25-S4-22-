from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.users import User

router = APIRouter(tags=["me"])

@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}
