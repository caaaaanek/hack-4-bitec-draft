"""Сховище файлів-доказів до пунктів чек-листа.

- Ліміти: розмір файлу (EVIDENCE_MAX_BYTES), кількість файлів на пункт (EVIDENCE_MAX_FILES_PER_ITEM),
  перелік дозволених типів (розширення + сигнатура вмісту, а не Content-Type від браузера).
- Цілісність: sha256 рахується під час читання; файл лежить за своїм хешем
  (EVIDENCE_DIR/ab/abcdef...), тож підміна вмісту на диску видна при завантаженні.
- Однаковий вміст зберігається один раз.
- Ім'я файлу від користувача лише показується; шлях на диску від нього не залежить.
"""

import hashlib
import os
import re
import tempfile
import unicodedata
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.errors import ApiError

CHUNK = 1024 * 1024

# розширення -> (MIME, перевірка сигнатури)
ZIP_MAGIC = (b"PK\x03\x04",)
ALLOWED_TYPES: dict[str, tuple[str, tuple[bytes, ...] | None]] = {
    "pdf": ("application/pdf", (b"%PDF-",)),
    "png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    "jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ZIP_MAGIC),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ZIP_MAGIC),
    "odt": ("application/vnd.oasis.opendocument.text", ZIP_MAGIC),
    "ods": ("application/vnd.oasis.opendocument.spreadsheet", ZIP_MAGIC),
    "txt": ("text/plain; charset=utf-8", None),
    "csv": ("text/csv; charset=utf-8", None),
}


def safe_filename(name: str | None) -> str:
    """Ім'я для показу й Content-Disposition: без шляхів, керівних символів і зайвої довжини."""
    name = unicodedata.normalize("NFC", (name or "").replace("\\", "/").split("/")[-1])
    name = re.sub(r"[\x00-\x1f\x7f\"<>|:*?]", "_", name).strip(" .")
    if not name:
        name = "file"
    stem, dot, ext = name.rpartition(".")
    if dot and len(name) > 200:
        name = stem[: 200 - len(ext) - 1] + "." + ext
    return name[:200]


def extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def storage_root() -> Path:
    return Path(get_settings().evidence_dir)


def path_for(sha256: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("bad sha256")
    return storage_root() / sha256[:2] / sha256


def _looks_like_text(head: bytes) -> bool:
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as e:
        # Обрізаний багатобайтовий символ у кінці фрагмента — не помилка.
        return e.start >= len(head) - 3
    return True


def store(upload: UploadFile) -> tuple[str, str, str, int]:
    """Читає завантаження потоком, перевіряє ліміти й тип. Повертає (ім'я, MIME, sha256, розмір).

    Синхронно (upload.file): викликається із синхронних ендпойнтів, які FastAPI виконує в пулі потоків,
    тож запис на диск і запити до БД не блокують цикл подій.
    """
    settings = get_settings()
    filename = safe_filename(upload.filename)
    ext = extension(filename)
    if ext not in ALLOWED_TYPES:
        raise ApiError(415, f"Тип файлу .{ext or '?'} не дозволено", code="unsupported_type",
                       hint="Дозволено: " + ", ".join(sorted(ALLOWED_TYPES)) + ".")
    mime, magic = ALLOWED_TYPES[ext]

    root = storage_root()
    root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    head = b""
    fd, tmp_name = tempfile.mkstemp(dir=root, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as tmp:
            while chunk := upload.file.read(CHUNK):
                size += len(chunk)
                if size > settings.evidence_max_bytes:
                    raise ApiError(413, "Файл завеликий", code="too_large",
                                   hint=f"Максимум {settings.evidence_max_bytes // (1024 * 1024)} МБ.")
                if len(head) < 4096:
                    head += chunk[: 4096 - len(head)]
                digest.update(chunk)
                tmp.write(chunk)
        if size == 0:
            raise ApiError(422, "Файл порожній", code="empty_file")
        if magic is not None and not any(head.startswith(m) for m in magic):
            raise ApiError(415, f"Вміст файлу не схожий на .{ext}", code="type_mismatch",
                           hint="Перевірте, що файл не пошкоджено і розширення правильне.")
        if magic is None and not _looks_like_text(head):
            raise ApiError(415, "Текстовий файл містить двійкові дані", code="type_mismatch")
        sha = digest.hexdigest()
        final = path_for(sha)
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            os.unlink(tmp_name)
        else:
            os.replace(tmp_name, final)
            os.chmod(final, 0o440)
        return filename, mime, sha, size
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def verify_on_disk(sha256: str) -> bool:
    """Чи збігається вміст на диску з хешем із БД."""
    path = path_for(sha256)
    if not path.exists():
        return False
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest() == sha256
