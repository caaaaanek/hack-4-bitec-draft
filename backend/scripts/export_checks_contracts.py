"""Оновлює контракти модуля «Перевірки» з коду. Запуск з backend/: python scripts/export_checks_contracts.py

Пише docs/contracts/checks.openapi.json (лише /api/v1/checks*) і docs/contracts/schemas/*.schema.json.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("JWT_SECRET", "x" * 48)  # лише щоб імпортувався застосунок; сервер не стартує

from app.main import app  # noqa: E402
from app.schemas_checks import DeclarationItem, FindingOut, ProcurementRecord, RunOut  # noqa: E402

contracts = Path(__file__).resolve().parents[2] / "docs" / "contracts"


def dump(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def used_refs(node, found: set) -> set:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            found.add(ref.rsplit("/", 1)[1])
        for v in node.values():
            used_refs(v, found)
    elif isinstance(node, list):
        for v in node:
            used_refs(v, found)
    return found


full = app.openapi()
paths = {p: v for p, v in full["paths"].items() if p.startswith("/api/v1/checks")}
schemas = full["components"]["schemas"]
needed, queue = set(), list(used_refs(paths, set()))
while queue:
    name = queue.pop()
    if name not in needed:
        needed.add(name)
        queue.extend(used_refs(schemas[name], set()))
dump(contracts / "checks.openapi.json", {
    "openapi": full["openapi"],
    "info": {"title": "Перевірки: закупівлі, декларації, конфлікти інтересів", "version": full["info"]["version"]},
    "paths": paths,
    "components": {"schemas": {k: schemas[k] for k in sorted(needed)}},
})
for name, model in (("procurement-record", ProcurementRecord), ("declaration-item", DeclarationItem),
                    ("check-run", RunOut), ("finding", FindingOut)):
    dump(contracts / "schemas" / f"{name}.schema.json", model.model_json_schema())
print(f"{contracts}: {len(paths)} шляхів, схем {len(needed)}")
