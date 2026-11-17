/* --- Конструктор анкет (укладач): повноекранний редактор чернетки ---
   Працює з бекендом: POST /questionnaires, PATCH /{id}, PUT /{id}/structure, GET /{id}/validate, POST /{id}/publish.
   Редагувати можна лише чернетку; опубліковану спершу копіюють у нову версію (кнопка «Нова версія»). */
const BLD_COMP = [["culture", "Культура"], ["system", "Система"], ["accountability", "Підзвітність"], ["overall", "Загальна самооцінка"]];
const BLD_TYPE = [["single_choice", "Один варіант"], ["multiple_choice", "Кілька варіантів"], ["scale", "Шкала"]];
const BLD_UP = IC.chev.replace("<svg", `<svg style="transform:rotate(180deg)"`);
let B = null; // стан редактора: { q (мета з сервера), sections, dirty, issues }

// Код анкети з назви: українська транслітерація, лише латиниця, цифри й дефіс
const BLD_TR = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "yu", я: "ya", "'": "", "’": "" };
const bldSlug = t => t.trim().toLowerCase().replace(/./g, c => BLD_TR[c] ?? c).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const bldNewQ = (n) => ({ code: "q" + Date.now().toString(36) + n, text: "", help_text: "", type: "single_choice", required: true, weight: 1, scale_min: null, scale_max: null, options: [{ text: "", score: 1 }, { text: "", score: 0 }] });
const bldNewSec = () => ({ title: "", component: "culture", questions: [bldNewQ(0)] });
const bldPlural = (n, a, b, c) => { const m = n % 10, h = n % 100; return `${n} ${h > 10 && h < 15 ? c : m === 1 ? a : m > 1 && m < 5 ? b : c}`; };

function bldFromServer(q) {
  return {
    q: { id: q.id, code: q.code, version: q.version, status: q.status, title: q.title, description: q.description || "", kind: q.kind, target_category: q.target_category },
    sections: q.sections.map(s => ({ title: s.title, component: s.component, questions: s.questions.map(x => ({ code: x.code, text: x.text, help_text: x.help_text || "", type: x.type, required: x.required, weight: x.weight, scale_min: x.scale_min, scale_max: x.scale_max, options: x.options.map(o => ({ text: o.text, score: o.score })) })) })),
    dirty: false, issues: null, busy: false,
  };
}
// Структура для PUT: для шкали варіантів немає, для вибору шкали немає
const bldPayload = () => ({ sections: B.sections.map(s => ({ title: s.title.trim(), component: s.component, questions: s.questions.map(x => ({ code: x.code, text: x.text.trim(), help_text: x.help_text.trim(), type: x.type, required: x.required, weight: Number(x.weight) || 0, scale_min: x.type === "scale" ? Number(x.scale_min) : null, scale_max: x.type === "scale" ? Number(x.scale_max) : null, options: x.type === "scale" ? [] : x.options.map(o => ({ text: o.text.trim(), score: Number(o.score) || 0 })) })) })) });

