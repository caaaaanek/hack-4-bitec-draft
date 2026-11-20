"""Генерує docs/recommendations.md і docs/cross-check.md з реального прогону системи.

Скрипт піднімає тимчасову SQLite-базу, заповнює її тим самим demo-seed із двома хвилями, рішеннями й заходами
(що й `docker compose up`), і бере все через справжні маршрути API. Дата вивантаження фіксована, тож документи
однакові за кожного запуску. Робоча база не зачіпається.

Запуск з backend/:
    python scripts/gen_docs.py                       # docs/recommendations.md, docs/cross-check.md
    python scripts/gen_docs.py --as-of 2026-11-17 --out-dir /tmp/docs
"""

import argparse
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

DEFAULT_AS_OF = date(2026, 11, 17)
ROOT_DIR = Path(__file__).resolve().parents[2]
CATEGORY = {"staff": "ОС", "working_group": "РГ", "expert": "Експерти"}
SOURCE_SHORT = {"staff": "ОС", "working_group": "РГ", "expert": "Експерти", "checklist": "Чек-лист"}


def _setup_env(db_path: Path) -> None:
    """Тимчасова база й налаштування до імпорту застосунку (робоча база й .env не використовуються)."""
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ.setdefault("JWT_SECRET", "gen-docs-secret-not-for-production-0123456789")
    os.environ["DEMO_PASSWORD"] = "gen-docs-demo-pass"
    os.environ["BCRYPT_ROUNDS"] = "4"
    os.environ["SEED_WITH_WAVES"] = "false"
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def num(x) -> str:
    from app.services.scoring import fmt

    return "—" if x is None else fmt(x)


def cell(text) -> str:
    return str(text if text is not None else "—").replace("|", "\\|").replace("\n", " ")


def table(header: list[str], rows: list[list]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(cell(c) for c in row) + " |" for row in rows]
    return lines


class Run:
    """Дані одного прогону: хвилі, результати, рекомендації, заходи — усе через API."""

    def __init__(self, as_of: date):
        from sqlalchemy import select

        from app.clock import frozen_on
        from app.db import Base, SessionLocal, engine
        from app.inprocess import InProcessClient
        from app.main import app
        from app.models import User
        from app.security import create_access_token
        from app.seed import seed
        from app.seed.waves import WAVE_GAP_MONTHS, seed_waves
        from app.services.methodology import FACTS_WINDOW_MONTHS

        Base.metadata.create_all(engine)
        with frozen_on(as_of):
            with SessionLocal() as db:
                units = seed.seed_units(db)
                seed.seed_users(db, units, os.environ["DEMO_PASSWORD"], seed.DEMO_STAFF_SIZES)
                seed.seed_questionnaires(db)
                seed.seed_indicators(db, units, today=as_of, months=FACTS_WINDOW_MONTHS + WAVE_GAP_MONTHS)
                db.commit()
            self.seed_lines = seed_waves(today=as_of)
            with SessionLocal() as db:
                self.h = {u.login: {"Authorization": f"Bearer {create_access_token(u)}"}
                          for u in db.scalars(select(User).where(User.login.in_(("admin", "leader"))))}
            with InProcessClient(app) as client:
                self.client = client
                self._collect()

    def get(self, path: str, login: str = "leader", **params):
        r = self.client.get(f"/api/v1{path}", headers=self.h[login], params=params)
        r.raise_for_status()
        return r.json()

    def _collect(self) -> None:
        campaigns = sorted(self.get("/campaigns", "admin"), key=lambda c: c["closed_on"])
        self.w1, self.w2 = campaigns[0], campaigns[-1]
        units = self.get("/units", "admin")
        self.root = next(u for u in units if u["parent_id"] is None)
        self.children = sorted((u for u in units if u["parent_id"] == self.root["id"]), key=lambda u: u["name"])
        self.r1 = self.get(f"/campaigns/{self.w1['id']}/results", "admin")
        self.r2 = self.get(f"/campaigns/{self.w2['id']}/results", "admin")
        units_below_root = sorted((u for u in units if u["parent_id"] is not None), key=lambda u: u["name"])
        self.by_unit = {
            u["name"]: [self.get(f"/campaigns/{w['id']}/results", "admin", unit_id=u["id"]) for w in (self.w1, self.w2)]
            for u in units_below_root}
        self.compare = self.get(f"/units/{self.root['id']}/compare", "admin",
                                from_campaign=self.w1["id"], to_campaign=self.w2["id"])
        self.recs1 = self.get(f"/campaigns/{self.w1['id']}/recommendations")["items"]
        self.recs2 = self.get(f"/campaigns/{self.w2['id']}/recommendations")["items"]
        self.measures = self.get("/measures")
        self.methodology = self.get("/methodology")
        # Формулювання спільних питань — завжди з Анкети 1 (РГ): API бере текст першої анкети, порядок якої
        # залежить від випадкових id, а документ має бути однаковим за кожного запуску.
        wg = next(q for q in self.get("/questionnaires", "admin") if q["code"] == "nazk-maturity-wg")
        detail = self.get(f"/questionnaires/{wg['id']}", "admin")
        self.question_text = {q["code"]: q["text"] for s in detail["sections"] for q in s["questions"]}


