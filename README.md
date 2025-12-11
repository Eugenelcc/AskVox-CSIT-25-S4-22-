# AskVox-CSIT-25-S4-22- — A Voice‑Activated Multimedia Knowledge Assistant

AskVox is a voice-first assistant that lets you speak your questions and receive rich, multimodal answers. It blends speech recognition, LLM-powered reasoning, and media retrieval to help you explore knowledge hands-free. Think of it as a conversational layer over your knowledge sources, with the ability to respond with text, images, links, and more.

- Repository: Eugenelcc/AskVox-CSIT-25-S4-22-
- License: MIT (see [LICENSE](LICENSE))
- Major technologies: Python (backend), TypeScript (frontend), Docker (optional), CSS/JS

This repository is organized into two primary folders:
- `backend/` — Python services, APIs, database migrations, and orchestration
- `frontend/` — Web UI (TypeScript) for interacting with AskVox

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
- Environment variables (backend only)
- Troubleshooting
- License

## Introduction

AskVox aims to make knowledge accessible through natural conversation. Speak to AskVox and receive contextual answers that can include media—images, links, and structured information—sourced from connected knowledge bases and external services. The system is designed for extensibility: you can swap speech, LLM, and storage providers with configuration.

## Features

- Voice input and output for hands‑free interaction
- LLM-powered reasoning and summarization
- Multimedia responses (text + links and media previews)
- Web frontend with real-time connection to the backend
- Optional Dockerized development environment
- Database migrations via Alembic

## Architecture (at a glance)

- Backend (Python)
  - REST or WebSocket API for the frontend
  - Integrations for speech-to-text, text-to-speech, LLMs, and storage
  - Database with Alembic migrations
  - Containerized via backend/Dockerfile and backend/docker-compose.yml
- Frontend (TypeScript)
  - Web app that captures audio, displays responses, and provides controls
  - Connects to backend API over HTTP/WebSocket

For backend internals and developer notes, see backend/README.md.

## Prerequisites

- Git
- Optional (recommended): Docker Desktop with Docker Compose v2
- If running locally (no Docker):
  - Python 3.10+ (recommend 3.11 if available)
  - pip
  - On Windows: PowerShell for convenience scripts
- For the frontend:
  - Node.js 18+ and npm 9+ (or pnpm/yarn if you prefer)

## Installation

1) Clone the repository
```bash
git clone https://github.com/Eugenelcc/AskVox-CSIT-25-S4-22-.git
cd AskVox-CSIT-25-S4-22-
```

2) Backend environment
- Create `backend/.env` and provide provider keys and DB connection (see “Environment variables” below).

Frontend does NOT require creating an `.env` file. It will work with its default configuration pointing to the backend URL you set in code or configuration.

## Running the backend

There are two common ways to run the backend: Docker Compose (quickest to get going if you have Docker) or local Python environment (useful for debugging).

### Option A: Docker Compose (recommended)
From the repository root:
```bash
cd backend
# Ensure backend/.env is configured first
docker compose up --build
```
- Compose will build the image defined in backend/Dockerfile and start services specified in backend/docker-compose.yml.
- On first run, you may need to apply database migrations (if not handled automatically by entrypoint):
```bash
alembic upgrade head
```
- Once running, the backend typically serves at http://localhost:8000.

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

After activation, your shell prompt should show a `(.venv)` prefix.

3) Upgrade pip and install dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

4) Configure backend environment variables
- Create `backend/.env` and populate required values (see “Environment variables”).

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

By default, the frontend is configured to connect to the backend without requiring a `.env` file. Ensure your backend is running (e.g., at http://localhost:8000). If you need to change the API URL in the future, update it in the frontend configuration or source code where the API base is defined.

## Environment variables (backend only)

Typical values include:
```
# backend/.env

# Core
APP_ENV=development
SECRET_KEY=change_me

# CORS (allow frontend dev origin if needed)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Database
DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/askvox

# LLM / AI providers
OPENAI_API_KEY=your_key_here
# or other provider keys…

# Speech
STT_PROVIDER_KEY=your_key_here
TTS_PROVIDER_KEY=your_key_here
```

Consult backend/README.md for any additional, backend-specific configuration that may already be documented there.

## Troubleshooting

- Backend won’t start
  - Ensure `backend/.env` is present and required variables are set.
  - If using Docker Compose, rebuild: `docker compose build --no-cache && docker compose up`.
  - Apply migrations: `alembic upgrade head`.
- Frontend can’t reach backend
  - Verify the backend address and port (e.g., http://localhost:8000).
  - Check CORS configuration in the backend (allow the frontend dev origin).
- Windows path/venv issues
  - Use PowerShell and `.\.venv\Scripts\Activate.ps1`.
  - Alternatively, run `.\run_backend.ps1` from `backend/`.

## License

This project is released under the MIT License. See [LICENSE](LICENSE) for details.

---

For deeper backend details, commands, and developer workflows, please read the dedicated backend/README.md.
