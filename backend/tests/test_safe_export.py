"""Захист від формул у CSV і Excel: текст, що починається з = + - @, лишається текстом."""

import csv
import io
from datetime import date, timedelta

from openpyxl import load_workbook

from app.services.safe_export import FORMULA_PREFIXES, safe_cell, safe_row
from tests.conftest import auth
from tests.helpers import API, full_wave

FORMULA = '=HYPERLINK("http://x","x")'


def test_safe_cell():
    for dangerous in (FORMULA, "+1", "-1+2", "@SUM(A1)", "\t=1", "\r=1"):
        assert safe_cell(dangerous) == "'" + dangerous
    for harmless in ("Захід", "", "a=b", "−5 (юнікод-мінус)", " =1"):
        assert safe_cell(harmless) == harmless
    assert safe_row([-5, 3.5, None, date(2026, 1, 1), "=1"]) == [-5, 3.5, None, date(2026, 1, 1), "'=1"]


def test_measure_title_with_formula_is_text_in_xlsx_and_csv(client):
    campaign_id, _, root = full_wave(client)
    leader = auth(client, "leader")
    r = client.post(f"{API}/measures", headers=leader, json={
        "unit_id": root, "title": FORMULA, "owner": "@Відповідальний", "campaign_id": campaign_id,
        "due_date": (date.today() + timedelta(days=30)).isoformat()})
    assert r.status_code == 201, r.text
    url = f"{API}/campaigns/{campaign_id}/report"

    r = client.get(url, params={"format": "xlsx"}, headers=leader)
    assert r.status_code == 200, r.text
    sheet = load_workbook(io.BytesIO(r.content))["Заходи"]
    cells = [c for row in sheet.iter_rows() for c in row if isinstance(c.value, str) and "HYPERLINK" in c.value]
    assert cells, "захід має бути в аркуші «Заходи»"
    for cell in cells:
        assert cell.data_type == "s"
        assert cell.value == "'" + FORMULA
    assert not any(c.data_type == "f" for row in sheet.iter_rows() for c in row)

    r = client.get(url, params={"format": "csv"}, headers=leader)
    assert r.status_code == 200, r.text
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿")), delimiter=";"))
    measure = next(row for row in rows if row[0] == "захід" and "HYPERLINK" in row[2])
    assert measure[2] == "'" + FORMULA
    assert measure[6] == "'@Відповідальний"
    assert not any(cell.startswith(FORMULA_PREFIXES) for row in rows for cell in row)
