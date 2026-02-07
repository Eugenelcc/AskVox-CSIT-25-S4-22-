FROM python:3.11-slim

WORKDIR /app

# Tools for downloading/extracting the Vosk model
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl unzip \
	&& rm -rf /var/lib/apt/lists/*

ARG VOSK_MODEL_ZIP_URL="https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
RUN curl -fsSL "$VOSK_MODEL_ZIP_URL" -o /tmp/vosk-model.zip \
	&& unzip /tmp/vosk-model.zip -d /opt \
	&& rm -f /tmp/vosk-model.zip

ENV VOSK_MODEL_PATH=/opt/vosk-model-small-en-us-0.15

COPY backend/requirements-render.txt /app/requirements-render.txt
RUN pip install --no-cache-dir -r /app/requirements-render.txt

COPY backend /app

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${WEB_CONCURRENCY:-2} --timeout-keep-alive 75"]
