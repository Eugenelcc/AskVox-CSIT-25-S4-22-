# AskVox Backend (FastAPI + PostgreSQL + Alembic)

This folder contains the AskVox backend API built with **FastAPI**, using **PostgreSQL** for the database, **SQLAlchemy** for ORM, and **Alembic** for migrations.

---

## Folder Structure (backend/)

- `app/` – FastAPI application code (routes, models, config)
- `alembic_migrations/` – Alembic migration scripts
- `alembic.ini` – Alembic config
- `seeding/` – seed scripts (e.g. create admin user)
- `Dockerfile` – API container build
- `docker-compose.yml` – runs API + Postgres
- `entrypoint.sh` – waits for DB → runs migrations → starts API
- `.env` – local dev environment variables (non-docker)
- `.env.docker` – docker environment variables (used by docker compose)
- `requirements.txt` – Python dependencies
- `dev.py` – helper for local (venv) workflow (optional)
- `docker.py` – helper for docker workflow (short commands)

---

## Requirements

### Docker workflow (recommended)
- Docker Desktop (with `docker compose`)

### Local workflow (optional)
- Python 3.12+

---

## Environment Variables

### Docker (`.env.docker`)
Inside Docker, the DB host is the compose service name `db` and the internal port is `5432`.

```env
DATABASE_URL=postgresql+asyncpg://askvox_user:askvox_pw@db:5432/askvox_db
DATABASE_URL_SYNC=postgresql+psycopg://askvox_user:askvox_pw@db:5432/askvox_db
CORS_ORIGINS=http://localhost:5173

SECRET_KEY=change_me_to_a_long_random_string
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
```

### Local (`.env`)
If you run FastAPI locally and your Postgres is mapped to host port `5433`:

```env
DATABASE_URL=postgresql+asyncpg://askvox_user:askvox_pw@localhost:5433/askvox_db
DATABASE_URL_SYNC=postgresql+psycopg://askvox_user:askvox_pw@localhost:5433/askvox_db
CORS_ORIGINS=http://localhost:5173

SECRET_KEY=change_me_to_a_long_random_string
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
```

> ⚠️ Do not commit real secrets to GitHub. Use a strong `SECRET_KEY` for production.

---

## Quick Start (Docker)

From the `backend/` folder:

### 1) Build + start API + Postgres
```bash
docker compose up -d --build
```

### 2) View backend logs (recommended while testing)
```bash
docker compose logs -f api
```

### 3) Open Swagger
- http://127.0.0.1:8000/docs

---

## Migrations (Alembic)

### Auto-run on startup
When the `api` container starts, `entrypoint.sh` will:
1) wait for DB  
2) run migrations: `alembic upgrade head`  
3) start Uvicorn  

You will see in logs:
- `== AskVox: running migrations ==`
- `✅ Migrations done`

### Run migration manually
```bash
docker compose exec api python -m alembic upgrade head
```

### Create a new migration (after changing models)
```bash
docker compose exec api python -m alembic revision --autogenerate -m "describe change"
docker compose exec api python -m alembic upgrade head
```

---

## Short Docker Commands (optional helper)

This repo includes `backend/docker.py` to shorten common docker commands:

```bash
python docker.py up      # docker compose up -d --build
python docker.py mig     # run alembic upgrade head inside api container
python docker.py logs    # follow api logs
python docker.py down    # docker compose down
```

---

## Creating a Virtual Environment (venv) — explicit steps

If you want to run the backend locally without Docker, create and use a Python virtual environment to isolate dependencies. The following steps show how to create, activate, install dependencies, and deactivate a venv on macOS/Linux and Windows.

Note: the project also provides `dev.py` which automates some of these steps (see "Optional: Local Dev (venv)" below). The commands below are the manual equivalents.

1) From the `backend/` folder, create the venv:
- Mac / Linux
  ```bash
  python3 -m venv .venv
  ```
- Windows (PowerShell / CMD, where `python` points to your desired Python)
  ```powershell
  python -m venv .venv
  ```

2) Activate the venv:
- Mac / Linux
  ```bash
  source .venv/bin/activate
  ```
- Windows PowerShell
  ```powershell
  .venv\Scripts\Activate.ps1
  ```
- Windows CMD
  ```cmd
  .venv\Scripts\activate.bat
  ```

3) Upgrade pip (recommended) and install requirements:
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

4) Verify installation and Python interpreter:
```bash
python -V
pip list
```

5) Run the app (development mode with auto-reload):
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Replace `app.main:app` with the actual import path for the FastAPI app if different.

6) Deactivate the venv when done:
```bash
deactivate
```

Tips:
- If `python3` is required on your machine, use `python3` instead of `python`.
- If you prefer `poetry` or `pipenv`, you can use those tools instead — they provide similar isolation and dependency management.
- If the repository includes `dev.py`, `python dev.py setup` may create and install the venv for you (see next section).

---

## Optional: Local Dev (venv)

If you prefer running FastAPI locally using the helper scripts in this repo:

### 1) Create venv + install deps (helper)
```bash
python dev.py setup
```
This script typically:
- creates a `.venv`
- activates it (or instructs you to activate)
- installs dependencies (from `requirements.txt`)

### 2) Run migrations (helper)
```bash
python dev.py migrate
```

### 3) Run API (helper)
```bash
python dev.py run
```

Swagger:
- http://127.0.0.1:8000/docs

If you prefer to do the steps manually, follow the "Creating a Virtual Environment (venv)" section above.

---

## Testing the API quickly

### Health check (if you added `/health`)
```bash
curl http://127.0.0.1:8000/health
```

### Protected route should return 401 without token
```bash
curl -i http://127.0.0.1:8000/me
```

---

## Troubleshooting

### “Missing bearer token” in Swagger
- Click **Authorize** in Swagger
- Paste: `Bearer <access_token>`
- Then call protected endpoints like `/me`

### Docker DB connection issues
- In `.env.docker`, use `db:5432` (NOT `localhost:5433`)
- In `.env` (local), use `localhost:5433`

### Reset database completely (wipe all data)
```bash
docker compose down -v
docker compose up -d --build
```

---

## Notes
- Postgres host port mapping: `5433:5432`
  - `5433` is for your host machine
  - `5432` is used inside Docker network
