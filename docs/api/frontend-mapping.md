# Контракт фронтенду → API бекенду

Фронтенд написано під власну пропозицію контракту (`frontend/docs/api/openapi.yaml`, 48 операцій). Джерело правди тепер
бекенд: [`openapi.json`](openapi.json). Типи для фронтенду варто генерувати з нього:

```bash
cd frontend
npx openapi-typescript ../docs/api/openapi.json -o src/api/schema.d.ts
```

База: `/api/v1`. Вхід: `POST /auth/session` (JSON), далі `Authorization: Bearer <token>`.

**Стан (17.11): фронтенд підключено.** Екрани беруть дані з API через `src/api/AppData.tsx` (остання закрита хвиля,
знімок, історія, рекомендації, заходи) і адаптери `src/api/adapters.ts` (моделі бекенду → моделі екранів, тести на справжніх
відповідях у `adapters.test.ts`). Вхід — `src/pages/Login.tsx`, сесія — `src/api/session.tsx`, ролі бекенду → ролі інтерфейсу —
`frontRole` + `API_ROLE_ROUTES` у `src/lib/access.ts`. Демо-режим без бекенду: `VITE_DEMO=true` (`npm run dev:demo`).

**Готово для підключення (v0.3):**
- Клієнт `frontend/src/api/client.ts` (fetch, токен у sessionStorage, `ApiError`), типи `frontend/src/api/backend.d.ts`
  (`npm run api:types:backend`), тести `client.test.ts`.
- У розробці Vite проксіює `/api` на `http://localhost:8000` (`VITE_PROXY_TARGET`), у Docker — nginx: один origin, CORS не задіяний.
- **Помилки** `{code, message, hint, detail, errors?, missing_question_ids?, request_id}` — те, що просив фронтенд (`{code, message, hint}`).
- **k одне:** `K_MIN_GROUP = 5` у фронтенді, бекенд віддає те саме в `GET /config` → `min_group_size`; для хвилі — її `min_group_size`.
- **snake_case без перетворень.** Поля як у бекенді; ключі-словники (категорії, коди компонентів) лишаються як є, тому автоматичне
  camelCase-перетворення не робимо: воно зламало б ключі `working_group` тощо. Типи генеруються з `openapi.json`.

## Відповідність операцій

| Фронтенд (пропозиція) | Бекенд | Примітка |
|---|---|---|
| `POST /session` | `POST /auth/session` | JSON `{login, password}` → `access_token`, `expires_in`, `role`, `user` (є й `POST /auth/login` з form-data) |
| `GET /session` | `GET /auth/session` (= `GET /auth/me`) | роль, категорія, `unit_id` |
| `DELETE /session` | `DELETE /auth/session` | 204; JWT без стану, фронтенд видаляє токен |
| — | `POST /auth/proxy` | вхід через SSO організації, якщо `GET /config` → `auth.proxy` |
| `PUT /demo/role` | — | у демо — вхід під іншим демо-логіном (`docs/run.md`) |
| `GET/POST /questionnaires`, `GET/PATCH /questionnaires/{id}` | ті самі шляхи | |
| `PUT /questionnaires/{id}/questions` | `PUT /questionnaires/{id}/structure` | уся структура розділів, питань і варіантів одним запитом |
| `POST .../publish`, `.../archive` | ті самі | перед публікацією можна `GET .../validate` |
| `POST .../versions` | `POST /questionnaires/{id}/new-version` | |
| `GET/POST /cycles`, `GET /cycles/{id}` | `GET/POST /campaigns`, `GET /campaigns/{id}` | «цикл» = «хвиля» |
| `PATCH /cycles/{id}` | `PATCH /campaigns/{id}` | лише чернетка: назва, підрозділ, анкети, k, `access_mode` |
| `PUT .../assignments` | `PUT /campaigns/{id}/participants`, `POST .../participants/import` | явний склад або CSV псевдонімів; без нього — за категорією й підрозділом |
| `/s/:token` (опитування за посиланням) | `GET /respond/form`, `POST /respond/responses` | токен у заголовку `X-Response-Token`; видача: `POST /campaigns/{id}/tokens`; повтор → 409 `token_used` |
| `POST /cycles/{id}/open`, `/close` | `POST /campaigns/{id}/open`, `/close` | закриття фіксує знімок; результати лише після нього |
| `POST /cycles/{id}/publish` | — | результати доступні одразу після закриття |
| `GET /cycles/{id}/counters` | `GET /campaigns/{id}/progress` | без імен; малі групи `too_few_people: true`; для хвилі за посиланнями «видано / використано» |
| `GET /my/surveys` | `GET /me/assignments` | |
| `GET /my/surveys/{id}` | `GET /campaigns/{cid}/questionnaires/{qid}/form` | без балів варіантів |
| `PUT /my/surveys/{id}/draft` | — | **лише на клієнті** (localStorage): серверна чернетка зв'язала б людину з відповідями |
| `POST /my/surveys/{id}/submit` | `POST /campaigns/{cid}/questionnaires/{qid}/responses` | |
| `GET /units` | `GET /units` | `id`, `name`, `parent_id` |
| `GET /institutions` | `GET /units` (корені дерева) | заклад = кореневий підрозділ |
| `GET /dashboard` | `GET /dashboard` | |
| `GET /index/breakdown` | `GET /campaigns/{id}/results` | `components[].sources`, `rule`, `facts` |
| `GET /compare` | `GET /campaigns/{id}/results` (`questions[].by_category`) і `GET /units/{id}/compare` | категорії й хвилі, не підрозділи |
| `GET /trends` | `GET /units/{id}/history` | з `measures_done` |
| `GET /facts` | `GET /units/{id}/indicators?months=3\|6\|12` | |
| `PUT /facts/{id}/manual` | `POST /indicators` (admin) | ручний ввід = той самий прийом фактів |
| `GET /data-sources` | `GET /integrations/status` (admin) + `GET /methodology` (`facts`) | |
| `GET /checklist`, `PUT .../entry`, `POST .../confirmation` | `GET /campaigns/{id}/checklist`, `PUT .../checklist/{question_id}`, `POST .../confirm` | відкликати: `DELETE .../confirm`; файли: `.../checklist/{question_id}/files` (multipart `file`) |
| `GET /recommendations` | `GET /campaigns/{id}/recommendations` | |
| `POST /recommendations/{id}/decision` | `POST /campaigns/{id}/recommendations/{code}/decision` | |
| `GET /measures`, `PATCH /measures/{id}` | ті самі | + `POST /measures`, `GET /measures/stats`; `overdue_days` є |
| `GET /me` | `GET /me/results` | |
| `POST /reports`, `GET /reports/{id}`, `.../export` | `GET /campaigns/{id}/report?format=json\|csv` | звіт будується на льоту зі знімка; PDF — print.css |
| `GET /audit` | `GET /admin/audit-log` | фільтри й `offset` |
| `POST /audit/verify` | `POST /admin/audit-log/verify` | |
| `GET /methodology` | `GET /methodology` | |
| `PATCH /methodology` | — | методика змінюється лише в коді з новою версією (`methodology.py`), щоб знімки лишались порівнянними |

