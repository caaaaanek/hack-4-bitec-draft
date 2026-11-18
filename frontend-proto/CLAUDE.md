# frontend-proto — інструкції для Claude

Основний фронтенд команди для хакатону BITEC, «Завдання 3. Integrity Management Dashboard». Дедлайн подання — 18.11.2026 10:00.

Це застосунок на React (Vite, JSX без TypeScript) з власним дизайном. Гілка React-версії — `frontend`; ванільна версія лишилась у гілці `feature/frontend-proto`. Методика, дані й тексти взяті з фронту колеги:
- сайт: https://integrity-platform-demo.vercel.app;
- код у репо: `../frontend/`.

Заглушки колеги тут замінено робочими екранами.

Загальні правила репозиторію (гілки, коміти, без згадок ШІ) — у `../AGENTS.md`. Вони діють і тут.

## ГОЛОВНІ ПРАВИЛА

1. **Не робити `git push` без явного дозволу користувача.** Також не мерджити, не створювати PR і не чіпати віддалені гілки.
2. **Комітити теж лише на прохання.** Робоча гілка — `feature/frontend-proto`. У `main` і `dev` напряму не комітимо.
3. **У комітах немає `Co-Authored-By`, «Generated with…» чи будь-якої згадки ШІ.** Git user не змінювати. Хук `.githooks/commit-msg` це перевіряє: `git config core.hooksPath .githooks`.
4. **Робити лише те, що просили.** Не розширювати задачу й не починати нічого до того, як користувач надішле правку. Якщо незрозуміло, що саме змінити, спитати з варіантами (а/б/в).
5. **Візуальний стиль — користувача.** Зміст, методику й числа звіряти з сайтом колеги. Дизайн без запиту не змінювати.
6. **Бекенд (`../backend/`) і підключення фронту до `/api/v1` робить відповідальний за бекенд.** Не пропонувати й не робити цього.
7. **ШІ лише пояснює вже пораховані правилами числа й пише чернетки.** Розрахунків і рішень він не робить. Є вимикач, і без ШІ все працює. Відповіді, де важливі точні цифри (наприклад, «Чому такий індекс?» чи «Чому така достовірність?»), завжди беруться з шаблону правил (`fixed: true`), а не з моделі.
8. **Тексти інтерфейсу — українською.** Коротко, без канцеляриту, без тире-нагромаджень. Користувачу відповідати російською.
9. **Дані лише синтетичні.** Платні хмарні LLM не використовувати: користувач цього не хоче.

## Деплой

- Прод: https://integrity-prototype.vercel.app (Vercel-проєкт `integrity-prototype`).
- Прив'язка до проєкту лежить у `.vercel/`. Вона в `.gitignore`, але локально присутня.
- Деплоїти після кожної перевіреної правки, щоб користувач бачив результат:
  ```bash
  cd ~/hack-4-bitec-draft/frontend-proto && npx --yes vercel@65.16.0 deploy --prod --yes
  ```