async function bldOpen(id) {
  try { const q = await api(`/questionnaires/${id}`); B = bldFromServer(q); bldMount(); } catch (e) { apiFail(e); }
}
function bldMount() {
  let ov = document.getElementById("bld");
  if (!ov) { ov = document.createElement("div"); ov.id = "bld"; ov.className = "bld"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Конструктор анкети"); document.body.appendChild(ov); }
  document.body.classList.add("bld-open");
  bldDraw();
}
function bldClose(force) {
  if (B && B.dirty && !force) { B.confirmClose = true; return bldDraw(); }
  const ov = document.getElementById("bld"); if (ov) ov.remove();
  document.body.classList.remove("bld-open"); B = null;
  if (typeof apiSurveysReload === "function") apiSurveysReload(); else { API.qs = null; render(true); }
}

function bldOpt(x, si, qi, oi) {
  return `<div class="bld-opt"><input class="inp" data-f="o.text" data-p="${si}.${qi}.${oi}" placeholder="Текст варіанта відповіді" value="${esc(x.text)}" aria-label="Текст варіанта"><label class="bld-score" data-tip="Бал варіанта, число. Наприклад 1, 0,5 або 0"><span class="lbl">Бал</span><input class="inp tnum" data-f="o.score" data-p="${si}.${qi}.${oi}" inputmode="decimal" value="${esc(String(x.score).replace(".", ","))}" aria-label="Бал"></label><button type="button" class="icon-btn sm" data-a="del-opt" data-p="${si}.${qi}.${oi}" aria-label="Видалити варіант" data-tip="Видалити варіант">${IC.x}</button></div>`;
}
function bldQ(x, si, qi, last) {
  const p = `${si}.${qi}`;
  return `<div class="bld-q"><div class="bld-q-h"><span class="bld-qn">${qi + 1}</span>
    <div class="bld-move"><button type="button" class="icon-btn sm" data-a="q-up" data-p="${p}" ${qi === 0 ? "disabled" : ""} aria-label="Питання вище">${BLD_UP}</button><button type="button" class="icon-btn sm" data-a="q-down" data-p="${p}" ${last ? "disabled" : ""} aria-label="Питання нижче">${IC.chev}</button><button type="button" class="icon-btn sm" data-a="del-q" data-p="${p}" aria-label="Видалити питання" data-tip="Видалити питання">${IC.x}</button></div></div>
    <div class="field"><label>Текст питання</label><textarea class="inp" rows="2" data-f="q.text" data-p="${p}" placeholder="Сформулюйте питання">${esc(x.text)}</textarea></div>
    <div class="bld-row">
      <div class="field"><label>Тип відповіді</label><select class="inp" data-f="q.type" data-p="${p}">${BLD_TYPE.map(([v, n]) => `<option value="${v}" ${x.type === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="field bld-w"><label>Вага</label><input class="inp tnum" data-f="q.weight" data-p="${p}" inputmode="decimal" value="${esc(String(x.weight).replace(".", ","))}"></div>
      <label class="chk-row bld-req"><input type="checkbox" data-f="q.required" data-p="${p}" ${x.required ? "checked" : ""}><span>Обов'язкове</span></label>
    </div>
    ${x.type === "scale"
      ? `<div class="bld-row"><div class="field bld-w"><label>Від</label><input class="inp tnum" type="number" data-f="q.scale_min" data-p="${p}" value="${x.scale_min ?? ""}"></div><div class="field bld-w"><label>До</label><input class="inp tnum" type="number" data-f="q.scale_max" data-p="${p}" value="${x.scale_max ?? ""}"></div><span class="lbl bld-hint">Респондент обирає число в цих межах.</span></div>`
      : `<div class="bld-opts"><div class="lbl">Варіанти відповіді і бали</div>${x.options.map((o, oi) => bldOpt(o, si, qi, oi)).join("")}<button type="button" class="btn btn-ghost bld-add" data-a="add-opt" data-p="${p}">${IC.plus}Додати варіант</button></div>`}
    <details class="bld-more"><summary>Підказка до питання</summary><textarea class="inp" rows="2" data-f="q.help_text" data-p="${p}" placeholder="Необов'язково: пояснення, що мається на увазі">${esc(x.help_text)}</textarea></details>
  </div>`;
}
function bldSec(s, si, lastS) {
  return `<section class="bld-sec"><div class="bld-sec-h"><span class="pv-num">${si + 1}</span>
    <div class="field bld-grow"><label>Назва розділу</label><input class="inp" data-f="s.title" data-p="${si}" value="${esc(s.title)}" placeholder="Наприклад, Культура"></div>
    <div class="field bld-comp"><label>Компонент індексу</label><select class="inp" data-f="s.component" data-p="${si}">${BLD_COMP.map(([v, n]) => `<option value="${v}" ${s.component === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="bld-move"><button type="button" class="icon-btn sm" data-a="s-up" data-p="${si}" ${si === 0 ? "disabled" : ""} aria-label="Розділ вище">${BLD_UP}</button><button type="button" class="icon-btn sm" data-a="s-down" data-p="${si}" ${lastS ? "disabled" : ""} aria-label="Розділ нижче">${IC.chev}</button><button type="button" class="icon-btn sm" data-a="del-s" data-p="${si}" aria-label="Видалити розділ" data-tip="Видалити розділ">${IC.x}</button></div></div>
    ${s.questions.map((x, qi) => bldQ(x, si, qi, qi === s.questions.length - 1)).join("")}
    <button type="button" class="btn btn-soft bld-add" data-a="add-q" data-p="${si}">${IC.plus}Додати питання</button></section>`;
}
function bldDraw() {
  const ov = document.getElementById("bld"); if (!ov || !B) return;
  const m = B.q, nq = B.sections.reduce((a, s) => a + s.questions.length, 0), scrollTop = ov.querySelector(".bld-body") ? ov.querySelector(".bld-body").scrollTop : 0;
  ov.innerHTML = `<div class="bld-top"><div class="bld-top-in"><button type="button" class="icon-btn" data-a="close" aria-label="Закрити конструктор">${IC.x}</button>
      <div class="bld-title"><b>${esc(m.title || "Нова анкета")}</b><span class="lbl">Версія ${m.version} · ${bldPlural(B.sections.length, "розділ", "розділи", "розділів")}, ${bldPlural(nq, "питання", "питання", "питань")} ${B.dirty ? "· є незбережені зміни" : "· збережено"}</span></div>
      <div class="bld-actions"><button type="button" class="btn btn-ghost" data-a="validate" ${B.busy ? "disabled" : ""}>${IC.check}Перевірити</button><button type="button" class="btn btn-soft" data-a="save" ${B.busy || !B.dirty ? "disabled" : ""}>Зберегти</button><button type="button" class="btn btn-primary" data-a="publish" ${B.busy ? "disabled" : ""}>${IC.ok}Опублікувати</button></div></div></div>
    <div class="bld-body"><div class="bld-wrap">
      <details class="bld-rules"><summary>Коли анкету не можна опублікувати</summary><ul><li>немає жодного розділу, або розділ без питань;</li><li>у питань з вибором менше двох варіантів, або варіанти повторюються;</li><li>для шкали «від» не менше за «до»;</li><li>код питання повторюється в межах анкети;</li><li>порожній текст питання чи варіанта (не збережеться).</li></ul></details>
      ${B.confirmClose ? `<div class="bld-note warn"><b>Є незбережені зміни.</b> Закрити без збереження?<div class="bld-note-act"><button type="button" class="btn btn-ghost" data-a="stay">Лишитись</button><button type="button" class="btn btn-danger" data-a="close-force">Закрити без збереження</button></div></div>` : ""}
      ${B.issues ? (B.issues.length ? `<div class="bld-note warn"><b>Перед публікацією виправте:</b><ul>${B.issues.map(i => `<li>${esc(bldIssuePath(i.path))}${esc(i.message)}</li>`).join("")}</ul></div>` : `<div class="bld-note ok"><b>Усе гаразд.</b> Анкету можна публікувати.</div>`) : ""}
      <section class="card bld-meta"><div class="bld-row"><div class="field bld-grow"><label>Назва анкети</label><input class="inp" data-f="m.title" value="${esc(m.title)}"></div></div>
        <div class="field"><label>Опис</label><textarea class="inp" rows="2" data-f="m.description" placeholder="Необов'язково: для кого й навіщо ця анкета">${esc(m.description)}</textarea></div>
        <div class="bld-row"><div class="field"><label>Для кого</label><select class="inp" data-f="m.target_category">${Object.entries(QCAT).map(([v, n]) => `<option value="${v}" ${m.target_category === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
          <div class="field"><label>Вид</label><select class="inp" data-f="m.kind"><option value="survey" ${m.kind === "survey" ? "selected" : ""}>Анкета зрілості</option><option value="checklist" ${m.kind === "checklist" ? "selected" : ""}>Чек-лист</option></select></div></div></section>
      ${B.sections.map((s, si) => bldSec(s, si, si === B.sections.length - 1)).join("")}
      <button type="button" class="btn btn-soft bld-add bld-add-s" data-a="add-s">${IC.plus}Додати розділ</button>
    </div></div>`;
  const body = ov.querySelector(".bld-body"); if (body) body.scrollTop = scrollTop;
  ov.querySelectorAll("textarea").forEach(bldFit);
}
const bldIssuePath = p => { const m = String(p || "").match(/sections\[(\d+)\](?:\.questions\[(\d+)\])?/); return m ? `Розділ ${+m[1] + 1}${m[2] != null ? `, питання ${+m[2] + 1}` : ""}: ` : ""; };

// --- Події (делеговані на документ, бо редактор перемальовується) ---
function bldAt(path) { const [si, qi, oi] = String(path).split(".").map(Number); return { s: B.sections[si], q: Number.isInteger(qi) ? B.sections[si].questions[qi] : null, o: Number.isInteger(oi) ? B.sections[si].questions[qi].options[oi] : null, si, qi, oi }; }
const bldMove = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
function bldSet(el) {
  const f = el.dataset.f, a = el.dataset.p != null ? bldAt(el.dataset.p) : {}, v = el.type === "checkbox" ? el.checked : el.value;
  if (f.startsWith("m.")) B.q[f.slice(2)] = v;
  else if (f === "s.title") a.s.title = v; else if (f === "s.component") a.s.component = v;
  else if (f === "q.text") a.q.text = v; else if (f === "q.help_text") a.q.help_text = v; else if (f === "q.required") a.q.required = v;
  else if (f === "q.weight") a.q.weight = String(v).replace(",", ".");
  else if (f === "q.scale_min") a.q.scale_min = v === "" ? null : +v; else if (f === "q.scale_max") a.q.scale_max = v === "" ? null : +v;
  else if (f === "q.type") { a.q.type = v; if (v === "scale") { a.q.scale_min = a.q.scale_min ?? 1; a.q.scale_max = a.q.scale_max ?? 5; } else if (a.q.options.length < 2) a.q.options = [{ text: "", score: 1 }, { text: "", score: 0 }]; B.dirty = true; return bldDraw(); }
  else if (f === "o.text") a.o.text = v; else if (f === "o.score") a.o.score = String(v).replace(",", ".");
  if (!B.dirty) { B.dirty = true; B.issues = null; const t = document.querySelector("#bld .bld-title .lbl"); if (t) t.textContent = t.textContent.replace("· збережено", "· є незбережені зміни"); const sv = document.querySelector('#bld [data-a="save"]'); if (sv) sv.disabled = false; }
}
const bldFit = el => { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; };
document.addEventListener("input", e => { if (B && e.target.tagName === "TEXTAREA") bldFit(e.target); if (B && e.target.closest("#bld") && e.target.dataset.f && e.target.tagName !== "SELECT" && e.target.type !== "checkbox") bldSet(e.target); });
document.addEventListener("change", e => { if (B && e.target.closest("#bld") && e.target.dataset.f && (e.target.tagName === "SELECT" || e.target.type === "checkbox")) bldSet(e.target); });
document.addEventListener("keydown", e => { if (B && e.key === "Escape" && document.getElementById("bld") && !e.target.closest(".combo")) bldClose(); });
document.addEventListener("click", async e => {
  const b = e.target.closest("#bld [data-a]"); if (!b || !B) return;
  const act = b.dataset.a, a = b.dataset.p != null ? bldAt(b.dataset.p) : {};
  const touch = () => { B.dirty = true; B.issues = null; bldDraw(); };
  if (act === "close") return bldClose();
  if (act === "close-force") return bldClose(true);
  if (act === "stay") { B.confirmClose = false; return bldDraw(); }
  if (act === "add-s") { B.sections.push(bldNewSec()); return touch(); }
  if (act === "del-s") { B.sections.splice(a.si, 1); return touch(); }
  if (act === "s-up") { bldMove(B.sections, a.si, -1); return touch(); }
  if (act === "s-down") { bldMove(B.sections, a.si, 1); return touch(); }
  if (act === "add-q") { a.s.questions.push(bldNewQ(a.s.questions.length)); return touch(); }
  if (act === "del-q") { a.s.questions.splice(a.qi, 1); return touch(); }
  if (act === "q-up") { bldMove(a.s.questions, a.qi, -1); return touch(); }
  if (act === "q-down") { bldMove(a.s.questions, a.qi, 1); return touch(); }
  if (act === "add-opt") { a.q.options.push({ text: "", score: 0 }); return touch(); }
  if (act === "del-opt") { a.q.options.splice(a.oi, 1); return touch(); }
  if (act === "save") return bldSave();
  if (act === "validate") { if (B.dirty && !(await bldSave(true))) return; return bldValidate(); }
  if (act === "publish") return bldPublish();
});
async function bldSave(silent) {
  B.busy = true; bldDraw();
  try {
    await api(`/questionnaires/${B.q.id}`, { method: "PATCH", body: { title: B.q.title.trim() || "Без назви", description: B.q.description, kind: B.q.kind, target_category: B.q.target_category } });
    await api(`/questionnaires/${B.q.id}/structure`, { method: "PUT", body: bldPayload() });
    B.dirty = false; B.busy = false; bldDraw(); if (!silent) toast("Чернетку збережено"); return true;
  } catch (err) { B.busy = false; bldDraw(); toast(apiErrText(err)); return false; }
}
async function bldValidate() {
  try { B.issues = await api(`/questionnaires/${B.q.id}/validate`); bldDraw(); const top = document.querySelector("#bld .bld-body"); if (top) top.scrollTop = 0; return B.issues; } catch (err) { apiFail(err); return null; }
}
async function bldPublish() {
  if (B.dirty && !(await bldSave(true))) return;
  const issues = await bldValidate(); if (!issues || issues.length) return;
  try { await api(`/questionnaires/${B.q.id}/publish`, { method: "POST" }); toast("Анкету опубліковано"); bldClose(true); } catch (err) { apiFail(err); }
}
// Створення нової анкети: коротка форма, далі редактор
function bldNew() {
  openDrawer("Нова анкета", `
    <div class="field"><label for="bn-t">Назва</label><input class="inp" id="bn-t" placeholder="Наприклад, Анкета для курсантів"></div>
    <div class="field"><label for="bn-c">Код</label><input class="inp" id="bn-c" placeholder="kursanty-survey"><span class="lbl">Латиницею, цифри, дефіс. За кодом пов'язуються версії анкети.</span></div>
    <div class="field"><label>Для кого</label><select class="inp" id="bn-g">${Object.entries(QCAT).map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></div>
    <div class="field"><label>Вид</label><select class="inp" id="bn-k"><option value="survey">Анкета зрілості</option><option value="checklist">Чек-лист</option></select></div>
    <span class="lbl" id="bn-err" style="color:var(--red)"></span>
    <button class="btn btn-primary" id="bn-ok" style="justify-content:center">${IC.plus}Створити й відкрити конструктор</button>`, b => {
    const code = b.querySelector("#bn-c"), title = b.querySelector("#bn-t");
    title.oninput = () => { if (!code.dataset.touched) code.value = bldSlug(title.value); };
    code.oninput = () => { code.dataset.touched = "1"; };
    b.querySelector("#bn-ok").onclick = async () => {
      const t = title.value.trim(), c = code.value.trim();
      if (!t) return void (b.querySelector("#bn-err").textContent = "Вкажіть назву.");
      if (!/^[a-z0-9_.-]+$/.test(c)) return void (b.querySelector("#bn-err").textContent = "Код: лише латиниця, цифри, дефіс і крапка.");
      try { const q = await api("/questionnaires", { method: "POST", body: { code: c, title: t, description: "", kind: b.querySelector("#bn-k").value, target_category: b.querySelector("#bn-g").value, sections: [] } }); closeDrawer(); B = bldFromServer(q); B.sections = [bldNewSec()]; B.dirty = true; bldMount(); }
      catch (e) { b.querySelector("#bn-err").textContent = apiErrText(e); }
    };
  });
}
