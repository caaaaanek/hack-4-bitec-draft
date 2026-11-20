"""Димова перевірка запущеного стенда (після `docker compose up`). Лише стандартна бібліотека.

    python backend/scripts/smoke.py --base http://localhost:8080 --password "$DEMO_PASSWORD"

Перевіряє: /health з БД, /config, вхід, хвилю за посиланнями від створення до закриття,
повтор посилання (409), файл-доказ із sha256, журнал і його цілісність.
Створює в БД хвилю «Smoke …», файл-доказ і записи журналу, які не видаляються. Тому запускайте його
на окремому проєкті compose (docker compose -p smoke …), не на демо-стенді й не на робочому.
Якщо в БД є хвилі «(демо)», скрипт відмовляється працювати без --force.
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
import uuid


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token = None

    def call(self, method, path, body=None, headers=None, raw=None, content_type=None):
        url = path if path.startswith("http") else f"{self.base}{path}"
        data, hdrs = None, {"Accept": "application/json", **(headers or {})}
        if self.token and "X-Response-Token" not in hdrs:
            hdrs["Authorization"] = f"Bearer {self.token}"
        if raw is not None:
            data, hdrs["Content-Type"] = raw, content_type
        elif body is not None:
            data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = r.read()
                return r.status, (json.loads(payload) if payload and "json" in r.headers.get("Content-Type", "") else payload), r.headers
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                payload = json.loads(payload)
            except ValueError:
                pass
            return e.code, payload, e.headers


def multipart(field: str, filename: str, content: bytes, mime: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--password", required=True, help="DEMO_PASSWORD")
    ap.add_argument("--force", action="store_true",
                    help="Запускати навіть на стенді з демо-хвилями (лишить у БД хвилю «Smoke …»)")
    args = ap.parse_args()
    api = Api(args.base)
    failures = []

    def check(name, ok, info=""):
        print(("  ok  " if ok else "FAIL  ") + name + (f"  ({info})" if info and not ok else ""))
        if not ok:
            failures.append(name)

    s, body, _ = api.call("GET", "/health")
    check("health + БД", s == 200 and body.get("database") == "ok", body)
    s, cfg, _ = api.call("GET", "/api/v1/config")
    check("config", s == 200 and cfg["min_group_size"] >= 5, cfg)
    s, body, _ = api.call("POST", "/api/v1/auth/session", {"login": "admin", "password": args.password})
    check("вхід admin", s == 200, body)
    if s != 200:
        return 1
    api.token = body["access_token"]

    s, campaigns, _ = api.call("GET", "/api/v1/campaigns")
    demo = [c["title"] for c in (campaigns if s == 200 and isinstance(campaigns, list) else []) if "(демо)" in c["title"]]
    if demo and not args.force:
        print(f"\nСтоп: у БД є демо-хвилі ({', '.join(demo)}). Smoke лишить свою хвилю, доказ і записи журналу,\n"
              "і вони з'являться на демо. Запустіть на окремому проєкті:\n"
              "  docker compose -p smoke up -d --build   # окремі томи й БД\n"
              "  (у .env проєкту smoke: SEED_WITH_WAVES=false, інші порти або зупинений основний стенд)\n"
              "або додайте --force, якщо слід на цьому стенді не заважає.")
        return 2

    units = {u["name"]: u["id"] for u in api.call("GET", "/api/v1/units")[1]}
    qs = {q["code"]: q["id"] for q in api.call("GET", "/api/v1/questionnaires")[1]}
    root = next(u["id"] for u in api.call("GET", "/api/v1/units")[1] if u["parent_id"] is None)
    unit = next(i for n, i in units.items() if i != root)
    s, camp, _ = api.call("POST", "/api/v1/campaigns", {
        "title": f"Smoke {time.strftime('%H:%M:%S')}", "unit_id": root, "access_mode": "token",
        "questionnaire_ids": [qs["nazk-maturity-staff"], qs["nazk-checklist"]]})
    check("хвиля за посиланнями", s == 201, camp)
    cid = camp["id"]
    s, issued, _ = api.call("POST", f"/api/v1/campaigns/{cid}/tokens",
                            {"questionnaire_id": qs["nazk-maturity-staff"], "unit_id": unit, "count": 6})
    check("видача посилань", s == 201 and len(issued["tokens"]) == 6, issued)
    s, opened, _ = api.call("POST", f"/api/v1/campaigns/{cid}/open")
    check("відкриття", s == 200, opened)
    if s == 200 and opened.get("pending_approval_id"):  # принцип двох осіб: підтверджує внутрішній аудит
        saved = api.token
        s, au, _ = api.call("POST", "/api/v1/auth/session", {"login": "auditor", "password": args.password})
        api.token = au["access_token"]
        s, body, _ = api.call("POST", f"/api/v1/admin/approvals/{opened['pending_approval_id']}/approve")
        check("відкриття підтвердив аудит", s == 200, body)
        api.token = saved

    tokens = [t["token"] for t in issued["tokens"]]
    saved = api.token
    api.token = None
    for i, t in enumerate(tokens[:5]):
        s, form, _ = api.call("GET", "/api/v1/respond/form", headers={"X-Response-Token": t})
        answers = [{"question_id": q["id"], "option_ids": [q["options"][i % len(q["options"])]["id"]]}
                   for sec in form["sections"] for q in sec["questions"]]
        s, body, _ = api.call("POST", "/api/v1/respond/responses", {"answers": answers},
                              headers={"X-Response-Token": t})
        check(f"анонімне подання {i + 1}", s == 201, body)
    s, body, _ = api.call("POST", "/api/v1/respond/responses", {"answers": answers},
                          headers={"X-Response-Token": tokens[4]})
    check("повтор посилання → 409 token_used", s == 409 and body.get("code") == "token_used", body)
    api.token = saved

    s, prog, _ = api.call("GET", f"/api/v1/campaigns/{cid}/progress")
    check("прогрес 5 з 6", s == 200 and prog["items"][0]["submitted"] == 5, prog)

    # Файл-доказ від члена робочої групи.
    s, wg, _ = api.call("POST", "/api/v1/auth/session", {"login": "wg1", "password": args.password})
    api.token = wg["access_token"]
    item = api.call("GET", f"/api/v1/campaigns/{cid}/checklist")[1]["items"][0]
    content = b"%PDF-1.4\n% smoke\n" + b"0" * (2 * 1024 * 1024)
    raw, ctype = multipart("file", "Наказ (smoke).pdf", content, "application/pdf")
    s, meta, _ = api.call("POST", f"/api/v1/campaigns/{cid}/checklist/{item['question_id']}/files", raw=raw,
                          content_type=ctype)
    check("файл-доказ 2 МБ через проксі", s == 201 and meta["sha256"] == hashlib.sha256(content).hexdigest(), meta)
    s, data, hdrs = api.call("GET", f"/api/v1/campaigns/{cid}/checklist/{item['question_id']}/files/{meta['id']}")
    check("завантаження доказу збігається", s == 200 and hashlib.sha256(data).hexdigest() == meta["sha256"])
    api.token = saved

    check("закриття хвилі", api.call("POST", f"/api/v1/campaigns/{cid}/close")[0] == 200)
    s, res, _ = api.call("GET", f"/api/v1/campaigns/{cid}/results")
    check("результати після закриття", s == 200, res)
    s, ver, _ = api.call("POST", "/api/v1/admin/audit-log/verify")
    check("журнал цілий", s == 200 and ver["ok"], ver)
    s, body, _ = api.call("GET", "/api/v1/no-such-route")
    check("формат помилки", s == 404 and {"code", "message", "hint"} <= set(body), body)

    print("\nУсе гаразд." if not failures else f"\nНе пройшло: {len(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
