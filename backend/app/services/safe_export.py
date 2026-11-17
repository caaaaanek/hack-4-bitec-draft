"""Захист від формул у CSV і Excel (CSV/formula injection).

Excel, LibreOffice й openpyxl вважають формулою клітинку, що починається з = + - @ (а також з табуляції чи
повернення каретки перед ними). Назва заходу, відповідальний, коментар до рішення чи текст питання з конструктора
вводять люди, тож у звіті керівника такий текст міг би виконатися. Перед записом у CSV/XLSX рядок, що починається
з цих символів, отримує на початку апостроф і лишається просто текстом. Числа й дати не змінюються.
"""

from collections.abc import Iterable

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value):
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def safe_row(row: Iterable) -> list:
    return [safe_cell(v) for v in row]


class SafeCsvWriter:
    """Обгортка над csv.writer: кожна клітинка проходить safe_cell()."""

    def __init__(self, writer):
        self._writer = writer

    def writerow(self, row: Iterable):
        return self._writer.writerow(safe_row(row))

    def writerows(self, rows: Iterable[Iterable]):
        for row in rows:
            self.writerow(row)
