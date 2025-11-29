$ErrorActionPreference = "Stop"

Write-Host "== AskVox: starting docker db =="
docker compose up -d

Write-Host "== AskVox: backend venv =="
Set-Location "$PSScriptRoot\backend"

if (!(Test-Path ".\venv\Scripts\Activate.ps1")) {
  Write-Host "venv not found, creating..."
  python -m venv venv
}

& .\venv\Scripts\Activate.ps1

Write-Host "== AskVox: migrations =="
alembic upgrade head

#Write-Host "== AskVox: seed admin (safe to rerun) =="
#python .\seeding\seed_admin.py

Write-Host "== AskVox: run api =="
python -m uvicorn app.main:app --reload --port 8000
