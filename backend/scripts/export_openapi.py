"""Оновлює docs/api/openapi.json з коду. Запуск з backend/: python scripts/export_openapi.py"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("JWT_SECRET", "x" * 48)  # лише щоб імпортувався застосунок; сервер не стартує

from app.main import app  # noqa: E402

target = Path(__file__).resolve().parents[2] / "docs" / "api" / "openapi.json"
target.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{target}: {len(app.openapi()['paths'])} шляхів")
