# Multi-stage build for document extraction service
# Supports both x86_64 (cluster) and arm64 (local development)

FROM python:3.13-slim as base

# Install system dependencies including build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    tesseract-ocr \
    tesseract-ocr-eng \
    libtesseract-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
# MLX only works on Apple Silicon, so conditional install
RUN pip install --no-cache-dir -r requirements.txt || \
    (grep -v "mlx" requirements.txt > /tmp/req-no-mlx.txt && \
     pip install --no-cache-dir -r /tmp/req-no-mlx.txt)

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
