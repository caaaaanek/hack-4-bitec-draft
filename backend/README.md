# Backend

API опитувальників, конструктора анкет, ролей, Integrity Index, рекомендацій, заходів і журналу дій. Опис архітектури та API: [`docs/backend.md`](../docs/backend.md).

## Запуск через Docker (з кореня репозиторію)

1. `cp .env.example .env` і заповнити `POSTGRES_PASSWORD`, `JWT_SECRET` (не коротше 32 символів, інакше API не стартує), `DEMO_PASSWORD`.
2. `docker compose up --build`
3. Відкрити `http://localhost:8000/docs`

Під час старту застосовуються міграції й створюються синтетичні демо-дані: підрозділи, користувачі `admin` (уповноважений), `coordinator` (технічний адміністратор), `department`, `leader`, `leader_a`, `auditor`, `wg1`…`wg6`, `staff01`…`staff75`, `expert1`…`expert5` (пароль: `DEMO_PASSWORD`), чотири опубліковані анкети з додатків Б і В і факти за 18 місяців. З `SEED_WITH_WAVES=true` (за замовчуванням у compose) ще дві закриті хвилі, рішення керівника й заходи. З `SEED_DEMO=false` — лише анкети й адміністратор `admin`, без демо-даних і хвиль.

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

Уся демо-історія (дві хвилі, рішення, заходи) без запущеного сервера: `python -m app.seed.seed --with-waves`.

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
| `app/routers/` | Маршрути: `config` (налаштування й `/health`), `auth` (і запрошення), `admin` (і принцип двох осіб, якір журналу, звіт переглядів), `dictionaries`, `department`, `urn`, `risks`, `insights_plus` (відвертість, лотерея, план, брифінг, стійкість ваг), `questionnaires`, `campaigns`, `respond`, `checklist`, `checks`, `indicators`, `results`, `dashboard`, `recommendations`, `measures`, `reports`, `integrations` (тема 2 / Mitra), `what_if`, `insights` (адвокат диявола, черговий), `normative`, `learning`, `autopilot`, `assistant` і `llm` (`/api/assistant` для frontend-proto) |
| `app/services/` | Логіка (з 20.11 ще: `categories`, `fact_registry`, `approvals`, `invites`, `candor`, `goodhart`, `urn`, `ballots`, `planning`, `counterparty`): анкети й версії, перевірка відповідей, правила допуску, анонімність (буфер, вторинне приховування), методика й розрахунок Integrity Index, факти, знімки, рекомендації, заходи й черга для теми 2, «що, якщо», адвокат диявола, черговий, нормативка, автопілот, флешкартки, перевірки декларацій і закупівель |
| `app/seed/` | Демо-дані, анкети з додатків Б і В, каталог заходів з Додатку Д (JSON) |
| `migrations/` | Міграції Alembic |
| `scripts/demo_wave.py` | Демо-хвиля через API від початку до кінця |
| `adapters/`, `scripts/mock_sources.py` | Моки 5 джерел фактів (ARTEMIDA, атестація, навчання, закупівлі, повідомлення) → `POST /indicators`, кожне своїм ключем |
| `scripts/export_openapi.py` | Оновлює `docs/api/openapi.json` з коду (запускати після змін API) |
| `scripts/smoke.py`, `scripts/mitra_mock.py` | Перевірка стенду з кінця в кінець; мок Mitra (тема 2) для інтеграції |
| `scripts/gen_docs.py` | Генерує `docs/recommendations.md` і `docs/cross-check.md` з прогону на тимчасовій базі (демо-seed, фіксована дата) |
