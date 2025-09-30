FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn httpx numpy transformers torch sentry-sdk

COPY app.py .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9090"]