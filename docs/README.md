# docs — джерела хакатону і документація проєкту

```
docs/
├── raw/        оригінали (HTML, PDF) без змін + SOURCES.md (URL, дата, SHA-256)
├── md/         оброблені версії: Markdown (+ .txt), картинки в <doc>-img/
├── tools/      скрипти конвертації (html2md, pdf2md, check_words, fixes/)
├── api/        openapi.json — контракт API бекенду
├── backend.md  архітектура, ролі, модель даних, API
├── integrity-index.md  методика Integrity Index
└── run.md      як запустити (Docker, розробка, демо-дані)
```

Що тут лежить:

| Документ | Markdown | Зміст |
|---|---|---|
| Сторінка завдання 3 | `md/zavdannia-3.md` | Умова завдання «Integrity Management Dashboard» (сайт) |
| PDF завдання 3 | `md/zavdannia-3-1811daff.md` | Те саме, PDF-версія |
| Рекомендації НУОУ (99 с.) | `md/recommendations_transform_dobrochesnist.md` | Дод. Б — чек-лист, Дод. В — анкети 1 і 2, Дод. Г — шаблон звіту, Дод. Д — план заходів |

Як додавати й обробляти нові документи — у скілі
[`.claude/skills/ingest-docs/SKILL.md`](../.claude/skills/ingest-docs/SKILL.md).
Коротко: оригінал → `raw/` (+ рядок у `raw/SOURCES.md`), конвертація скриптами з `tools/` → `md/`,
перевірка повноти `tools/check_words.py`. `raw/` ніколи не редагувати руками; `md/` перегенеровується з `raw/`.