## Відповіді на питання фронтенду

1. **Анонімність.** Окремі таблиці «хто пройшов» і «що відповіли» без зв'язку, плюс буфер: відповіді переносяться пачками ≥ k
   у перемішаному порядку, тому навіть системні поля БД не вказують на людину. Є й одноразові посилання (хвиля `access_mode: token`)
   без облікових записів. Деталі: [`docs/anonymity.md`](../anonymity.md).
2. **Вхід.** Логін і пароль, JWT (HS256, 8 годин); або через довірений проксі організації (`POST /auth/proxy`).
3. **Ролі.** `admin`, `commissioner`, `respondent`, `leader`, `auditor`. Ваші `observer` → `leader` без підрозділу,
   `checklist_editor` → респондент категорії `working_group`, `checklist_approver` → `commissioner`.
4. **Ваги питань** — у анкеті (`weight` питання). Ваги джерел і компонентів — у методиці.
5. **Індекс, обмежувач і достовірність рахує бекенд.** Фронтенд лише показує; `lib/scoring` можна лишити для демо.
6. **Хеш методики** — поки лише `version`. **Журнал** — ланцюжок sha256 (`seq`, `prev_hash`, `hash`).
7. **Підрозділи** — дерево `unit` будь-якої глибини. Підрозділ респондента береться з його облікового запису й зберігається
   у відповіді лише як `unit_id` (без людини). Групи, менші за k, і групи, які довелося приховати, щоб малу не можна було
   обчислити різницею, приходять із `null` замість чисел і `suppressed: true` / `too_few_people`.
8. **Факти** — `POST /indicators` з інших систем (ключ на джерело) або вручну адміном; помісячно.

## Що треба змінити у фронтенді

- ~~k = 5, а не 10~~ — зроблено (`K_MIN_GROUP = 5`, тести оновлено).
- Екрани перевести з `src/demo` на `api` з `src/api/client.ts`; опитування `/s/:token` — на `api.tokenForm` / `api.tokenSubmit`.
- Прихований стан: замість `{visibility: "hidden_below_k", fallbackScope}` бекенд віддає `null` у числах, `sufficient: false`,
  `suppressed: true` у групі. `fallbackScope` = `parent_id` підрозділу.
- Ідентифікатори — UUID; назви полів — `snake_case`.
