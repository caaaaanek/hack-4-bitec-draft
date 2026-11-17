/* ---------- Перевірки (Уповноважений): закупівлі, декларації й конфлікти інтересів ----------
 * Контракт: docs/contracts/checks.md. Стан екрана в API.ck2 (не плутати з API.ck, це чек-лист).
 * Дані записів лише в пам'яті (API.ck2.payload): імена й контакти бекенд не зберігає й не повертає.
 */
const CK_MAX = 5000, CK_PAGE = 100;
const CK_KIND = { procurement: "Закупівлі", declarations: "Декларації й конфлікти інтересів" };
const CK_SRC = { file: "Файл", api: "Відкриті API", mock: "Демо-набір", prozorro: "Prozorro", nazk: "НАЗК" };
const CK_RISK = { high: ["Високий", "p-bad"], medium: ["Середній", "p-warn"], low: ["Низький", "p-mute"] };
const CKR_ST = { new: ["Нова", "p-info"], reviewed: ["Розглянуто", "p-good"], dismissed: ["Відхилено", "p-mute"] };
const CK_IND = [["declarations_on_time", "Декларації подано вчасно"], ["coi_reviewed", "Конфлікти інтересів розглянуто"], ["procurement_flags_reviewed", "Підозрілі закупівлі розглянуто"]];
const CK_ENDPOINTS = [
  ["POST /checks/procurement", "Приймає масив закупівель, рахує правила, зберігає знахідки"],
  ["POST /checks/declarations", "Приймає масив декларацій, перевіряє строк і правила конфлікту інтересів"],
  ["GET /checks/runs", "Журнал запусків (unit_id, kind, period)"],
  ["GET /checks/findings", "Знахідки (run_id, kind, status, risk_level)"],
  ["POST /checks/findings/{id}/review", "Статус reviewed, dismissed або new і коментар"],
  ["POST /checks/publish", "Рахує X з Y і записує показники для індексу"],
  ["GET /checks/mock/{kind}", "Синтетичний набір для демо"],
  ["POST /checks/fetch/prozorro", "Вибірка з відкритого API Prozorro (якщо живі запити дозволено)"],
  ["POST /checks/fetch/nazk", "Вибірка зі списку декларацій НАЗК (так само)"],
];
const CK_SAMPLE = { record_id: "UA-2026-10-01-000123-a-L1", procurement_method: "open", procurement_method_type: "aboveThresholdUA", category: "goods", expected_value: 1500000.0, currency: "UAH", cpv: "30190000-7", dates: { created_at: "2026-10-01", tender_start: "2026-10-01", tender_period_days: 7 }, buyer: { edrpou: "00000001", kind: "general" }, bids: [{ bid_id: "b1", amount: 1490000.0, award_status: "active", bidder: { edrpou: "11111111" } }], winner: { edrpou: "11111111", amount: 1490000.0 }, contract: { changes_count: 0 }, complaints_count: 0, beneficiaries: [] };

/* --- Чиста логіка --- */
function ckPeriods(now = new Date()) {
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
}
const ckYear = period => +String(period).slice(0, 4) - 1;
// Масив або {records:[...]} / {items:[...]}; інакше null
function ckItems(x) { return Array.isArray(x) ? x : x && Array.isArray(x.records) ? x.records : x && Array.isArray(x.items) ? x.items : null; }
function ckFilter(list, status, risk) { return (list || []).filter(f => (status === "all" || f.status === status) && (risk === "all" || f.risk_level === risk)); }
// Відповідь publish у вигляді {код: {x, y}}; показник без знаменника пропускаємо
function ckInd(r) {
  const list = Array.isArray(r) ? r : r && Array.isArray(r.indicators) ? r.indicators : r && typeof r === "object" ? Object.entries(r.indicators || r).map(([k, v]) => v && typeof v === "object" ? { indicator: k, ...v } : null).filter(Boolean) : [];
  const out = {};
  for (const i of list) { const code = i.indicator || i.code, x = i.numerator ?? i.x ?? i.value ?? i.reviewed ?? i.on_time, y = i.denominator ?? i.y ?? i.total; if (code && y > 0 && x != null) out[code] = { x, y }; }
  return out;
}
const ckFmt = at => { const d = new Date(at); return isNaN(d) ? "" : d.toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }); };
const ckIsDecl = k => String(k).startsWith("decl");

