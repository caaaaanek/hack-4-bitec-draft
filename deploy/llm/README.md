# Self-hosted модель для асистента (Gemma)

> Основний варіант — Gemma на шлюзі кафедри: `LLM_BASE_URL=https://api.csit-mitit.com/v1`, `LLM_MODEL=gemma4-26b`,
> ключ видає адміністратор шлюзу (див. `docs/run.md`); адреса зовнішня, тому ще `LLM_ALLOW_EXTERNAL=true`. Цей каталог — запасний: власний сервер із GPU.

Асистент лише пояснює вже пораховані правилами числа (бали, рівні, рекомендації рахує бекенд без ШІ). Модель бачить
тільки агрегати груп ≥ k. Цей каталог піднімає Gemma через Ollama на власному сервері за шлюзом із ключем, без
зовнішніх хмарних сервісів.

```
бекенд (LLM_BASE_URL, LLM_API_KEY) ──HTTPS──▶ проксі хоста ──▶ gateway (nginx, перевірка ключа) ──▶ ollama (Gemma, GPU)
```

## Що потрібно на сервері

- Docker з Compose і NVIDIA Container Toolkit (GPU в контейнері).
- Відеопам'ять під модель: орієнтовно 16–20 ГБ для ~26–27B у квантуванні Q4; менші варіанти Gemma — менше.
- Зворотний проксі хоста з HTTPS на піддомені (наприклад, `llm.<ваш-піддомен>.cs.mitit.com`), що веде на порт шлюзу.

## Запуск

```bash
cp .env.example .env            # LLM_API_KEY — довгий випадковий рядок; LLM_MODEL — тег Gemma з бібліотеки Ollama
docker compose up -d
docker compose exec ollama ollama pull "<тег моделі>"   # той самий, що в LLM_MODEL
```

Перевірка (з ключем — 200 і список моделей, без ключа — 401):

```bash
curl -H "Authorization: Bearer $LLM_API_KEY" https://<піддомен>/v1/models
curl https://<піддомен>/v1/models
```

## Підключення застосунку

У `.env` основного застосунку (корінь репозиторію):

```
LLM_BASE_URL=https://<піддомен>/v1
LLM_API_KEY=<той самий ключ>
LLM_MODEL=<тег моделі>
LLM_ALLOW_EXTERNAL=true         # адреса зовнішня: без цього бекенд не відправить дані за межі закритого контуру
ASSISTANT_ENABLED=true          # вмикає ще й /api/v1/assistant/ask; /api/assistant працює, щойно задано LLM_BASE_URL
```

Після `docker compose up -d` перевірити: `GET /api/assistant` → `{"live": true, "model": "<тег>"}`.

## Безпека

- Порт Ollama назовні не відкривається. Шлюз пропускає лише `/v1/chat/completions` і `/v1/models` з ключем;
  керування моделями (`pull`, `delete`) — тільки з сервера.
- Ключ не комітиться (`.env` у `.gitignore`); у бекенді він передається лише в заголовку `Authorization`.
- `OLLAMA_CONTEXT_LENGTH=16384`: дані хвилі в запиті — до ~10 тис. токенів, з меншим контекстом Ollama обрізала б їх мовчки.
- Моделі й сервіси з РФ, РБ і китайських хмар бекенд не викликає (`FORBIDDEN_MARKERS` у `app/routers/assistant.py`).
  Gemma — відкриті ваги Google, у закритому контурі працює без інтернету після завантаження.
- Якщо модель недоступна, асистент відповідає 503/502, а решта системи працює як звичайно; frontend-proto тоді
  відповідає шаблонами правил.
