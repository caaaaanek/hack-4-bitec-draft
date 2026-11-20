"""«Що змінилося для нас»: аналіз нового наказу чи редакції закону (services/normative.py)."""

import hashlib

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.audit import log_action
from app.db import get_db
from app.errors import ApiError
from app.models import Role, User
from app.security import require_roles
from app.services import normative

router = APIRouter(prefix="/normative", tags=["normative"])
readers = require_roles(Role.ADMIN, Role.DEPARTMENT, Role.LEADER, Role.AUDITOR)
MAX_BYTES = 10 * 1024 * 1024


class Match(BaseModel):
    kind: str = Field(description="checklist | question | measure | fact")
    kind_title: str
    ref: str
    number: str | None
    title: str
    score: float = Field(description="Косинусна схожість 0–1")
    matched_terms: list[str] = Field(description="Спільні слова документа й елемента — чому збіг")
    fragment_index: int
    fragment: str = Field(description="Фрагмент документа, з яким знайдено збіг")
    action: str
    current_status: dict | None = Field(default=None, description="Для пункту чек-листа: стан в останній хвилі")


class DocumentInfo(BaseModel):
    name: str
    chars: int
    fragments: int
    top_terms: list[str]


class AnalyzeOut(BaseModel):
    document: DocumentInfo
    matches: list[Match]
    by_kind: dict[str, int]
    corpus_size: dict[str, int]
    method: dict
    note: str


@router.post("/analyze", response_model=AnalyzeOut)
def analyze(
    file: UploadFile | None = File(default=None, description=".txt, .md, .docx або .pdf"),
    text: str | None = Form(default=None, description="Або сам текст документа"),
    title: str | None = Form(default=None, max_length=200),
    db: Session = Depends(get_db),
    user: User = Depends(readers),
):
    """Які пункти чек-листа, питання анкет, заходи Додатку Д і показники зачіпає документ.

    Документ не зберігається; у журнал дій потрапляють лише назва, розмір і хеш.
    """
    # Навмисно не async: FastAPI виконує обробник у пулі потоків. Розбір PDF/DOCX і TF-IDF — секунди CPU,
    # в async-обробнику вони зупиняли б цикл подій, тобто весь API для всіх користувачів.
    if file is None and not (text and text.strip()):
        raise ApiError(422, "Додайте файл або текст документа", code="validation_error")
    if file is not None:
        raw = file.file.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ApiError(413, "Файл більший за 10 МБ", code="too_large")
        name = title or file.filename or "документ"
        try:
            content = normative.read_document(file.filename or "", raw)
        except ValueError as e:
            raise ApiError(422, str(e), code="validation_error")
        except Exception:  # noqa: BLE001 — пошкоджений docx/pdf
            raise ApiError(422, "Не вдалося прочитати файл", code="validation_error",
                           hint="Збережіть документ як .docx або .txt і спробуйте ще раз.")
    else:
        raw = text.encode()
        name, content = title or "текст", text
    if len(content.strip()) < 30:
        raise ApiError(422, "У документі замало тексту для аналізу", code="validation_error")
    result = normative.analyze(db, name, content)
    log_action(db, user, "analyze", "normative", None,
               {"name": name[:200], "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                "matches": len(result["matches"])})
    db.commit()
    return result
