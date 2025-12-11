# AskVox-CSIT-25-S4-22- — A Voice‑Activated Multimedia Knowledge Assistant

AskVox is a voice-first assistant that lets you speak your questions and receive rich, multimodal answers. It blends speech recognition, LLM-powered reasoning, and media retrieval to help you explore knowledge hands-free. It’s a conversational layer over your knowledge sources, able to respond with text, images, links, and more.

- Repository: Eugenelcc/AskVox-CSIT-25-S4-22-
- Description: AskVox - A Voice-Activated Multimedia Knowledge Assistant
- License: MIT (see [LICENSE](LICENSE))
- Language composition: Python (53.1%), CSS (22.8%), TypeScript (14.4%), Shell (2.6%), Mako (1.8%), JavaScript (1.5%), Other (3.8%)

This repository is organized into two primary folders:
- `backend/` — Python services (FastAPI), Supabase/Postgres integration, database migrations, and orchestration
- `frontend/` — Web UI (TypeScript/React via Vite) for interacting with AskVox

Quick links to backend resources:
- Backend README: backend/README.md
- Dockerfile: backend/Dockerfile
- Compose: backend/docker-compose.yml
- Requirements: backend/requirements.txt
- Entrypoint (container): backend/entrypoint.sh
- Dev helper script: backend/dev.py
- Windows run script: backend/run_backend.ps1
- Makefile (developer shortcuts): backend/makefile

## Table of Contents
- Introduction
- Features
- Architecture (at a glance)
- Prerequisites
- Installation
- Running the backend
  - Option A: With Docker Compose
  - Option B: Locally (Python venv) — step‑by‑step venv guide
- Running the frontend (no env required)
- Environment variables (backend only, with Supabase)
- Supabase setup notes
- Troubleshooting
- License

## Introduction

AskVox makes knowledge accessible through natural conversation. Speak to AskVox and receive contextual answers that can include media—images, links, and structured information—sourced from connected knowledge bases and external services. The system is designed for extensibility: you can swap speech, LLM, storage, and auth providers with configuration. This branch uses Supabase for its managed Postgres, auth, and APIs.

## Features

- Voice input and output for hands‑free interaction
- LLM-powered reasoning and summarization
- Multimedia responses (text + links and media previews)
- Web frontend with real-time connection to the backend
- Optional Dockerized development environment
- Database migrations via Alembic
- Supabase integration for Postgres, auth, and storage

## Architecture (at a glance)

- Backend (Python/FastAPI)
  - REST/WebSocket API for the frontend
  - Integrations for speech-to-text, text-to-speech, LLMs
  - Supabase Postgres as the primary database (managed), plus Supabase auth/storage if enabled
  - Alembic migrations for schema management
  - Containerized via `backend/Dockerfile` and `backend/docker-compose.yml`
- Frontend (TypeScript/React + Vite)
  - Web app that captures audio, displays responses, and provides controls
  - Connects to backend API over HTTP/WebSocket
  - No `.env` required in this setup

For backend internals and developer notes, see `backend/README.md`.

## Prerequisites

- Git
- Optional (recommended): Docker Desktop with Docker Compose v2
- If running locally (no Docker):
  - Python 3.10+ (recommended 3.11 or 3.12)
  - pip
  - On Windows: PowerShell for convenience scripts
- For the frontend:
  - Node.js 18+ and npm 9+ (or pnpm/yarn if you prefer)
- Supabase project (if using managed Postgres/auth)
  - Supabase URL and keys (Anon and/or Service Role)
  - Database connection string

## Installation

1) Clone the repository
```bash
git clone https://github.com/Eugenelcc/AskVox-CSIT-25-S4-22-.git
cd AskVox-CSIT-25-S4-22-
```

2) Backend environment
- Create `backend/.env` and provide Supabase and DB connection details (see “Environment variables” below).

Frontend does NOT require creating an `.env` file. It works with its default configuration pointing to the backend URL defined in code/config.

## Running the backend

There are two common ways to run the backend: Docker Compose (quickest to get going if you have Docker) or local Python environment (useful for debugging).

### Option A: Docker Compose (recommended)
From the repository root:
```bash
cd backend
# Ensure backend/.env is configured first (with Supabase vars)
docker compose up --build
```
- Compose will build the image defined in `backend/Dockerfile` and start services specified in `backend/docker-compose.yml`.
- Migrations can be run automatically by `entrypoint.sh` or manually:
```bash
alembic upgrade head
```
- The backend usually serves at http://localhost:8000

To stop:
```bash
docker compose down
```

### Option B: Locally (Python venv) — step‑by‑step guide

