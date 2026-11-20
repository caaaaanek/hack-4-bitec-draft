"""Джерела фактів: ARTEMIDA (конфлікти інтересів) і моки атестації, навчання, закупівель і повідомлень.

Кожне джерело описує свій «рідний» формат записів, з якого адаптер рахує факт «X з Y» за місяць.
Формати й назви систем — синтетичні припущення команди для демо; справжні контракти погоджуються з
власниками систем (див. docs/backend.md, «Адаптери джерел фактів»).

Моки генерують записи детерміновано (той самий підрозділ і місяць дають ті самі записи).
"""

import json
import os
import random
from collections.abc import Iterable
from datetime import date, timedelta
from pathlib import Path

from adapters.base import Fact, tally

# Якість процесів у підрозділах моків: частка «вчасно / з перевіркою». Синтетика.
ORG_QUALITY = {"ORG-A": 0.9, "ORG-A1": 0.8, "ORG-A2": 0.7, "ORG-B": 0.85, "ORG-B1": 0.6, "ORG-V": 0.75}


def _rng(source: str, org: str, period: str) -> random.Random:
    return random.Random(f"{source}:{org}:{period}")


def _day(period: str, rng: random.Random) -> date:
    year, month = map(int, period.split("-"))
    return date(year, month, rng.randint(1, 28))


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _due(record: dict, as_of: date, deadline: str, closed: str) -> bool:
    """Запис рахується, коли його закрито або строк уже минув (відкриті в строку ще не оцінюємо)."""
    return record.get(closed) is not None or date.fromisoformat(record[deadline]) < as_of


class Source:
    name = ""
    title = ""
    indicators: tuple[str, ...] = ()
    real = False  # True — є читання справжнього експорту (--file), інакше лише мок

    def mock_records(self, orgs: Iterable[str], periods: Iterable[str], as_of: date) -> dict:
        raise NotImplementedError

    def read_file(self, path: Path) -> dict:
        raise SystemExit(f"«{self.name}» — мок, читання експорту не реалізовано")

    def facts(self, data: dict, periods: set[str] | None, as_of: date) -> list[Fact]:
        raise NotImplementedError


class Artemida(Source):
    """ARTEMIDA — рішення з попереднього хакатону: виявляє можливі конфлікти інтересів і веде їх розгляд.

    Експорт (JSON): {"system": "ARTEMIDA", "exported_at": "2026-11-17",
                     "cases": [{"case_id", "org_code", "detected_on", "deadline_on", "status", "closed_on"}]}
    status: open / resolved / dismissed. Адаптер читає лише ці поля; інші (якщо є) ігнорує й нікуди не передає.
    Факт coi_reviewed: розібрано до строку / виявлено за місяць (справи, строк яких ще не минув, не рахуються).
    """

    name = "artemida"
    title = "ARTEMIDA (конфлікти інтересів)"
    indicators = ("coi_reviewed",)
    real = True
    FIELDS = ("case_id", "org_code", "detected_on", "deadline_on", "status", "closed_on")

    def read_file(self, path: Path) -> dict:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("system") != "ARTEMIDA" or not isinstance(data.get("cases"), list):
            raise SystemExit(f"{path}: очікується експорт ARTEMIDA з полями system і cases")
        cases = []
        for n, case in enumerate(data["cases"]):
            missing = [f for f in ("org_code", "detected_on", "deadline_on", "status") if f not in case]
            if missing or case["status"] not in ("open", "resolved", "dismissed"):
                raise SystemExit(f"{path}: справа №{n}: бракує {missing} або невідомий status")
            cases.append({f: case.get(f) for f in self.FIELDS})
        return {"cases": cases}

    def mock_records(self, orgs, periods, as_of):
        cases = []
        for org in orgs:
            for period in periods:
                rng = _rng(self.name, org, period)
                for i in range(rng.randint(0, 3)):
                    detected = _day(period, rng)
                    deadline = detected + timedelta(days=30)
                    closed = detected + timedelta(days=rng.randint(5, 25) if rng.random() < ORG_QUALITY[org] else rng.randint(31, 60))
                    if closed > as_of:
                        closed = None
                    status = "open" if closed is None else ("dismissed" if rng.random() < 0.4 else "resolved")
                    cases.append({"case_id": f"KI-{period}-{org}-{i}", "org_code": org, "detected_on": detected.isoformat(),
                                  "deadline_on": deadline.isoformat(), "status": status, "closed_on": _iso(closed)})
        return {"system": "ARTEMIDA", "exported_at": as_of.isoformat(), "cases": cases}

    def facts(self, data, periods, as_of):
        cases = [c for c in data["cases"] if _due(c, as_of, "deadline_on", "closed_on")]
        on_time = lambda c: c["closed_on"] is not None and c["closed_on"] <= c["deadline_on"]  # noqa: E731
        return tally(cases, source=self.name, indicator="coi_reviewed", when="detected_on", ok=on_time, periods=periods,
                     why="ARTEMIDA: справи щодо можливого КІ, закриті до строку",
                     extra={"pending": lambda c: c["closed_on"] is None,
                            "late": lambda c: c["closed_on"] is not None and c["closed_on"] > c["deadline_on"]})


