"""Демо-історія: дві закриті хвилі, рішення керівника щодо рекомендацій і заходи в різних станах.

Запуск: python -m app.seed.seed --with-waves (або SEED_WITH_WAVES=1).

Усе йде через справжні маршрути API в тому ж процесі (TestClient), тож працюють ті самі перевірки,
буфер анонімності, знімки й журнал дій, що й у роботі. Сервер запускати не треба.
Хвиля 1 закривається приблизно пів року тому, хвиля 2 — сьогодні (дату фіксує app.clock.frozen_on).
Детерміновано, без випадковості в даних (перемішування в буфері анонімності не впливає на бали).
"""

import math
from collections.abc import Callable
from datetime import date, timedelta

from sqlalchemy import select

from app.clock import frozen_on
from app.clock import today as clock_today
from app.db import SessionLocal
from app.models import Campaign, RespondentCategory, Role, Unit, User
from app.security import create_access_token

API = "/api/v1"
# Хвиля 1 на стільки місяців раніше за хвилю 2. Факти seed генерує на 12 + стільки місяців.
WAVE_GAP_MONTHS = 6
WAVE_LENGTH_DAYS = 14

# Частка особового складу, що проходить анкету (хвиля 1, хвиля 2). «Підрозділ В» у хвилі 1
# навмисно має замало відповідей: на дашборді видно, як працює поріг k і вторинне приховування.
STAFF_TURNOUT = {
    "Підрозділ А": (0.75, 0.9),
    "Підрозділ Б": (0.65, 0.85),
    "Підрозділ А-1": (0.7, 0.9),
    "Підрозділ А-2": (0.6, 0.8),
    "Підрозділ Б-1": (0.75, 0.9),
    "Підрозділ В": (0.25, 0.65),
}

# Відповідальні — посади, не ПІБ.
OWNERS = [
    "Уповноважена особа з питань запобігання та виявлення корупції",
    "Голова робочої групи з розбудови доброчесності",
    "Начальник відділу кадрів",
    "Заступник керівника з навчальної роботи",
    "Начальник служби закупівель",
]

# Рішення керівника щодо рекомендацій хвилі 1 (за порядком пріоритету) і доля заходу.
# (рішення, коментар, строк від закриття хвилі 1 у днях, підсумковий стан, день виконання)
# Строк None означає «через 60 днів від сьогодні» (захід ще в строку).
DECISION_PLAN = [
    ("accepted", "", 60, "done", 45),
    ("accepted", "", 90, "in_progress", None),      # прострочено, у роботі
    ("accepted", "", None, "in_progress", None),    # у строку
    ("accepted", "", 120, "planned", None),         # прострочено, не розпочато
    ("clarify", "Уточнити охоплення: чи стосується лише закупівель, чи всіх фінансових рішень", None, None, None),
    ("accepted", "", 150, "done", 140),
    ("rejected", "Захід уже виконується за планом попереднього року, дублювати не будемо", None, None, None),
]


def _check(response, what: str):
    if response.status_code >= 300:
        raise RuntimeError(f"{what}: {response.status_code} {response.text}")
    return response.json() if response.content else None


def _level_pick(level: int) -> Callable[[dict], int]:
    """Варіант відповіді за рівнем 1–5 (позиція в списку, обмежена кількістю варіантів)."""
    return lambda question: max(0, min(level, len(question["options"])) - 1)


def _profiles(wave: int):
    """Рівень відповіді (1–5) для людини p і питання q. Хвиля 2 в середньому краща за хвилю 1."""
    if wave == 1:
        return {
            "staff": lambda p, q: 2 + ((p + q) % 3 == 0),
            "working_group": lambda p, q: 3 + ((p + q) % 3 != 0),  # робоча група завищує
            "expert": lambda p, q: 2 + ((p * q) % 3 == 1),
        }
    return {
        "staff": lambda p, q: 3 + ((p + q) % 4 == 0) - ((p + q) % 5 == 0),
        "working_group": lambda p, q: 3 + ((p + q) % 2),
        "expert": lambda p, q: 3 + ((p * q) % 3 == 1) - ((p + q) % 4 == 0),
    }


