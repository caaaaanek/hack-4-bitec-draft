"""Людські назви службових значень (статусів, рішень, ролей) для текстів, які бачить користувач.

Сирі коди (`none`, `in_progress`, `clarify`…) лишаються в полях API, а в `note`, `change`, `rule`, повідомленнях
про помилки й журналі — лише ці назви.
"""

# Стан пункту чек-листа в коротких переходах «було → стало».
CHECKLIST_STATUS_SHORT = {"full": "повністю", "partial": "частково", "none": "не впроваджено"}
MEASURE_STATUS_TITLES = {"planned": "заплановано", "in_progress": "в роботі", "done": "виконано",
                         "cancelled": "скасовано"}
DECISION_TITLES = {"accepted": "прийнято", "rejected": "відхилено", "clarify": "потрібне уточнення"}
ROLE_TITLES = {"admin": "уповноважений", "respondent": "респондент", "leader": "керівник",
               "auditor": "внутрішній аудит", "coordinator": "технічний адміністратор", "department": "Департамент"}


def code_of(value) -> str | None:
    return getattr(value, "value", value)


def checklist_status(status) -> str:
    """`none` → «не впроваджено»; порожній стан → «не заповнено»."""
    status = code_of(status)
    return CHECKLIST_STATUS_SHORT.get(status, status) if status else "не заповнено"


def measure_status(status) -> str:
    status = code_of(status)
    return MEASURE_STATUS_TITLES.get(status, status)


def decision(value) -> str:
    value = code_of(value)
    return DECISION_TITLES.get(value, value)


def role(value) -> str:
    value = code_of(value)
    return ROLE_TITLES.get(value, value)
