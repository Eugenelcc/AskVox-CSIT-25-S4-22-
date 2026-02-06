FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements-render.txt /app/requirements-render.txt
RUN pip install --no-cache-dir -r /app/requirements-render.txt

COPY backend /app

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
