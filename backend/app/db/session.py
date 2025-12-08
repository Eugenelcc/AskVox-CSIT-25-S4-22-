from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings


def get_engine():
    """Create engine only when needed (no side effects on import)."""
    return create_async_engine(settings.database_url, echo=False)


def get_sessionmaker(engine=None):
    if engine is None:
        engine = get_engine()
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# This will only create engine/session when first accessed
engine = get_engine()
SessionLocal = get_sessionmaker(engine)


async def get_db():
    async with SessionLocal() as session:
        yield session
