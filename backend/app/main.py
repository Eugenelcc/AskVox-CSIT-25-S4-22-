from fastapi import FastAPI, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_db

app = FastAPI(title="AskVox API")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/db-check")
async def db_check(db: AsyncSession = Depends(get_db)):
    r = await db.execute(text("SELECT 1"))
    return {"db": r.scalar_one()}
