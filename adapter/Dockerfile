FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN python -m venv /venv \
 && /venv/bin/pip install --upgrade pip \
 && /venv/bin/pip install -r /tmp/requirements.txt
# Copy application code into image
COPY app.py /app/app.py
COPY ner/ /app/ner/
ENV PATH="/venv/bin:$PATH"
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","9090"]

