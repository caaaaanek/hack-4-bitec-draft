"""«Що змінилося для нас»: які пункти чек-листа, питання анкет, заходи типового плану й показники
зачіпає новий наказ чи редакція закону.

Пошук локальний і детермінований (закритий контур, без моделей і зовнішніх сервісів):
1. Документ ділиться на фрагменти (пункти, абзаци).
2. Слова зводяться до основи (перші 6 літер; стоп-слова відкидаються).
3. Кожен фрагмент і кожен елемент бази (чек-лист Додатку Б, анкети Додатку В, заходи Додатку Д,
   показники методики) — вектор TF-IDF; схожість — косинус.
4. Збіг показується, якщо схожість ≥ MIN_SCORE і спільних основ ≥ MIN_SHARED; поруч — спільні слова й
   фрагмент документа, з якого він узявся. Тобто кожен збіг пояснюваний.

Система лише пропонує, що переглянути; чи змінювати пункт, вирішує людина.
"""

import io
import json
import math
import re
from collections import Counter
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChecklistEntry, Questionnaire, QuestionnaireKind, QuestionnaireStatus
from app.services import methodology as m

METHOD_VERSION = "1.0"
STEM = 6
MIN_SCORE = 0.12
MIN_SHARED = 2
MAX_MATCHES = 25
MAX_CHARS = 400_000
CATALOG_FILE = Path(__file__).resolve().parent.parent / "seed" / "data" / "measures_catalog.json"

KIND_TITLES = {"checklist": "Пункт чек-листа (Додаток Б)", "question": "Питання анкети (Додаток В)",
               "measure": "Захід типового плану (Додаток Д)", "fact": "Об'єктивний показник методики"}
ACTIONS = {
    "checklist": "Перегляньте формулювання пункту й доказ: чи відповідає він новій нормі.",
    "question": "Перевірте, чи питання досі актуальне; зміна — нова версія анкети в конструкторі.",
    "measure": "Захід пов'язаний зі зміною: можна додати його в трекер з відповідальним і строком.",
    "fact": "Узгодьте з системою-джерелом, чи не змінюється визначення показника чи порядок обліку.",
}

STOPWORDS = set("""
і й та а але або чи що щоб як який яка яке які якого якої яких яким якими цей ця це ці цього цієї цих того тієї тих
той та те ті він вона воно вони його її їх їм їй йому ним нею ними в у на з із зі до від для при за по про над під
між через без після перед також тому тоді якщо коли де вже ще не ні так же лише тільки бути є був була було були
буде будуть має мають може можуть повинен повинна повинні необхідно потрібно інший інша інше інші інших іншого
своїх свого своєї свій своє свої всіх усіх всі усі кожен кожна кожного кожної щодо згідно відповідно шляхом
зокрема тощо разі випадку випадках частина частини пункт пункту пунктом підпункт стаття статті статтею абзац
року рік роки днів день дня років україни україна закону закон законом наказ наказу наказом положення порядок
порядку забезпечити забезпечення здійснення здійснювати здійснюють визначити визначено визначення
""".split())

# Основи загальних слів документів про заклад: «заклад вищої освіти», «внесення змін», «у тому числі».
STOP_STEMS = {"заклад", "вищої", "внесен", "змін", "зміни", "змінам", "числі", "ввнз", "наказу", "синтет", "приклад",
              "демо"}

WORD = re.compile(r"[a-zа-яіїєґ'’ʼ]+", re.IGNORECASE)


def stems(text: str) -> list[tuple[str, str]]:
    """(основа, слово) для значущих слів тексту."""
    out = []
    for w in WORD.findall(text.lower().replace("’", "'").replace("ʼ", "'")):
        w = w.strip("'")
        if len(w) < 4 or w in STOPWORDS or w[:STEM] in STOP_STEMS:
            continue
        out.append((w[:STEM], w))
    return out


# ---------- База: що з нашої системи може зачепити документ ----------

