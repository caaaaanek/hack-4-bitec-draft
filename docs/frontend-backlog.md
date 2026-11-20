# Бекенд готовий, екрана немає: карта для фронтенду

20.11.2026. Усе нижче вже працює в API (`/api/v1`, Swagger — `/docs`, схема — `docs/api/openapi.json`), але `frontend-proto`
жодного з цих маршрутів поки не викликає. Приклади — справжні відповіді демо-бази (`seed --with-waves`, хвиля 2).

Загальні правила для всіх екранів:
- `null` замість числа — «недостатньо даних» або «замало людей для показу», **не нуль**. Показувати «Немає даних» чи замок.
- 403 з текстом «Деталі іншого підрозділу бачить лише сам підрозділ» — нормальна відмова, а не помилка: прибрати перехід.
- Помилки мають вигляд `{code, message, hint}`; `message` і `hint` можна показувати людині як є.
- Що ввімкнено в розгортанні, видно з `GET /config` → `policies` (див. п. 9). Кнопки показувати за ним.

---

## Для відео (до 23.11)

### 1. Картка «Що люди бояться сказати прямо» на «Огляді»
`GET /dashboard` (leader, admin, commissioner, auditor) уже віддає:

```json
"candor_card": [
  "«Мені натякали, що оцінку чи рішення можна «покращити» за подяку»: прямо визнали 3,2%, непряма оцінка 19,4% (від 5,4 до 33,3%).",
  "Дзеркало: 82,5% кажуть, що вчинили б так самі; про колег так думають лише 41,3%."
],
"candor_flags": ["concealment", "pluralistic_ignorance"]
```

- Порожній `candor_card` — картку не показувати (непрямих питань немає або < 30 відповідей на варіант).
- Деталі з числами для графіка «два стовпчики»: `GET /campaigns/{id}/candor?unit_id=` →
  `candor.list_experiments[]` (`statement`, `direct_share` 3,2, `estimate` 19,4, `ci` [5,4, 33,3], `sufficient`, `rule`) і
  `candor.mirrors[]` (`self_text`, `self_share` 82,5, `others_share` 41,3). `sufficient: false` — «недостатньо даних».

### 2. Кнопки «Брифінг за 30 секунд» і «План до наступного рівня»
- `GET /campaigns/{id}/briefing?format=json|docx` (RESULT_READERS). JSON:
  ```json
  {"numbers": [{"label": "Integrity Index", "value": 53.7, "text": "53,7 зі 100, рівень 3"},
               {"label": "Достовірність", "value": "C", "text": "C"}, {"label": "Участь", "value": 94.7, "text": "94,7%"}],
   "risks": ["Підзвітність: 43,8 (потребує уваги) — самооцінку не підтверджують факти", "…"],
   "decisions": [{"title": "Люди бояться відповідати чесно: посилити захист викривачів", "priority": "високий"}, "…"]}
  ```
- `GET /campaigns/{id}/next-level-plan?format=json|docx` — План заходів за Додатком Д: `current_level`, `target_level`,
  `index`, `index_after`, `steps[]` (`title`, `responsible` — посада, `due_date`, `gain`, `level_after`).
  `status`: `reached` (план доводить до наступного рівня), інакше показати, скільки бракує.
- `format=docx` — завантаження Word: просто `<a download>` з токеном у заголовку (як для звіту за Додатком Г).

### 3. Журнал переглядів для аудитора
`GET /admin/result-views?date_from=&date_to=&actor_id=&role=&unit_id=&campaign_id=&limit=` (auditor, admin):

```json
{"total": 2,
 "by_actor": [{"actor_id": "…", "login": "admin", "role": "admin", "views": 2, "units": ["Підрозділ А"]}],
 "items": [{"at": "2026-11-20T09:31:02Z", "login": "admin", "unit_name": "Підрозділ А",
            "endpoint": "/campaigns/{campaign_id}/what-if", "campaign_id": "…"}]}
```

Таблиця «хто дивився чужі підрозділи»: зверху `by_actor` (хто скільки), нижче `items`. Пише кожен ендпойнт результатів
(дашборд, результати, рекомендації, «Що, якщо», звіти, факти, ризики, «Питання перевірки», асистент); свій підрозділ і
корінь хвилі не пишуться. Підпис для відео: «систематичне порівняння підрозділів видно аудиту».

---

## Захист від колективного покарання і Департамент

### 4. Керівник: розподіл дочірніх без назв
`GET /units/{id}/children-levels?campaign_id=` (leader):
```json
{"children_total": 6, "with_data": 6, "insufficient": 0, "levels": {"1": 0, "2": 0, "3": 6, "4": 0, "5": 0},
 "hidden": false, "rule": "Лише кількість підрозділів на кожному рівні, без назв…"}
```
`hidden: true` (менше 3 підрозділів з даними) — показати `rule`, без стовпчиків. Деталі дочірнього підрозділу керівник
**не отримає** (403): у дереві підрозділів прибрати перехід на чужий підрозділ.