class Atestat(Source):
    """Мок: система атестації персоналу. Декларації (due_on, submitted_on) і призначення (appointed_on, integrity_check)."""

    name = "atestat"
    title = "Атестація персоналу (мок)"
    indicators = ("declarations_on_time", "hiring_checks")

    def mock_records(self, orgs, periods, as_of):
        declarations, appointments = [], []
        for org in orgs:
            for period in periods:
                rng = _rng(self.name, org, period)
                for i in range(rng.randint(1, 4)):
                    due = _day(period, rng)
                    late = rng.random() > 0.95 * ORG_QUALITY[org] + 0.05
                    submitted = due + timedelta(days=rng.randint(1, 20)) if late else due - timedelta(days=rng.randint(0, 10))
                    declarations.append({"org_code": org, "declarant_ref": f"D-{org}-{period}-{i}", "due_on": due.isoformat(),
                                         "submitted_on": _iso(submitted if submitted <= as_of else None)})
                for _ in range(rng.randint(0, 2)):
                    appointments.append({"org_code": org, "appointed_on": _day(period, rng).isoformat(),
                                         "integrity_check": "done" if rng.random() < ORG_QUALITY[org] + 0.1 else "not_done"})
        return {"declarations": declarations, "appointments": appointments}

    def facts(self, data, periods, as_of):
        # «Декларації вчасно» передає модуль «Перевірки» (власник факту, fact_registry.BUILTIN_OWNERS):
        # він рахує їх із реєстру декларацій НАЗК. Якщо в розгортанні власником призначено кадрову ІС
        # (FACT_OWNERS="declarations_on_time=atestat"), запустіть адаптер з ATESTAT_SEND_DECLARATIONS=1.
        out = tally(data["appointments"], source=self.name, indicator="hiring_checks", when="appointed_on",
                    periods=periods, ok=lambda a: a["integrity_check"] == "done",
                    why="Атестація: призначення з перевіркою доброчесності")
        if os.environ.get("ATESTAT_SEND_DECLARATIONS") == "1":
            declarations = [r for r in data["declarations"] if date.fromisoformat(r["due_on"]) < as_of]
            out += tally(declarations, source=self.name, indicator="declarations_on_time", when="due_on",
                         periods=periods, ok=lambda r: r["submitted_on"] is not None and r["submitted_on"] <= r["due_on"],
                         why="Атестація: декларацію подано до строку")
        return out


class Training(Source):
    """Мок: облік навчання з доброчесності. Записи: org_code, employee_ref, due_on, completed_on."""

    name = "training"
    title = "Облік навчання (мок)"
    indicators = ("training_coverage",)

    def mock_records(self, orgs, periods, as_of):
        rows = []
        for org in orgs:
            for period in periods:
                rng = _rng(self.name, org, period)
                for i in range(rng.randint(3, 8)):
                    due = _day(period, rng)
                    done = due - timedelta(days=rng.randint(0, 40)) if rng.random() < ORG_QUALITY[org] else None
                    rows.append({"org_code": org, "employee_ref": f"E-{org}-{period}-{i}", "due_on": due.isoformat(),
                                 "completed_on": _iso(done)})
        return {"trainings": rows}

    def facts(self, data, periods, as_of):
        rows = [t for t in data["trainings"] if date.fromisoformat(t["due_on"]) < as_of]
        return tally(rows, source=self.name, indicator="training_coverage", when="due_on", periods=periods,
                     ok=lambda t: t["completed_on"] is not None and t["completed_on"] <= t["due_on"],
                     why="Облік навчання: навчання з доброчесності пройдено до строку")