def latest_published(db: Session, kind: QuestionnaireKind) -> list[Questionnaire]:
    rows = db.scalars(select(Questionnaire).where(Questionnaire.kind == kind,
                                                  Questionnaire.status == QuestionnaireStatus.PUBLISHED)).all()
    best: dict[str, Questionnaire] = {}
    for q in rows:
        if q.code not in best or q.version > best[q.code].version:
            best[q.code] = q
    return sorted(best.values(), key=lambda q: q.code)


def corpus(db: Session) -> list[dict]:
    items: list[dict] = []
    for q in latest_published(db, QuestionnaireKind.CHECKLIST):
        for s in q.sections:
            for question in s.questions:
                number = m.checklist_item_number(question.code)
                items.append({"kind": "checklist", "ref": question.code, "number": number,
                              "title": question.text, "text": f"{s.title} {question.text}",
                              "question_id": str(question.id), "questionnaire": q.title})
    seen: set[str] = set()
    for q in latest_published(db, QuestionnaireKind.SURVEY):
        for s in q.sections:
            for question in s.questions:
                # Спільні питання анкет РГ, ОС і експертів — один елемент; загальна самооцінка не про норми.
                if question.code in seen or question.code.startswith(m.DECLARED_COMPONENT):
                    continue
                seen.add(question.code)
                options = " ".join(o.text for o in question.options)
                items.append({"kind": "question", "ref": question.code, "number": None, "title": question.text,
                              "text": f"{question.text} {options}", "questionnaire": q.title})
    catalog = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    for x in catalog["items"]:
        items.append({"kind": "measure", "ref": x["number"], "number": x["number"], "title": x["title"],
                      "text": f"{x['title']} {x.get('indicator', '')} {x.get('responsible', '')}"})
    for code, spec in m.FACTS.items():
        items.append({"kind": "fact", "ref": code, "number": None, "title": spec["title"],
                      "text": f"{spec['title']} {spec.get('numerator', '')} {spec.get('denominator', '')} "
                              f"{spec.get('rest', '')}"})
    return items


# ---------- Документ ----------

# Захист від «бомб»: 10 МБ стиснутого docx можуть розпакуватися в гігабайти XML, а PDF — мати тисячі сторінок.
MAX_UNPACKED_BYTES = 50 * 1024 * 1024
MAX_PDF_PAGES = 300


