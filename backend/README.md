# Backend

API опитувальників, конструктора анкет, ролей, Integrity Index, рекомендацій, заходів і журналу дій. Опис архітектури та API: [`docs/backend.md`](../docs/backend.md).

## Запуск через Docker (з кореня репозиторію)

1. `cp .env.example .env` і заповнити `POSTGRES_PASSWORD`, `JWT_SECRET` (не коротше 32 символів, інакше API не стартує), `DEMO_PASSWORD`.
2. `docker compose up --build`
3. Відкрити `http://localhost:8000/docs`

Під час старту застосовуються міграції й створюються синтетичні демо-дані: підрозділи, користувачі `admin`, `commissioner`, `leader`, `leader_a`, `auditor`, `wg1`…`wg6`, `staff01`…`staff24`, `expert1`…`expert5` (пароль: `DEMO_PASSWORD`), чотири опубліковані анкети з додатків Б і В і факти за 12 місяців.

## Локальний запуск без Docker

Потрібні Python 3.12+ і PostgreSQL.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env        # заповнити JWT_SECRET (≥ 32 символи) і DEMO_PASSWORD
alembic upgrade head && python -m app.seed.seed && uvicorn app.main:app --reload
```

## Демо-хвиля одним запуском

Коли сервер працює, ця команда проходить повну хвилю на демо-даних (анкети, чек-лист, закриття) і друкує Integrity Index з поясненнями:

```bash
python scripts/demo_wave.py
python scripts/demo_wave.py --title "Хвиля 2" --shift 1   # друга хвиля для динаміки
```

## Тести

```bash
cd backend && pytest
```

За замовчуванням тести працюють на тимчасовій SQLite. Щоб прогнати їх на PostgreSQL, задайте `TEST_DATABASE_URL`
(тоді виконується й перевірка `xmin` для анонімності). CI (`.github/workflows/backend.yml`) проганяє обидва варіанти й міграції з нуля.

## Де що лежить

| Шлях | Що там |
|---|---|
| `app/models.py` | Таблиці БД |
| `app/schemas.py` | Формати запитів і відповідей API |
| `app/security.py` | Паролі, JWT, перевірка ролей |
| `app/routers/` | Маршрути: `auth`, `admin`, `questionnaires`, `campaigns`, `respond`, `checklist`, `indicators`, `results`, `dashboard`, `recommendations`, `measures`, `reports`, `integrations`, `assistant` |
| `app/services/` | Логіка: анкети й версії, перевірка відповідей, правила допуску, анонімність (буфер, вторинне приховування), методика й розрахунок Integrity Index, факти, знімки, рекомендації, заходи й черга для теми 2 |
| `app/seed/` | Демо-дані, анкети з додатків Б і В, каталог заходів з Додатку Д (JSON) |
| `migrations/` | Міграції Alembic |
| `scripts/demo_wave.py` | Демо-хвиля через API від початку до кінця |