/* --- Стан --- */
function ckState() {
  const uid = API.user && API.user.id;
  if (!API.ck2 || API.ck2.uid !== uid) API.ck2 = { uid, kind: "procurement", period: ckPeriods()[0], unit: null, source: "file", payload: null, run: null, findings: null, fStatus: "new", fRisk: "all", shown: CK_PAGE, runs: null, pub: null, busy: "", note: "" };
  const C = API.ck2, units = API.adm.units;
  if (!C.unit || !units.some(u => u.id === C.unit)) C.unit = (units.find(u => !u.parent_id) || units[0] || {}).id || null;
  return C;
}
function ckResetData(C) { C.payload = null; C.run = null; C.findings = null; C.pub = null; C.note = ""; C.shown = CK_PAGE; }
function ckLoadRuns(C) {
  if (C.runs !== null || C.loadingRuns || !C.unit) return;
  const unit = C.unit; C.loadingRuns = true;
  api(`/checks/runs?unit_id=${encodeURIComponent(unit)}`).then(r => { if (C.unit === unit) C.runs = (ckItems(r) || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10); }, e => { C.runs = []; apiFail(e); }).finally(() => { C.loadingRuns = false; render(true); });
}
async function ckLoadFindings(C) {
  C.findings = null; C.shown = CK_PAGE; const id = C.run && C.run.run_id; render(true);
  try { const r = await api(`/checks/findings?run_id=${encodeURIComponent(id)}`); if (C.run && C.run.run_id === id) C.findings = ckItems(r) || []; }
  catch (e) { C.findings = []; apiFail(e); }
  render(true);
}