def read_document(filename: str, raw: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".docx"):
        import zipfile

        from docx import Document
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNPACKED_BYTES:
                raise ValueError("Документ після розпакування більший за 50 МБ: розділіть його на частини")
        doc = Document(io.BytesIO(raw))
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text for cell in row.cells))
        return "\n\n".join(p for p in parts if p.strip())
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ValueError(f"У PDF понад {MAX_PDF_PAGES} сторінок: завантажте лише потрібний розділ")
        text = ""
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n\n"
            if len(text) > MAX_CHARS:
                break
        return text
    for encoding in ("utf-8-sig", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Не вдалося прочитати текст: підтримуються .txt, .md, .docx, .pdf (UTF-8 або Windows-1251)")


POINT = re.compile(r"\n\s*(?=(?:\d+(?:\.\d+)*[.)]|[-–•])\s)")


def fragments(text: str) -> list[str]:
    """Пункти й абзаци документа; довгі абзаци ріжуться по реченнях приблизно на 700 символів."""
    text = text.replace("\r\n", "\n")
    blocks = []
    for block in re.split(r"\n\s*\n", text):
        blocks += POINT.split("\n" + block)
    out = []
    for b in (" ".join(x.split()) for x in blocks):
        if len(b) < 30:
            continue
        if len(b) <= 900:
            out.append(b)
            continue
        chunk = ""
        for sentence in re.split(r"(?<=[.;:])\s+", b):
            if chunk and len(chunk) + len(sentence) > 700:
                out.append(chunk)
                chunk = ""
            chunk = f"{chunk} {sentence}".strip()
        if chunk:
            out.append(chunk)
    return out


# ---------- Пошук ----------

def vector(tokens: list[str], idf: dict[str, float]) -> dict[str, float]:
    tf = Counter(t for t in tokens if t in idf)
    v = {t: (1 + math.log(c)) * idf[t] for t, c in tf.items()}
    norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {t: x / norm for t, x in v.items()}


def current_statuses(db: Session) -> dict[str, dict]:
    """Стан пунктів чек-листа в останній хвилі, де їх заповнювали."""
    from app.models import Campaign, Question
    rows = db.execute(select(Question.code, ChecklistEntry.status, ChecklistEntry.confirmed_by_id, Campaign.title,
                             Campaign.created_at)
                      .join(ChecklistEntry, ChecklistEntry.question_id == Question.id)
                      .join(Campaign, Campaign.id == ChecklistEntry.campaign_id)
                      .order_by(Campaign.created_at)).all()
    out: dict[str, dict] = {}
    for code, status, confirmed_by, title, _ in rows:
        out[code] = {"status": getattr(status, "value", status), "confirmed": confirmed_by is not None,
                     "campaign_title": title}
    return out


def analyze(db: Session, filename: str, text: str, limit: int = MAX_MATCHES) -> dict:
    text = text[:MAX_CHARS]
    items = corpus(db)
    item_tokens = [[s for s, _ in stems(x["text"])] for x in items]
    df = Counter(t for tokens in item_tokens for t in set(tokens))
    n = len(items)
    idf = {t: math.log((1 + n) / (1 + c)) + 1 for t, c in df.items()}
    item_vectors = [vector(tokens, idf) for tokens in item_tokens]

    frags = fragments(text)
    frag_stems = [stems(f) for f in frags]
    frag_vectors = [vector([s for s, _ in fs], idf) for fs in frag_stems]

    statuses = current_statuses(db)
    matches = []
    for x, iv in zip(items, item_vectors):
        best = None
        for i, fv in enumerate(frag_vectors):
            shared = set(iv) & set(fv)
            if len(shared) < MIN_SHARED:
                continue
            score = sum(iv[t] * fv[t] for t in shared)
            if score >= MIN_SCORE and (best is None or score > best[0]):
                best = (score, i, shared)
        if best is None:
            continue
        score, i, shared = best
        words = {}
        for s, w in frag_stems[i]:
            if s in shared and s not in words:
                words[s] = w
        terms = [words[s] for s in sorted(shared, key=lambda s: -iv[s] * frag_vectors[i][s])][:8]
        match = {"kind": x["kind"], "kind_title": KIND_TITLES[x["kind"]], "ref": x["ref"], "number": x["number"],
                 "title": x["title"], "score": round(score, 3), "matched_terms": terms,
                 "fragment_index": i, "fragment": frags[i][:500], "action": ACTIONS[x["kind"]],
                 "current_status": statuses.get(x["ref"]) if x["kind"] == "checklist" else None}
        matches.append(match)
    matches.sort(key=lambda r: (-r["score"], r["kind"], r["ref"]))
    matches = matches[:limit]

    doc_terms = Counter()
    for fs in frag_stems:
        for s, w in fs:
            if s in idf:
                doc_terms[w] += 1
    return {
        "document": {"name": filename, "chars": len(text), "fragments": len(frags),
                     "top_terms": [w for w, _ in doc_terms.most_common(12)]},
        "matches": matches,
        "by_kind": {k: sum(1 for r in matches if r["kind"] == k) for k in KIND_TITLES},
        "corpus_size": {k: sum(1 for x in items if x["kind"] == k) for k in KIND_TITLES},
        "method": {
            "version": METHOD_VERSION,
            "description": "TF-IDF за основами слів (перші 6 літер, без стоп-слів), косинусна схожість фрагмента "
                           f"документа й елемента бази; поріг {MIN_SCORE}, щонайменше {MIN_SHARED} спільні основи. "
                           "Локально, без моделей; той самий документ дає той самий результат.",
        },
        "note": "Система пропонує, що переглянути. Чи змінювати пункт, анкету чи план — вирішує людина.",
    }