def header(title: str, as_of: date, run: Run) -> list[str]:
    return [
        f"# {title}",
        "",
        f"> Згенеровано скриптом `backend/scripts/gen_docs.py` з прогону системи на синтетичних демо-даних "
        f"(дата вивантаження {as_of:%d.%m.%Y}). Не редагуйте вручну: змініть код або seed і перегенеруйте.",
        f"> Хвилі: «{run.w1['title']}» (закрита {date.fromisoformat(run.w1['closed_on']):%d.%m.%Y}) і "
        f"«{run.w2['title']}» (закрита {date.fromisoformat(run.w2['closed_on']):%d.%m.%Y}), "
        f"підрозділ «{run.root['name']}». Методика v{run.methodology['version']}.",
        "",
    ]


def recommendations_md(run: Run, as_of: date) -> str:
    out = header("Рекомендації: правила, приклади, рішення й заходи", as_of, run)
    out += [
        "Рекомендації формує `app/services/recommendations.py` — чиста функція від знімка хвилі й ризик-сигналів, "
        "без ШІ. Ті самі дані завжди дають ті самі рекомендації в тому самому порядку. Кожна має `rule` — чому її "
        "запропоновано, і `basis` — числа, на які вона спирається. Рішення ухвалює посадова особа: прийняти "
        "(і одразу створити захід), уточнити або відхилити з обґрунтуванням.",
        "",
        f"## 1. Рекомендації за результатами «{run.w2['title']}»",
        "",
        f"Integrity Index {num(run.r2['index']['score'])} · {run.r2['index']['level']['title']} · "
        f"достовірність {run.r2['index']['reliability']}. Рекомендацій: {len(run.recs2)}.",
        "",
    ]
    out += table(["#", "Пріоритет", "Компонент", "Рекомендація", "Чому (rule)", "Запропоновані заходи"], [
        [n, r["priority_title"], r.get("component_title") or "—", r["title"], r["rule"],
         "; ".join(f"{m['catalog_number'] or '—'} {m['title']}" for m in r["suggested_measures"][:2]) or "—"]
        for n, r in enumerate(run.recs2, 1)])
    out += ["", "### Як прочитати один приклад", ""]
    example = run.recs2[0]
    out += [f"**{example['title']}** (код `{example['code']}`, пріоритет {example['priority_title']}).", "",
            f"- Чому: {example['rule']}",
            f"- Опис: {example['description']}",
            f"- Підстава (`basis`): `{example['basis']}`" if example["basis"] else "- Підстава: правило без числових даних",
            ""]
    out += [f"## 2. Рішення керівника щодо рекомендацій «{run.w1['title']}»", "",
            "Рішення зберігаються окремо від рекомендацій і пов'язані з ними стабільним кодом. Для «уточнити» й "
            "«відхилити» обґрунтування обов'язкове; захід створюється лише для прийнятої рекомендації.", ""]
    titles = {"accepted": "прийнято", "clarify": "уточнити", "rejected": "відхилено"}
    out += table(["Рекомендація", "Пріоритет", "Рішення", "Обґрунтування", "Заходів"], [
        [r["title"], r["priority_title"], titles.get((r["decision"] or {}).get("decision"), "ще не вирішено"),
         (r["decision"] or {}).get("comment") or "—", len(r["measures"])]
        for r in run.recs1 if r["decision"]])
    undecided = sum(1 for r in run.recs1 if not r["decision"])
    out += ["", f"Ще без рішення: {undecided}. Рекомендації «{run.w2['title']}» лишено без рішень для демонстрації.", ""]
    status_titles = {"planned": "заплановано", "in_progress": "в роботі", "done": "виконано", "cancelled": "скасовано"}
    out += ["## 3. Заходи і перевірка наступною хвилею", "",
            "Кожен захід має відповідального (посада, не ПІБ), строк і статус; «виконано» — лише з доказом. "
            "Ефект перевіряє наступна хвиля: зміна компонента заходу між знімками за правилом значущості "
            f"(|Δ| < {num(run.methodology['significant_delta'])} бала — в межах похибки).", ""]
    out += table(["Захід", "Відповідальний", "Строк", "Статус", "Перевірка наступною хвилею"], [
        [x["title"], x["owner"], date.fromisoformat(x["due_date"]).strftime("%d.%m.%Y"),
         status_titles.get(x["status"], x["status"]) + (f" (прострочено {x['overdue_days']} дн.)" if x["overdue"] else ""),
         (x.get("verification") or {}).get("title", "—") + (
             f": {num(x['verification']['previous'])} → {num(x['verification']['current'])}"
             if (x.get("verification") or {}).get("delta") is not None else "")]
        for x in run.measures])
    out += ["", "## 4. Типи правил", ""]
    codes = sorted({r["code"].split(":")[0] for r in run.recs1 + run.recs2})
    out += [f"У цьому прогоні спрацювали правила: {', '.join(f'`{c}`' for c in codes)}. "
            "Повна таблиця правил — `docs/backend.md`, розділ «Рекомендації, заходи, тема 2, асистент».", ""]
    return "\n".join(out)


