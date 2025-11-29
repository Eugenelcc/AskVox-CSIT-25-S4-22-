#!/usr/bin/env sh
set -e

echo "== AskVox: waiting for database =="

# Wait until DB is reachable (uses DATABASE_URL_SYNC)
python - <<'PY'
import os, time
from sqlalchemy import create_engine, text

url = os.getenv("DATABASE_URL_SYNC")
if not url:
    raise SystemExit("DATABASE_URL_SYNC not set")

for i in range(60):
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("DB is ready")
        break
    except Exception as e:
        print(f"DB not ready yet ({i+1}/60): {e}")
        time.sleep(1)
else:
    raise SystemExit("DB never became ready")
PY

echo "== AskVox: running migrations =="
python -m alembic upgrade head
echo "✅ Migrations done"

# Optional: seed admin (safe if your script handles 'already exists')
# echo "== AskVox: seeding admin =="
# python seeding/seed_admin.py
# echo "✅ Seeding done"

echo "== AskVox: starting server =="
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
