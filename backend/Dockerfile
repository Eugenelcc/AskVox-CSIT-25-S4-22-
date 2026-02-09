# Use a slim Python image as the base
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Install necessary system dependencies
# libsndfile1 is critical for audio processing with sounddevice/soundfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    ffmpeg \
    build-essential \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip to the latest version
RUN pip install --upgrade pip

# Download and extract the Vosk model for wake word detection
ARG VOSK_MODEL_ZIP_URL="https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
RUN curl -fsSL "$VOSK_MODEL_ZIP_URL" -o /tmp/vosk-model.zip \
    && unzip /tmp/vosk-model.zip -d /opt \
    && rm -f /tmp/vosk-model.zip

# Set environment variable for Vosk model path
ENV VOSK_MODEL_PATH=/opt/vosk-model-small-en-us-0.15

# Copy the requirements file into the container
COPY backend/requirements-render.txt /app/requirements-render.txt

# Install Python dependencies
# faster-whisper installs cleanly without special flags
RUN pip install --no-cache-dir -r /app/requirements-render.txt

# Copy the rest of the backend code into the container
COPY backend /app

# Set up the entrypoint for the application using uvicorn to run FastAPI
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${WEB_CONCURRENCY:-2} --timeout-keep-alive 75"]