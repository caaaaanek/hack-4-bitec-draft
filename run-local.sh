#!/usr/bin/env bash
# Фронтенд і бекенд одним процесом без Docker: API віддає зібраний frontend-proto на тому ж порту.
#   ./run-local.sh            → http://localhost:8000 (UI), http://localhost:8000/docs (API)
# Потрібні: Python 3.12+, Node 20+, PostgreSQL. Налаштування — backend/.env (DATABASE_URL, JWT_SECRET, DEMO_PASSWORD).
# Змінні: PORT (8000), SKIP_BUILD=1 (не перезбирати фронтенд), SKIP_SEED=1 (не запускати міграції й seed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"

if [ ! -f "$ROOT/backend/.env" ]; then
  echo "Немає backend/.env. Скопіюйте backend/.env.example і задайте DATABASE_URL, JWT_SECRET (≥ 32 символи), DEMO_PASSWORD."
  exit 1
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "→ Збираю фронтенд (frontend-proto)"
  cd "$ROOT/frontend-proto"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npm run build
fi

cd "$ROOT/backend"
if [ ! -d .venv ]; then
  echo "→ Створюю віртуальне оточення Python"
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi

if [ "${SKIP_SEED:-0}" != "1" ]; then
  echo "→ Міграції й демо-дані (повторний запуск нічого не дублює)"
  .venv/bin/alembic upgrade head
  SEED_WITH_WAVES="${SEED_WITH_WAVES:-true}" .venv/bin/python -m app.seed.seed   # дві закриті демо-хвилі для дашборда
fi

echo "→ http://localhost:$PORT  (API: http://localhost:$PORT/docs)"
FRONTEND_DIST="$ROOT/frontend-proto/dist" PUBLIC_URL="${PUBLIC_URL:-http://localhost:$PORT}" \
  exec .venv/bin/uvicorn app.main:app --host "${HOST:-127.0.0.1}" --port "$PORT"
