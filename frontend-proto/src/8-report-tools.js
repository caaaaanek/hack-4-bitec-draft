/* ---------- Звіт: шаблони, масштаб, режим редагування, ШІ за виділеним фрагментом ----------
 * Шаблони рендеряться з тих самих даних, що й Додаток Г (cur(), buildRecs(), measures()); нових розрахунків немає.
 * Масштаб: повзунок, кнопки −/+, Ctrl/⌘ + коліщатко або щипок на тачпаді й сенсорному екрані.
 * Редагування: документ стає contenteditable, правки зберігаються в браузері окремо для закладу, циклу й шаблону.
 * ШІ: виділіть текст → «Запитати ШІ» → POST /api/assistant/edit. Модель або пропонує заміну (людина приймає її),
 * або відповідає. Документ на сервері не змінюється; числа, яких немає у звіті, позначаються попередженням.
 */
const RT_TPL = {
  appendix_g: ["Звіт за Додатком Г", "Повний звіт про результати опитувань за формою Додатку Г Рекомендацій НУОУ."],
  brief: ["Довідка керівнику", "Одна-дві сторінки: індекс, компоненти, що знизило оцінку, рішення, які треба ухвалити."],
  measures: ["Стан виконання Плану заходів", "Заходи: відповідальні, строки, прострочення, перевірка наступним оцінюванням."],
  dynamics: ["Динаміка між циклами", "Індекс і компоненти за циклами, що змінилося порівняно з попереднім циклом."],
};
const RT_ZOOM = [50, 200];
const rtLs = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
const RT = { tpl: RT_TPL[rtLs("ii-rt-tpl")] ? rtLs("ii-rt-tpl") : "appendix_g", zoom: +rtLs("ii-rt-zoom") || 100, edit: false, range: null, busy: false, last: null };
const rtKey = () => `ii-rt-edit:${cur().id}:${CYCLE}:${RT.tpl}`;
const rtCanAi = () => S.aiOn && AI_ROLES.includes(S.role);

/* --- Шаблони --- */
const rtHead = (m, title, sub) => `
    <div class="doc-approve">ЗАТВЕРДЖУЮ<br>Голова робочої групи<br><span class="doc-blank">військове звання</span><br><span class="doc-blank">Імʼя ПРІЗВИЩЕ</span><br>«___» ____________ 2026 року</div>
    <h2 class="doc-title">${title}</h2>
    <p class="doc-sub">${sub}<br>${esc(m.name)}</p>
    <p class="doc-meta">Цикл оцінювання ${CYCLE}. Дані станом на ${TODAY_UA}.${API.on ? "" : " Синтетичні дані для демонстрації."}</p>`;
const rtFoot = `
    <p class="doc-note">Усі бали, рівні й перевірки розраховано явними правилами методики. Окремих відповідей, імен і порівнянь підрозділів у документі немає.</p>
    <div class="doc-sign"><span>Підготував</span><span class="doc-blank">підпис</span><span class="doc-blank">Імʼя ПРІЗВИЩЕ</span></div>`;
const rtLv = v => `${level(v)}. ${LEVELS[level(v) - 1]}`;
const rtDelta = d => d > 0 ? `+${fb(d)}` : d < 0 ? `−${fb(-d)}` : "0";

