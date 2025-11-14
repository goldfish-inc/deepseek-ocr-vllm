# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS build
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.4.20 /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml README.md ./
COPY src ./src
RUN uv sync --python 3.11 --no-dev

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PORT=8080
WORKDIR /app
COPY --from=build /app/.venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY src ./src
USER 65532:65532
EXPOSE 8080
CMD ["uvicorn", "ocr_service.app:app", "--host", "0.0.0.0", "--port", "8080"]
