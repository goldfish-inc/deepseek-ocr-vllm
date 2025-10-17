# Multi-stage build for document extraction service
# Supports both x86_64 (cluster) and arm64 (local development)

# Build stage - install dependencies
FROM python:3.12-slim as builder

# Install build dependencies with retry on hash mismatch
RUN apt-get update && \
    (apt-get install -y --no-install-recommends build-essential gcc g++ || \
     apt-get install -y --no-install-recommends --fix-missing build-essential gcc g++) && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies to /install directory
COPY requirements.txt .
RUN grep -vE "^mlx" requirements.txt > requirements-no-mlx.txt && \
    pip install --no-cache-dir --prefix=/install -r requirements-no-mlx.txt

# Runtime stage - minimal image
FROM python:3.12-slim as base

# Install runtime dependencies only with retry on hash mismatch
RUN apt-get update && \
    (apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng libgomp1 || \
     apt-get install -y --no-install-recommends --fix-missing tesseract-ocr tesseract-ocr-eng libgomp1) && \
    rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Set working directory
WORKDIR /app

# Copy application code
COPY main.py .

# Create cache directory for HuggingFace models
ENV HF_HOME=/data/hf-cache
ENV HF_HUB_CACHE=/data/hf-cache/hub
ENV DOCLING_USE_MLX=0
RUN mkdir -p /data/hf-cache/hub

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8080/health').raise_for_status()"

# Run service
CMD ["python", "main.py"]
