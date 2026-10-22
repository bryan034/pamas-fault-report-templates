FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_CACHE_DIR=/tmp/uv-cache

RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation libreoffice-writer \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.12.17

WORKDIR /service
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./

# Non-root in both local and cloud containers. Compose retains its existing
# startup command; the image default runs the already-installed environment.
RUN useradd --uid 10001 --create-home appuser \
    && chown -R appuser:appuser /service /tmp/uv-cache
USER appuser

EXPOSE 8000
CMD ["/service/.venv/bin/python", "-m", "uvicorn", "app.template_main:app", "--host", "0.0.0.0", "--port", "8000"]
