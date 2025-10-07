FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/opt/venv/bin:$PATH \
    WORKDIR=/app

WORKDIR $WORKDIR

# System deps (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*

# Create venv (optional) and install deps
RUN python -m venv /opt/venv

COPY scripts/requirements-ner.txt /tmp/requirements-ner.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements-ner.txt \
    && pip install pulumi==3.110.0  # small dependency sometimes used by helpers

# Copy training scripts and assets
COPY scripts/ner_train.py scripts/export_onnx.sh labels.json $WORKDIR/
COPY apps/training-worker/entrypoint.py $WORKDIR/entrypoint.py

RUN chmod +x export_onnx.sh

ENTRYPOINT ["python", "-u", "/app/entrypoint.py"]