function reportBrief(m) {
  const recs = m.id === ALPHA ? buildRecs(m) : [], ms = m.id === ALPHA ? measures() : [];
  const pending = recs.filter(r => r.st === "proposed" || r.st === "clarified");
  const weak = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
  const overdue = ms.filter(x => dispSt(x) === "overdue"), done = ms.filter(x => ["done", "confirmed"].includes(x.st));
  return `<article class="paper doc rise">${rtHead(m, "ДОВІДКА", "про поточний рівень зрілості доброчесності (для керівника закладу)")}
    <h3>1. Головне</h3>
    <p>Індекс доброчесності <b>${f1(m.index)} з 100</b>, рівень зрілості ${m.level} «${LEVELS[m.level - 1]}». ${m.delta > 0 ? `Це на ${pts(m.delta)} вище` : m.delta < 0 ? `Це на ${pts(m.delta)} нижче` : "Без змін"} порівняно з попереднім циклом. Достовірність ${m.trust === "insufficient" ? "не оцінюється" : m.trust}: ${TRUST[m.trust][1].toLowerCase()}.</p>
    <p class="doc-cap">Таблиця 1. Компоненти індексу</p>
    <table class="doc-t"><thead><tr><th>Компонент</th><th>Сприйняття</th><th>Факти</th><th>Зараховано</th><th>Рівень</th></tr></thead><tbody>
    ${m.components.map(c => `<tr><td>${COMP[c.id].n}</td><td class="tnum">${fb(c.P)}</td><td class="tnum">${fb(c.F)}</td><td class="tnum">${fb(c.cr.v)}</td><td>${rtLv(c.cr.v)}</td></tr>`).join("")}</tbody></table>
    <h3>2. Що знизило оцінку</h3>
    <ol>${[...m.components.filter(c => c.cr.lim).map(c => `<li>${COMP[c.id].n}: ${esc(c.cr.reason)}</li>`), ...m.raised.filter(f => !(f.id === "tf-gap" && m.limited)).map(f => `<li>${esc(f.t)} (${f.w === "major" ? "серйозна" : "незначна"} перевірка).</li>`), ...weak.map(x => `<li>${esc(x.t)}: ${fb(x.v)} з 100.</li>`)].slice(0, 6).join("")}</ol>
    <h3>3. Потрібне рішення керівника</h3>
    ${pending.length ? `<p class="doc-cap">Таблиця 2. Рекомендації без рішення</p><table class="doc-t"><thead><tr><th>№</th><th>Рекомендація</th><th>Компонент</th><th>Пріоритет</th></tr></thead><tbody>${pending.slice(0, 6).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.t)}</td><td>${COMP[r.c].n}</td><td>${PRI[r.pri][0]}</td></tr>`).join("")}</tbody></table>${pending.length > 6 ? `<p>Ще ${pending.length - 6} рекомендацій нижчого пріоритету — на екрані «Рекомендації».</p>` : ""}` : "<p>Усі рекомендації вже мають рішення.</p>"}
    ${ms.length ? `<h3>4. План заходів</h3><p>Виконано ${done.length} з ${ms.length} заходів, прострочено ${overdue.length}.${overdue.length ? ` Прострочені: ${overdue.map(x => `«${esc(x.t)}» (${esc(x.who)})`).join("; ")}.` : ""}</p>` : ""}
    ${rtFoot}</article>`;
}

function reportMeasures(m) {
  const ms = m.id === ALPHA ? measures() : [];
  if (!ms.length) return `<article class="paper doc rise">${rtHead(m, "ЗВІТ", "про стан виконання Плану заходів")}<p>Заходів для цього закладу ще не заплановано.</p>${rtFoot}</article>`;
  const by = {}; ms.forEach(x => { const st = dispSt(x); by[st] = (by[st] || 0) + 1; });
  const overdue = ms.filter(x => dispSt(x) === "overdue");
  return `<article class="paper doc rise">${rtHead(m, "ЗВІТ", "про стан виконання Плану заходів з розбудови доброчесності")}
    <h3>1. Підсумок</h3>
    <p>Усього заходів: ${ms.length} (${Object.entries(by).map(([k, n]) => `${M_ST[k][0].toLowerCase()} ${n}`).join(", ")}).${overdue.length ? ` Прострочено ${overdue.length}: потрібні нові строки або причини затримки.` : " Прострочених немає."}</p>
    <h3>2. Перелік заходів</h3>
    <p class="doc-cap">Таблиця 1. Заходи плану трансформації</p>
    <table class="doc-t"><thead><tr><th>№</th><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Стан</th><th>Перевірка результату</th></tr></thead><tbody>
    ${ms.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.t)}</td><td>${esc(x.who)}</td><td class="tnum">${ua(x.due)}</td><td>${M_ST[dispSt(x)][0]}${dispSt(x) === "overdue" ? `, ${overdueDays(x)} ${daysWord(overdueDays(x))}` : ""}</td><td>${verif(x)[0]}</td></tr>`).join("")}</tbody></table>
    ${overdue.length ? `<h3>3. Прострочені заходи</h3><ol>${overdue.map(x => `<li>${esc(x.t)}: ${esc(x.who)}, строк ${ua(x.due)}, прострочено на ${overdueDays(x)} ${daysWord(overdueDays(x))}.</li>`).join("")}</ol>` : ""}
    <p>Результат заходу перевіряється наступним циклом оцінювання: показник, на який спрямовано захід, має покращитися.</p>
    ${rtFoot}</article>`;
}