### 5. Департамент (роль `department`)
- Зіставити роль: бекенд `department` = фронтенд `observer`.
- `GET /department/institutions` — список **без індексів і без рейтингу**: `name`, `closed_waves`, `open_waves`, `last_closed_on`.
- `GET /department/institutions/{unit_id}` — один заклад: `latest` (як результати хвилі), `note` («Рейтингу немає…»).
- `GET /dashboard` без `unit_id` для Департаменту — 422 `unit_required`: спершу вибір закладу.
- Демо-екран «Заклади» зараз ставить індекси поруч: прибрати індекс із карток.

---

## Чек-лист, довідники, люди

### 6. Вкладка «Відповідальні» в чек-листі
- `GET /campaigns/{id}/checklist/assignments` (admin): `[{question_id, code, number, enterer_id, enterer, confirmer_id, confirmer}]`.
- `PUT /campaigns/{id}/checklist/assignments` `{"items": [{"question_id": "…", "enterer_id": "…", "confirmer_id": "…"}]}`.
- Вносить лише призначений член РГ, підтверджує призначений підтверджувач (`policies.checklist_confirmers`); одна людина
  не може бути обома (422). Без призначення — як раніше.

### 7. Довідники (категорії й посади — coordinator; категорії ще й department; факти — admin)
- Категорії: `GET/POST/PATCH /dictionaries/categories` — `{code, title, weight, builtin, active, in_index}`.
  Без ваги нова категорія (курсанти) лише порівнюється, в індекс не йде — так і підписати.
- Посади: `GET/POST/DELETE /dictionaries/positions`. **Трекер заходів:** поле «Відповідальний» брати списком звідси.
- Факти: `GET/POST/PATCH /dictionaries/facts` — `{code, title, component, thresholds, builtin, active, owner_sources}`.
  `owner_sources` — хто має право передавати факт (порожньо — будь-яке джерело).

### 8. Люди: запрошення і принцип двох осіб
- `POST /admin/users` без `password` → `invite_link: "/invite/<токен>"`, `invite_expires_at`. Показати посилання один раз
  з кнопкою «Копіювати».
- **Сторінка `/invite/<токен>`** (без входу): поле пароля → `POST /auth/invite {token, password}` → 204 → на вхід.
  Помилки: 404 `invite_invalid` — посилання недійсне чи прострочене (показати `hint`); 429 — `Retry-After`.
- `POST /admin/users/{id}/invite` — повторне запрошення.
- Якщо `policies.four_eyes`: створення привілейованої ролі, імпорт, відкриття хвилі повертають `pending_approval_id`.
  Екран «Запити»: `GET /admin/approvals`, `POST /admin/approvals/{id}/approve|reject`. Підтверджує не той, хто просив (403).

---

## Налаштування і безпека

### 9. `GET /config` → `policies`
```json
{"four_eyes": true, "admin_sets_passwords": false, "staff_token_only": false, "leader_child_details": false,
 "separate_tech_admin": true, "checklist_confirmers": ["auditor"], "checklist_require_file": true,
 "external_fetch": false, "security_profile": "demo", "overridden": []}
```
- `admin_sets_passwords` тепер завжди `false`, `separate_tech_admin` — завжди `true` (поля лишено для сумісності).
  Поле пароля з форми користувача прибрати зовсім: API його не приймає (422).
- `staff_token_only: true` — у майстрі хвилі для особового складу лише QR і посилання.
- `security_profile: "production"` і непорожній `overridden` — адміну показати попередження «вимкнено запобіжник: …».
- `org_terms` (`{"nominative": "заклад", …}`) — підставляти замість зашитого «заклад».

### 10. Якір журналу (аудитор)
- `POST /admin/audit-log/anchor` — «Прийняти поточну голову»: показати `seq` і `hash` великим шрифтом + «Надрукувати».
- `GET /admin/audit-log/anchors` — історія; експортовані назовні мають `accepted_by_id: null` і `note` «Якір назовні (щоденний|вручну): file…, tsa…».
- `POST /admin/audit-log/verify-anchor {seq, hash}` — звірка копії аудитора: `{ok, matches, chain_ok, reason}`.
- `POST /admin/audit-log/export-anchor` — «Експортувати зараз»; 409 `anchor_disabled` — сховище не налаштовано, кнопку сховати.

### 11. «Що саме ми зберігаємо» перед анкетою
`GET /respond/privacy` (без входу): `{title, modes: {login: [...], ballot: [...], token: [...]}}`. Показати пункти режиму,
у якому людина проходить анкету, на вступному екрані.

---

## Решта нових функцій (P1–P2)

