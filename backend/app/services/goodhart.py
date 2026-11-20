"""«Детектор Гудхарта»: коли показник стає ціллю, він перестає бути показником.

Індекс почнуть «малювати». Детерміновані правила шукають сліди підгонки — не звинувачення, а привід
для питання аудитора («Питання перевірки») і прапорець достовірності possible_gaming:

1. thresholds_cluster — частки фактів «X з Y» скупчуються якраз над порогами методики
   (класична ознака підгонки під межу): над порогом (до +1 п. п.) утричі частіше, ніж під ним (до −1 п. п.).
2. measures_spike — сплеск «Виконано» в трекері за тиждень до відкриття хвилі.
3. checklist_rush — масова зміна пунктів чек-листа на «повністю» за 2 дні до закриття.
4. identical_patterns — однакові набори відповідей у робочій групі.
5. last_day_surge — різкий ріст участі в останній день хвилі разом із високою часткою «ідеальних» анкет.

Усі правила працюють з агрегатами й зі статусами, які й так видно; жодних даних про окремих людей.
"""

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccessMode, ChecklistStatus, Measure, MeasureStatus, RespondentCategory
from app.services import methodology as m

THRESHOLD_BAND = 1.0          # п. п. над / під порогом
THRESHOLD_MIN_ABOVE = 3
THRESHOLD_RATIO = 3.0
THRESHOLD_MIN_DENOMINATOR = 10
SPIKE_DAYS = 7
SPIKE_LOOKBACK_DAYS = 90
SPIKE_MIN = 3
SPIKE_SHARE = 0.4
RUSH_DAYS = 2
RUSH_MIN = 5
RUSH_SHARE = 0.5
IDENTICAL_SHARE = 0.5
SURGE_SHARE = 0.4
SURGE_PERFECT = 0.2


def signal(code: str, title: str, description: str, rule: str, **values) -> dict:
    return {"code": code, "title": title, "description": description, "rule": rule, "values": values}


def thresholds_cluster(rows) -> dict | None:
    above = below = 0
    for r in rows:
        spec = m.FACTS.get(r.indicator)
        if spec is None or r.denominator < THRESHOLD_MIN_DENOMINATOR:
            continue
        percent = 100 * r.numerator / r.denominator
        for t in spec["thresholds"]:
            if t <= percent < t + THRESHOLD_BAND:
                above += 1
            elif t - THRESHOLD_BAND <= percent < t:
                below += 1
    if above >= THRESHOLD_MIN_ABOVE and above >= THRESHOLD_RATIO * max(below, 1):
        return signal("thresholds_cluster", "Факти скупчуються якраз над порогами методики",
                      f"{above} місячних значень фактів лежать у межах {THRESHOLD_BAND:g} п. п. над порогом рівня, "
                      f"і лише {below} — так само близько під ним.",
                      f"Над порогом щонайменше {THRESHOLD_MIN_ABOVE} і в {THRESHOLD_RATIO:g} рази частіше, ніж під ним "
                      f"(знаменник від {THRESHOLD_MIN_DENOMINATOR}).", above=above, below=below)
    return None


def measures_spike(db: Session, units: set, opened_on: date | None) -> dict | None:
    if opened_on is None:
        return None
    rows = db.scalars(select(Measure.done_on).where(
        Measure.unit_id.in_(units), Measure.status == MeasureStatus.DONE, Measure.done_on.is_not(None),
        Measure.done_on <= opened_on, Measure.done_on > opened_on - timedelta(days=SPIKE_LOOKBACK_DAYS))).all()
    recent = sum(1 for d in rows if d > opened_on - timedelta(days=SPIKE_DAYS))
    if recent >= SPIKE_MIN and recent >= SPIKE_SHARE * len(rows):
        return signal("measures_spike", "Сплеск «Виконано» перед хвилею",
                      f"{recent} з {len(rows)} заходів за {SPIKE_LOOKBACK_DAYS} днів позначено виконаними за "
                      f"тиждень до відкриття хвилі.",
                      f"Щонайменше {SPIKE_MIN} і {round(SPIKE_SHARE * 100)}% виконаних за {SPIKE_LOOKBACK_DAYS} днів "
                      f"припадає на останні {SPIKE_DAYS} днів перед відкриттям.", recent=recent, total=len(rows))
    return None


