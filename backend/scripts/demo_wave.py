"""Демо-хвиля від початку до кінця через API на демо-даних.

Створює і відкриває хвилю, заповнює анкети синтетичними відповідями, вносить і
підтверджує чек-лист, закриває хвилю і друкує Integrity Index з поясненнями.

Запуск (сервер має працювати, база засіяна seed):
    python scripts/demo_wave.py
    python scripts/demo_wave.py --url http://localhost:8000 --title "Хвиля 2"
Пароль демо-користувачів береться з DEMO_PASSWORD (.env або змінна оточення).
"""

import argparse
import os
import sys
from pathlib import Path

import httpx


def demo_password() -> str:
    if os.environ.get("DEMO_PASSWORD"):
        return os.environ["DEMO_PASSWORD"]
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("DEMO_PASSWORD="):
                return line.split("=", 1)[1].strip()
    sys.exit("Задайте DEMO_PASSWORD у backend/.env або як змінну оточення")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--title", default="Хвиля 1 (демо)")
    parser.add_argument("--shift", type=int, default=0, help="Зсув відповідей, щоб друга хвиля відрізнялась від першої")
    args = parser.parse_args()

    api = args.url.rstrip("/") + "/api/v1"
    password = demo_password()
    client = httpx.Client(timeout=60)

    def login(name: str) -> dict:
        r = client.post(f"{api}/auth/login", data={"username": name, "password": password})
        r.raise_for_status()
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    admin = login("admin")
    questionnaires = {q["code"]: q["id"] for q in client.get(f"{api}/questionnaires", headers=admin).json()}
    root = next(u for u in client.get(f"{api}/units", headers=admin).json() if u["parent_id"] is None)

    r = client.post(f"{api}/campaigns", headers=admin,
                    json={"title": args.title, "unit_id": root["id"], "questionnaire_ids": list(questionnaires.values())})
    r.raise_for_status()
    campaign_id = r.json()["id"]
    r = client.post(f"{api}/campaigns/{campaign_id}/open", headers=admin)
    r.raise_for_status()
    if r.json().get("pending_approval_id"):  # принцип двох осіб: відкриття підтверджує внутрішній аудит
        client.post(f"{api}/admin/approvals/{r.json()['pending_approval_id']}/approve",
                    headers=login("auditor")).raise_for_status()
    print(f"Хвиля «{args.title}» відкрита для «{root['name']}»")

    def answer(user: str, code: str, pick) -> None:
        headers = login(user)
        url = f"{api}/campaigns/{campaign_id}/questionnaires/{questionnaires[code]}"
        form = client.get(f"{url}/form", headers=headers).json()
        answers = [
            {"question_id": q["id"], "option_ids": [q["options"][pick(i) % len(q["options"])]["id"]]}
            for s in form["sections"] for i, q in enumerate(s["questions"])
        ]
        client.post(f"{url}/responses", json={"answers": answers}, headers=headers).raise_for_status()

    s = args.shift
    for i in range(1, 21):
        answer(f"staff{i:02d}", "nazk-maturity-staff", lambda j, i=i: (i + j) % 3 + 1 + s)
    for i in range(1, 7):
        answer(f"wg{i}", "nazk-maturity-wg", lambda j, i=i: (i + j) % 2 + 2 + s)
    for i in range(1, 6):
        answer(f"expert{i}", "nazk-maturity-expert", lambda j, i=i: (i * j) % 3 + 1 + s)
    print("Анкети: особовий склад 20, робоча група 6, експерти 5")

    wg, auditor = login("wg1"), login("auditor")
    items = client.get(f"{api}/campaigns/{campaign_id}/checklist", headers=wg).json()["items"]
    for n, item in enumerate(items):
        status = ["full", "partial", "none"][(n + s) % 3]
        evidence = "Документ (синтетичний)" if n % 2 == 0 else ""
        url = f"{api}/campaigns/{campaign_id}/checklist/{item['question_id']}"
        # Пункт разом із документом: «повністю» й «частково» без файлу не підтверджуються.
        pdf = b"%PDF-1.4\n% synthetic\n%%EOF\n" + str(n).encode()
        files = [("files", (f"doc-{n}.pdf", pdf, "application/pdf"))] if evidence else None
        client.post(f"{url}/submit", data={"status": status, "evidence": evidence}, files=files,
                    headers=wg).raise_for_status()
        if evidence:
            client.post(f"{url}/confirm", headers=auditor).raise_for_status()
    print(f"Чек-лист: заповнено {len(items)}, підтверджено {(len(items) + 1) // 2}")

    progress = client.get(f"{api}/campaigns/{campaign_id}/progress", headers=admin).json()
    for item in progress["items"]:
        shown = f"{item['submitted']} з {item['eligible']}" if not item["too_few_people"] else "замало людей для показу"
        print(f"  Прогрес {item['target_category']}: {shown}")

    client.post(f"{api}/campaigns/{campaign_id}/close", headers=admin).raise_for_status()
    result = client.get(f"{api}/campaigns/{campaign_id}/results", headers=admin).json()

    idx = result["index"]
    print("\n=== Integrity Index ===")
    print(f"{idx['score']} балів · {idx['level']['title']} · достовірність {idx['reliability']} (без фактів: {idx['self_score']})")
    print(idx["rule"])
    for c in result["components"]:
        print(f"\n{c['title']}: S {c['self_score']} · F {c['facts_score']} · L {c['score']} · {c['reliability']}")
        print(f"  {c['self_rule']}")
        print(f"  {c['rule']}")
        for f in c["facts"]:
            print(f"  · {f['label']}")
    print("\nВисновок:")
    for line in result["summary"]:
        print(f"  {line}")
    print(f"\nПовний JSON: GET {api}/campaigns/{campaign_id}/results")


if __name__ == "__main__":
    main()
