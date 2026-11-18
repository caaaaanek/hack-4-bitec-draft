#!/usr/bin/env bash
# Локальний запуск: збірка сайту + ШІ-асистент на локальній моделі (Ollama), без хмари.
#   ./start.sh              — модель за замовчуванням
#   ./start.sh qwen2.5:3b   — інша модель
set -euo pipefail
cd "$(dirname "$0")"
MODEL="${1:-gemma3:4b}"

command -v ollama >/dev/null || { echo "Потрібна Ollama: https://ollama.com/download"; exit 1; }
if ! curl -s -m 2 http://localhost:11434/api/version >/dev/null; then
  echo "Запускаю Ollama…"; (ollama serve >/dev/null 2>&1 &); sleep 2
fi
ollama list | awk '{print $1}' | grep -qx "$MODEL" || ollama pull "$MODEL"
echo "Прогріваю $MODEL…"; ollama run "$MODEL" "" >/dev/null 2>&1 || true

[ -d node_modules ] || npm install --no-audit --no-fund
npm run build

export LLM_BASE_URL="http://localhost:11434/v1"
export LLM_MODEL="$MODEL"
export LLM_TIMEOUT_MS="180000"
exec node server.mjs
