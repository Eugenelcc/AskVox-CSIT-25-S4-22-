

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.session import get_db


from app.api.accounts.auth import router as auth_router
from app.api.me import router as me_router
from app.api.admin import router as admin_router
from app.api.chats.chat import router as chat_router
from app.api.chats.llamachat import router as llamachat_router

from app.services.stt_router import router as services_router
from app.services.google_stt import router as google_stt_router


app = FastAPI(title="AskVox API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(me_router)
app.include_router(admin_router)
app.include_router(chat_router)
app.include_router(llamachat_router)
app.include_router(services_router)

app.include_router(google_stt_router)

@app.get("/health")
def health():
    print("Health scheck OK")
    return {"ok": True}


@app.get("/db-check")
async def db_check(db: AsyncSession = Depends(get_db)):
    r = await db.execute(text("SELECT 1"))
    return {"db": r.scalar_one()}
