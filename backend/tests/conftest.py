import os
import sys
import types
from pathlib import Path

# Ensure `backend/` is on sys.path so `import app` resolves to backend/app
ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Test-safe environment defaults for pydantic Settings
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DATABASE_URL_SYNC", "sqlite:///./test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

# Lightweight stub for `aiosqlite` if not installed
if "aiosqlite" not in sys.modules:
    sys.modules["aiosqlite"] = types.ModuleType("aiosqlite")

# Stub `sqlalchemy.ext.asyncio` to avoid creating a real engine during import
if "sqlalchemy.ext.asyncio" not in sys.modules:
    mod = types.ModuleType("sqlalchemy.ext.asyncio")

    def create_async_engine(*args, **kwargs):
        class DummyEngine:
            pass

        return DummyEngine()

    def async_sessionmaker(engine, class_=None, expire_on_commit=False):
        def _maker(*args, **kwargs):
            class DummySession:
                async def __aenter__(self):
                    return self

                async def __aexit__(self, exc_type, exc, tb):
                    return False

                async def execute(self, *a, **k):
                    return None

            return DummySession()

        return _maker

    mod.create_async_engine = create_async_engine
    mod.async_sessionmaker = async_sessionmaker
    mod.AsyncSession = object
    sys.modules["sqlalchemy.ext.asyncio"] = mod