class _Demo:
    def __init__(self, db):
        self.client = None
        self.headers: dict[str, dict] = {}
        users = db.scalars(select(User).where(User.is_active.is_(True))).all()
        unit_names = {u.id: u.name for u in db.scalars(select(Unit))}
        self.root_id = str(db.scalar(select(Unit.id).where(Unit.parent_id.is_(None))))
        for user in users:
            self.headers[user.login] = {"Authorization": f"Bearer {create_access_token(user)}"}
        respondents = sorted((u for u in users if u.role == Role.RESPONDENT), key=lambda u: u.login)
        self.staff_by_unit: dict[str, list[str]] = {}
        for u in respondents:
            if u.category == RespondentCategory.STAFF:
                self.staff_by_unit.setdefault(unit_names.get(u.unit_id, ""), []).append(u.login)
        self.working_group = [u.login for u in respondents if u.category == RespondentCategory.WORKING_GROUP]
        self.experts = [u.login for u in respondents if u.category == RespondentCategory.EXPERT]

    def get(self, login: str, path: str, **params):
        return _check(self.client.get(f"{API}{path}", headers=self.headers[login], params=params), f"GET {path}")

    def send(self, method: str, login: str, path: str, body: dict | None = None):
        r = self.client.request(method, f"{API}{path}", headers=self.headers[login], json=body)
        return _check(r, f"{method} {path}")

    def answer(self, campaign_id: str, questionnaire_id: str, login: str, level: Callable[[int], int]) -> None:
        url = f"/campaigns/{campaign_id}/questionnaires/{questionnaire_id}"
        form = self.get(login, f"{url}/form")
        questions = [q for s in form["sections"] for q in s["questions"]]
        answers = [{"question_id": q["id"], "option_ids": [q["options"][_level_pick(level(j))(q)]["id"]]}
                   for j, q in enumerate(questions)]
        self.send("POST", login, f"{url}/responses", {"answers": answers})

    def wave(self, wave: int, title: str, opened: date, closed: date) -> tuple[str, list[str]]:
        questionnaires = {q["code"]: q["id"] for q in self.get("admin", "/questionnaires")}
        with frozen_on(opened):
            campaign = self.send("POST", "admin", "/campaigns",
                                 {"title": title, "unit_id": self.root_id, "questionnaire_ids": list(questionnaires.values())})
            self.send("POST", "admin", f"/campaigns/{campaign['id']}/open")
        cid = campaign["id"]
        profile = _profiles(wave)

        with frozen_on(closed - timedelta(days=3)):
            staff_total = 0
            for unit_name, logins in sorted(self.staff_by_unit.items()):
                rate = STAFF_TURNOUT.get(unit_name, (0.7, 0.85))[wave - 1]
                for p, login in enumerate(logins[: math.ceil(rate * len(logins))]):
                    self.answer(cid, questionnaires["nazk-maturity-staff"], login, lambda q, p=p: profile["staff"](p, q))
                    staff_total += 1
            wg = self.working_group if wave == 2 else self.working_group[:-1]
            for p, login in enumerate(wg):
                self.answer(cid, questionnaires["nazk-maturity-wg"], login, lambda q, p=p: profile["working_group"](p, q))
            for p, login in enumerate(self.experts):
                self.answer(cid, questionnaires["nazk-maturity-expert"], login, lambda q, p=p: profile["expert"](p, q))

            items = self.get(wg[0], f"/campaigns/{cid}/checklist")["items"]
            confirmed = 0
            for n, item in enumerate(items):
                if wave == 1:
                    status = ("full", "partial", "none")[n % 3]
                    evidence = "Наказ (синтетичний)" if status == "full" or (status == "partial" and n % 2 == 0) else ""
                else:
                    status = "partial" if n % 3 == 2 else "full"
                    evidence = "" if n % 7 == 6 else "Наказ і звіт (синтетичні)"
                path = f"/campaigns/{cid}/checklist/{item['question_id']}"
                self.send("PUT", wg[0], path, {"status": status, "evidence": evidence})
                if evidence:
                    self.send("POST", "commissioner", f"{path}/confirm")
                    confirmed += 1

        with frozen_on(closed):
            self.send("POST", "admin", f"/campaigns/{cid}/close")
        result = self.get("admin", f"/campaigns/{cid}/results")
        idx = result["index"]
        lines = [
            f"«{title}»: {opened:%d.%m.%Y}–{closed:%d.%m.%Y}; анкети ОС {staff_total}, РГ {len(wg)}, експерти {len(self.experts)}; "
            f"чек-лист {len(items)}, підтверджено {confirmed}",
            f"  Integrity Index {idx['score']} (без фактів {idx['self_score']}) · {idx['level']['title']} · достовірність {idx['reliability']}",
        ]
        return cid, lines

    def decisions(self, campaign_id: str, closed: date, today: date) -> list[str]:
        with frozen_on(closed + timedelta(days=10)):
            recs = self.get("leader", f"/campaigns/{campaign_id}/recommendations")["items"]
        counts: dict[str, int] = {}
        for n, (rec, plan) in enumerate(zip(recs, DECISION_PLAN)):
            decision, comment, due_in, final, done_in = plan
            body: dict = {"decision": decision, "comment": comment}
            if decision == "accepted":
                due = closed + timedelta(days=due_in) if due_in is not None else today + timedelta(days=60)
                body["measure"] = {"owner": OWNERS[n % len(OWNERS)], "due_date": due.isoformat()}
            with frozen_on(closed + timedelta(days=10)):
                out = self.send("POST", "leader", f"/campaigns/{campaign_id}/recommendations/{rec['code']}/decision", body)
            counts[decision] = counts.get(decision, 0) + 1
            for measure in out["measures"]:
                if final == "done":
                    done_on = closed + timedelta(days=done_in)
                    self.send("PATCH", "leader", f"/measures/{measure['id']}",
                              {"status": "done", "done_on": done_on.isoformat(), "evidence": "Звіт про виконання (синтетичний)"})
                elif final == "in_progress":
                    self.send("PATCH", "leader", f"/measures/{measure['id']}", {"status": "in_progress"})
        measures = self.get("leader", "/measures")
        overdue = sum(1 for x in measures if x["overdue"])
        done = sum(1 for x in measures if x["status"] == "done")
        decided = ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
        return [f"Рішення щодо рекомендацій хвилі 1: {decided}; заходів {len(measures)}, виконано {done}, прострочено {overdue}"]


def seed_waves(today: date | None = None) -> list[str]:
    """Дві закриті хвилі з рішеннями й заходами. Якщо хвилі вже є, нічого не робить."""
    from fastapi.testclient import TestClient  # httpx потрібен лише тут

    from app.main import app

    today = today or clock_today()
    with SessionLocal() as db:
        if db.scalar(select(Campaign.id).limit(1)) is not None:
            return ["Хвилі вже є, демо-історію не додаю"]
        demo = _Demo(db)
    # Сесію закрито до запитів: на SQLite відкрита транзакція читання блокувала б запис.
    with TestClient(app) as client:
        demo.client = client
        first_closed = today - timedelta(days=round(WAVE_GAP_MONTHS * 30.4))
        first_id, lines = demo.wave(1, "Хвиля 1 (демо)", first_closed - timedelta(days=WAVE_LENGTH_DAYS), first_closed)
        lines += demo.decisions(first_id, first_closed, today)
        _, more = demo.wave(2, "Хвиля 2 (демо)", today - timedelta(days=WAVE_LENGTH_DAYS), today)
        lines += more
    return lines