Below are platform-specific instructions to create and use a Python virtual environment (venv) for the backend, install dependencies, run migrations, and start the server.

1) Create the virtual environment

- macOS/Linux:
```bash
cd backend
python3 -m venv .venv
```

- Windows (PowerShell):
```powershell
cd backend
py -3 -m venv .venv
```

2) Activate the virtual environment

- macOS/Linux (bash/zsh):
```bash
source .venv/bin/activate
```

- Windows (PowerShell):
```powershell
.\.venv\Scripts\Activate.ps1
```

- Windows (CMD):
```cmd
.\.venv\Scripts\activate.bat
```

After activation, your shell prompt should show a `(.venv)` prefix.

3) Upgrade pip and install dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

4) Configure backend environment variables
- Create `backend/.env` and populate required values (see “Environment variables”).
- Ensure your Supabase DB is reachable from your local machine.

5) Initialize the database (if applicable)
```bash
alembic upgrade head
```

6) Start the backend
- If a dev helper is provided:
```bash
python dev.py
```

- Or use a typical FastAPI/Uvicorn entrypoint (adjust if your app uses a different module or factory):
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

7) Deactivate the venv when done
```bash
deactivate
```

Tip: On Windows, you can also use the convenience script:
```powershell
# From backend/
.\run_backend.ps1
```

## Running the frontend (no env required)

From the repository root:
```bash
cd frontend
npm install

# Development server:
npm run dev

# Production build:
npm run build
# Optional local preview (varies by toolchain):
npm run preview
```

By default, the frontend is configured to connect to the backend without requiring a `.env` file. Ensure your backend is running (e.g., at http://localhost:8000). If you need to change the API URL in the future, update it in the frontend code/config where the API base is defined.

## Environment variables (backend only, with Supabase)

Create `backend/.env` and include the following. Adjust names to match your configuration in `app/` if different.

```
# App
APP_ENV=development
SECRET_KEY=change_me
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Supabase core
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=your_anon_key            # For public client operations (if needed)
SUPABASE_SERVICE_ROLE_KEY=your_service_key # For secure server-side operations (DO NOT expose to frontend)

# Database (Supabase Postgres)
# Use the connection string from Supabase → Project Settings → Database → Connection info.
# Prefer a sync driver for Alembic and general SQLAlchemy engine:
DATABASE_URL=postgresql+psycopg2://postgres.YOUR_PROJECT_REF:YOUR_DB_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres

# Optional async variant (if your code uses async engine)
# DATABASE_URL=postgresql+asyncpg://postgres.YOUR_PROJECT_REF:YOUR_DB_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres

# JWT/Token config (if backend issues tokens)
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# LLM / AI providers (example)
OPENAI_API_KEY=your_key_here

# Speech providers (example)
STT_PROVIDER_KEY=your_key_here
TTS_PROVIDER_KEY=your_key_here
```

Notes:
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend; keep it server-side only.
- If you use Supabase Auth from the backend, ensure verification/callback URLs are configured in your Supabase project.

## Supabase setup notes

- Create a Supabase project at [supabase.com](https://supabase.com).
- In Project Settings → Database:
  - Copy the connection string and use it for `DATABASE_URL` as shown above.
- In Project Settings → API:
  - Copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- If the backend uses Supabase Auth:
  - Configure Redirect URLs and email templates as needed.
- Migrations:
  - You can keep schema changes in Alembic migrations within this repo and run `alembic upgrade head` against the Supabase database.
  - Alternatively, use Supabase SQL editor for one-off changes but ensure your migration scripts stay in sync.

## Troubleshooting

- Backend won’t start
  - Ensure `backend/.env` is present and required variables are set.
  - Verify your Supabase `DATABASE_URL` (host, port 5432, credentials).
  - If using Docker Compose, rebuild: `docker compose build --no-cache && docker compose up`.
  - Apply migrations: `alembic upgrade head`.
- Frontend can’t reach backend
  - Verify the backend address and port (e.g., http://localhost:8000).
  - Check CORS configuration in the backend (allow the frontend dev origin).
- Supabase permission/auth issues
  - If you access tables directly, confirm Row Level Security (RLS) policies.
  - Use Service Role key for secure server-side operations; never in frontend.
- Windows path/venv issues
  - Use PowerShell and `.\.venv\Scripts\Activate.ps1`.
  - Alternatively, run `.\run_backend.ps1` from `backend/`.

## License

This project is released under the MIT License. See [LICENSE](LICENSE) for details.

---

For deeper backend details, commands, and developer workflows, please read the dedicated `backend/README.md`.
