"""Create all tables from SQLAlchemy models using the sync DATABASE_URL_SYNC.

Usage (PowerShell):
    cd backend
    .\venv\Scripts\Activate.ps1
    python scripts/create_tables.py

This is a convenience helper for local testing. For production use Alembic migrations.
"""
from app.core.config import settings
from app.db.base import Base
from sqlalchemy import create_engine
#import sys


def main() -> int:
    url = settings.database_url_sync
    if not url:
        print("DATABASE_URL_SYNC is not set. Check backend/.env")
        return 2

    print(f"Creating tables on {url} ...")
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    print("Done.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
