FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WORKDIR=/app

WORKDIR $WORKDIR

# System deps (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/requirements-ner.txt /tmp/requirements-ner.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements-ner.txt \
    && pip install pulumi==3.110.0 \
    && rm -rf /root/.cache/pip

# Copy training scripts and assets
COPY scripts/ner_train.py scripts/export_onnx.sh labels.json $WORKDIR/
COPY apps/training-worker/entrypoint.py $WORKDIR/entrypoint.py

RUN chmod +x export_onnx.sh

ENTRYPOINT ["python", "-u", "/app/entrypoint.py"]
