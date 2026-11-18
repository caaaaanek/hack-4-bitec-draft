# frontend-proto

Фронтенд Integrity Dashboard на React (Vite), власний дизайн. Методика, дані й тексти — як у `frontend/` (Integrity Index, 8 ролей, 5 правил рекомендацій), заглушки `frontend/` тут робочі: звіт, керування циклом, анкети, чек-лист «чотири ока», журнал з ланцюгом хешів, порівняння.

Демо: https://integrity-prototype.vercel.app

## Запуск

З бекендом (основний режим): `docker compose up --build` у корені репозиторію → http://localhost:8080, вхід демо-логінами
(див. `docs/run.md`). Режим визначається автоматично: відповідає `GET /api/v1/config` — дані й вхід з бекенду (`src/lib/api.js`).

Розробка:

```bash
npm install
npm run dev                     # http://localhost:5173; /api і /health → BACKEND_URL (за замовчуванням http://127.0.0.1:8000), без бекенду — демо-дані
npm run build                   # збірка в dist/
./start.sh                      # збірка + асистент на локальній моделі Ollama (gemma3:4b) → http://127.0.0.1:3000
```

## Структура

- `src/` — React-код: `lib/` (модель, стан, API, роутер), `components/`, `views/` (екрани), `ai/` (асистент), `styles/`. Детально — `CLAUDE.md`.
- `api/assistant.js` — серверна функція асистента (будь-який OpenAI-сумісний `/chat/completions`, ключ лише в змінних оточення).
- `server.mjs`, `start.sh` — локальний сервер для закритого контуру: віддає `dist/` і `/api/assistant`.

ШІ лише пояснює вже розраховані правилами числа й пише чернетки; вимикається перемикачем, без нього все працює.