def cross_check_md(run: Run, as_of: date) -> str:
    r2 = run.r2
    out = header("Зіставлення: самооцінка, категорії респондентів і факти", as_of, run)
    out += [
        "Система не довіряє жодному джерелу окремо. Самооцінку (анкети ОС, РГ, експертів і чек-лист) зводить у S, "
        "факти з інших систем — у F, а в індекс іде L: факти лише обмежують самооцінку (`L = min(S, F + "
        f"{num(run.methodology['reality_margin'])})`), але ніколи її не піднімають. Розбіжності між категоріями й "
        "з фактами стають прапорцями достовірності й рекомендаціями.",
        "",
        "## 1. Методика коротко",
        "",
    ]
    out += [f"{rule}" for rule in run.methodology["rules"]] + [""]
    out += [f"## 2. Компоненти «{run.w2['title']}»: S, F і L", "",
            f"Integrity Index {num(r2['index']['score'])}, без перевірки фактами {num(r2['index']['self_score'])} · "
            f"{r2['index']['level']['title']} · достовірність {r2['index']['reliability']}.", ""]
    out += table(["Компонент", "Джерела S (ефективні ваги)", "S самооцінка", "F факти", "L зараховано", "Обмежено фактами",
                  "Достовірність", "Прапорці"], [
        [c["title"], ", ".join(f"{SOURCE_SHORT.get(s['source'], s['source'])} {num(100 * s['weight'])}%" for s in c["sources"]),
         num(c["self_score"]), num(c["facts_score"]), num(c["score"]), "так" if c["cut_by_facts"] else "ні",
         c["reliability"], "; ".join(f["title"] for f in c["flags"]) or "—"]
        for c in r2["components"]])
    titles = {c["code"]: c["title"] for c in r2["components"]}
    wave_flags = r2.get("reliability_flags") or []
    out += ["", "Прапорці достовірності хвилі (кожен один раз, зі списком компонентів; у таблиці — лише "
            "«самооцінку не підтверджують факти»):", ""]
    out += [f"- {f['title']} — {', '.join(titles.get(c, c) for c in f['components'])}" for f in wave_flags] or ["- —"]
    out += ["", "Пояснення кожного рядка (`rule`):", ""] + [f"- **{c['title']}.** {c['rule']}" for c in r2["components"]] + [""]

    out += ["## 3. Категорії респондентів між собою", "",
            "Ті самі коди питань у різних анкетах дають змогу порівняти РГ, ОС і експертів на спільних питаннях. "
            f"Розрив понад {num(run.methodology['reliability']['category_gap_points'])} балів між РГ і ОС на спільних "
            "питаннях компонента — прапорець `category_gap` (серйозний).", ""]
    order = {"working_group": 0, "staff": 1, "expert": 2}
    groups = sorted((g for g in r2["groups"] if g["category"] in CATEGORY), key=lambda g: order[g["category"]])
    out += table(["Категорія", "Анкета", "Відповідей (n)", "Участь, %", "Заявлений рівень", "Розрахований рівень", "Прапорці"], [
        [CATEGORY[g["category"]], g["title"], g["n"], num(g["participation_percent"]), g["declared_level"],
         g["computed_level"], ", ".join(g["flags"]) or "—"] for g in groups])
    common = sorted((q for q in r2["questions"] if len({c["category"] for c in q["by_category"]}) > 1), key=lambda q: q["code"])
    rows = []
    for q in common:
        by = {c["category"]: c["score"] for c in q["by_category"]}
        values = [v for v in by.values() if v is not None]
        text = run.question_text.get(q["code"], q["text"])
        rows.append([text[:80] + ("…" if len(text) > 80 else ""), num(by.get("working_group")), num(by.get("staff")),
                     num(by.get("expert")), num(max(values) - min(values)) if len(values) > 1 else "—"])
    out += ["", "Спільні питання (бали 0–100):", ""]
    out += table(["Питання", "РГ", "ОС", "Експерти", "Розкид"], rows)
    out += ["", "Розбіжності, які знайшла система:", ""]
    out += [f"- {d['description']} ({d['rule']})" for d in r2["discrepancies"]] or ["- немає"]
    out += [""]

    out += ["## 4. Самооцінка проти фактів", "",
            "Факти приходять з інших систем лише як частки «X з Y» (без імен), кожне джерело своїм ключем. "
            "Частка переводиться в рівень за порогами показника. Кількість знайдених проблем на бал не впливає.", ""]
    out += table(["Показник", "Компонент", "Джерела", "Факт", "Рівень", "Бал"], [
        [f["title"], next(c["title"] for c in r2["components"] if c["code"] == f["component"]), ", ".join(f["sources"]),
         f["label"].split(": ", 1)[-1], f["level"], num(f["score"])] for f in r2["facts"]])
    cut = [c for c in r2["components"] if c["cut_by_facts"]]
    out += [""] + ([f"Самооцінку обмежено фактами: {', '.join(c['title'] for c in cut)}." if cut
                    else "У цій хвилі факти не обмежили жоден компонент."]) + [""]

    def staff_group(result: dict) -> str:
        g = next((g for g in result["groups"] if g["category"] == "staff"), None)
        if g is None:
            return "—"
        if g["suppressed"]:
            return "приховано (вторинне приховування)"
        return f"n = {g['n']}" if g["sufficient"] and g["n"] is not None else "приховано (менше k)"

    out += ["## 5. Анонімність: групи, менші за k", "",
            f"Поріг k = {r2['min_group_size']}. Група особового складу підрозділу, менша за k, не показується й не входить "
            "в індекс цього підрозділу — лише вищого. Якщо замалу групу можна обчислити різницею «батько − показані "
            "сусіди», приховується й сусідня (вторинне приховування). Індекси підрозділів тут навмисно не наведено: "
            "система порівнює підрозділ лише із самим собою, рейтингу підрозділів немає. РГ і експерти не прив'язані до "
            "окремих підрозділів, тому їхні оцінки входять лише в індекс організації.", ""]
    out += table(["Підрозділ", f"ОС у «{run.w1['title']}»", f"ОС у «{run.w2['title']}»"], [
        [name, staff_group(w1), staff_group(w2)] for name, (w1, w2) in run.by_unit.items()])
    out += [""]

    cmp = run.compare
    out += [f"## 6. Динаміка: «{cmp['previous_title']}» → «{cmp['current_title']}»", "",
            f"Індекс {num(cmp['previous_index'])} → {num(cmp['current_index'])} (Δ {num(cmp['index_delta'])}, "
            f"{cmp['index_significance']['title']}). {cmp['rule']}", ""]
    out += table(["Компонент", "Було", "Стало", "Δ", "Значущість"], [
        [c["title"], num(c["previous"]), num(c["current"]), num(c["delta"]), c["significance"]["title"]]
        for c in cmp["components"]])
    out += [""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--as-of", type=date.fromisoformat, default=DEFAULT_AS_OF, help="Дата вивантаження (YYYY-MM-DD)")
    parser.add_argument("--out-dir", type=Path, default=ROOT_DIR / "docs")
    args = parser.parse_args(argv)

    with tempfile.TemporaryDirectory() as tmp:
        _setup_env(Path(tmp) / "gen_docs.sqlite3")
        run = Run(args.as_of)
        files = {"recommendations.md": recommendations_md(run, args.as_of), "cross-check.md": cross_check_md(run, args.as_of)}
        from app.db import engine

        engine.dispose()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (args.out_dir / name).write_text(text, encoding="utf-8")
        print(f"{args.out_dir / name}: {len(text.splitlines())} рядків")
    return 0


if __name__ == "__main__":
    sys.exit(main())
