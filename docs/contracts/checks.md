# Контракт «Перевірки»: декларації, конфлікти інтересів, закупівлі

Модуль для ролі «Уповноважений» (`admin`). Бере записи з файлів, від зовнішніх систем або з відкритих API (НАЗК, Prozorro),
застосовує правила ризику й видає агрегати «X з Y» у ті самі показники, що вже читає індекс:
`declarations_on_time`, `coi_reviewed`, `procurement_flags_reviewed`.

Принципи:
- Імена, телефони, пошту й адреси **не зберігаємо** і не повертаємо. У знахідці лише публічний ідентифікатор запису
  (закупівля) або його хеш (декларація), код правила, серйозність, норми закону.
- Правила детерміновані: ні LLM, ні мережі, ні Neo4j. Однакові дані дають однаковий результат.
- Знахідка це сигнал «варто перевірити», а не висновок про порушення.
- Усі дії пишуться в журнал дій.

Усі шляхи під `/api/v1`. Доступ: `admin`, або заголовок `X-Integration-Key` джерела `checks` (для вхідних POST від зовнішніх систем).

## Вхідні записи

### Закупівля (`procurement`)
Формат «контракт даних v1.2» (один запис = один лот). Обов'язкове лише `record_id`; без решти правила, яким бракує полів, мовчать.

```json
{
  "record_id": "UA-2026-10-01-000123-a-L1",
  "procurement_method": "open",
  "procurement_method_type": "aboveThresholdUA",
  "category": "goods",
  "expected_value": 1500000.0,
  "currency": "UAH",
  "cpv": "30190000-7",
  "dates": {"created_at": "2026-10-01", "tender_start": "2026-10-01", "tender_period_days": 7},
  "buyer": {"edrpou": "00000001", "kind": "general"},
  "bids": [
    {"bid_id": "b1", "amount": 1490000.0, "award_status": "active",
     "bidder": {"edrpou": "11111111", "name": "…", "phone": "…", "email": "…", "address": {"street": "…", "locality": "…"}}}
  ],
  "winner": {"edrpou": "11111111", "amount": 1490000.0},
  "contract": {"changes_count": 0},
  "complaints_count": 0,
  "beneficiaries": []
}
```
Імена, телефони, пошта й адреси учасників використовуються лише всередині розрахунку (порівняння збігів) і ніколи не потрапляють у відповідь чи БД.

### Декларація (`declaration`)
```json
{
  "declaration_id": "nacp_…",
  "declaration_type": 1,
  "declaration_year": 2025,
  "date": "2026-03-28",
  "data": null
}
```
- `declaration_type`: 1 щорічна, 2 перед звільненням, 3 після звільнення, 4 кандидата.
- `date`: дата подання з реєстру НАЗК.
- `data`: необов'язково, повний JSON декларації НАЗК (кроки `step_1`…`step_16`) для правил конфлікту інтересів. Без нього тільки перевірка строку.
- Строк щорічної за рік N: до 31.03 року N+1 включно. Для типів 2 і 3: 30 днів з дати звільнення, якщо її передано у `data.step_1.data.dismissalDate`; інакше строк не оцінюється (`on_time = null`).

## Ендпоінти

| Метод і шлях | Що робить |
|---|---|
| `POST /checks/procurement` | Приймає масив закупівель, рахує правила, зберігає знахідки |
| `POST /checks/declarations` | Приймає масив декларацій, перевіряє строк і правила конфлікту інтересів |
| `GET /checks/runs` | Журнал запусків (`unit_id`, `kind`, `period`) |
| `GET /checks/findings` | Знахідки (`run_id`, `kind`, `status`, `risk_level`) |
| `POST /checks/findings/{id}/review` | Статус `reviewed`, `dismissed` або `new` + коментар |
| `POST /checks/publish` | Рахує X з Y і записує показники (`source = "checks"`) |
| `GET /checks/mock/{kind}` | Синтетичний набір для демо (детермінований за `unit_id`, `period`) |
| `POST /checks/fetch/prozorro` | Жива вибірка з відкритого API Prozorro (лише якщо `EXTERNAL_FETCH_ENABLED=true`) |
| `POST /checks/fetch/nazk` | Жива вибірка зі списку декларацій НАЗК (так само) |

### Запит запуску
```json
{"unit_id": "uuid", "period": "2026-11", "source": "file", "records": [ … ]}
```
`source`: `file`, `api`, `mock`, `prozorro`, `nazk` (мітка походження, на правила не впливає).
Для декларацій замість `records` поле `items`, плюс `year` (звітний рік, за замовчуванням рік періоду мінус 1).
Зайві поля верхнього рівня дають 422. Максимум 5000 записів за запит.

### Відповідь запуску (`RunOut`)
```json
{"run_id": "uuid", "kind": "procurement", "unit_id": "uuid", "period": "2026-11", "source": "file",
 "total": 120, "flagged": 14, "by_risk": {"high": 3, "medium": 6, "low": 5},
 "extra": {}, "created_at": "2026-11-17T20:00:00Z"}
```
Для декларацій `extra` містить `{"on_time": 90, "late": 8, "unknown": 2}`.

### Знахідка (`FindingOut`)
```json
{"id": "uuid", "run_id": "uuid", "kind": "procurement", "unit_id": "uuid", "period": "2026-11",
 "record_ref": "UA-2026-10-01-000123-a-L1", "risk_level": "high",
 "flags": [{"rule_id": "single_bidder_high_value", "severity": "high",
            "title": "Один учасник на великій сумі", "law_refs": ["Закон «Про публічні закупівлі», ст. 3"]}],
 "status": "new", "comment": "", "reviewed_at": null}
```
Для декларацій `record_ref` це `d-` і перші 12 символів sha256 ідентифікатора.

### Публікація показників
`POST /checks/publish` `{"unit_id","period"}` повертає та записує:
- `procurement_flags_reviewed`: розглянуто (`reviewed` або `dismissed`) із позначених за період (X з Y);
- `coi_reviewed`: те саме для знахідок конфлікту інтересів;
- `declarations_on_time`: `on_time` із записів, у яких строк можна оцінити, за останнім запуском декларацій періоду.
Показник без знаменника (Y = 0) не записується. Повторний виклик перезаписує (`UNIQUE(unit_id, period, indicator)`).

## Правила

### Закупівлі (12, з репозиторію `anti-corruption-scheme`)
`single_bidder_high_value`, `winner_price_near_expected`, `short_tender_period`, `shared_phone`, `shared_email`, `shared_address`,
`email_matches_other_bidder`, `winner_not_cheapest`, `cheaper_rejected_near_max`, `non_competitive_high_value`,
`many_contract_changes`, `shared_owner`, `complaints_present`, `split_purchase` (потребує всього масиву запиту). Пороги в конфігурації правил.

### Конфлікти інтересів (6, з `anti-coruption-api-fix`, переписані без графа)
`self_interest`, `business_ownership`, `ngo_risk`, `family_conflict`, `suspicious_gifts`, `large_family_income`. Працюють над `data` декларації.

### Строк декларації
Правило `declaration_late` (серйозність medium) для щорічної, поданої після 31.03.

## Джерела та ліцензії
Код правил адаптовано з приватних репозиторіїв команди (`sololox/-anti-corruption-scheme`,
`Master-of-numbers/anti-coruption-api-fix`) з дозволу їхніх авторів.
