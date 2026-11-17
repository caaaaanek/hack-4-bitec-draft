# Правила роботи з репозиторієм

Для всіх агентів (Claude, Codex, Cursor тощо) і людей.

## Гілки

- `main` — чиста робоча версія. Напряму в `main` не комітимо; потрапляє туди лише злиттям із `dev`.
- `dev` — розробка. Усі зміни йдуть сюди.
- `feature/<коротко-що>` — нова функціональність, відгалужується від `dev`, зливається назад у `dev`.
- `fix/<коротко-що>` — виправлення, так само від `dev` і назад у `dev`.

```bash
git switch dev && git pull
git switch -c feature/questionnaire-json
# ...робота, коміти...
git switch dev && git merge --no-ff feature/questionnaire-json && git push
```

Реліз: `dev` → `main` лише тоді, коли `dev` у робочому стані.

## Коміти

- Коротко й по суті: один рядок до ~72 символів, у наказовому способі, що зроблено. Тіло — лише якщо без нього незрозуміло «чому».
  - ✅ `Add questionnaire JSON export`
  - ✅ `Fix table merge across PDF pages`
  - ❌ `Update files`, `WIP`, абзаци опису на кожну дрібницю
- **Ніколи не додавати `Co-Authored-By`, `Generated with …`, `Claude-Session`, посилання на сесії чи будь-яку іншу згадку агента/ШІ** — ні в комітах, ні в описах PR. Автор коміту — лише людина, від якої налаштовано git.
- Не змінювати `user.name` / `user.email` у git-конфігу.
- Секрети не комітити (`.env`, ключі, токени — див. `.gitignore`). Перед комітом переглядати `git diff --cached`.

Технічно це підкріплено:
- `.claude/settings.json` вимикає атрибуцію Claude Code у комітах і PR;
- `.githooks/commit-msg` відхиляє коміт із такими рядками. Після клонування один раз виконати:
  `git config core.hooksPath .githooks`

## Структура і перевірки

Огляд модулів і дерево проєкту — `README.md`.

- `backend/` — FastAPI. Перед комітом: `cd backend && pytest`. Ваги й пороги індексу міняються лише в `app/services/methodology.py`, зміни API — разом із `docs/api/openapi.json` і `docs/backend.md`.
- `frontend/` — Vite + React. Перед комітом: `cd frontend && npm run check`. Локальні правила UI (тексти, кольори, доступність) — `frontend/CLAUDE.md`; правила гілок і комітів звідси діють і там.
- `docs/` — джерела хакатону (`raw/` — оригінали, `md/` — оброблене) і документація проєкту. Як додавати й конвертувати джерела — `docs/README.md` і скіл `.claude/skills/ingest-docs/SKILL.md`.

Документацію оновлюємо в тому ж коміті, що й код, який вона описує.
