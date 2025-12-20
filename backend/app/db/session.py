from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def _sanitize_db_url(url: str) -> str:
    """Remove any `sslmode` query param which asyncpg does not accept as a keyword arg.

    This keeps URLs like `postgresql+asyncpg://.../?sslmode=require` from raising
    `TypeError: connect() got an unexpected keyword argument 'sslmode'`.
    """
    try:
        parts = urlsplit(url)
        if not parts.query:
            return url
        qs = parse_qsl(parts.query, keep_blank_values=True)
        filtered = [(k, v) for (k, v) in qs if k.lower() != "sslmode"]
        new_query = urlencode(filtered)
        if new_query == parts.query:
            return url
        return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
    except Exception:
        # If parsing fails for any reason, return original URL and let SQLAlchemy raise a clear error.
        return url


def get_engine():
    """Create engine only when needed (no side effects on import)."""
    db_url = _sanitize_db_url(settings.database_url)
    return create_async_engine(db_url, echo=False)


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