/* --- Розмітка --- */
function ckSource(C) {
  const decl = C.kind === "declarations", p = C.payload, busy = C.busy;
  const body = C.source === "file" ? `<div class="ck-drop" id="ck-drop"><span class="lbl">Перетягніть сюди файл JSON або</span><button type="button" class="btn btn-soft" data-a="ck-pick">${IC.file}Обрати файл</button><input type="file" id="ck-file" data-ck="file" accept=".json,application/json" hidden></div>
      <span class="lbl">Підійде масив записів або об'єкт {"records": [...]}, {"items": [...]}. Не більше ${CK_MAX} записів.</span>`
    : C.source === "mock" ? `<div class="ck-act"><button type="button" class="btn btn-soft" data-a="ck-mock" ${busy ? "disabled" : ""}>${IC.spark}${busy === "mock" ? "Генеруємо…" : "Згенерувати"}</button><span class="lbl">Синтетичні записи для демо. Для того самого підрозділу й періоду набір однаковий.</span></div>`
    : `<div class="ck-act"><button type="button" class="btn btn-soft" data-a="ck-fetch" ${busy ? "disabled" : ""}>${IC.download}${busy === "fetch" ? "Отримуємо…" : decl ? "Отримати з НАЗК" : "Отримати з Prozorro"}</button><span class="lbl">До 20 записів із відкритого реєстру.</span></div>
      ${C.note ? `<div class="note-box"><span>${esc(C.note)}</span></div>` : ""}`;
  return `<section class="card c12 rise"><div class="card-h"><h2>Джерело даних</h2></div>
    <div class="seg" role="group" aria-label="Джерело даних">${["file", "mock", "api"].map(s => `<button type="button" class="${C.source === s ? "on" : ""}" data-a="ck-src" data-v="${s}">${s === "file" ? "Файл JSON" : s === "mock" ? "Демо-набір" : "Відкриті API"}</button>`).join("")}</div>
    <div class="ck-body">${body}</div>
    <div class="ck-act ck-run"><button type="button" class="btn btn-primary" data-a="ck-run" ${!p || busy ? "disabled" : ""}>${IC.ok}${busy === "run" ? "Перевіряємо…" : "Запустити перевірку"}</button>
      <span class="lbl tnum">${p ? `${p.items.length} записів завантажено` : "Дані ще не завантажено"}</span></div></section>`;
}
function ckTiles(C) {
  const r = C.run; if (!r) return "";
  const tile = (l, v, cls = "") => `<div class="ck-tile ${cls}"><span class="lbl">${l}</span><b class="tnum">${v}</b></div>`, br = r.by_risk || {}, ex = r.extra || {};
  return `<section class="card c12 rise"><div class="card-h"><h2>Підсумок запуску</h2><div class="sp"></div><span class="lbl">${esc(CK_KIND[ckIsDecl(r.kind) ? "declarations" : "procurement"])}, ${esc(r.period)}</span></div>
    <div class="ck-tiles">${tile("Усього записів", r.total ?? 0)}${tile("Позначено", r.flagged ?? 0)}${tile("Високий ризик", br.high ?? 0, "hi")}${tile("Середній ризик", br.medium ?? 0, "md")}${tile("Низький ризик", br.low ?? 0)}
    ${ckIsDecl(r.kind) ? tile("Вчасно", ex.on_time ?? 0) + tile("Із запізненням", ex.late ?? 0) + tile("Не оцінено", ex.unknown ?? 0) : ""}</div></section>`;
}
function ckFindingRow(f) {
  const rk = CK_RISK[f.risk_level] || [f.risk_level, "p-mute"], st = CKR_ST[f.status] || [f.status, "p-mute"];
  const flags = (f.flags || []).map(x => { const sv = CK_RISK[x.severity] || [x.severity, "p-mute"]; return `<li><div class="ck-fl"><span>${esc(x.title || x.rule_id)}</span>${pill(esc(sv[0]), sv[1] + " nodot")}</div>${(x.law_refs || []).length ? `<div class="ck-law">${esc(x.law_refs.join("; "))}</div>` : ""}</li>`; }).join("");
  return `<div class="ck-f"><div class="ck-fm"><div class="ck-fh"><code class="ck-ref">${esc(f.record_ref)}</code>${pill(esc(rk[0]), rk[1])}${f.status === "new" ? "" : pill(esc(st[0]), st[1] + " nodot")}</div>
    <ul class="ck-flags">${flags}</ul>${f.comment ? `<div class="lbl">Коментар: ${esc(f.comment)}</div>` : ""}</div>
    <div class="ck-btns">${f.status !== "reviewed" ? `<button type="button" class="btn btn-soft" data-a="ck-rev" data-id="${esc(f.id)}">Розглянуто</button>` : ""}${f.status !== "dismissed" ? `<button type="button" class="btn btn-ghost" data-a="ck-dis" data-id="${esc(f.id)}">Відхилити</button>` : ""}${f.status !== "new" ? `<button type="button" class="btn btn-ghost" data-a="ck-back" data-id="${esc(f.id)}">Повернути</button>` : ""}</div></div>`;
}
function ckFindings(C) {
  if (!C.run) return "";
  const head = `<div class="card-h"><h2>Знахідки</h2></div>`;
  if (C.findings === null) return `<section class="card c12 rise">${head}<div class="empty">Завантажуємо знахідки…</div></section>`;
  const list = ckFilter(C.findings, C.fStatus, C.fRisk), shown = list.slice(0, C.shown);
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`;
  return `<section class="card c12 rise">${head}
    <div class="toolbar ck-tb"><select class="inp" aria-label="Статус" data-ck="fstatus">${opt("new", "Нові", C.fStatus)}${opt("reviewed", "Розглянуті", C.fStatus)}${opt("dismissed", "Відхилені", C.fStatus)}${opt("all", "Усі", C.fStatus)}</select>
      <select class="inp" aria-label="Ризик" data-ck="frisk">${opt("all", "Будь-який ризик", C.fRisk)}${opt("high", "Високий", C.fRisk)}${opt("medium", "Середній", C.fRisk)}${opt("low", "Низький", C.fRisk)}</select>
      <span class="lbl tnum">Показано ${shown.length} з ${list.length}</span></div>
    ${shown.length ? `<div class="ck-list">${shown.map(ckFindingRow).join("")}</div>` : `<div class="empty">Знахідок за цими фільтрами немає.</div>`}
    ${list.length > shown.length ? `<div style="margin-top:12px"><button type="button" class="btn btn-soft" data-a="ck-more">Показати ще</button></div>` : ""}
    <div class="lbl" style="margin-top:10px">Знахідка це сигнал «варто перевірити», а не висновок про порушення.</div></section>`;
}
function ckPublish(C) {
  const p = C.pub;
  return `<section class="card c12 rise"><div class="card-h" style="flex-wrap:wrap"><h2>Показники для індексу</h2><div class="sp"></div><button type="button" class="btn btn-soft" data-a="ck-pub" ${C.busy ? "disabled" : ""}>${IC.up}${C.busy === "pub" ? "Публікуємо…" : "Опублікувати показники"}</button></div>
    ${p ? `<div class="ck-tiles">${CK_IND.map(([k, n]) => `<div class="ck-tile"><span class="lbl">${n}</span><b class="tnum">${p[k] ? `${p[k].x} з ${p[k].y}` : `<span class="ck-none">немає даних</span>`}</b></div>`).join("")}</div>` : ""}
    <div class="lbl" style="margin-top:10px">Показники потрапляють в індекс після закриття хвилі.</div></section>`;
}
function ckRuns(C) {
  const rows = C.runs;
  return `<section class="card c12 rise"><div class="card-h"><h2>Історія запусків</h2></div>
    ${rows === null ? `<div class="lbl">Завантажуємо…</div>` : !rows.length ? `<div class="empty">Запусків для цього підрозділу ще не було.</div>`
    : `<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Вид</th><th>Період</th><th>Джерело</th><th class="tnum">Записів</th><th class="tnum">Позначено</th></tr></thead><tbody>${rows.map(r => `<tr class="ck-rr" tabindex="0" data-a="ck-open" data-id="${esc(r.run_id)}"><td>${esc(ckFmt(r.created_at))}</td><td>${esc(CK_KIND[ckIsDecl(r.kind) ? "declarations" : "procurement"])}</td><td class="tnum">${esc(r.period)}</td><td>${esc(CK_SRC[r.source] || r.source)}</td><td class="tnum">${r.total ?? ""}</td><td class="tnum">${r.flagged ?? ""}</td></tr>`).join("")}</tbody></table></div>`}</section>`;
}
function apiChecksView() {
  if (!apiEnsure("adm", () => apiLoadAdm())) return apiLoadingHTML("Перевірки");
  if (API.adm.error) return apiErrorHTML(API.adm.error);
  const C = ckState(); ckLoadRuns(C);
  return `<section class="card c12 rise"><div class="ck-head">
      <div class="field ck-u"><label for="ck-u">Підрозділ</label>${unitCombo("ck-u", API.adm.units, C.unit, false)}</div>
      <div class="field"><label for="ck-p">Період</label><select class="inp" id="ck-p" data-ck="period">${ckPeriods().map(p => `<option value="${p}" ${p === C.period ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label>Що перевіряємо</label><div class="seg" role="group" aria-label="Вид перевірки">${Object.entries(CK_KIND).map(([k, n]) => `<button type="button" class="${C.kind === k ? "on" : ""}" data-a="ck-kind" data-v="${k}">${n}</button>`).join("")}</div></div>
      <button type="button" class="btn btn-ghost ck-ct" data-a="ck-contract">${IC.info}Контракт для інтеграції</button></div></section>
    ${ckSource(C)}${ckTiles(C)}${ckFindings(C)}${ckPublish(C)}${ckRuns(C)}`;
}

/* --- Дії --- */
function ckLoadFile(file) {
  const C = API.ck2; if (!file) return;
  const fr = new FileReader();
  fr.onerror = () => toast("Не вдалося прочитати файл");
  fr.onload = () => {
    let items; try { items = ckItems(JSON.parse(fr.result)); } catch (e) { return toast("Файл не схожий на JSON"); }
    if (!items) return toast("Очікується масив записів або об'єкт з полем records чи items");
    if (!items.length) return toast("У файлі немає записів");
    if (items.length > CK_MAX) return toast(`Забагато записів: максимум ${CK_MAX}`);
    C.payload = { items, source: "file" }; C.note = ""; render(true);
  };
  fr.readAsText(file);
}
async function ckGet(C, kind, act) {
  C.busy = act; C.note = ""; render(true);
  try {
    const r = act === "mock" ? await api(`/checks/mock/${kind}?unit_id=${encodeURIComponent(C.unit)}&period=${C.period}`)
      : await api(`/checks/fetch/${kind === "declarations" ? "nazk" : "prozorro"}`, { method: "POST", body: { unit_id: C.unit, period: C.period, limit: 20 } });
    // Prozorro: бекенд одразу запускає перевірку й повертає підсумок (назви й контакти учасників у відповідь не потрапляють)
    if (r && r.run_id) { C.run = r; C.runs = null; C.pub = null; C.busy = ""; toast(`Отримано й перевірено: позначено ${r.flagged} із ${r.total}`); await ckLoadFindings(C); return; }
    const items = ckItems(r);
    if (!items || !items.length) C.note = "Записів не знайдено";
    else C.payload = { items, source: act === "mock" ? "mock" : kind === "declarations" ? "nazk" : "prozorro" };
  } catch (e) { if (e.status === 409) C.note = "Живі запити вимкнено: закритий контур"; else apiFail(e); }
  C.busy = ""; render(true);
}
async function ckRun(C) {
  const decl = C.kind === "declarations", p = C.payload; if (!p) return;
  C.busy = "run"; render(true);
  try {
    const body = decl ? { unit_id: C.unit, period: C.period, source: p.source, items: p.items, year: ckYear(C.period) } : { unit_id: C.unit, period: C.period, source: p.source, records: p.items };
    C.run = await api(decl ? "/checks/declarations" : "/checks/procurement", { method: "POST", body }); C.runs = null; C.pub = null;
    toast(`Перевірку завершено: позначено ${C.run.flagged} із ${C.run.total}`);
    C.busy = ""; await ckLoadFindings(C);
  } catch (e) { C.busy = ""; apiFail(e); render(true); }
}
async function ckReview(id, status, comment) {
  const C = API.ck2;
  try {
    const f = await api(`/checks/findings/${id}/review`, { method: "POST", body: { status, comment: comment || "" } });
    const i = C.findings.findIndex(x => x.id === id);
    if (i >= 0) C.findings[i] = { ...C.findings[i], status, comment: comment || "", ...(f && typeof f === "object" ? f : {}) };
    C.pub = null; render(true);
  } catch (e) { apiFail(e); }
}
function ckDismiss(id) {
  openDrawer("Відхилити знахідку", `<div class="field"><label for="ck-cm">Коментар</label><textarea class="inp" id="ck-cm" rows="4" placeholder="Чому знахідку відхилено"></textarea><span class="lbl">Коментар обов'язковий. Не вказуйте імена й контакти людей.</span></div>
    <span class="lbl" id="ck-cerr" style="color:var(--red)"></span><button class="btn btn-primary" id="ck-cok" style="justify-content:center">Відхилити</button>`, b => {
    b.querySelector("#ck-cok").onclick = () => { const c = b.querySelector("#ck-cm").value.trim(); if (!c) return void (b.querySelector("#ck-cerr").textContent = "Вкажіть коментар."); closeDrawer(); ckReview(id, "dismissed", c); };
  });
}
async function ckPublishAct(C) {
  C.busy = "pub"; render(true);
  try { C.pub = ckInd(await api("/checks/publish", { method: "POST", body: { unit_id: C.unit, period: C.period } })); toast("Показники опубліковано"); }
  catch (e) { apiFail(e); }
  C.busy = ""; render(true);
}
function ckContract() {
  const curl = `curl -X POST "${location.origin}/api/v1/checks/procurement" \\\n  -H "X-Integration-Key: <ключ джерела checks>" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ unit_id: "<uuid підрозділу>", period: ckPeriods()[0], source: "api", records: [CK_SAMPLE] })}'`;
  const sample = JSON.stringify(CK_SAMPLE, null, 2);
  openDrawer("Контракт для інтеграції", `
    <div class="note-box"><span class="lbl">Зовнішня система надсилає записи на ці ендпоінти із заголовком X-Integration-Key. Усі шляхи під /api/v1. Для декларацій замість records передається items і year.</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Ендпоінт</th><th>Що робить</th></tr></thead><tbody>${CK_ENDPOINTS.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${esc(b)}</td></tr>`).join("")}</tbody></table></div>
    <div class="field"><label>Приклад запиту</label><pre class="ck-pre">${esc(curl)}</pre></div>
    <div class="field"><label>Приклад запису закупівлі</label><pre class="ck-pre">${esc(sample)}</pre></div>
    <div class="note-box"><span class="lbl">Приватність: імена, телефони, пошту й адреси учасників не зберігаємо й не повертаємо. Їх можна не передавати: правила працюють і без них.</span></div>
    <button class="btn btn-primary" id="ck-copy" style="justify-content:center">${IC.copy}Копіювати приклад</button>`, b => {
    b.querySelector("#ck-copy").onclick = () => { const t = curl + "\n\n" + sample, ok = () => toast("Приклад скопійовано"); try { navigator.clipboard.writeText(t).then(ok, () => fallbackCopy(t, ok)); } catch (e) { fallbackCopy(t, ok); } };
  });
}

/* --- Події (делеговані на документ, бо екран перемальовується) --- */
document.addEventListener("click", e => {
  const b = e.target.closest("#view [data-a^='ck-']"), C = API.ck2; if (!b || !C) return;
  const a = b.dataset.a, v = b.dataset.v, id = b.dataset.id;
  if (a === "ck-kind") { if (C.kind !== v) { C.kind = v; ckResetData(C); render(true); } return; }
  if (a === "ck-src") { if (C.source !== v) { C.source = v; C.payload = null; C.note = ""; render(true); } return; }
  if (a === "ck-pick") return void $("#ck-file").click();
  if (a === "ck-mock" || a === "ck-fetch") return void ckGet(C, C.kind, a === "ck-mock" ? "mock" : "fetch");
  if (a === "ck-run") return void ckRun(C);
  if (a === "ck-more") { C.shown += CK_PAGE; return void render(true); }
  if (a === "ck-rev") return void ckReview(id, "reviewed", "");
  if (a === "ck-back") return void ckReview(id, "new", "");
  if (a === "ck-dis") return void ckDismiss(id);
  if (a === "ck-pub") return void ckPublishAct(C);
  if (a === "ck-contract") return void ckContract();
  if (a === "ck-open") { const r = (C.runs || []).find(x => x.run_id === id); if (r) { C.run = r; C.pub = null; C.kind = ckIsDecl(r.kind) ? "declarations" : "procurement"; C.period = r.period; ckLoadFindings(C); } }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches && e.target.matches("#view tr.ck-rr")) e.target.click(); });
document.addEventListener("change", e => {
  const t = e.target, C = API.ck2, k = t.dataset && t.dataset.ck; if (!k || !C) return;
  if (k === "file") { ckLoadFile(t.files[0]); t.value = ""; }
  else if (k === "period") { C.period = t.value; ckResetData(C); render(true); }
  else if (k === "fstatus") { C.fStatus = t.value; C.shown = CK_PAGE; render(true); }
  else if (k === "frisk") { C.fRisk = t.value; C.shown = CK_PAGE; render(true); }
});
// Вибір підрозділу в combo не має власної події: читаємо dataset.val після кліку або Enter
function ckUnitSync() {
  const C = API.ck2, box = document.getElementById("ck-u"); if (!C || !box || !box.dataset.val || box.dataset.val === C.unit) return;
  C.unit = box.dataset.val; ckResetData(C); C.runs = null; render(true);
}
document.addEventListener("mousedown", e => { if (e.target.closest && e.target.closest("#ck-u li")) setTimeout(ckUnitSync, 0); });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest && e.target.closest("#ck-u")) setTimeout(ckUnitSync, 0); });
document.addEventListener("dragover", e => { const d = e.target.closest && e.target.closest("#ck-drop"); if (d) { e.preventDefault(); d.classList.add("on"); } });
document.addEventListener("dragleave", e => { const d = e.target.closest && e.target.closest("#ck-drop"); if (d) d.classList.remove("on"); });
document.addEventListener("drop", e => { const d = e.target.closest && e.target.closest("#ck-drop"); if (d) { e.preventDefault(); d.classList.remove("on"); ckLoadFile(e.dataTransfer.files[0]); } });

V.checks = () => `<section class="card c12 rise"><div class="empty"><b>Перевірки доступні лише в режимі з бекендом</b></div></section>`;
