FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FINREG_HOST=0.0.0.0 \
    FINREG_PORT=8765 \
    FINREG_DB=/app/data/practice.sqlite3

WORKDIR /app

RUN groupadd --gid 1000 finreg \
    && useradd --uid 1000 --gid finreg --create-home --shell /usr/sbin/nologin finreg \
    && mkdir -p /app/data \
    && chown finreg:finreg /app/data

COPY app.py database.py services.py importer.py taxonomy.py ./
COPY web/ ./web/

USER finreg
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('FINREG_PORT', '8765') + '/healthz', timeout=3).close()"]

CMD ["python", "app.py"]