| Функція | Маршрути | Хто | Що показати |
|---|---|---|---|
| Урна з трьома ключами | `GET/PUT/DELETE /campaigns/{id}/urn`, `GET .../urn/my-share`, `POST .../urn/shares {share}` | admin налаштовує; власники частин | `PUT {holder_ids: [3 id]}` для чернетки; власник забирає частину один раз (показати як QR + текст); закриття — коли дві частини повернуто (`ready`) |
| Лотерея перевірок | `GET /campaigns/{id}/audit-lottery` | auditor | `items[]` (номер, текст, статус) і `seed` — «перевірити жеребкування може кожен» |
| Стійкість ваг ±10 % | `GET /campaigns/{id}/sensitivity` | RESULT_READERS | таблиця `rows[]` (`source`, `change`, `index`, `delta`, `level`); «рівень не змінюється» — головний висновок |
| Детектор Гудхарта | `gaming_signals[]` у `GET /dashboard` | RESULT_READERS | картка `title` + `description`, `rule` — по кліку |
| Реєстр ризиків | `POST /units/{id}/risk-register/import` (CSV), `GET /units/{id}/risk-register` | admin імпортує; RESULT_READERS | `items[]`, `by_component` (`total`, `open`, `without_measure`) |
| Квитанції (сліпий підпис) | `GET .../questionnaires/{qid}/ballot-key`, `POST .../ballot`, `POST /respond/ballot`, `GET /respond/receipts/{r}` | респондент | клієнтська частина сліпого підпису (RSA blind) у браузері; квитанцію людина зберігає й перевіряє після закриття |
| Ознака накрутки QR | `GET /campaigns/{id}/qr-links` → `over_expected`, `scan_limit_reached` | admin | брати з API, прибрати власний розрахунок `completed > expected` |
| Власник факту | `POST /indicators` → 409 `not_fact_owner` | адаптери | показати `message` («передає лише джерело: checks») у журналі інтеграцій |

## Що змінилось у відповідях, які фронтенд уже читає

- `GET /admin/result-views` — додано `total` і фільтри `role`, `unit_id`, `campaign_id`.
- `GET /campaigns/{id}/qr-links` — додано `over_expected`, `scan_limit_reached`.
- `GET /dictionaries/facts` — додано `owner_sources`.
- `GET /config` → `policies` — додано `security_profile`, `overridden`.

---

## Ролі, два адміністратори, зони (бекенд 20.11, ввечері)

Опис моделі — `docs/backend.md`, «Ролі» і «Два адміністратори, зони, принцип двох осіб». Що треба на фронтенді:

- **Прибрати `commissioner`.** Логіна в демо більше немає. У `department` першим екраном «Анкети» (конструктор, версії,
  публікація). Підтверджує чек-лист `auditor` (`policies.checklist_confirmers`).
- **«Люди» й «Довідники» (категорії, посади) — лише `coordinator`.** Уповноважений отримує 403 на `/admin/users`,
  `/admin/units`, `/dictionaries/categories|positions` (POST/PATCH). Поля пароля немає; після створення показати
  `invite_link` один раз. Масовий імпорт людей: `POST /admin/users/import` (CSV `login,category,unit[,display_name]`).
  Скидання пароля — кнопка «Нове запрошення» (`POST /admin/users/{id}/invite`; старий пароль і сесії гаснуть).
- **Координатор не бачить хвиль, результатів, журналу, чергового, автопілота** (403). Його меню: Люди, Підрозділи,
  Довідники, Запити (свої), Зведення (`/admin/overview` без хвиль: `campaigns: []`, `checks: null`).
- **Уповноважений обирає людей хвилі з `GET /campaigns/{id}/people?role=&category=`**: учасників, відповідальних за
  пункти чек-листа, власників ключа урни. Підрозділ нової хвилі — з `GET /units` (лише його зона); чужий → 422 `out_of_zone`.
  Імпорт учасників хвилі лише додає наявних людей; невідомий логін → рядок помилки «людей заводить технічний адміністратор».
- **«Запити другій людині»** (`GET /admin/approvals`): у кожного запиту `approver_roles` і `can_decide`. Кнопки
  «Підтвердити / Відхилити» лише при `can_decide: true`. Відкриття хвилі підтверджує лише `auditor`, нові люди й ролі —
  `admin` (запис самого уповноваженого — `auditor`). Відповідь `POST /campaigns/{id}/open` з `pending_approval_id` —
  стан «чекає на підтвердження аудиту», а не помилка.
- **Підрозділи в межах чернетки хвилі**: `POST/PATCH/DELETE /admin/units` → 202 `{pending_approval_id, kind: "unit_change"}`
  — показати «зміну передано уповноваженому»; відкритої хвилі — 409 `campaign_open`.
- **Чек-лист**: обов'язковий документ за `policies.checklist_require_file`; пункт з `file_required: true` підсвітити.
  Надсилати пункт разом із файлами одним запитом `POST .../checklist/{qid}/submit` (multipart `status`, `evidence`,
  `comment`, `files`).
- **Автопілот**: `GET /campaigns/{id}/autopilot` → `interval_seconds` (0 — лише вручну), `next_tick_at` (точний час
  наступного кроку; `null` — фоновий потік не запущено) і `waiting_approval_id` (стан «чекає на підтвердження відкриття»).
  Подія кроку зі `status: "waiting"` — не помилка.
- **Сторінка входу**: список «Демо-облікові записи» — `admin`, `coordinator`, `department`, `auditor`, `leader`,
  `leader_a`, `wg1`, `staff01`, `expert1` (без `commissioner`).
