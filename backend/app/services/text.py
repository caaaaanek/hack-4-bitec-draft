"""Дрібні текстові помічники для повідомлень користувачу."""


def shorten(text: str | None, limit: int) -> str:
    """Обрізати текст до `limit` символів по межі слова з «…», а не посеред слова."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    space = cut.rfind(" ")
    if space > limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:—-–.«(") + "…"


def short_questionnaire(title: str | None, limit: int = 50) -> str:
    """Коротка назва анкети для повідомлень: «Анкета 3. Рівень … (зовнішні експерти)» → «Анкета 3 (зовнішні
    експерти)». Інакше — обрізання по слову (раніше «…доброчесності (зовнішні : 0%» обрізалося посеред дужки)."""
    import re

    title = " ".join((title or "").split())
    match = re.match(r"^(Анкета\s+\d+)\..*\(([^()]+)\)$", title)
    if match:
        return f"{match.group(1)} ({match.group(2)})"
    return shorten(title, limit)


def percent(value: float | int | None) -> str:
    """83.3 → «83,3 %», 80.0 → «80 %»."""
    if value is None:
        return "—"
    return f"{value:.1f}".replace(".", ",").removesuffix(",0") + " %"


def points(value: float | int | None) -> str:
    """Число з узгодженим «бал»: «1 бал», «54 бали», «75 балів», «43,8 бала» (дробові — родовий однини)."""
    from app.services.plural import plural

    if value is None:
        return "—"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:.1f}".replace(".", ",") + " бала"
    return plural(int(value), "бал", "бали", "балів")
