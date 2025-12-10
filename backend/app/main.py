from fastapi import FastAPI, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.session import get_db


from app.api.accounts.auth import router as auth_router
from app.api.me import router as me_router
from app.api.admin import router as admin_router


app = FastAPI(title="AskVox API")

app.include_router(auth_router)
app.include_router(me_router)
app.include_router(admin_router)


@app.get("/health")
def health():
    print("Health scheck OK")
    return {"ok": True}

@app.get("/db-check")
async def db_check(db: AsyncSession = Depends(get_db)):
    r = await db.execute(text("SELECT 1"))
    return {"db": r.scalar_one()}
