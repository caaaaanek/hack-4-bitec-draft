"""scripts/gen_docs.py: документи recommendations.md і cross-check.md з реального прогону.

Скрипт запускається окремим процесом: він налаштовує власну тимчасову базу до імпорту застосунку.
"""

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_generates_docs_from_real_run(tmp_path):
    r = subprocess.run([sys.executable, "scripts/gen_docs.py", "--out-dir", str(tmp_path)], cwd=BACKEND,
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
    recs = (tmp_path / "recommendations.md").read_text(encoding="utf-8")
    cross = (tmp_path / "cross-check.md").read_text(encoding="utf-8")

    assert "Хвиля 2 (демо)" in recs and "Чому (rule)" in recs
    assert "відхилено" in recs and "уточнити" in recs and "прострочено" in recs
    assert "L зараховано" in cross and "Самооцінку обмежено фактами" in cross
    assert "приховано (менше k)" in cross  # «Підрозділ В» у хвилі 1 нижче порогу
    for text in (recs, cross):
        assert "staff01" not in text and "wg1" not in text  # ні логінів, ні осіб
    # Анонімність і «без рейтингів»: у розділі про підрозділи немає індексів.
    section = cross.split("## 5.")[1].split("## 6.")[0]
    assert "Індекс" not in section.split("|", 1)[1]
