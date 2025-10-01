FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
# Minimal dependencies for the annotations sink runtime
RUN python -m venv /venv \
 && /venv/bin/pip install --upgrade pip \
 && /venv/bin/pip install fastapi==0.114.0 uvicorn==0.30.6 huggingface_hub==0.23.0 asyncpg==0.29.0 httpx==0.27.2
ENV PATH="/venv/bin:$PATH"
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8080"]

