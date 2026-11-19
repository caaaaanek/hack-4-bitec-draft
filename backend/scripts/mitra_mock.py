"""Мок Mitra (тема 2) за контрактом docs/contracts/integra-mitra.yaml. Лише для розробки й запасного демо.

Приймає заходи від Integra (POST /measures) у «вхідні» координатора і дозволяє вручну або автоматично
пройти їхній шлях: пов'язати із заходом програми → виконати з документом → відправити вебхук у Integra.
Код справжньої Mitra тут не використано: це окрема заглушка, яка лише повторює контракт.

Запуск з backend/:
    python scripts/mitra_mock.py --port 8090 --integra http://localhost:8000 --key <THEME2_API_KEY>
    # в Integra: THEME2_URL=http://localhost:8090  THEME2_PUBLIC_URL=http://localhost:8090  THEME2_API_KEY=<той самий>
    python scripts/mitra_mock.py ... --auto 3   # кожен новий захід сам пройде «linked → done» з паузою 3 с

Сторінка http://localhost:8090/ — список вхідних з кнопками «Пов'язати», «Виконано», «Відхилити».
"""

import argparse
import hashlib
import html
import json
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

CONTRACT = "integra-mitra/1"
INBOX: dict[str, dict] = {}
LOCK = threading.Lock()
ARGS: argparse.Namespace


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def webhook(item: dict, state: str, **extra) -> tuple[int, str]:
    body = {"contract": CONTRACT, "event_id": str(uuid.uuid4()), "occurred_at": now(), "measure_id": item["id"],
            "external_id": item["mitra_id"], "state": state, "url": f"{ARGS.public}/measures/{item['mitra_id']}",
            **extra}
    request = urllib.request.Request(
        ARGS.integra.rstrip("/") + "/api/v1/integrations/theme2/measures/status",
        data=json.dumps(body, ensure_ascii=False).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Integration-Key": ARGS.key})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310 (адреса з аргументів)
            return response.status, response.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except OSError as e:
        return 0, str(e)


def act(mitra_id: str, action: str) -> tuple[int, str]:
    with LOCK:
        item = INBOX.get(mitra_id)
    if item is None:
        return 404, "not found"
    if action == "link":
        item["state"] = "linked"
        return webhook(item, "linked", mitra_status="PLANNED")
    if action == "reject":
        item["state"] = "rejected"
        return webhook(item, "rejected", comment="Дублює захід 2.4 програми (мок)")
    if action == "done":
        content = f"Наказ про виконання заходу «{item['title']}» (мок, {date.today()})".encode()
        sha = hashlib.sha256(content).hexdigest()
        verify = f"{ARGS.public}/verify?" + urlencode({"doc": item["mitra_id"], "h": sha})
        item["state"], item["sha256"] = "done", sha
        return webhook(item, "done", mitra_status="DONE", done_on=date.today().isoformat(), evidence={
            "summary": "Захід виконано: наказ підписано, ознайомлено особовий склад (мок).",
            "documents": [{"name": f"Наказ_{item['mitra_id']}.pdf", "sha256": sha, "verify_url": verify}]})
    return 400, "unknown action"


def auto(mitra_id: str) -> None:
    for action in ("link", "done"):
        time.sleep(ARGS.auto)
        print(f"[mitra-mock] {mitra_id}: {action} → {act(mitra_id, action)}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body, kind: str = "application/json") -> None:
        data = (json.dumps(body, ensure_ascii=False) if kind == "application/json" else body).encode()
        self.send_response(code)
        self.send_header("Content-Type", f"{kind}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/measures":
            if self.headers.get("X-Integration-Key") != ARGS.key:
                return self._send(401, {"detail": "bad key"})
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if payload.get("contract") not in (None, CONTRACT) or not payload.get("id"):
                return self._send(422, {"detail": "unsupported contract or missing id"})
            with LOCK:
                existing = next((x for x in INBOX.values() if x["id"] == payload["id"]), None)
                if existing:  # повтор чи оновлення того самого заходу: той самий запис
                    existing.update(payload=payload, title=payload["title"])
                    return self._send(200, {"id": existing["mitra_id"], "state": existing["state"]})
                mitra_id = f"MITRA-{len(INBOX) + 1:03d}"
                INBOX[mitra_id] = {"id": payload["id"], "mitra_id": mitra_id, "state": "inbox",
                                   "title": payload["title"], "payload": payload}
            print(f"[mitra-mock] вхідний {mitra_id}: {payload['title']}", flush=True)
            if ARGS.auto:
                threading.Thread(target=auto, args=(mitra_id,), daemon=True).start()
            return self._send(201, {"id": mitra_id, "state": "inbox"})
        if path.startswith("/demo/"):
            _, _, mitra_id, action = path.split("/", 3)
            code, text = act(mitra_id, action)
            self.send_response(303)
            self.send_header("Location", f"/?last={code}")
            self.end_headers()
            return None
        return self._send(404, {"detail": "not found"})

    def do_GET(self):  # noqa: N802
        parts = urlsplit(self.path)
        if parts.path == "/verify":
            q = parse_qs(parts.query)
            item = INBOX.get((q.get("doc") or [""])[0])
            ok = item is not None and item.get("sha256") == (q.get("h") or [""])[0]
            text = "Документ справжній, sha256 збігається" if ok else "Документ не знайдено або хеш не збігається"
            return self._send(200 if ok else 404, f"<h1>МОК Mitra</h1><p>{text}</p>", "text/html")
        if parts.path == "/":
            rows = "".join(
                f"<tr><td>{html.escape(x['mitra_id'])}</td><td>{html.escape(x['title'])}</td><td>{x['state']}</td><td>"
                + "".join(f"<form method=post action='/demo/{x['mitra_id']}/{a}' style='display:inline'>"
                          f"<button>{t}</button></form>" for a, t in
                          (("link", "Пов'язати"), ("done", "Виконано"), ("reject", "Відхилити")))
                + "</td></tr>" for x in INBOX.values())
            return self._send(200, f"<h1>МОК Mitra: вхідні</h1><table border=1 cellpadding=6>{rows}</table>",
                              "text/html")
        return self._send(404, {"detail": "not found"})

    def log_message(self, *_):
        pass


def main(argv: list[str] | None = None) -> None:
    global ARGS
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--integra", default="http://localhost:8000")
    parser.add_argument("--key", required=True, help="THEME2_API_KEY: той самий ключ в обидва боки")
    parser.add_argument("--public", default=None, help="Адреса мока для посилань, за замовчуванням http://localhost:PORT")
    parser.add_argument("--auto", type=float, default=0, help="Секунд між кроками автоматичного проходження")
    ARGS = parser.parse_args(argv)
    ARGS.public = (ARGS.public or f"http://localhost:{ARGS.port}").rstrip("/")
    print(f"[mitra-mock] {ARGS.public} → вебхуки в {ARGS.integra}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", ARGS.port), Handler).serve_forever()  # noqa: S104


if __name__ == "__main__":
    main()
