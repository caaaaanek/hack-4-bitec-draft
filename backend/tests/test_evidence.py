"""Б4: файли-докази до пунктів чек-листа — sha256, ліміти, типи, журнал, цілісність."""

import hashlib
import os

from app.services import evidence as storage
from tests.conftest import auth
from tests.helpers import API, close, open_campaign

PDF = b"%PDF-1.4\n% synthetic evidence\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def setup_item(client):
    campaign_id, _, admin = open_campaign(client, ("nazk-checklist",))
    wg = auth(client, "wg1")
    item = client.get(f"{API}/campaigns/{campaign_id}/checklist", headers=wg).json()["items"][0]
    base = f"{API}/campaigns/{campaign_id}/checklist/{item['question_id']}"
    return campaign_id, base, wg, admin


def upload(client, base, headers, name="nakaz.pdf", content=PDF, mime="application/pdf"):
    return client.post(f"{base}/files", files={"file": (name, content, mime)}, headers=headers)


def test_upload_list_download_with_sha256(client):
    _, base, wg, admin = setup_item(client)
    r = upload(client, base, wg, name="../../Наказ №1.pdf")
    assert r.status_code == 201, r.text
    meta = r.json()
    assert meta["sha256"] == hashlib.sha256(PDF).hexdigest() and meta["size"] == len(PDF)
    assert meta["filename"] == "Наказ №1.pdf" and meta["content_type"] == "application/pdf"

    files = client.get(f"{base}/files", headers=auth(client, "auditor")).json()
    assert [f["id"] for f in files] == [meta["id"]]

    d = client.get(f"{base}/files/{meta['id']}", headers=auth(client, "commissioner"))
    assert d.status_code == 200 and d.content == PDF
    assert d.headers["x-content-sha256"] == meta["sha256"]
    assert d.headers["x-content-type-options"] == "nosniff"
    assert d.headers["content-disposition"].startswith("attachment;")
    assert "filename*=UTF-8''" in d.headers["content-disposition"]

    # Відповідь хвилі показує файли в пункті.
    item = next(i for i in client.get(base.rsplit("/", 1)[0], headers=wg).json()["items"] if i["files"])
    assert item["files"][0]["sha256"] == meta["sha256"]

    log = client.get(f"{API}/admin/audit-log", params={"entity": "evidence_file"}, headers=admin).json()
    actions = {e["action"]: e["details"] for e in log}
    assert actions["upload"]["sha256"] == meta["sha256"] and "download" in actions


def test_rejects_bad_types_and_sizes(client):
    _, base, wg, _ = setup_item(client)
    r = upload(client, base, wg, name="virus.exe", content=b"MZ\x90\x00", mime="application/octet-stream")
    assert r.status_code == 415 and r.json()["code"] == "unsupported_type"
    r = upload(client, base, wg, name="fake.pdf", content=b"<html><script>alert(1)</script>", mime="application/pdf")
    assert r.status_code == 415 and r.json()["code"] == "type_mismatch"
    r = upload(client, base, wg, name="notes.txt", content=b"\x00\x01binary", mime="text/plain")
    assert r.status_code == 415
    r = upload(client, base, wg, name="empty.pdf", content=b"", mime="application/pdf")
    assert r.status_code == 422 and r.json()["code"] == "empty_file"
    big = b"%PDF-" + b"0" * (64 * 1024)  # EVIDENCE_MAX_BYTES у тестах = 64 КБ
    r = upload(client, base, wg, name="big.pdf", content=big)
    assert r.status_code == 413 and r.json()["code"] == "too_large"
    # Тимчасові файли за собою не лишаємо.
    assert not [p for p in os.listdir(storage.storage_root()) if p.startswith(".upload-")]


def test_file_count_limit(client):
    _, base, wg, _ = setup_item(client)
    for i in range(3):  # EVIDENCE_MAX_FILES_PER_ITEM у тестах = 3
        assert upload(client, base, wg, name=f"d{i}.png", content=PNG + bytes([i]), mime="image/png").status_code == 201
    r = upload(client, base, wg, name="d4.png", content=PNG, mime="image/png")
    assert r.status_code == 409 and r.json()["code"] == "too_many_files"


def test_only_working_group_uploads_and_only_while_open(client):
    campaign_id, base, wg, admin = setup_item(client)
    assert upload(client, base, auth(client, "commissioner")).status_code == 403
    assert upload(client, base, auth(client, "staff01")).status_code == 403
    assert client.get(f"{base}/files", headers=auth(client, "staff01")).status_code == 403
    close(client, campaign_id, admin)
    r = upload(client, base, wg)
    assert r.status_code == 409


def test_file_counts_as_evidence_and_changes_reset_confirmation(client):
    _, base, wg, _ = setup_item(client)
    commissioner = auth(client, "commissioner")
    assert client.put(base, json={"status": "full"}, headers=wg).status_code == 200
    assert client.post(f"{base}/confirm", headers=commissioner).status_code == 422  # ні тексту, ні файлу
    file_id = upload(client, base, wg).json()["id"]
    r = client.post(f"{base}/confirm", headers=commissioner)
    assert r.status_code == 200 and r.json()["confirmed"]

    # Новий файл знімає підтвердження: підтверджується конкретний набір доказів.
    upload(client, base, wg, name="dodatok.png", content=PNG, mime="image/png")
    assert client.get(base.rsplit("/", 1)[0], headers=wg).json()["confirmed"] == 0
    assert client.post(f"{base}/confirm", headers=commissioner).status_code == 200

    # Видалення теж знімає підтвердження; файл зникає зі списку, але лишається в журналі.
    assert client.delete(f"{base}/files/{file_id}", headers=wg).status_code == 204
    assert client.get(base.rsplit("/", 1)[0], headers=wg).json()["confirmed"] == 0
    assert [f["id"] for f in client.get(f"{base}/files", headers=wg).json()] != [file_id]
    assert client.get(f"{base}/files/{file_id}", headers=wg).status_code == 404
    admin = auth(client, "admin")
    log = client.get(f"{API}/admin/audit-log", params={"entity": "evidence_file", "action": "delete"}, headers=admin).json()
    assert log[0]["entity_id"] == file_id and log[0]["details"]["unconfirmed"] is True


def test_tampered_file_is_detected(client):
    _, base, wg, admin = setup_item(client)
    meta = upload(client, base, wg).json()
    path = storage.path_for(meta["sha256"])
    os.chmod(path, 0o640)
    path.write_bytes(PDF + b"tampered")
    r = client.get(f"{base}/files/{meta['id']}", headers=wg)
    assert r.status_code == 409 and r.json()["code"] == "evidence_tampered"
    log = client.get(f"{API}/admin/audit-log", params={"action": "integrity_fail"}, headers=admin).json()
    assert log and log[0]["details"]["sha256"] == meta["sha256"]
    path.write_bytes(PDF)  # той самий вміст може знадобитися іншим тестам


def test_same_content_stored_once(client):
    _, base, wg, _ = setup_item(client)
    a = upload(client, base, wg, name="a.pdf").json()
    b = upload(client, base, wg, name="b.pdf").json()
    assert a["sha256"] == b["sha256"] and a["id"] != b["id"]
    assert storage.path_for(a["sha256"]).exists()


def test_safe_filename():
    assert storage.safe_filename("..\\..\\etc/passwd") == "passwd"
    assert storage.safe_filename('a"b<c>.pdf') == "a_b_c_.pdf"
    assert storage.safe_filename("") == "file"
    assert storage.safe_filename("x" * 300 + ".pdf").endswith(".pdf")