function reportDynamics(m) {
  const s = m.series || [], last = s[s.length - 1], prev = s[s.length - 2];
  if (!prev) return `<article class="paper doc rise">${rtHead(m, "ДОВІДКА", "про динаміку рівня зрілості доброчесності")}<p>Попереднього циклу немає: динаміку буде видно після наступного оцінювання.</p>${rtFoot}</article>`;
  const comp = id => ({ id, a: prev.cr && prev.cr[id], b: last.cr && last.cr[id] });
  const rows = COMPS.map(comp).filter(x => x.a != null && x.b != null);
  const up = rows.filter(x => x.b - x.a >= 5), down = rows.filter(x => x.a - x.b >= 5);
  return `<article class="paper doc rise">${rtHead(m, "ДОВІДКА", "про динаміку рівня зрілості доброчесності")}
    <h3>1. Індекс за циклами</h3>
    <p class="doc-cap">Таблиця 1. Індекс доброчесності</p>
    <table class="doc-t"><thead><tr><th>Цикл</th><th>Індекс</th><th>Рівень</th><th>Зміна</th></tr></thead><tbody>
    ${s.map((x, i) => `<tr><td>${esc(x.cycle)}</td><td class="tnum">${f1(x.index)}</td><td>${rtLv(x.index)}</td><td class="tnum">${i ? rtDelta(r1(x.index - s[i - 1].index)) : "—"}</td></tr>`).join("")}</tbody></table>
    <h3>2. Компоненти: ${esc(prev.cycle)} → ${esc(last.cycle)}</h3>
    <p class="doc-cap">Таблиця 2. Зараховані бали компонентів</p>
    <table class="doc-t"><thead><tr><th>Компонент</th><th>${esc(prev.cycle)}</th><th>${esc(last.cycle)}</th><th>Зміна</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${COMP[x.id].n}</td><td class="tnum">${fb(x.a)}</td><td class="tnum">${fb(x.b)}</td><td class="tnum">${rtDelta(r1(x.b - x.a))}</td></tr>`).join("")}</tbody></table>
    <h3>3. Висновок</h3>
    <p>Індекс ${m.delta > 0 ? `зріс на ${pts(m.delta)}` : m.delta < 0 ? `знизився на ${pts(m.delta)}` : "не змінився"}: з ${f1(prev.index)} до ${f1(last.index)}. ${Math.abs(m.delta) < 5 ? "Зміна менша за 5 балів і може бути в межах похибки." : "Зміна більша за 5 балів."}
    ${up.length ? `Помітне покращення: ${up.map(x => COMP[x.id].n).join(", ")}.` : ""} ${down.length ? `Погіршення: ${down.map(x => COMP[x.id].n).join(", ")}; варто переглянути заходи за цими напрямами.` : ""}${m.trust === "C" ? " Достовірність поточного циклу C: перед висновками перевірте дані." : ""}</p>
    ${rtFoot}</article>`;
}
const RT_RENDER = { appendix_g: reportG, brief: reportBrief, measures: reportMeasures, dynamics: reportDynamics };

/* --- Екран --- */
V.report = () => {
  const m = cur(), saved = rtLs(rtKey());
  const doc = RT_RENDER[RT.tpl](m).replace('<article class="paper doc rise"', `<article class="paper doc rise rt-doc${RT.edit ? " rt-editing" : ""}" id="rtDoc"`);
  return `${backToInst()}
  <div class="c12 rise toolbar rt-bar">
    <label class="rt-tpl" data-tip="${esc(RT_TPL[RT.tpl][1])}"><span class="lbl">Шаблон</span><select class="inp" onchange="rtSetTpl(this.value)" aria-label="Шаблон звіту">${Object.entries(RT_TPL).map(([k, [t]]) => `<option value="${k}"${k === RT.tpl ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <div class="sp"></div>
    <div class="rt-zoomctl" role="group" aria-label="Масштаб">
      <button class="icon-btn" onclick="rtZoom(RT.zoom - 10)" aria-label="Зменшити">−</button>
      <input type="range" min="${RT_ZOOM[0]}" max="${RT_ZOOM[1]}" step="5" value="${RT.zoom}" oninput="rtZoom(+this.value)" aria-label="Масштаб, %">
      <button class="icon-btn" onclick="rtZoom(RT.zoom + 10)" aria-label="Збільшити">+</button>
      <button class="rt-pct" onclick="rtZoom(100)" data-tip="Скинути до 100%">${RT.zoom}%</button>
    </div>
    <button class="btn ${RT.edit ? "btn-primary" : "btn-soft"}" onclick="rtToggleEdit()" aria-pressed="${RT.edit}">${IC.edit}${RT.edit ? "Готово" : "Редагувати"}</button>
    ${saved ? `<button class="btn btn-ghost" onclick="rtResetEdits()" data-tip="Повернути текст, згенерований із даних">${IC.reset}Скинути правки</button>` : ""}
    ${rtCanAi() && RT.tpl === "appendix_g" ? `<button class="btn btn-soft" onclick="aiOpen('Підготуй чернетку опису результатів для звіту')">${IC.spark}Чернетка опису</button>` : ""}
    <button class="btn btn-primary" onclick="openExport()">${IC.download}Експорт</button>
  </div>
  ${RT.edit ? `<div class="c12 rt-hint noprint">${IC.edit}<span>Режим редагування: пишіть прямо в документі, правки зберігаються в цьому браузері.${rtCanAi() ? " Виділіть фрагмент, щоб попросити ШІ переписати його або пояснити." : ""}</span></div>` : saved ? `<div class="c12 rt-hint noprint">${IC.info}<span>Документ містить ручні правки. Числа в них не оновлюються разом із даними.</span></div>` : ""}
  <div class="c12 rt-stage" id="rtStage"><div class="rt-zoom" id="rtZoom" style="zoom:${RT.zoom / 100}">${doc}</div></div>`;
};
V.report.after = () => {
  const d = $("#rtDoc"); if (!d) return;
  const saved = rtLs(rtKey()); if (saved) d.innerHTML = saved;
  if (RT.edit) { d.contentEditable = "true"; d.spellcheck = true; d.addEventListener("input", rtSaveSoon); }
  rtGestures($("#rtStage"));
};

function rtSetTpl(k) { rtSave(); RT.tpl = k; rtLs("ii-rt-tpl", k); rtCloseAi(); render(true); }
function rtZoom(z) {
  RT.zoom = Math.round(Math.min(RT_ZOOM[1], Math.max(RT_ZOOM[0], z)));
  const box = $("#rtZoom"); if (box) box.style.zoom = RT.zoom / 100;
  const r = document.querySelector(".rt-zoomctl input"); if (r) r.value = RT.zoom;
  const p = document.querySelector(".rt-pct"); if (p) p.textContent = RT.zoom + "%";
  rtLs("ii-rt-zoom", String(RT.zoom)); rtCloseAi();
}
function rtToggleEdit() {
  if (RT.edit) rtSave();
  RT.edit = !RT.edit; rtCloseAi(); render(true);
  if (RT.edit) { const d = $("#rtDoc"); if (d) d.focus({ preventScroll: true }); }
}
let rtTimer;
function rtSaveSoon() { clearTimeout(rtTimer); rtTimer = setTimeout(rtSave, 400); }
function rtSave() { const d = $("#rtDoc"); if (d && RT.edit) rtLs(rtKey(), d.innerHTML); }
function rtResetEdits() {
  if (!confirmReset()) return;
  rtLs(rtKey(), null); addLog(me(), `Скинуто ручні правки звіту (${RT_TPL[RT.tpl][0]})`); render(true); toast("Правки скинуто");
}
// Без window.confirm: двічі натиснути протягом 3 с
let rtResetArm = 0;
function confirmReset() { if (Date.now() - rtResetArm < 3000) return true; rtResetArm = Date.now(); toast("Натисніть ще раз, щоб скинути всі правки"); return false; }

/* --- Жести масштабу: Ctrl/⌘ + коліщатко (і щипок тачпада), щипок двома пальцями, Safari gesture* --- */
function rtGestures(stage) {
  if (!stage || stage.dataset.g) return; stage.dataset.g = "1";
  // Коліщатко миші (|deltaY| ≥ 50 або рядки) — крок 10%; щипок тачпада (дрібні deltaY з ctrlKey) — плавно
  stage.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
    if (e.deltaMode || Math.abs(e.deltaY) >= 50) rtZoom(Math.round(RT.zoom / 10) * 10 + (e.deltaY > 0 ? -10 : 10));
    else rtZoom(RT.zoom * Math.exp(-e.deltaY * 0.01));
  }, { passive: false });
  let base = 0, startZoom = 100;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  stage.addEventListener("touchstart", e => { if (e.touches.length === 2) { base = dist(e.touches); startZoom = RT.zoom; } }, { passive: true });
  stage.addEventListener("touchmove", e => { if (e.touches.length === 2 && base) { e.preventDefault(); rtZoom(startZoom * dist(e.touches) / base); } }, { passive: false });
  stage.addEventListener("touchend", e => { if (e.touches.length < 2) base = 0; });
  let gz = 100;
  stage.addEventListener("gesturestart", e => { e.preventDefault(); gz = RT.zoom; });
  stage.addEventListener("gesturechange", e => { e.preventDefault(); rtZoom(gz * e.scale); });
}

