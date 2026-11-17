/* Люди й ролі та Зведення (Координатор): GET/POST/PATCH /admin/users, GET /admin/units, GET /admin/overview */
const PP_ROLES = { admin: "Уповноважений", commissioner: "Укладач анкет", respondent: "Респондент", leader: "Керівник", auditor: "Аудитор", coordinator: "Координатор" };
const PP_CATS = { working_group: "Робоча група", staff: "Особовий склад", expert: "Зовнішні експерти" };
const PP_MAX_IMPORT = 200;
const P = { q: "", role: "all", st: "active" };

async function apiLoadPeople() {
  const [users, units] = await Promise.all([api("/admin/users"), api("/admin/units")]);
  return { users, units };
}
const ppUnit = id => { const u = API.ppl.units.find(x => x.id === id); return u ? dn(u.name) : ""; };

/* --- Чисті функції --- */
function ppGenPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_.!?#$%&*+=@~^()[]{}<>/|:,"; // 64 символи: 256 ділиться націло
  const abc = a.slice(0, 64), b = new Uint8Array(12); crypto.getRandomValues(b);
  return Array.from(b, x => abc[x & 63]).join("");
}
/* Рядки «логін;ім'я;роль;категорія;підрозділ;пароль» → { rows, errors: [{n, text}] } */
function ppParseImport(text, units, existing) {
  const lines = String(text || "").split(/\r?\n/).map((t, i) => [i + 1, t.trim()]).filter(x => x[1]);
  const rows = [], errors = [], seen = new Set((existing || []).map(l => l.toLowerCase()));
  if (lines.length > PP_MAX_IMPORT) return { rows, errors: [{ n: 0, text: `Забагато рядків: ${lines.length}, максимум ${PP_MAX_IMPORT}` }] };
  for (const [n, line] of lines) {
    const f = line.split(";").map(s => s.trim());
    if (f.length < 6) { errors.push({ n, text: "Потрібно 6 полів через «;»" }); continue; }
    const [login, display_name, role, category] = f, unitName = f[4], password = f.slice(5).join(";");
    let err = "";
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(login)) err = "Логін: 3-64 символи, латиниця, цифри, . _ -";
    else if (seen.has(login.toLowerCase())) err = "Такий логін уже є";
    else if (!display_name) err = "Порожнє імʼя";
    else if (!PP_ROLES[role]) err = "Невідома роль";
    else if (category && !PP_CATS[category]) err = "Невідома категорія";
    else if (role === "respondent" && !category) err = "Для респондента потрібна категорія";
    else if (password.length < 8 || password.length > 128) err = "Пароль: 8-128 символів";
    let unit_id = null;
    if (!err && unitName) { const u = units.find(x => dn(x.name).toLowerCase() === unitName.toLowerCase()); if (u) unit_id = u.id; else err = `Підрозділ «${unitName}» не знайдено`; }
    if (err) { errors.push({ n, text: err }); continue; }
    seen.add(login.toLowerCase());
    rows.push({ n, login, display_name, role, category: category || null, unit_id, password });
  }
  return { rows, errors };
}

