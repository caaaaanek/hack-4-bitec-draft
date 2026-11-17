# Контракт фронтенду → API бекенду

Фронтенд написано під власну пропозицію контракту (`frontend/docs/api/openapi.yaml`, 48 операцій). Джерело правди тепер
бекенд: [`openapi.json`](openapi.json). Типи для фронтенду варто генерувати з нього:

```bash
cd frontend
npx openapi-typescript ../docs/api/openapi.json -o src/api/schema.d.ts
```

База: `/api/v1`. Вхід: `POST /auth/login` (form-data), далі `Authorization: Bearer <token>`.

## Відповідність операцій

| Фронтенд (пропозиція) | Бекенд | Примітка |
|---|---|---|
| `POST /session` | `POST /auth/login` | form-data `username`, `password` → `access_token` |
| `GET /session` | `GET /auth/me` | роль, категорія, `unit_id` |
| `DELETE /session` | — | JWT без стану: фронтенд просто видаляє токен |
| `PUT /demo/role` | — | у демо — вхід під іншим демо-логіном (`docs/run.md`) |
| `GET/POST /questionnaires`, `GET/PATCH /questionnaires/{id}` | ті самі шляхи | |
| `PUT /questionnaires/{id}/questions` | `PUT /questionnaires/{id}/structure` | уся структура розділів, питань і варіантів одним запитом |
| `POST .../publish`, `.../archive` | ті самі | перед публікацією можна `GET .../validate` |
| `POST .../versions` | `POST /questionnaires/{id}/new-version` | |
| `GET/POST /cycles`, `GET /cycles/{id}` | `GET/POST /campaigns`, `GET /campaigns/{id}` | «цикл» = «хвиля» |
| `PATCH /cycles/{id}`, `PUT .../assignments` | — | анкети й підрозділ задаються при створенні; призначення виводяться з категорії й підрозділу |
| `POST /cycles/{id}/open`, `/close` | `POST /campaigns/{id}/open`, `/close` | закриття фіксує знімок; результати лише після нього |
| `POST /cycles/{id}/publish` | — | результати доступні одразу після закриття |
| `GET /cycles/{id}/counters` | `GET /campaigns/{id}/progress` | без імен; малі групи `too_few_people: true` |
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
| `GET /checklist`, `PUT .../entry`, `POST .../confirmation` | `GET /campaigns/{id}/checklist`, `PUT .../checklist/{question_id}`, `POST .../confirm` | відкликати: `DELETE .../confirm` |
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
   у перемішаному порядку, тому навіть системні поля БД не вказують на людину. Одноразові жетони не потрібні для MVP
   (у промисловій версії — сліпий підпис). Деталі: `docs/backend.md`, розділ «Як забезпечено анонімність».
2. **Вхід.** Логін і пароль, JWT (HS256, 8 годин), без SSO в MVP.
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

- **k = 5, а не 10** (`K_MIN_GROUP` у `src/lib/scoring/methodology.ts`), або підняти `DEFAULT_MIN_GROUP_SIZE` на бекенді. Значення має бути одне.
- Прихований стан: замість `{visibility: "hidden_below_k", fallbackScope}` бекенд віддає `null` у числах, `sufficient: false`,
  `suppressed: true` у групі. `fallbackScope` = `parent_id` підрозділу.
- Ідентифікатори — UUID; назви полів — `snake_case`.