def checklist_rush(db: Session, entries, closed_on: date | None) -> dict | None:
    """Пункти, які були «частково» чи «підлягає» і стали «повністю» за RUSH_DAYS днів до закриття (за журналом дій)."""
    from app.models import AuditLog

    full = [e for e in entries if e.status == ChecklistStatus.FULL]
    if closed_on is None or not full:
        return None
    border = datetime.combine(closed_on - timedelta(days=RUSH_DAYS), datetime.min.time(), tzinfo=timezone.utc)

    def aware(x: datetime) -> datetime:
        return x if x.tzinfo else x.replace(tzinfo=timezone.utc)

    history: dict[str, list] = {}
    for row in db.scalars(select(AuditLog).where(AuditLog.entity == "checklist_entry", AuditLog.action == "set",
                                                 AuditLog.entity_id.in_([str(e.id) for e in full]))
                          .order_by(AuditLog.seq)):
        history.setdefault(row.entity_id, []).append((aware(row.at), (row.details or {}).get("status")))
    late = 0
    for e in full:
        events = history.get(str(e.id), [])
        changed = [i for i, (at, st) in enumerate(events) if st == "full" and at >= border
                   and any(prev != "full" for _, prev in events[:i])]
        late += bool(changed)
    if late >= RUSH_MIN and late >= RUSH_SHARE * len(full):
        return signal("checklist_rush", "Масова зміна чек-листа на «повністю» перед закриттям",
                      f"{late} з {len(full)} пунктів «впроваджено повністю» змінено на «повністю» за {RUSH_DAYS} дні "
                      "до закриття (раніше були «частково» чи «підлягає»).",
                      f"Щонайменше {RUSH_MIN} і {round(RUSH_SHARE * 100)}% пунктів «повністю» змінено на «повністю» "
                      f"за останні {RUSH_DAYS} дні (за журналом дій).", late=late, total=len(full))
    return None


def identical_patterns(groups, k: int) -> dict | None:
    for g in groups:
        if g.questionnaire.target_category != RespondentCategory.WORKING_GROUP or len(g.responses) < k:
            continue
        patterns = Counter(tuple(sorted((str(q), tuple(sorted(map(str, o)))) for q, o in r.options.items()))
                           for r in g.responses)
        duplicated = sum(n for n in patterns.values() if n > 1)
        if duplicated >= k and duplicated >= IDENTICAL_SHARE * len(g.responses):
            return signal("identical_patterns", "Однакові набори відповідей у робочій групі",
                          f"{duplicated} з {len(g.responses)} анкет робочої групи повністю збігаються з іншою анкетою.",
                          f"Щонайменше k і {round(IDENTICAL_SHARE * 100)}% анкет групи мають двійника.",
                          duplicated=duplicated, total=len(g.responses))
    return None


def last_day_surge(campaign, participations, scored_groups: list[dict]) -> dict | None:
    if campaign.access_mode != AccessMode.LOGIN or not participations:
        return None
    last = campaign.closed_on or max(p.submitted_on for p in participations)
    if campaign.opened_on is None or campaign.opened_on >= last:
        return None  # одноденна хвиля: «останній день» — це вся хвиля
    on_last = sum(1 for p in participations if p.submitted_on == last)
    perfect = max((g.get("perfect_share") or 0 for g in scored_groups), default=0)
    if on_last >= campaign.min_group_size and on_last >= SURGE_SHARE * len(participations) and perfect >= SURGE_PERFECT:
        return signal("last_day_surge", "Різкий ріст участі в останній день з «ідеальними» анкетами",
                      f"{on_last} з {len(participations)} анкет подано в останній день; частка анкет лише з найвищими "
                      f"відповідями в групі до {round(perfect * 100)}%.",
                      f"Щонайменше {round(SURGE_SHARE * 100)}% подань в останній день і частка «ідеальних» від "
                      f"{round(SURGE_PERFECT * 100)}%.", on_last=on_last, total=len(participations))
    return None


def analyze(db: Session, wave, scope, units: set, groups, at_root: bool) -> dict:
    from app.services import scoring

    k = wave.campaign.min_group_size
    scored = [scoring.score_group(g, k) for g in groups]
    rows = [r for r in wave.indicator_rows if r.unit_id in units]
    signals = [s for s in (
        thresholds_cluster(rows),
        measures_spike(db, units, wave.campaign.opened_on),
        checklist_rush(db, list(wave.checklist_entries.values()), wave.campaign.closed_on) if at_root else None,
        identical_patterns(groups, k),
        last_day_surge(wave.campaign, wave.participations, scored) if at_root else None,
    ) if s is not None]
    return {"signals": signals, "flags": ["possible_gaming"] if signals else [],
            "rule": "Закон Гудхарта: правила шукають сліди підгонки показників. Сигнал — привід для питання, "
                    "а не висновок; прапорець possible_gaming знижує достовірність на один щабель (незначний)."}
