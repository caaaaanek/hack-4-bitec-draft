# Як запустити: база, бекенд, фронтенд

> Екрани фронтенду ще працюють на власних синтетичних даних (`frontend/src/demo`); клієнт API для переходу на бекенд —
> `frontend/src/api/client.ts`. Збираються й запускаються вони вже разом.

## Усе через Docker (одна команда)

```bash
cp .env.example .env     # заповнити POSTGRES_PASSWORD, JWT_SECRET (не коротше 32 символів), DEMO_PASSWORD
docker compose up --build
```

| Що | Адреса |
|---|---|
| Фронтенд (nginx, `/api` проксіюється на бекенд) | http://localhost:8080 |
| API і Swagger напряму | http://localhost:8000/docs |
| Стан (процес + БД) | http://localhost:8080/health, http://localhost:8000/health |

Порядок старту: `db` (healthcheck `pg_isready`) → `backend` (міграції, seed, healthcheck `/health` з БД) → `frontend`.
Файли-докази лежать у томі `evidence`. Почати з чистої бази: `docker compose down -v`, потім `docker compose up --build`.

Перевірити стенд з кінця в кінець (вхід, хвиля за посиланнями, повтор → 409, файл-доказ із sha256, журнал):

```bash
python backend/scripts/smoke.py --base http://localhost:8080 --password "$DEMO_PASSWORD"
```

Скрипт створює демо-хвилю «Smoke …», тож запускайте його на демо-стенді.

### За проксі організації

- Під підшляхом (`https://portal.example/imd/`): `ROOT_PATH=/imd` для бекенду; адреси в `/docs` і OpenAPI стануть `/imd/...`.
- Посилання на анкети будуються від `PUBLIC_URL` (`https://portal.example/imd` → `.../s/<токен>`).
- Вхід через SSO: `PROXY_AUTH_ENABLED=true`, `TRUSTED_PROXIES=<IP чи мережа проксі>`, за бажання `PROXY_AUTH_SECRET`.
  Проксі має сам задавати `X-Remote-User` (і `X-Proxy-Secret`) після автентифікації й не пропускати їх від браузера.
  Фронтенд викликає `POST /api/v1/auth/proxy`, коли `GET /api/v1/config` → `auth.proxy: true`.
  Без `TRUSTED_PROXIES` API з увімкненим входом через проксі не стартує.

## Бекенд без Docker

`cd backend`, далі кроки з [`backend/README.md`](../backend/README.md): venv, alembic, seed, uvicorn на порту 8000.

## Фронтенд

```bash
cd frontend
npm ci
npm run dev          # http://localhost:5173, /api проксіюється на http://localhost:8000 (VITE_PROXY_TARGET)
```

Роль (керівник, адміністратор, учасник тощо) і заклад перемикаються в демо-панелі інтерфейсу, логін не потрібен.

## Демо-дані бекенду

`docker compose up` за замовчуванням (`SEED_WITH_WAVES=true`) одразу створює демо-історію:

- особовий склад по 10–15 осіб на підрозділ (`staff01`…`staff75`);
- «Хвиля 1 (демо)», закрита близько пів року тому: «Підрозділ В» має замало відповідей, тож видно поріг k і вторинне приховування;
- рішення `leader` щодо рекомендацій хвилі 1 (прийнято, уточнити, відхилено) і заходи: виконані, у роботі, прострочені;
- «Хвиля 2 (демо)», закрита сьогодні: індекс вищий, рекомендації ще без рішень (їх можна ухвалити на демо).

Повторний старт нічого не дублює: якщо хвилі вже є, історія не додається. Без історії: `SEED_WITH_WAVES=false` у `.env`.
Локально без Docker: `python -m app.seed.seed --with-waves` (сервер запускати не треба).

Додати ще хвилю до вже засіяної бази (сервер має працювати):

```bash
cd backend
python scripts/demo_wave.py --title "Хвиля 3" --shift 1
# або в контейнері: docker compose exec backend python scripts/demo_wave.py --title "Хвиля 3"
```

Або пройти все через API (Swagger): admin створює й відкриває хвилю, учасники проходять анкети, робоча група вносить чек-лист,
commissioner його підтверджує, admin закриває хвилю.

Після хвиль: `GET /api/v1/dashboard` від імені `leader` показує індекс, динаміку, топ-рекомендації, заходи й ризик-сигнали.

Демо-логіни бекенду (пароль у всіх `DEMO_PASSWORD`):

| Логін | Роль | Що може |
|---|---|---|
| `admin` | адміністратор | хвилі, люди, підрозділи, факти, журнал, результати |
| `commissioner` | укладач анкет | конструктор анкет, підтвердження чек-листа, результати |
| `leader` | керівник | дашборд, результати, рішення щодо рекомендацій, заходи (усе дерево) |
| `leader_a` | керівник підрозділу А | те саме, але лише «Підрозділ А» і дочірні |
| `auditor` | аудитор | лише читання: результати, рекомендації, заходи, журнал і його перевірка |
| `wg1`…`wg6` | учасник, робоча група | Анкета 1, внесення чек-листа, мої результати |
| `staff01`…`staff75` | учасник, особовий склад | Анкета 2, мої результати |
| `expert1`…`expert5` | учасник, експерт | Анкета 3, мої результати |

## Перевірки

```bash
cd backend && pytest                    # бекенд: 137 тестів (на SQLite один тест xmin пропускається)
TEST_DATABASE_URL=postgresql+psycopg://imd:пароль@localhost:5432/imd_test pytest   # те саме на PostgreSQL
cd frontend && npm run check            # фронтенд: typecheck, lint, тести, збірка
cd frontend && npm run check:contrast   # контраст кольорів
```

`npm run verify` додатково збирає фронтенд, піднімає `vite preview` і знімає скріншоти всіх екранів у Playwright (Chromium має бути встановлений:
`npx playwright install chromium`). Бекенд для цього не потрібен. Скріншоти лягають у `frontend/artifacts/` (не комітиться).

> Після 5 невдалих спроб входу для пари логін + IP вхід блокується на 5 хвилин (429). Перезапуск сервера скидає лічильник.