from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.session import get_db

# ... your other router imports ...
from app.api.accounts.auth import router as auth_router
from app.api.me import router as me_router
from app.api.admin import router as admin_router
from app.api.chats.chat import router as chat_router
# from app.api.chats.llamachat import router as llamachat_router  # Disabled: prefer multimodal routes
from app.api.chats.MultimodalLlamachat import router as llamachat_plus_router
from app.services.stt_router import router as services_router
from app.services.google_stt import router as google_stt_router
from app.services.google_tts import router as google_tts_router
from app.services.wake_stt import router as wake_router
from app.services.voice_logs import router as voice_logs_router
from app.services.smartrec import router as smartrec_router
from app.api.accounts.billing import router as billing_router
from app.api.news_worker import router as news_worker_router
from app.services.quiz import router as quiz_router


app = FastAPI(title="AskVox API")

# --- CORS CONFIGURATION ---
# IMPORTANT: When you deploy to Vercel/Cloud, add your REAL frontend URL here!
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://askvox-csit-25-s4-22-1.onrender.com",
    "https://askvox-front-production.up.railway.app",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    #allow_origin_regex=r"^https://askvox-csit-25-s4-22(-.*)?\.onrender\.com$",
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- INCLUDE ROUTERS ---
app.include_router(auth_router)
app.include_router(me_router)
app.include_router(admin_router)
app.include_router(chat_router)
# app.include_router(llamachat_router)  # Disabled: using multimodal `llamachat_plus_router` instead
app.include_router(llamachat_plus_router)
app.include_router(services_router)
app.include_router(google_stt_router)
app.include_router(google_tts_router)
app.include_router(wake_router)
app.include_router(voice_logs_router)
app.include_router(smartrec_router)
app.include_router(billing_router)
app.include_router(news_worker_router)  
app.include_router(quiz_router)



# --- HEALTH CHECKS ---

@app.api_route("/health", methods=["GET", "HEAD"])
async def health(db: AsyncSession = Depends(get_db)):
    """
    Checks if the Backend is running and if the Database is accessible.
    """
    status = {"backend": "online", "database": "unknown"}

    try:
        await db.execute(text("SELECT 1"))
        status["database"] = "online"
    except Exception as e:
        status["database"] = "offline"
        status["error"] = str(e)

    return JSONResponse(content=status)

@app.get("/db-check")
async def db_check(db: AsyncSession = Depends(get_db)):
    # This is a redundant check now that /health does it, but good for debugging!
    try:
        r = await db.execute(text("SELECT 1"))
        return {"db": "connected", "result": r.scalar_one()}
    except Exception as e:
        return {"db": "disconnected", "error": str(e)}