/* --- ШІ за виділеним фрагментом --- */
document.addEventListener("selectionchange", () => {
  if (RT.busy || $("#rtAi")?.dataset.open === "form") return;
  clearTimeout(RT.selT); RT.selT = setTimeout(rtOnSelect, 180);
});
function rtOnSelect() {
  const d = $("#rtDoc"), sel = window.getSelection();
  if (!d || !rtCanAi() || !sel || sel.isCollapsed || !sel.rangeCount) return rtHideFab();
  const r = sel.getRangeAt(0);
  if (!d.contains(r.commonAncestorContainer)) return rtHideFab();
  const text = sel.toString().trim();
  if (text.length < 3) return rtHideFab();
  RT.range = r.cloneRange(); RT.sel = text.slice(0, 4000);
  const rect = r.getBoundingClientRect();
  let fab = $("#rtFab");
  if (!fab) { fab = document.createElement("button"); fab.id = "rtFab"; fab.className = "rt-fab noprint"; fab.innerHTML = `${IC.spark}Запитати ШІ`; fab.onmousedown = e => e.preventDefault(); fab.onclick = rtOpenAi; document.body.appendChild(fab); }
  fab.style.top = Math.max(8, rect.top - 44) + "px"; fab.style.left = Math.min(window.innerWidth - 150, Math.max(8, rect.left + rect.width / 2 - 64)) + "px";
  fab.hidden = false;
}
function rtHideFab() { const f = $("#rtFab"); if (f) f.hidden = true; }
const RT_QUICK = [["Скоротити", "Скороти, зберігши всі числа"], ["Офіційніше", "Переклади в офіційно-діловий стиль"], ["Простіше", "Перепиши простішою мовою для особового складу"], ["Поясни", "Поясни, що означає цей фрагмент і звідки числа?"]];
function rtOpenAi() {
  rtHideFab();
  let p = $("#rtAi");
  if (!p) { p = document.createElement("div"); p.id = "rtAi"; p.className = "rt-ai noprint"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Запит до ШІ щодо фрагмента"); document.body.appendChild(p); }
  p.dataset.open = "form"; RT.last = null;
  const quick = RT_QUICK.filter((_, i) => RT.edit || i === 3);
  p.innerHTML = `<div class="rt-ai-h"><b>${IC.spark}ШІ для фрагмента</b><div class="sp"></div><button class="icon-btn" onclick="rtCloseAi()" aria-label="Закрити">${IC.x}</button></div>
    <blockquote class="rt-quote">${esc(RT.sel.length > 220 ? RT.sel.slice(0, 220) + "…" : RT.sel)}</blockquote>
    <div class="rt-chips">${quick.map(([t, q]) => `<button class="pill-btn" onclick="rtAsk(${esc(JSON.stringify(q))})">${t}</button>`).join("")}</div>
    <form class="rt-ask" onsubmit="event.preventDefault();rtAsk(this.q.value)"><textarea class="inp" name="q" rows="2" maxlength="500" placeholder="${RT.edit ? "Що зробити з фрагментом або що пояснити?" : "Що пояснити? (щоб змінювати текст, увімкніть «Редагувати»)"}" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.requestSubmit()}"></textarea><button class="btn btn-primary" aria-label="Надіслати">${IC.send}</button></form>
    <div id="rtAiOut"></div>`;
  rtPlace(p); p.querySelector("textarea").focus();
}
function rtPlace(p) {
  const rect = RT.range ? RT.range.getBoundingClientRect() : { bottom: 120, left: 40 };
  const w = Math.min(420, window.innerWidth - 16);
  p.style.width = w + "px";
  p.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.left)) + "px";
  const below = rect.bottom + 10, h = p.offsetHeight || 260;
  p.style.top = (below + h < window.innerHeight ? below : Math.max(8, (rect.top || 120) - h - 10)) + "px";
}
function rtCloseAi() { const p = $("#rtAi"); if (p) { p.remove(); } rtHideFab(); RT.busy = false; }
async function rtAsk(q) {
  q = String(q || "").trim(); if (!q || RT.busy) return;
  const out = $("#rtAiOut"); if (!out) return;
  RT.busy = true; out.innerHTML = `<div class="rt-wait">${IC.spark}Модель думає…</div>`;
  const body = { selection: RT.sel, instruction: q, document: ($("#rtDoc")?.innerText || "").slice(0, 20000), mode: RT.edit ? "auto" : "ask", unit_id: API.unitId || null };
  try {
    const r = await fetch("/api/assistant/edit", { method: "POST", headers: { "content-type": "application/json", ...apiAuth() }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(r.status === 503 ? "Модель на сервері не підключена (LLM_BASE_URL). Без неї текст можна правити вручну." : r.status === 404 || r.status === 405 ? "Редагування з ШІ працює лише з бекендом (docker compose)." : (j && (j.message || j.detail)) || "Модель не відповіла");
    RT.last = { ...j, q }; rtShowResult();
  } catch (e) {
    out.innerHTML = `<div class="rt-err">${esc(e.message === "Failed to fetch" ? "Немає звʼязку із сервером" : e.message)}</div>`;
  } finally { RT.busy = false; const p = $("#rtAi"); if (p) rtPlace(p); }
}
function rtShowResult() {
  const j = RT.last, out = $("#rtAiOut"); if (!j || !out) return;
  const warn = (j.warnings || []).map(w => `<div class="rt-warn">${IC.alert}${esc(w)}</div>`).join("");
  if (j.action === "replace" && RT.edit) {
    out.innerHTML = `<div class="lbl">Пропозиція${j.note ? `: ${esc(j.note)}` : ""}</div>
      <div class="rt-diff"><del>${esc(RT.sel)}</del><ins>${esc(j.text)}</ins></div>${warn}
      <div class="rt-act"><button class="btn btn-primary" onclick="rtApply()">${IC.ok}Замінити</button><button class="btn btn-ghost" onclick="rtCloseAi()">Скасувати</button><span class="lbl">${esc(modelName(j.model))}</span></div>
      <div class="lbl">Не те? Уточніть у полі вище, наприклад «коротше» чи «без другого речення».</div>`;
  } else {
    out.innerHTML = `<div class="rt-answer">${esc(j.text).replace(/\n/g, "<br>")}</div>${warn}
      <div class="rt-act">${RT.edit ? `<button class="btn btn-soft" onclick="rtApply(true)">${IC.plus}Вставити після фрагмента</button>` : ""}<button class="btn btn-ghost" onclick="rtCloseAi()">Закрити</button><span class="lbl">${esc(modelName(j.model))}</span></div>`;
  }
}
function rtApply(after) {
  const j = RT.last, d = $("#rtDoc"); if (!j || !d || !RT.range || !RT.edit) return;
  d.focus({ preventScroll: true });
  const sel = window.getSelection(), r = RT.range.cloneRange();
  if (after) r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  // insertText зберігає історію: Ctrl/⌘+Z повертає попередній текст
  const text = after ? " " + j.text : j.text;
  if (!document.execCommand("insertText", false, text)) { r.deleteContents(); r.insertNode(document.createTextNode(text)); }
  rtSave(); addLog(me(), `Звіт: ${after ? "вставлено відповідь" : "замінено фрагмент"} за пропозицією ШІ`);
  rtCloseAi(); render(true); toast(after ? "Вставлено. Скасувати: Ctrl/⌘+Z" : "Замінено. Скасувати: Ctrl/⌘+Z");
}
document.addEventListener("mousedown", e => { const p = $("#rtAi"); if (p && !p.contains(e.target) && !e.target.closest("#rtFab")) rtCloseAi(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#rtAi")) rtCloseAi(); });
window.addEventListener("hashchange", () => { rtCloseAi(); if (RT.edit) { rtSave(); RT.edit = false; } });

/* --- Експорт: Word за шаблоном із сервера (без ручних правок) --- */
const rtOpenExport = openExport;
openExport = function () {
  rtOpenExport();
  if (!API.on || !API.campaignId) return;
  const list = document.querySelector("#exp .exp-list"); if (!list) return;
  list.insertAdjacentHTML("afterbegin", `<button type="button" class="exp-opt" onclick="rtServerExport('docx')"><span class="comp-ic" style="background:var(--soft)">${IC.file}</span><span><b>Word: ${RT_TPL[RT.tpl][0]}</b><span class="lbl">Документ із сервера за шаблоном, без ручних правок.</span></span></button>
    <button type="button" class="exp-opt" onclick="rtServerExport('xlsx')"><span class="comp-ic" style="background:var(--soft)">${IC.table}</span><span><b>Excel</b><span class="lbl">Усі таблиці звіту з сервера.</span></span></button>`);
};
async function rtServerExport(fmt) {
  $("#exp").close();
  try {
    const q = new URLSearchParams({ format: fmt, template: RT.tpl }); if (API.unitId) q.set("unit_id", API.unitId);
    const r = await api(`/campaigns/${API.campaignId}/report?${q}`, { raw: true });
    const name = (/filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "") || [])[1] || `integrity-report.${fmt}`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast("Завантажено: " + name);
  } catch (e) { apiFail(e); }
}
