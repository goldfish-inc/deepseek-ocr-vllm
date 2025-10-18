FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WORKDIR=/app

WORKDIR $WORKDIR

# System deps (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git=1:2.47.3-0+deb13u1 \
    curl=8.14.1-2 \
    ca-certificates=20250419 \
    bash=5.2.37-2+b5 \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/requirements-ner.txt /tmp/requirements-ner.txt
RUN pip install --upgrade pip==25.1 \
    && pip install -r /tmp/requirements-ner.txt \
    && pip install pulumi==3.110.0 \
    && rm -rf /root/.cache/pip

# Copy training scripts and assets
COPY scripts/ner_train.py scripts/export_onnx.sh scripts/normalize_ner_from_outbox.py labels.json $WORKDIR/
COPY apps/training-worker/entrypoint.py $WORKDIR/entrypoint.py

RUN chmod +x export_onnx.sh

ENTRYPOINT ["python", "-u", "/app/entrypoint.py"]
