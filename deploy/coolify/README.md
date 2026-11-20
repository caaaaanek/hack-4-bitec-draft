# Розгортання на Coolify кафедри (`*.csit-mitit.com`)

Один ресурс Docker Compose з файлу `docker-compose.coolify.yml` у корені репозиторію: PostgreSQL, бекенд і
фронтенд. Назовні відкривається лише фронтенд; він проксує `/api` на бекенд, тож CORS не потрібен. При першому
старті створюються демо-дані з двома хвилями (як у `docker compose up`). Асистент — Gemma на шлюзі кафедри.

Загальні правила Coolify кафедри — у посібнику для курсантів (вхід через GitLab ВІТІ, команда своєї групи, без
`ports:`, `mem_limit` для кожного сервісу). Нижче лише те, що стосується цього проєкту.

## 1. Доступ до репозиторію

Репозиторій на GitHub приватний, тож Coolify потрібен токен лише на читання. Створює його власник репозиторію
(fine-grained токен GitHub діє лише для репозиторіїв свого власника):

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → `hack-4-bitec-draft`.
3. **Permissions → Repository permissions → Contents:** *Read-only* (решта — *No access*). Строк — до кінця хакатону.
4. Адреса для Coolify:

```
https://<логін власника GitHub>:<токен>@github.com/caaaaanek/hack-4-bitec-draft.git
```

Лише HTTPS-адреса: SSH-формат (`git@github.com:…`) Coolify кафедри не клонує.

Токен — секрет: не комітити й не пересилати в загальні чати. Після хакатону — видалити в GitHub.

## 2. Ресурс

1. https://coolify.csit-mitit.com → **Login with GitLab** → перемикач команд угорі ліворуч: **Group 1** (або своя група).
2. **Projects → + Add**: назва `Integrity Management Dashboard` → **Continue** → середовище `production`.
3. **+ New → Public Repository** (пункт називається «Public», але адреса з токеном відкриває й приватний):
   - **Repository URL:** адреса з розділу 1;
   - сервер своєї групи (`deploy-1` для Group 1, `deploy-2` для Group 2);
   - **Branch:** `main` (або `dev` для перевірки);
   - **Build Pack:** `Docker Compose`;
   - **Base Directory:** `/`;
   - **Docker Compose Location:** `/docker-compose.coolify.yml`.
4. **Continue** — Coolify покаже сервіси `db`, `backend`, `frontend`.

## 3. Домен

Лише для `frontend`, саме так (з `http://` і портом контейнера `8080`):

```
http://<назва>.csit-mitit.com:8080
```

Назва — латиниця в нижньому регістрі й дефіси, один рівень піддомену, наприклад `bitec-imd`. Для `backend` і
`db` домен **не задавати**. Ззовні застосунок відкривається як `https://<назва>.csit-mitit.com` (HTTPS дає Cloudflare).

## 4. Змінні середовища (Environment Variables)

Несекретні налаштування (часовий пояс, поріг k, демо-дані, модель, ліміти файлів) уже зашиті в
`docker-compose.coolify.yml`, тож у Coolify лишаються лише ці:

| Змінна | Значення |
|---|---|
| `SERVICE_PASSWORD_POSTGRES` | Coolify генерує сам. Перевірте, що поле не порожнє |
| `SERVICE_PASSWORD_POOL` | Coolify генерує сам: ключ шифрування буфера відповідей. Не змінювати посеред хвилі |
| `JWT_SECRET` | обов'язково, ≥ 32 символи: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `DEMO_PASSWORD` | обов'язково, пароль демо-користувачів (≥ 8 символів) |
| `PUBLIC_URL` | обов'язково: `https://<назва>.csit-mitit.com` — з нього будуються посилання на анонімне проходження |
| `LLM_BASE_URL` | `https://api.csit-mitit.com/v1` — увімкнути асистента; порожньо — шаблони правил |
| `LLM_API_KEY` | ключ шлюзу кафедри (видає адміністратор шлюзу) |
| `INTEGRATION_KEYS` | за потреби: ключі джерел фактів (`artemida=…;atestat=…;…`); можна лишити порожнім |

Вводьте лише значення, без `${…}`. Після зміни змінних — **Redeploy**, а не Restart.

## 5. Деплой і перевірка

**Deploy**. Перша збірка триває кілька хвилин; бекенд стартує довше (міграції й seed із хвилями, 1–3 хв;
healthcheck чекає до 3 хв).

- `https://<назва>.csit-mitit.com/health` → `{"status":"ok","database":"ok",…}`;
- `https://<назва>.csit-mitit.com/api/assistant` → `{"live":true,"model":"gemma4-26b"}` (якщо задано `LLM_*`);
- вхід `leader` / `DEMO_PASSWORD` → дашборд «Хвиля 2 (демо)»; кнопка «Асистент» відповідає українською.

Інші демо-логіни: `admin`, `coordinator`, `department`, `auditor`, `leader_a`, `wg1`, `staff01`, `expert1`
(пароль той самий). Swagger (`/docs`) назовні не відкривається: бекенд без домену.

## 6. Автодеплой і бекап

- Автодеплой на push у вибрану гілку — посібник, розділ 9 (для GitHub: вебхук GitHub замість GitLab, або
  **Redeploy** вручну перед показом).
- База живе в томі `pgdata` всередині стеку, тож кнопка **Backups** Coolify на неї не діє. Перед захистом:
  **Terminal** → контейнер `db` → `pg_dump -U imd imd -f /var/lib/postgresql/data/backup.sql`.
- Почати з чистої демо-бази: видалити том `pgdata` у **Persistent Storage** → **Redeploy**.

## 7. Що варто знати

- **Асистент і закритий контур.** Шлюз кафедри — зовнішня для стеку адреса, тому в compose стоїть
  `LLM_ALLOW_EXTERNAL=true`. Моделі бачать лише агрегати груп ≥ k; заборонені моделі (`FORBIDDEN_MARKERS`) бекенд
  не викликає. Без `LLM_BASE_URL` уся система працює, асистент відповідає шаблонами правил.
- **Ліміти спроб.** Запит іде Cloudflare → проксі Coolify → nginx фронтенду → бекенд. nginx передає бекенду адресу
  проксі Coolify, тож ліміти невдалих входів і невірних посилань рахуються спільно для всіх відвідувачів стенда.
  Дійсні посилання відкриваються завжди; для демо цього досить.
- **Лише синтетичні дані** (правила Coolify кафедри, п. 4). Після захисту — бекап і видалення проєкту.