- Прод зараз показує ванільну версію. React-версію з гілки `frontend` деплоїти як preview (та сама команда без `--prod`), на прод — лише з дозволу користувача.
- Vercel сам збирає проєкт: `vercel.json` задає `npm run build` і каталог `dist/`, функція `api/assistant.js` працює як і раніше.
- Якщо Vercel відповідає `DEPLOYMENT_BLOCKED` («commit author doesn't have access»), значить останній коміт зробив хтось поза командою Vercel (наприклад, merge PR на GitHub). Тоді деплоїти копію без git: скопіювати `index.html`, `src/`, `api/`, `package.json`, `package-lock.json`, `vite.config.js`, `vercel.json`, `.vercel/`, `.vercelignore` у тимчасову папку й запустити ту саму команду там.
- `.vercelignore` не пускає на Vercel `server.mjs`, `start.sh`, `README.md`, `CLAUDE.md`, `node_modules`, `dist`, скриншоти й файли Docker.
- Стара копія в `~/integrity-prototype` більше не робоча. Працювати лише тут.

## Структура

```
frontend-proto/
├── index.html          оболонка Vite: <div id="root"> і підключення src/main.jsx
├── src/
│   ├── main.jsx        стилі, роутер (hashchange), запуск boot()
│   ├── App.jsx         оболонка: меню, шапка, пошук, доступність, тема, вхід, оверлеї; applyRoute, applyA11y
│   ├── lib/            логіка без JSX
│   ├── components/     спільні компоненти
│   ├── views/          екрани
│   ├── ai/assistant.jsx асистент
│   └── styles/         CSS: base.css → extra*.css → base-end.css (порядок задано в main.jsx)
├── api/assistant.js    serverless-функція асистента (OpenAI-сумісний /chat/completions)
├── vite.config.js      dev-проксі /api і /health → BACKEND_URL (за замовчуванням http://127.0.0.1:8000)
├── vercel.json, Dockerfile, deploy/ (nginx, шрифт), server.mjs, start.sh
```

Стан лишився «глобальним», як у ванільній версії: `S` (state.js) і `API` (api.js) — звичайні обʼєкти. Після зміни викликається `render()` зі `lib/store.js`:
- `render()` — екран монтується заново, анімації появи програються;
- `render(true)` — тихе оновлення без повторних анімацій.

Компоненти підписані через `useStore()`. Оверлеї керуються обʼєктом `ui` (store.js): `openDrawer(title, () => JSX)`, `closeDrawer`, `toast`, `openPop(kind, anchor)`, `closePop`, `ui.ai`, `ui.exp`, `ui.bld`. Форми в бічній панелі — компоненти з `useState`. Підказки — атрибут `data-tip` (рядок HTML), їх ловить глобальний обробник (`installTips`). Для тестів `window.S` і `window.API` доступні з консолі.

### Що де лежить

**`lib/`**
- `model.js` — модель і дані: `COMPS`, `COMP`, `LEVELS`, `LDESC`, `BOUNDS`, `CAP = 25`, `TODAY`/`CYCLE` (змінюються через `setClock`), `PERCEPTION`, `FACTS`, `credit`, `components`, `trust`, `FLAGS`, `ALPHA_HISTORY`, `OTHERS`, `inst(id)`, `INSTITUTIONS`, `UNITS`, `resolveUnit`, `buildRecs`, `measures`, `overdueDays`.
- `state.js` — анкета `SURVEY`, ролі `ROLE`, меню `NAV` (`[route, label, icon, roles]`), `HOME`, `AI_ROLES`, стан `S` (localStorage `ii-proto-v2`), `persist`, `resetDemo`, журнал з хеш-ланцюгом (`fnv`, `addLog`, `logItems`).
- `api.js` — режим бекенду: `boot` (зокрема скан QR `/q/<код>` → `/s/<токен>`), вхід/вихід, завантаження результатів, рішення, анкети, хвилі й QR для зали (`apiQrCreate`, `apiQrRevoke`, живі лічильники `apiQrTick`), чек-лист, журнал.
- `nav.js` — `route()`, `allowed`, `can`, `cur()`, `TITLES`, `isLogin`.
- `store.js` — `render`, `useStore`, `ui`, панелі, поповер, сповіщення.
- `format.js` (`fb`, `f1`, `pts`, `ua`, `plural`), `texts.js` (тексти «Чому такий індекс/достовірність»), `util.js` (завантаження файлу, копіювання), `icons.jsx` (`<Ic n="…"/>`).

**`components/`**
- `ui.jsx` — `Pill`, `LvPill`, `TrustPill`, `Num` (анімація числа), `Delta`, `LevelBar`, `Ticks`, `useWidth`.
- `charts.jsx` — `MiniTrend`, `TrendChart`, `Radar` (SVG, ширина з `useWidth`).
- `overlays.jsx` — підказка (`showTip`/`hideTip`, з урахуванням zoom через `Z()`/`zr()`), `Drawer`, `Pop` + `placePop`, `Toast`.
- `DatePicker.jsx`, `UnitCombo.jsx`.

**`views/`**
- `results.jsx` — «Огляд», «Розклад індексу», «Динаміка», «Порівняння», `ReadGuide`, вибір періоду (`PeriodPop`).
- `panels.jsx` — бічні панелі: `openWhy`, `openTrust`, `openHow`, `openResp`, `openItem`, `openApiQ`, `openSource`, `openMeasure`; «i» на картках «Огляду» — `openHow`, `openTrustHow`, `openTrackerHow`, `openRespHow`. Клік на картку індексу чи достовірності одразу показує готовий висновок за правилами (`whyText`, `trustBecause` у `texts.js`), асистента не запускає; обговорити з ним можна кнопкою внизу панелі.
- `work.jsx` — «Рекомендації» (прийняти/уточнити/відхилити), «Трекер заходів» (таблиця й дошка з перетягуванням), «Джерела», «Заклади».
- `WhatIf.jsx` — «Що, якщо»: прогноз індексу, якщо підтягнути факти, закрити пункти чек-листа чи виконати заходи. З бекендом рахує `POST /campaigns/{id}/what-if` (нічого не записує), у демо — та сама модель, що й «Огляд». Топ-5 важелів із кнопкою «Додати», пояснення до кожного компонента. Опитування не моделюються. Стилі — `extra-whatif.css`.
- `Report.jsx` — екран «Звіт»: шаблони, масштаб, редагування, ШІ за виділенням, вікно експорту (PDF/друк, HTML, CSV, JSON, копіювати; з бекендом ще Word за шаблоном і Excel із `GET /campaigns/{id}/report`; Excel завжди повний, тож без `template`).
  - Шаблони `RT_TPL` (`report-templates.jsx`): Додаток Г, довідка керівнику, стан Плану заходів, динаміка між циклами. Усі з тих самих даних (`cur()`, `buildRecs()`, `measures()`), нових розрахунків немає.
  - Масштаб 50–200 %: повзунок і −/+, Ctrl/⌘ + коліщатко (крок 10 %), щипок тачпада й двома пальцями, Safari `gesture*`. CSS `zoom`, при друку 100 %.
  - «Редагувати»: документ `contentEditable`, правки в localStorage окремо для закладу, циклу й шаблону (`ii-rt-edit:…`). «Скинути правки» — натиснути двічі.
  - ШІ за виділенням (`ReportAi.jsx`): «Запитати ШІ» → `POST /api/assistant/edit`. Заміна лише після «Замінити» (через `insertText`, тож Ctrl/⌘+Z працює); попередження про числа, яких немає у звіті. Без бекенду чи моделі — повідомлення, правити можна вручну.
- `demo.jsx` — демо-екрани без бекенду: «Керування циклом», «Анкети», «Чек-лист», «Журнал», «Опитування», «Мої результати».
- `api-views.jsx` — ті самі екрани з даними сервера; `apiView(route)` повертає `null`, якщо треба показати звичайний екран. У «Керуванні циклом» картка «QR для зали» і повноекранний QR (`QrScreen`); сам код малює `components/QrCode.jsx` (qrcode-generator, локально).
- `Builder.jsx` — конструктор анкети (режим API).
- `Learn.jsx`, `Insights.jsx`, `Autopilot.jsx`, `Normative.jsx`, `Checks.jsx` — модулі автоматизації (див. README). Дані з сервера беруть через `apiMod(ключ, завантажувач)` з `lib/api.js` (кеш у `API.mod`, `apiModReset` для повтору); стани екрана (`Loading`, `Failed`, `Empty`, `NoAccess`, `NeedServer`) у `components/states.jsx`. Тексти правил сервера з довгим тире показуємо через `dsh()`.

**`ai/assistant.jsx`** — `aiTemplate(q)` (шаблони правил, регулярні вирази від питання), `aiAsk`, `aiOpen`, `aiClose`, панель `AiPanel`.

Новий екран: компонент у `views/`, пункт у `NAV` (state.js), заголовок у `TITLES` (nav.js), запис у мапі `V` (App.jsx).

## Методика (з сайту колеги)

**Компоненти й рахунок**
- Три компоненти: Культура, Система, Підзвітність.
- У кожному компоненті є сприйняття P (зважені питання анкет: РГ, особовий склад, експерти) і факти F (`pct` з «X з Y» або рівень 1–5 → (l−1)·25).
- Зараховано = min(P, F + 25). Текст причини — у `credit()`.
- Індекс = середнє трьох зарахованих значень.

**Рівні зрілості:** межі 12,5 / 37,5 / 62,5 / 87,5. Назви: Початковий, Керований, Визначений, Вимірюваний, Оптимізуючий. Описи (`LDESC`) — з Моделі зрілості НАЗК у `../docs/md/recommendations_transform_dobrochesnist.md`.

**Достовірність**
- «Недостатньо даних», якщо відповідей менше k.
- C — є серйозний прапорець або три й більше незначних.
- B — один-два незначних.
- A — прапорців немає.
- Прапорці: tf-gap (серйозний), tf-same (незначний), tf-jump (серйозний), tf-experts (незначний).

**Рекомендації:** 5 правил. Статуси: запропоновано → прийнято / уточнено / відхилено. Прийняття створює захід у трекері.

**Еталонні числа «Альфи»** (перевіряти після змін у моделі):
- індекс 54,2; рівень 3; достовірність C; +7,2;
- компоненти зараховано: Культура 57,5, Система 45, Підзвітність 60 (обмежувач: P 80, F 35);
- інші заклади навмисно покривають усі рівні й варіанти достовірності: «Гамма» 93,2 / рівень 5 / A; «Сигма» 78,7 / 4 / B; «Бета» 30,5 / 2 / «Недостатньо даних» (7 відповідей < k); «Омега» 11,7 / 1 / C (−6,7 за цикл). Задаються в `OTHERS` (`flags`, `responses`, `declining: "all"`).

**Ролі:** admin, commissioner, respondent, leader, observer, checklist_editor, checklist_approver, auditor, coordinator. Асистента бачать лише leader, observer і auditor.

## Як робити правку

1. Правити файли в `src/`. Залежності: `npm install` (один раз).
2. `npm run build` має пройти без помилок.
3. Перевірити в Chromium без вікна: playwright-core + `/usr/bin/chromium`. Якщо в scratchpad немає `node_modules`:
   ```bash
   mkdir -p <scratchpad>/pw && cd <scratchpad>/pw && npm i playwright-core@1.48.2
   ```
   Сторінку віддає `npx vite preview` (http://localhost:4173). Для демо-режиму без бекенду: `BACKEND_URL=http://127.0.0.1:9 npx vite preview`. Мінімальний скрипт перевірки:
   ```js
   import { chromium } from "playwright-core";
   const br = await chromium.launch({ executablePath: "/usr/bin/chromium" }); const errs = [];
   const p = await (await br.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
   p.on("pageerror", e => errs.push(e.message));
   await p.goto("http://localhost:4173/");
   await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
   await p.selectOption("#role", "leader"); await p.evaluate(() => { location.hash = "overview"; }); await p.waitForTimeout(1200);
   await p.screenshot({ path: "shot.png", fullPage: true });
   console.log("ERRORS:", errs.length ? errs : "none"); await br.close();
   ```
   Що перевіряти:
   - ширини 1440 і 390;
   - немає горизонтального скролу: `document.documentElement.scrollWidth > innerWidth` має бути false;
   - немає `pageerror`;
   - на скриншоті все виглядає правильно (переглядати Read).
4. Задеплоїти (див. «Деплой») і коротко звітувати користувачу російською: що змінено, де подивитися, що перевірено.
5. Не комітити й не пушити, доки користувач не попросить.

## Відкриті питання

- **Ще не зроблено для подання:** відео до 3 хв і `docs/ai.md` («Як ми використали ШІ», до 1 сторінки). Робити лише на прохання.
- **Дообучення локальної моделі** (gemma3:4b через Ollama) відкладено, доки не буде готовий бекенд.
