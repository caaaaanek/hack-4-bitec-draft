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
