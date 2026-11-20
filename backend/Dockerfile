FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 EVIDENCE_DIR=/data/evidence
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Без root: застосунку потрібен на запис лише каталог доказів.
RUN useradd --system --uid 10001 --home-dir /app app \
 && mkdir -p /data/evidence && chown -R app:app /data
USER app
EXPOSE 8000
# start-period з запасом: до uvicorn ідуть міграції й seed із демо-хвилями (~25 с тут, на слабкому VPS у 3–5 разів
# довше; раніше 180 с не вистачало й перший `docker compose up` падав). Здоровим контейнер стає з першою вдалою
# перевіркою, тож запас не затримує старт, а лише не рахує ранні невдачі.
HEALTHCHECK --interval=10s --timeout=3s --start-period=420s --retries=6 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed.seed && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