class Procurement(Source):
    """Мок: проєкт оцінки закупівель. Позначки: flag_id, org_code, flagged_on, reviewed_on."""

    name = "procurement"
    title = "Оцінка закупівель (мок)"
    indicators = ("procurement_flags_reviewed",)

    def mock_records(self, orgs, periods, as_of):
        flags = []
        for org in orgs:
            for period in periods:
                rng = _rng(self.name, org, period)
                for i in range(rng.randint(0, 3)):
                    flagged = _day(period, rng)
                    reviewed = flagged + timedelta(days=rng.randint(3, 45)) if rng.random() < ORG_QUALITY[org] - 0.1 else None
                    flags.append({"flag_id": f"P-{org}-{period}-{i}", "org_code": org, "flagged_on": flagged.isoformat(),
                                  "reviewed_on": _iso(reviewed if reviewed and reviewed <= as_of else None)})
        return {"flags": flags}

    def facts(self, data, periods, as_of):
        return tally(data["flags"], source=self.name, indicator="procurement_flags_reviewed", when="flagged_on",
                     periods=periods, ok=lambda f: f["reviewed_on"] is not None,
                     why="Оцінка закупівель: позначені закупівлі розглянуто",
                     extra={"pending": lambda f: f["reviewed_on"] is None})


class Reports(Source):
    """Мок: журнал повідомлень і звернень. Записи: report_id, org_code, received_on, deadline_on, answered_on."""

    name = "reports"
    title = "Журнал повідомлень (мок)"
    indicators = ("reports_handled",)

    def mock_records(self, orgs, periods, as_of):
        rows = []
        for org in orgs:
            for period in periods:
                rng = _rng(self.name, org, period)
                for i in range(rng.randint(0, 2)):
                    received = _day(period, rng)
                    deadline = received + timedelta(days=15)
                    answered = received + timedelta(days=rng.randint(2, 14) if rng.random() < ORG_QUALITY[org] + 0.05 else rng.randint(16, 40))
                    rows.append({"report_id": f"R-{org}-{period}-{i}", "org_code": org, "received_on": received.isoformat(),
                                 "deadline_on": deadline.isoformat(), "answered_on": _iso(answered if answered <= as_of else None)})
        return {"reports": rows}

    def facts(self, data, periods, as_of):
        rows = [r for r in data["reports"] if _due(r, as_of, "deadline_on", "answered_on")]
        return tally(rows, source=self.name, indicator="reports_handled", when="received_on", periods=periods,
                     ok=lambda r: r["answered_on"] is not None and r["answered_on"] <= r["deadline_on"],
                     why="Журнал повідомлень: розглянуто до строку",
                     extra={"pending": lambda r: r["answered_on"] is None})


class Mitra(Source):
    """Mitra — тема 2 цього хакатону (моніторинг виконання антикорупційної програми). Справжня Mitra сама шле
    факт POST /indicators (source "mitra", контракт docs/contracts/integra-mitra.yaml); тут лише мок для демо
    без їхнього стенду.

    Записи (JSON): {"system": "Mitra", "measures": [{"measure_code", "org_code", "due_on", "state", "closed_on"}]}
    state: DONE / PARTIAL / NOT_DONE / IN_PROGRESS. Факт program_measures_on_time: закриті «Виконано» до строку /
    заходи, строк яких настав (або вже закриті).
    """

    name = "mitra"
    title = "Mitra, виконання антикорупційної програми (мок)"
    indicators = ("program_measures_on_time",)

    def mock_records(self, orgs, periods, as_of):
        rows = []
        for org in orgs:
            for period in periods:
                rng = _rng(self.name, org, period)
                for i in range(rng.randint(1, 4)):
                    due = _day(period, rng)
                    on_time = rng.random() < ORG_QUALITY[org]
                    closed = due - timedelta(days=rng.randint(0, 10)) if on_time else due + timedelta(days=rng.randint(1, 30))
                    state = "DONE" if on_time or rng.random() < 0.5 else rng.choice(["PARTIAL", "NOT_DONE"])
                    if closed > as_of:
                        closed, state = None, "IN_PROGRESS"
                    rows.append({"measure_code": f"{period}-{org}-{i}", "org_code": org, "due_on": due.isoformat(),
                                 "state": state, "closed_on": _iso(closed)})
        return {"system": "Mitra", "measures": rows}

    def facts(self, data, periods, as_of):
        rows = [r for r in data["measures"] if _due(r, as_of, "due_on", "closed_on")]
        ok = lambda r: r["state"] == "DONE" and r["closed_on"] is not None and r["closed_on"] <= r["due_on"]  # noqa: E731
        return tally(rows, source=self.name, indicator="program_measures_on_time", when="due_on", ok=ok,
                     periods=periods, why="Mitra: заходи антикорупційної програми, закриті «Виконано» до строку",
                     extra={"partial": lambda r: r["state"] == "PARTIAL", "not_done": lambda r: r["state"] == "NOT_DONE",
                            "overdue": lambda r: r["closed_on"] is None})


SOURCES: dict[str, Source] = {s.name: s for s in (Artemida(), Atestat(), Training(), Procurement(), Reports(),
                                                    Mitra())}