/* --- Екран «Люди й ролі» --- */
function ppFiltered() {
  const q = P.q.trim().toLowerCase();
  return API.ppl.users.filter(u => (P.role === "all" || u.role === P.role) && (P.st === "all" || (P.st === "active") === !!u.is_active) &&
    (!q || u.login.toLowerCase().includes(q) || (u.display_name || "").toLowerCase().includes(q)));
}
function ppListHTML() {
  const L = API.ppl.users, shown = ppFiltered(), cnt = {};
  L.forEach(u => cnt[u.role] = (cnt[u.role] || 0) + 1);
  return `<div class="pp-chips">${Object.keys(PP_ROLES).map(r => `<button type="button" class="chip pp-chip ${P.role === r ? "on" : ""}" data-a="pp-role" data-v="${r}" aria-pressed="${P.role === r}">${PP_ROLES[r]} <b class="tnum">${cnt[r] || 0}</b></button>`).join("")}</div>
  <div class="tbl-wrap"><table class="pp-tbl"><thead><tr><th>Логін</th><th>Імʼя</th><th>Роль</th><th>Категорія</th><th>Підрозділ</th><th>Статус</th><th></th></tr></thead><tbody>
  ${shown.map(u => `<tr><td class="pp-mono">${esc(u.login)}</td><td>${esc(u.display_name || "")}</td><td>${PP_ROLES[u.role] || esc(u.role)}</td><td>${PP_CATS[u.category] || "-"}</td><td>${esc(ppUnit(u.unit_id) || "-")}</td><td>${u.is_active ? pill("Активний", "p-good") : pill("Заблокований", "p-bad")}</td><td><button class="btn btn-soft" type="button" data-a="pp-edit" data-id="${esc(u.id)}">Змінити</button></td></tr>`).join("") || `<tr><td colspan="7" class="lbl">Нікого не знайдено.</td></tr>`}
  </tbody></table></div>`;
}
function apiPeopleView() {
  if (!apiEnsure("ppl", apiLoadPeople)) return apiLoadingHTML("Люди й ролі");
  if (API.ppl.error) return `<section class="card c12 rise"><div class="empty"><b>Не вдалося завантажити дані</b><br>${esc(API.ppl.error)}<br><br><button class="btn btn-soft" data-a="pp-reload">Спробувати ще раз</button></div></section>`;
  const sel = (id, label, opts, v) => `<select class="inp" id="${id}" aria-label="${label}">${opts.map(([k, t]) => `<option value="${k}" ${v === k ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  return `<section class="card c12 rise">
    <div class="card-h"><h2>Люди й ролі</h2></div>
    <div class="toolbar pp-bar"><label class="search inst-search"><span>${IC.search}</span><input id="ppQ" placeholder="Логін або імʼя" value="${esc(P.q)}"></label>
      ${sel("ppRole", "Роль", [["all", "Усі ролі"], ...Object.entries(PP_ROLES)], P.role)}
      ${sel("ppSt", "Статус", [["active", "Активні"], ["blocked", "Заблоковані"], ["all", "Усі"]], P.st)}
      <span class="lbl tnum" id="ppCnt">Показано ${ppFiltered().length} з ${API.ppl.users.length}</span><div class="sp"></div>
      <button class="btn btn-soft" type="button" data-a="pp-import">Імпорт зі списку</button>
      <button class="btn btn-primary" type="button" data-a="pp-new">${IC.plus}Новий користувач</button></div>
    <div id="ppList">${ppListHTML()}</div></section>`;
}
function ppRefreshList() { const l = $("#ppList"); if (!l) return; l.innerHTML = ppListHTML(); $("#ppCnt").textContent = `Показано ${ppFiltered().length} з ${API.ppl.users.length}`; const s = $("#ppRole"); if (s) s.value = P.role; }

/* --- Форми --- */
const ppUnitInput = (u) => `<input class="inp" id="pp-unit" list="pp-units" autocomplete="off" placeholder="Почніть вводити назву" value="${esc(u ? dn(u.name) : "")}"><datalist id="pp-units">${API.ppl.units.map(x => `<option value="${esc(dn(x.name))}"></option>`).join("")}</datalist>`;
const ppRoleSel = v => `<select class="inp" id="pp-role">${Object.entries(PP_ROLES).map(([k, t]) => `<option value="${k}" ${v === k ? "selected" : ""}>${t}</option>`).join("")}</select>`;
const ppCatSel = v => `<select class="inp" id="pp-cat">${Object.entries(PP_CATS).map(([k, t]) => `<option value="${k}" ${v === k ? "selected" : ""}>${t}</option>`).join("")}</select>`;
function ppUnitId() { // назва з поля → id; "" = без підрозділу; undefined = не знайдено
  const v = $("#pp-unit").value.trim().toLowerCase(); if (!v) return "";
  const u = API.ppl.units.find(x => dn(x.name).toLowerCase() === v); return u ? u.id : undefined;
}
function ppSyncCat() { const r = $("#pp-role"), f = $("#pp-catf"); if (r && f) f.hidden = r.value !== "respondent"; }
const ppPwField = (hint) => `<div class="field"><label for="pp-pw">Пароль${hint}</label><div class="pp-pw"><input class="inp" id="pp-pw" type="password" autocomplete="new-password"><button class="btn btn-soft" type="button" data-a="pp-gen">Згенерувати</button><button class="btn btn-soft" type="button" data-a="pp-show">Показати</button><button class="btn btn-soft" type="button" data-a="pp-copy">${IC.copy}Копіювати</button></div><span class="lbl">8-128 символів</span></div>`;

function ppNewDrawer() {
  openDrawer("Новий користувач", `<div class="pp-form" id="ppForm">
    <div class="field"><label for="pp-login">Логін</label><input class="inp" id="pp-login" autocomplete="off"><span class="lbl">3-64 символи: латиниця, цифри, . _ -</span></div>
    <div class="field"><label for="pp-name">Імʼя (псевдонім)</label><input class="inp" id="pp-name" autocomplete="off"><span class="lbl">Без ПІБ: персональні дані не зберігаємо.</span></div>
    ${ppPwField("")}
    <div class="field"><label for="pp-role">Роль</label>${ppRoleSel("respondent")}</div>
    <div class="field" id="pp-catf"><label for="pp-cat">Категорія</label>${ppCatSel("staff")}</div>
    <div class="field"><label for="pp-unit">Підрозділ (необовʼязково)</label>${ppUnitInput(null)}</div>
    <span class="lbl pp-err" id="pp-err" role="alert"></span>
    <button class="btn btn-primary" type="button" data-a="pp-create">Створити</button></div>`, ppSyncCat);
}
async function ppCreate() {
  const login = $("#pp-login").value.trim(), display_name = $("#pp-name").value.trim(), password = $("#pp-pw").value, role = $("#pp-role").value, uid = ppUnitId();
  const err = !/^[A-Za-z0-9._-]{3,64}$/.test(login) ? "Логін: 3-64 символи, латиниця, цифри, . _ -" : API.ppl.users.some(u => u.login.toLowerCase() === login.toLowerCase()) ? "Такий логін уже існує"
    : !display_name ? "Вкажіть імʼя" : password.length < 8 || password.length > 128 ? "Пароль: 8-128 символів" : uid === undefined ? "Підрозділ не знайдено у списку" : "";
  if (err) { $("#pp-err").textContent = err; return; }
  const body = { login, display_name, password, role, category: role === "respondent" ? $("#pp-cat").value : null, unit_id: uid || null };
  try { await api("/admin/users", { method: "POST", body }); } catch (e) { return apiFail(e); }
  API.ppl = null; render(true);
  $("#dBody").innerHTML = `<div class="note-box"><b>Користувача «${esc(login)}» створено</b><span>Пароль показано один раз, збережіть його: <b class="pp-mono" id="pp-once">${esc(password)}</b></span>
    <div><button class="btn btn-soft" type="button" data-a="pp-copy-once">${IC.copy}Копіювати</button> <button class="btn btn-ghost" type="button" data-a="pp-close">Закрити</button></div></div>`;
}
function ppEditDrawer(id) {
  const u = API.ppl.users.find(x => x.id === id); if (!u) return;
  P.edit = u;
  openDrawer("Змінити: " + u.login, `<div class="pp-form" id="ppForm">
    <div class="field"><label for="pp-name">Імʼя (псевдонім)</label><input class="inp" id="pp-name" value="${esc(u.display_name || "")}"><span class="lbl">Без ПІБ: персональні дані не зберігаємо.</span></div>
    <div class="field"><label for="pp-role">Роль</label>${ppRoleSel(u.role)}</div>
    <div class="field" id="pp-catf"><label for="pp-cat">Категорія</label>${ppCatSel(u.category || "staff")}</div>
    <div class="field"><label for="pp-unit">Підрозділ</label>${ppUnitInput(API.ppl.units.find(x => x.id === u.unit_id))}</div>
    <label class="chk-row"><input type="checkbox" id="pp-block" ${u.is_active ? "" : "checked"}> Заблоковано</label>
    ${ppPwField(" (необовʼязково, нове значення)")}
    <span class="lbl pp-err" id="pp-err" role="alert"></span>
    <button class="btn btn-primary" type="button" data-a="pp-save">Зберегти</button></div>`, ppSyncCat);
}
async function ppSave() {
  const u = P.edit, body = {}, name = $("#pp-name").value.trim(), role = $("#pp-role").value, uid = ppUnitId(), pw = $("#pp-pw").value, active = !$("#pp-block").checked;
  if (!name) { $("#pp-err").textContent = "Вкажіть імʼя"; return; }
  if (uid === undefined) { $("#pp-err").textContent = "Підрозділ не знайдено у списку"; return; }
  if (pw && (pw.length < 8 || pw.length > 128)) { $("#pp-err").textContent = "Пароль: 8-128 символів"; return; }
  if (name !== u.display_name) body.display_name = name;
  if (role !== u.role) body.role = role;
  if (role === "respondent" && (role !== u.role || $("#pp-cat").value !== u.category)) body.category = $("#pp-cat").value;
  if ((uid || null) !== (u.unit_id || null)) body.unit_id = uid || null;
  if (active !== !!u.is_active) body.is_active = active;
  if (pw) body.password = pw;
  if (!Object.keys(body).length) return closeDrawer();
  try { await api(`/admin/users/${u.id}`, { method: "PATCH", body }); } catch (e) { return apiFail(e); }
  closeDrawer(); toast("Збережено"); API.ppl = null; render(true);
}

/* --- Імпорт --- */
function ppImportDrawer() {
  openDrawer("Імпорт зі списку", `<div class="pp-form">
    <div class="lbl">Один рядок на користувача, до ${PP_MAX_IMPORT} рядків: <span class="pp-mono">логін;імʼя;роль;категорія;підрозділ;пароль</span>. Роль англійським кодом: ${Object.keys(PP_ROLES).join(", ")}. Категорія (${Object.keys(PP_CATS).join(", ")}) і підрозділ можуть бути порожні.</div>
    <textarea class="inp pp-ta" id="pp-text" rows="8" spellcheck="false" placeholder="ivan01;Псевдонім;respondent;staff;Назва підрозділу;Пароль123"></textarea>
    <div><button class="btn btn-soft" type="button" data-a="pp-check">Перевірити</button></div>
    <div id="pp-prev"></div></div>`);
}
function ppCheck() {
  const r = P.imp = ppParseImport($("#pp-text").value, API.ppl.units, API.ppl.users.map(u => u.login));
  $("#pp-prev").innerHTML = `${r.errors.length ? `<div class="note-box pp-bad"><b>Помилки (${r.errors.length})</b>${r.errors.map(e => `<span>${e.n ? "Рядок " + e.n + ": " : ""}${esc(e.text)}</span>`).join("")}</div>` : ""}
    ${r.rows.length ? `<div class="lbl" style="margin:8px 0">Буде створено: ${r.rows.length}</div><div class="tbl-wrap"><table class="pp-tbl"><thead><tr><th>Логін</th><th>Імʼя</th><th>Роль</th><th>Категорія</th><th>Підрозділ</th></tr></thead><tbody>${r.rows.map(x => `<tr><td class="pp-mono">${esc(x.login)}</td><td>${esc(x.display_name)}</td><td>${PP_ROLES[x.role]}</td><td>${PP_CATS[x.category] || "-"}</td><td>${esc(ppUnit(x.unit_id) || "-")}</td></tr>`).join("")}</tbody></table></div>
    <button class="btn btn-primary" type="button" data-a="pp-run" style="margin-top:10px">Створити ${r.rows.length}</button>` : `<div class="lbl">Нічого створювати.</div>`}`;
}
async function ppRun() {
  const rows = (P.imp && P.imp.rows) || [], bad = [], btn = document.querySelector('[data-a="pp-run"]'); let ok = 0;
  if (btn) btn.disabled = true;
  for (const x of rows) {
    const { n, ...body } = x;
    try { await api("/admin/users", { method: "POST", body }); ok++; } catch (e) { bad.push(`Рядок ${n} (${x.login}): ${apiErrText(e)}`); }
  }
  API.ppl = null; render(true);
  $("#pp-prev").innerHTML = `<div class="note-box ${bad.length ? "pp-bad" : ""}"><b>Створено ${ok}, помилок ${bad.length}</b>${bad.map(t => `<span>${esc(t)}</span>`).join("")}</div>`;
}

/* --- Події --- */
const ppClip = t => navigator.clipboard.writeText(t).then(() => toast("Скопійовано"), () => toast("Не вдалося скопіювати"));
document.addEventListener("click", e => {
  const el = e.target.closest && e.target.closest("[data-a^='pp-']"); if (!el) return;
  const a = el.dataset.a;
  if (a === "pp-role") { P.role = P.role === el.dataset.v ? "all" : el.dataset.v; ppRefreshList(); }
  else if (a === "pp-new") ppNewDrawer();
  else if (a === "pp-edit") ppEditDrawer(el.dataset.id);
  else if (a === "pp-import") ppImportDrawer();
  else if (a === "pp-create") ppCreate();
  else if (a === "pp-save") ppSave();
  else if (a === "pp-check") ppCheck();
  else if (a === "pp-run") ppRun();
  else if (a === "pp-gen") { const i = $("#pp-pw"); i.value = ppGenPassword(); i.type = "text"; }
  else if (a === "pp-show") { const i = $("#pp-pw"); i.type = i.type === "password" ? "text" : "password"; el.textContent = i.type === "password" ? "Показати" : "Сховати"; }
  else if (a === "pp-copy") { const v = $("#pp-pw").value; v ? ppClip(v) : toast("Спершу введіть або згенеруйте пароль"); }
  else if (a === "pp-copy-once") ppClip($("#pp-once").textContent);
  else if (a === "pp-close") closeDrawer();
  else if (a === "pp-reload") { API.ppl = API.ovw = null; render(true); }
});
document.addEventListener("input", e => { if (e.target.id === "ppQ") { P.q = e.target.value; ppRefreshList(); } });
document.addEventListener("change", e => {
  if (e.target.id === "ppRole") { P.role = e.target.value; ppRefreshList(); }
  else if (e.target.id === "ppSt") { P.st = e.target.value; ppRefreshList(); }
  else if (e.target.id === "pp-role") ppSyncCat();
});

/* --- Екран «Зведення» --- */
function apiSummaryView() {
  if (!apiEnsure("ovw", () => api("/admin/overview"))) return apiLoadingHTML("Зведення");
  const O = API.ovw;
  if (O.error) return `<section class="card c12 rise"><div class="empty"><b>Не вдалося завантажити дані</b><br>${esc(O.error)}<br><br><button class="btn btn-soft" data-a="pp-reload">Спробувати ще раз</button></div></section>`;
  const u = O.users, tile = (n, t) => `<div class="card pp-tile"><b class="big tnum">${n}</b><span class="lbl">${t}</span></div>`;
  const max = Math.max(1, ...Object.values(u.by_role || {}));
  const bar = (v, m) => `<div class="pp-bar-t"><i style="width:${Math.round(100 * v / Math.max(1, m))}%"></i></div>`;
  return `<section class="c12 rise pp-tiles">${tile(u.total, "Усього користувачів")}${tile(u.total - u.inactive, "Активних")}${tile(O.units.total, "Підрозділів")}${tile(O.checks.findings_open, "Відкритих знахідок перевірок")}</section>
  <section class="card c12 rise"><div class="card-h"><h2>Люди за ролями</h2></div>
    <div class="rows">${Object.keys(PP_ROLES).map(r => { const v = (u.by_role || {})[r] || 0; return `<div class="pp-line"><span class="pp-lab">${PP_ROLES[r]}</span>${bar(v, max)}<b class="tnum pp-n">${v}</b></div>`; }).join("")}</div></section>
  <section class="card c12 rise"><div class="card-h"><h2>Хвилі</h2></div>
    ${O.campaigns.length ? O.campaigns.map(c => { const st = CST[c.status] || [c.status, "p-mute"]; return `<div class="pp-camp"><div class="card-h"><b>${esc(dn(c.title))}</b>${pill(st[0], st[1])}</div>
      ${(c.progress || []).map(p => `<div class="pp-line"><span class="pp-lab">${esc(p.questionnaire_title)}</span>${p.hidden ? `<span class="pp-hid">${IC.lock}приховано</span>` : `${bar(p.submitted || 0, p.eligible || 0)}<b class="tnum pp-n">${p.submitted ?? 0} з ${p.eligible ?? 0}</b>`}</div>`).join("") || `<div class="lbl">Анкет у хвилі немає.</div>`}</div>`; }).join("") : `<div class="lbl">Хвиль ще немає.</div>`}
    <div class="lbl" style="margin-top:10px">Групи, менші за мінімальну, не показуються.</div></section>
  <section class="c12 rise toolbar"><a class="btn btn-soft" href="#people">Люди й ролі</a><a class="btn btn-soft" href="#audit">Журнал</a></section>`;
}
V.people = () => `<section class="card c12 rise"><div class="empty"><b>Доступно лише в режимі з бекендом</b></div></section>`;
V.summary = V.people;
