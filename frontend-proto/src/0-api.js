/* ---------- Підключення до бекенду ----------
 * Якщо поруч є API (GET /api/v1/config відповідає), сторінка працює з даними сервера: вхід, результати,
 * рекомендації й рішення, заходи, анкети (за обліковим записом і анонімно за посиланням /s/<токен>),
 * чек-лист із файлами-доказами, хвилі й посилання, журнал. Без API (відкрито з файлу, Vercel) — демо-дані
 * в браузері, як раніше. Решта коду бере дані через гачки: inst(), buildRecs(), measures(), SV()/SQ(), apiView().
 */
const API = {
  on: false, base: "/api/v1", cfg: null, user: null, anon: false, token: null,
  model: null, empty: false, recs: [], ms: [], campaignId: null, unitId: null,
  survey: null, surveyUsed: false, surveyMsg: null, surveyTarget: null,
  my: null, assignments: null, adm: null, qs: null, ck: null, log: null, loading: {},
};
const SESSION_KEY = "ii-session";

/* --- Запити --- */
function apiToken() { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
function apiSetToken(t) { try { t ? sessionStorage.setItem(SESSION_KEY, t) : sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
const apiAuth = () => { const t = apiToken(); return t ? { Authorization: "Bearer " + t } : {}; };
class ApiErr extends Error { constructor(status, body) { super((body && body.message) || "Сервер не відповів"); this.status = status; this.code = body && body.code; this.hint = (body && body.hint) || ""; } }
async function api(path, { method = "GET", body, headers = {}, auth = true, raw = false } = {}) {
  const h = { Accept: "application/json", ...(auth ? apiAuth() : {}), ...headers };
  let b;
  if (body instanceof FormData) b = body; else if (body !== undefined) { h["Content-Type"] = "application/json"; b = JSON.stringify(body); }
  let r;
  try { r = await fetch(path.startsWith("/api/") ? path : API.base + path, { method, headers: h, body: b }); }
  catch (e) { throw new ApiErr(0, { message: "Немає зв’язку із сервером", hint: "Перевірте мережу." }); }
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    if (r.status === 401 && auth && apiToken() && API.user) { apiSetToken(null); API.user = null; showLogin("Сесія завершилась. Увійдіть знову."); }
    throw new ApiErr(r.status, j);
  }
  if (raw) return r;
  if (r.status === 204) return null;
  return (r.headers.get("content-type") || "").includes("json") ? r.json() : r.text();
}
const apiErrText = e => e instanceof ApiErr ? `${e.message}${e.hint ? ". " + e.hint : ""}` : "Не вдалося виконати дію";
const apiFail = e => toast(apiErrText(e));

/* --- Ролі: обліковий запис → роль інтерфейсу --- */
function frontRole(u) {
  if (!u) return "respondent";
  if (["admin", "commissioner", "leader", "auditor", "coordinator"].includes(u.role)) return u.role;
  return u.category === "working_group" ? "checklist_editor" : "respondent";
}
const RESULT_ROLES = ["leader", "auditor", "admin", "commissioner"];

/* --- Старт --- */
async function boot() {
  let cfg = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch("/api/v1/config", { signal: ctl.signal }); clearTimeout(t);
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) cfg = await r.json();
  } catch (e) {}
  if (!cfg) { render(); return; } // демо-режим
  API.on = true; API.cfg = cfg; S.k = cfg.min_group_size;
  // Розподіл прав як на бекенді: укладач підтверджує чек-лист, робоча група ще й проходить анкету.
  NAV.find(n => n[0] === "checklist")[3].push("commissioner", "auditor");
  for (const r of ["survey", "me"]) NAV.find(n => n[0] === r)[3].push("checklist_editor");
  NAV.find(n => n[0] === "survey")[1] = "Пройти анкету";
  const tm = location.pathname.match(/^\/s\/([^/?#]+)/);
  if (tm) return bootToken(decodeURIComponent(tm[1]));
  if (apiToken()) {
    try { const me = await api("/auth/session"); return afterLogin(me); } catch (e) { apiSetToken(null); }
  }
  if (cfg.auth.proxy && !cfg.auth.password) {
    try { const s = await api("/auth/proxy", { method: "POST", auth: false }); apiSetToken(s.access_token); return afterLogin(s.user); } catch (e) {}
  }
  showLogin();
}

function shellMode(mode) {
  const app = document.querySelector(".app");
  app.classList.toggle("login", mode === "login");
  app.classList.toggle("anon", mode === "anon");
}

function showLogin(msg) {
  shellMode("login");
  closeDrawer(); aiClose();
  $("#title").textContent = "Вхід";
  const demo = [["leader", "Керівник: огляд, рекомендації, заходи"], ["admin", "Уповноважений: хвилі, посилання, перевірки, журнал"], ["coordinator", "Координатор: люди, ролі, зведення"], ["commissioner", "Укладач: анкети, підтвердження чек-листа"], ["auditor", "Аудитор: перегляд і журнал"], ["wg1", "Робоча група: анкета й чек-лист"], ["staff01", "Особовий склад: анкета й результати"], ["expert1", "Експерт: анкета"]];
  $("#view").innerHTML = `<div class="login-wrap c12">
    <section class="card rise login-card">
      <div class="brand" style="padding:0 0 6px"><span class="logo">${IC.pulse.replace("<svg", '<svg width="20" height="20"')}</span>Integrity<span style="color:var(--muted);font-weight:500">Index</span></div>
      <h2 style="margin:6px 0 2px;font-size:22px">Вхід</h2>
      ${msg ? `<div class="note-box" style="margin:8px 0"><span>${esc(msg)}</span></div>` : ""}
      ${API.cfg.auth.password ? `<form id="lf" style="display:flex;flex-direction:column;gap:12px;margin-top:10px">
        <div class="field"><label for="lu">Логін</label><input class="inp" id="lu" autocomplete="username" required></div>
        <div class="field"><label for="lp">Пароль</label><input class="inp" id="lp" type="password" autocomplete="current-password" required></div>
        <span class="lbl" id="lerr" style="color:var(--red)"></span>
        <button class="btn btn-primary" type="submit" style="justify-content:center">Увійти ${IC.arrowR}</button>
      </form>` : ""}
      ${API.cfg.auth.proxy ? `<button class="btn btn-soft" id="lproxy" style="justify-content:center;margin-top:10px">Увійти через систему організації</button>` : ""}
      <div class="lbl" style="margin-top:12px;display:flex;gap:8px;align-items:center"><span style="display:inline-flex;width:16px">${IC.shield}</span>Анонімна анкета за одноразовим посиланням відкривається без входу.</div>
    </section>
    ${API.cfg.auth.password ? `<section class="card rise login-card">
      <h2 style="margin:0 0 4px;font-size:16px">Демо-облікові записи</h2>
      <div class="lbl" style="margin-bottom:10px">Пароль у всіх однаковий: DEMO_PASSWORD з файлу .env. Дані синтетичні.</div>
      <div class="rows">${demo.map(([l, t]) => `<a class="row click" href="javascript:void 0" onclick="document.getElementById('lu').value='${l}';document.getElementById('lp').focus()"><b class="tnum" style="min-width:110px;color:var(--teal-deep)">${l}</b><div class="grow lbl">${t}</div></a>`).join("")}</div>
    </section>` : ""}
  </div>`;
  const f = $("#lf");
  if (f) {
    f.onsubmit = async e => {
      e.preventDefault();
      const b = f.querySelector("button"); b.disabled = true; $("#lerr").textContent = "";
      try {
        const s = await api("/auth/session", { method: "POST", auth: false, body: { login: $("#lu").value.trim(), password: $("#lp").value } });
        apiSetToken(s.access_token); await afterLogin(s.user);
      } catch (err) { $("#lerr").textContent = apiErrText(err); b.disabled = false; }
    };
    setTimeout(() => $("#lu") && $("#lu").focus(), 50);
  }
  const p = $("#lproxy");
  if (p) p.onclick = async () => { try { const s = await api("/auth/proxy", { method: "POST", auth: false }); apiSetToken(s.access_token); await afterLogin(s.user); } catch (err) { toast(apiErrText(err)); } };
}

async function afterLogin(user) {
  API.user = user; S.role = frontRole(user); API.my = API.assignments = API.adm = API.qs = API.ck = API.log = API.logF = API.chain = null; API.survey = null;
  shellMode("app");
  const rc = document.querySelector(".role-card");
  rc.innerHTML = `<small>Ви увійшли як</small><b style="font-size:14px">${esc(user.display_name)}</b><small>${ROLE[S.role][0]} · ${esc(user.login)}</small>
    <button class="btn btn-ghost" id="logoutBtn" type="button">${IC.arrowL}Вийти</button>`;
  $("#logoutBtn").onclick = async () => { try { await api("/auth/session", { method: "DELETE" }); } catch (e) {} apiSetToken(null); API.user = null; API.model = null; history.replaceState(null, "", "/"); showLogin(); };
  setAvatar(); aiBtn();
  if (RESULT_ROLES.includes(S.role)) await apiLoadResults();
  if (!allowed((location.hash || "").slice(1).split("/")[0])) location.hash = HOME[S.role];
  render();
}

/* --- Анонімне проходження за посиланням /s/<токен> --- */
async function bootToken(token) {
  API.anon = true; API.token = token; S.role = "respondent"; shellMode("anon");
  API.surveyTarget = { kind: "token", token };
  location.hash = "survey";
  S.survey = { phase: "intro", sec: 0, a: {}, miss: false };
  try { API.survey = apiSurveyModel(await api("/respond/form", { auth: false, headers: { "X-Response-Token": token } }), "token"); }
  catch (e) { API.survey = null; API.surveyMsg = e.code === "token_used" ? "used" : e.code === "campaign_not_open" ? "closed" : "invalid"; }
  render();
}

/* --- Результати: остання закрита хвиля --- */
const CATEGORY_SRC = { staff: ["os", "Особовий склад (анкета 2)"], working_group: ["wg", "Робоча група (анкета 1)"], expert: ["experts", "Зовнішні експерти (анкета 3)"], checklist: ["wg", "Контрольний чек-лист (робоча група)"] };
const GROUP_FLAG = { low_participation: ["minor", "Низька участь", "Відповіла менша частка запрошених."], suspiciously_perfect: ["major", "Підозріло однакові «ідеальні» відповіді", "Значна частка анкет з однаковими найвищими відповідями."], insufficient_data: ["minor", "Недостатньо відповідей", "У групі замало відповідей для висновку."] };
const GRADE = { A: "A", B: "B", C: "C", insufficient_data: "insufficient" };
function cycleLabels(points) { const used = {}; return points.map(p => { const b = p.closed_on ? p.closed_on.slice(0, 7) : p.campaign_title; used[b] = (used[b] || 0) + 1; return used[b] === 1 ? b : `${b} (${used[b]})`; }); }

function apiModel(r, h) {
  const comps = COMPS.map(id => {
    const c = r.components.find(x => x.code === id) || {};
    const v = c.score ?? c.self_score ?? 0, P = c.self_score ?? v, F = c.facts_score ?? P;
    return { id, P, F, cr: { v, lim: !!c.cut_by_facts, reason: c.cut_by_facts ? c.rule : undefined } };
  });
  const pItems = r.components.filter(c => COMPS.includes(c.code)).flatMap(c => {
    const src = (c.sources || []).filter(s => s.score != null && s.effective_weight > 0), tot = src.reduce((a, s) => a + s.effective_weight, 0) || 1;
    return src.map(s => { const [k, t] = CATEGORY_SRC[s.source] || ["wg", s.title]; return { id: `${c.code}-${s.source}`, c: c.code, t, w: r1(s.effective_weight / tot * 100), v: s.score, src: k, kind: "p" }; });
  });
  const fItems = r.components.filter(c => COMPS.includes(c.code)).flatMap(c => {
    const fs = (c.facts || []).filter(f => f.score != null);
    return fs.map(f => ({ id: `${c.code}-f-${f.indicator}`, c: c.code, t: f.title, w: r1(100 / fs.length), v: f.score,
      kind: f.numerator != null && f.denominator ? "pct" : "lvl", val: f.numerator != null && f.denominator ? [f.numerator, f.denominator] : (f.level || 1),
      from: (f.sources || []).join(", ") || "Дані обліку", rule: f.rule }));
  });
  const pts = (h && h.points) || [], labels = cycleLabels(pts);
  let series = pts.map((p, i) => ({ cycle: labels[i], index: p.index ?? 0, cr: Object.fromEntries(COMPS.map(c => [c, (p.components || {})[c] ?? 0])) }));
  const at = pts.findIndex(p => p.campaign_id === r.campaign_id);
  if (at >= 0) series = series.slice(0, at + 1);
  else series.push({ cycle: r.closed_on ? r.closed_on.slice(0, 7) : r.campaign_title, index: r.index.score ?? 0, cr: Object.fromEntries(comps.map(c => [c.id, c.cr.v])) });
  if (series.length === 1) series = [series[0], series[0]];
  const events = pts.flatMap((p, i) => i > 0 && p.measures_done > 0 ? [{ after: labels[i - 1], t: `Виконано заходів між хвилями: ${p.measures_done}` }] : []);
  const flags = [];
  for (const c of r.components) for (const f of c.flags || []) flags.push({ id: `${f.code}:${c.code}`, w: f.severity === "serious" ? "major" : "minor", t: `${c.title}: ${f.title}`, ex: c.rule || f.title, raised: true });
  for (const g of r.groups) for (const code of g.flags || []) if (GROUP_FLAG[code]) flags.push({ id: `${code}:${g.category}`, w: GROUP_FLAG[code][0], t: `${g.title}: ${GROUP_FLAG[code][1]}`, ex: GROUP_FLAG[code][2], raised: true });
  const responses = r.groups.reduce((a, g) => a + (g.submitted || 0), 0);
  const m = finish({ id: ALPHA, name: r.unit_name, components: comps, pItems, fItems, series, events, flags, responses });
  m.trust = GRADE[r.index.reliability] || "insufficient";
  m.index = r.index.score ?? m.index; m.level = (r.index.level && r.index.level.level) || m.level; m.delta = r1(m.index - m.prevIndex);
  if (r.index.reliability_reasons && r.index.reliability_reasons[0]) m.summary = r.index.reliability_reasons[0];
  m.groups = r.groups; m.rule = r.index.rule;
  const sorted = [...comps].sort((a, b) => a.cr.v - b.cr.v), top = sorted[sorted.length - 1];
  // «Що потребує уваги» і «Сильні сторони» — з сервера (problems, weakest_questions, strengths за зонами методики)
  const byCode = Object.fromEntries(comps.map(c => [c.id, c])), qComp = code => (code || "").split(".")[0];
  m.attention = [
    ...(r.problems || []).filter(p => byCode[p.code]).map(p => ({ t: byCode[p.code].cr.lim ? `${COMP[p.code].n}: підтвердити фактами` : `${COMP[p.code].n}: підсилити напрям`, c: p.code, v: p.score ?? byCode[p.code].cr.v, hint: `Зараховане значення компонента ${COMP[p.code].n}, 0-100.` })),
    ...(r.weakest_questions || []).filter(q => q.score != null && q.score < 62.5 && COMPS.includes(qComp(q.code))).slice(0, 3).map(q => ({ t: q.text, c: qComp(q.code), v: q.score, q: q.code, hint: `Середній бал питання ${q.code}, 0-100.` })),
  ];
  m.strengths = (r.strengths || []).filter(s => byCode[s.code]).map(s => ({ t: `Сильний компонент: ${COMP[s.code].n}`, c: s.code, v: s.score ?? byCode[s.code].cr.v, hint: `Зараховане значення компонента ${COMP[s.code].n}, 0-100.` }));
  if (!m.strengths.length) m.strengths = [{ t: `Найвищий результат у компоненті ${COMP[top.id].n}`, c: top.id, v: top.cr.v, hint: `Зараховане значення компонента ${COMP[top.id].n}, 0-100.` }];
  if (series[0].index < m.index) m.strengths.push({ t: m.index > series[0].index ? "Зростання індексу з першої хвилі" : "Зміна індексу з першої хвилі", v: r1(m.index - series[0].index), hint: "Сумарна зміна індексу з першої закритої хвилі, у пунктах.", unit: "пт" });
  return m;
}

const CK_ST = { full: "впроваджено повністю", partial: "частково", none: "не впроваджено" };
const DEC_ST = { accepted: "accepted", clarify: "clarified", rejected: "rejected" };
const BASIS = { self_score: "Самооцінка", facts_score: "Факти", score: "Зараховано", percent: "Відсоток", confirmed: "Підтверджено пунктів", total: "Усього", found: "Знайдено", pending: "Не розглянуто", change: "Зміна", level: "Рівень" };
function apiRec(x, m, res) {
  const c = COMPS.includes(x.component) ? x.component : "system", st = x.decision ? DEC_ST[x.decision.decision] || "proposed" : "proposed", cm = x.decision && x.decision.comment || "";
  // Звʼязок рекомендації з питанням чи показником, з якого вона виникла (код правила: fact:<показник>, question:<питання>)
  const [kind, ref] = x.code.split(":"), links = [];
  if (kind === "fact" && m) { const f = m.fItems.find(i => i.id.endsWith("-f-" + ref)); if (f) links.push({ id: f.id, t: f.t, v: fb(f.v), item: true }); }
  const qLink = q => ({ id: COMPS.includes(q.component) ? q.component : c, q: q.code, t: `Питання «${q.text}»`, v: q.score != null ? fb(q.score) : "—", item: true });
  if (kind === "checklist" && res && res.checklist) { const i = (res.checklist.items || []).find(i => i.number === ref); if (i) links.push({ id: COMPS.includes(i.component) ? i.component : c, ck: i.number, t: `Пункт чек-листа ${i.number}${i.text ? ` «${i.text.replace(/^[\d.]+\s*/, "")}»` : ""}`, v: CK_ST[i.status] || "не заповнено", item: true }); }
  if (kind === "question" && res) { const q = (res.questions || []).find(i => i.code === ref); if (q) links.push(qLink(q)); }
  if (kind === "cut" && m) m.fItems.filter(i => i.c === x.component && i.v < 62.5).slice(0, 2).forEach(f => links.push({ id: f.id, t: f.t, v: fb(f.v), item: true }));
  if (kind === "weakest" && res) (res.questions || []).filter(q => q.component === x.component && q.score != null).sort((a, b) => a.score - b.score).slice(0, 2).forEach(q => links.push(qLink(q)));
  return { id: x.code, t: x.title, c, pri: ["high", "medium", "low"].includes(x.priority) ? x.priority : "medium", items: links.filter(l => !l.q).map(l => l.id), links,
    why: `${x.description} Правило: ${x.rule}`, acts: (x.suggested_measures || []).slice(0, 4).map(s => s.catalog_number ? `${s.catalog_number}. ${s.title}` : s.title),
    evidence: [...links, ...Object.entries(x.basis || {}).filter(([k, v]) => typeof v === "number" && BASIS[k] && !(links.length && k === "score")).slice(0, 4 - links.length).map(([k, v]) => ({ id: COMPS.includes(x.component) ? x.component : "", t: BASIS[k], v: fb(v), item: true }))],
    st, note: st === "rejected" ? { reason: cm } : st === "clarified" ? { comment: cm } : {} };
}
// Питання анкети з результатів хвилі: бал, бал за групами й розподіл відповідей
function openApiQ(code) {
  const q = API.res && (API.res.questions || []).find(i => i.code === code); if (!q) return toast("Питання не знайдено в результатах хвилі");
  const grp = k => (CATEGORY_SRC[k] || [null, k])[1];
  openDrawer("Питання анкети", `<div style="font-weight:600;font-size:16px">${esc(q.text)}</div>
    <div class="lbl" style="margin:4px 0 14px">${[q.section, COMP[q.component] ? COMP[q.component].n : q.component].filter((v, i, a) => v && a.indexOf(v) === i).map(esc).join(" · ")} · код ${esc(q.code)}</div>
    <div class="stat4 tnum" style="grid-template-columns:1fr 1fr"><div><small>Середній бал</small><b>${q.score != null ? fb(q.score) : "—"}</b></div><div><small>Рівень</small><b>${q.score != null ? LSHORT[level(q.score) - 1] : "—"}</b></div></div>
    ${q.by_category.map(g => `<div style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(grp(g.category))}</b><span class="lbl tnum">${g.n} відп. · бал ${g.score != null ? fb(g.score) : "—"}</span></div>
      ${g.distribution.map(d => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 90px 44px;gap:8px;align-items:center;margin-top:6px;font-size:13px"><span>${esc(d.option_text)}</span><div class="contrib"><i style="width:${d.percent}%;background:var(--teal)"></i></div><span class="lbl tnum" style="text-align:right">${fb(d.percent)}%</span></div>`).join("")}</div>`).join("")}
    <a class="btn btn-soft" href="#explain/${q.component}" onclick="closeDrawer()" style="justify-content:center;margin-top:18px">${IC.arrowR}Компонент у розкладі індексу</a>`);
}
const MEAS_ST = { planned: "accepted", in_progress: "inprogress", done: "done", cancelled: "cancelled" };
// Перевірка наступною хвилею (бекенд, services/measures.verify): зріс компонент заходу — підтверджено; не зріс — потрібен перегляд
const VERIFY_ST = { improved: "confirmed", worsened: "notconfirmed", within_error: "notconfirmed" };
function apiMeasure(x, titles) {
  const v = x.verification || {}, st = x.status === "done" && VERIFY_ST[v.status] ? VERIFY_ST[v.status] : MEAS_ST[x.status] || "accepted";
  const d = v.delta != null ? ` (${v.delta > 0 ? "+" : ""}${fb(v.delta)})` : "";
  const vf = x.status === "done" ? (st === "confirmed" ? [`Підтверджено: компонент зріс${d}`, "p-good"] : st === "notconfirmed" ? [`Не підтверджено: ${v.title || "без змін"}${d}`, "p-bad"] : v.status === "check_data" ? ["Перевірити дані: достовірність C", "p-warn"] : ["Очікує наступного оцінювання", "p-info"]) : null;
  return { id: x.id, rec: titles[x.recommendation_code] || (x.recommendation_code ? "попередньої хвилі" : "окремий захід"), t: x.title, who: x.owner, due: x.due_date, st, ind: x.component, vf, vrule: v.rule };
}
const MEAS_BACK = { accepted: "planned", inprogress: "in_progress", done: "done" };

async function apiLoadResults() {
  API.model = null; API.empty = false; API.recs = []; API.ms = [];
  let d;
  try { d = await api("/dashboard"); }
  catch (e) { if (e.status === 404 || e.status === 409) { API.empty = true; return; } throw e; }
  API.campaignId = d.campaign_id; API.unitId = d.unit_id;
  const q = d.unit_id ? `?unit_id=${d.unit_id}` : "";
  const [r, h, recs, ms] = await Promise.all([
    api(`/campaigns/${d.campaign_id}/results${q}`), api(`/units/${d.unit_id}/history`).catch(() => null),
    api(`/campaigns/${d.campaign_id}/recommendations${q}`).catch(() => ({ items: [] })), api(`/measures${q}`).catch(() => []),
  ]);
  API.model = apiModel(r, h);
  API.res = r; API.recs = recs.items.map(x => apiRec(x, API.model, r));
  const titles = Object.fromEntries(recs.items.map(x => [x.code, x.title]));
  API.ms = ms.map(x => apiMeasure(x, titles));
  TODAY = new Date().toISOString().slice(0, 10); TODAY_UA = ua(TODAY);
  CYCLE = API.model.series[API.model.series.length - 1].cycle;
  $("#cycleBtn").innerHTML = `${IC.cal}Цикл ${CYCLE}`;
  const n = API.model.series.length;
  S.trend = { from: 0, to: n - 1, lines: [] }; S.cmp = { a: Math.max(0, n - 2), b: n - 1 };
}
async function apiReloadResults() { try { await apiLoadResults(); } catch (e) { apiFail(e); } render(true); }

async function apiDecide(code, decision, comment, measure) {
  await api(`/campaigns/${API.campaignId}/recommendations/${encodeURIComponent(code)}/decision`, { method: "POST", body: { unit_id: API.unitId, decision, comment, ...(measure ? { measure: { ...measure, description: "" } } : {}) } });
  await apiReloadResults();
}
function apiSetMSt(id, st) {
  const x = measures().find(m => m.id === id); if (!x || !M_NEXT[x.st].includes(st)) return;
  const send = async evidence => {
    await api(`/measures/${id}`, { method: "PATCH", body: { status: MEAS_BACK[st] || "in_progress", ...(st === "done" ? { evidence, done_on: TODAY } : {}) } });
    toast(`Статус заходу змінено на «${M_ST[st][0]}».`); await apiReloadResults();
  };
  if (st !== "done") return send().catch(apiFail);
  openDrawer("Позначити захід виконаним", `<div style="font-weight:600">${esc(x.t)}</div>
    <div class="field"><label for="f-ev">Доказ виконання</label><textarea class="inp" id="f-ev" rows="4"></textarea><span class="lbl" id="f-err">Документ, наказ, звіт або посилання на нього. Без доказу захід не позначити виконаним.</span></div>
    <button class="btn btn-primary" id="f-ok" style="justify-content:center">${IC.ok}Зберегти</button>`, b => {
    b.querySelector("#f-ok").onclick = () => { const t = b.querySelector("#f-ev").value.trim(); if (t.length < 3) { const e = b.querySelector("#f-err"); e.textContent = "Опишіть доказ."; e.style.color = "var(--red)"; return; } send(t).then(closeDrawer, apiFail); };
  });
}

/* --- Анкета: форма сервера → модель proto --- */
function apiSurveyModel(form, kind, category) {
  const CAT = { working_group: "Робоча група", staff: "Особовий склад", expert: "Зовнішні експерти" };
  const guess = t => /культур/i.test(t) ? "culture" : /систем/i.test(t) ? "system" : /підзвітн/i.test(t) ? "accountability" : null;
  const opt = {};
  const sections = form.sections.map((s, si) => {
    const id = s.component || guess(s.title) || "overall"; // компонент з сервера (culture/system/accountability/overall); за назвою лише для старих відповідей
    return { id, t: s.title, about: COMPS.includes(id) ? { culture: "про ставлення до доброчесності", system: "про процедури й канали звернень", accountability: "про прозорість рішень і виконання заходів" }[id] : id === "overall" ? "" : "за темою розділу",
      q: s.questions.map(q => {
        if (q.type === "scale" && !q.options.length) { const vals = []; for (let v = q.scale_min; v <= q.scale_max; v++) vals.push(v); opt[q.id] = vals.map(v => ({ value: v })); return [q.id, q.text, vals.map(String)]; }
        opt[q.id] = q.options.map(o => ({ id: o.id })); return [q.id, q.text, q.options.map(o => o.text)];
      }) };
  });
  return { title: form.title, cat: CAT[category] || "Анонімне опитування", sections, opt, kind, campaignId: form.campaign_id, questionnaireId: form.questionnaire_id, k: form.min_group_size };
}
async function apiSubmitSurvey() {
  const sv = API.survey, answers = Object.entries(S.survey.a).filter(([qid]) => sv.opt[qid]).map(([qid, i]) => { const o = sv.opt[qid][i]; return o.id ? { question_id: qid, option_ids: [o.id] } : { question_id: qid, option_ids: [], value: o.value }; });
  try {
    if (sv.kind === "token") await api("/respond/responses", { method: "POST", auth: false, headers: { "X-Response-Token": API.token }, body: { answers } });
    else await api(`/campaigns/${sv.campaignId}/questionnaires/${sv.questionnaireId}/responses`, { method: "POST", body: { answers } });
  } catch (e) {
    if (e.code === "token_used" || e.status === 409) { API.surveyUsed = true; API.surveyMsg = "used"; render(); return; }
    toast(apiErrText(e)); return;
  }
  S.survey = { phase: "done", sec: 0, a: {}, miss: false }; API.surveyUsed = sv.kind === "token";
  try { localStorage.removeItem("ii-survey-draft"); } catch (e) {}
  if (sv.kind !== "token") { sv.submitted = true; API.assignments = null; API.my = null; }
  render();
}

/* --- Підвантаження даних екрана: true, якщо дані є --- */
function apiEnsure(key, loader) {
  if (API[key] !== null && API[key] !== undefined) return true;
  if (!API.loading[key]) {
    API.loading[key] = true;
    loader().then(v => { API[key] = v; }, e => { API[key] = { error: apiErrText(e) }; }).finally(() => { API.loading[key] = false; render(true); });
  }
  return false;
}
const apiLoadingHTML = t => `<section class="card c12 rise"><div class="empty"><b>${t}</b><br>Завантажуємо дані з сервера…</div></section>`;
const apiErrorHTML = e => `<section class="card c12 rise"><div class="empty"><b>Не вдалося завантажити дані</b><br>${esc(e)}<br><br><button class="btn btn-soft" onclick="API.adm=API.qs=API.ck=API.log=API.my=API.assignments=null;render()">Спробувати ще раз</button></div></section>`;
const RESULT_VIEWS = ["overview", "explain", "trends", "compare", "recs", "tracker", "report", "sources"];

/* --- Екрани з даними сервера (null — показати звичайний екран proto) --- */
function apiView(r) {
  if (!API.on) return null;
  if (RESULT_VIEWS.includes(r) && r !== "sources" && !API.model)
    return API.empty ? `<section class="card c12 rise"><div class="empty"><b>Ще немає закритої хвилі оцінювання</b><br>Результати зʼявляться, коли уповноважений закриє хвилю: система порахує індекс і збереже незмінний знімок.</div></section>` : apiLoadingHTML("Результати");
  if (r === "survey") return apiSurveyView();
  if (r === "me") return apiMeView();
  if (r === "manage") return apiManageView();
  if (r === "surveys") return apiSurveysView();
  if (r === "checklist") return apiChecklistView();
  if (r === "audit") return apiAuditView();
  if (r === "checks") return apiChecksView();
  if (r === "people") return apiPeopleView();
  if (r === "summary") return apiSummaryView();
  return null;
}

function apiSurveyView() {
  if (API.anon) {
    if (API.surveyMsg && !API.survey) {
      const [t, d] = API.surveyMsg === "used" ? ["Цю анкету вже заповнено", "Повторно відповісти за цим посиланням не можна: так ми захищаємо анонімність і не допускаємо подвоєних відповідей. Дякуємо за участь."]
        : API.surveyMsg === "closed" ? ["Опитування зараз не приймає відповіді", "Хвилю оцінювання ще не відкрито або вже закрито. Перевірте строки в того, хто надіслав вам посилання."]
        : ["Посилання недійсне або застаріле", "Перевірте, чи адресу скопійовано повністю. Якщо не допомогло, попросіть нове посилання в того, хто надіслав вам анкету."];
      return `<div class="survey c12"><section class="card rise" style="padding:32px;text-align:center"><div class="done-ic" style="background:var(--soft);color:var(--muted)">${IC.lock}</div><h2 style="margin:18px 0 6px;font-size:22px;font-weight:600">${t}</h2><p class="lbl" style="max-width:480px;margin:0 auto">${d}</p></section></div>`;
    }
    return null;
  }
  // Після подання показуємо подяку; наступний захід на екран бере наступну анкету.
  if (API.survey && API.survey.submitted && S.survey.phase !== "done") API.survey = null;
  if (API.survey) return null;
  if (!apiEnsure("assignments", () => api("/me/assignments"))) return apiLoadingHTML("Анкети");
  if (API.assignments.error) return apiErrorHTML(API.assignments.error);
  const todo = API.assignments.filter(a => a.kind !== "checklist");
  const next = todo.find(a => !a.submitted);
  if (next && !API.loading.form) {
    API.loading.form = true;
    api(`/campaigns/${next.campaign_id}/questionnaires/${next.questionnaire_id}/form`).then(f => { API.survey = apiSurveyModel(f, "account", API.user.category); S.survey = { phase: "intro", sec: 0, a: {}, miss: false }; }, apiFail).finally(() => { API.loading.form = false; render(true); });
    return apiLoadingHTML(next.questionnaire_title);
  }
  if (next) return apiLoadingHTML(next.questionnaire_title);
  return `<section class="card c12 rise"><div class="empty"><b>Зараз немає анкет до проходження</b><br>${todo.length ? `Ви вже пройшли: ${todo.map(a => esc(a.questionnaire_title)).join(", ")}.` : "Анкети зʼявляться, коли уповноважений відкриє хвилю оцінювання."}<br><br><a class="btn btn-soft" href="#me">Мої результати ${IC.arrowR}</a></div></section>`;
}

function apiScopeHTML(sc, title) {
  if (!sc.sufficient) return `<section class="card c12 rise"><div class="lock">${IC.lock}<div><b>${esc(title)}: результати приховано</b><div class="lbl">Відповіло менше ${S.k} осіб. Так ми не дозволяємо обчислити відповіді окремих людей.</div></div></div></section>`;
  const idx = sc.index.score ?? 0, lv = (sc.index.level && sc.index.level.level) || level(idx);
  return `<section class="card c5 rise"><div class="lbl">${esc(title)}</div>
    <div class="big tnum" style="margin-top:12px">${numHTML(idx)}<span class="of">з 100</span></div>
    <div style="margin:10px 0 14px">${lvPill(lv)}</div>${levelBar(idx)}</section>
  <section class="card c7 rise"><div class="card-h"><h2>Три компоненти</h2></div>
    <div style="display:flex;flex-direction:column;gap:18px">${sc.components.filter(c => COMPS.includes(c.code)).map((c, i) => { const v = c.score ?? 0; return `<div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="display:flex;gap:10px;align-items:center"><span class="comp-ic" style="background:${COMP[c.code].s};color:${COMP[c.code].c}">${IC[COMP[c.code].ic]}</span><b>${COMP[c.code].n}</b></span><span style="display:flex;gap:8px;align-items:center"><b class="tnum">${c.score == null ? "н/д" : fb(v)}</b>${lvPill((c.level && c.level.level) || level(v))}</span></div>
      <div class="ticks" style="height:18px;margin-top:10px">${Array.from({ length: 20 }, (_, j) => `<span class="${j < Math.round(v / 5) ? "f2" : ""} bar-a" style="animation-delay:${i * 120 + j * 20}ms;${j < Math.round(v / 5) ? `background:${COMP[c.code].c}` : ""}"></span>`).join("")}</div></div>`; }).join("")}</div></section>`;
}
function apiMeView() {
  const okA = apiEnsure("assignments", () => api("/me/assignments")), okM = apiEnsure("my", () => api("/me/results").catch(e => e.status === 404 ? [] : Promise.reject(e)));
  if (!okA || !okM) return apiLoadingHTML("Мої результати");
  if (API.my.error) return apiErrorHTML(API.my.error);
  const todo = Array.isArray(API.assignments) ? API.assignments.filter(a => a.kind !== "checklist") : [];
  const latest = Array.isArray(API.my) ? API.my[0] : API.my;
  return `<section class="c12 rise toolbar"><span class="lbl">Відповіді анонімні: вони не повʼязані з вашим обліковим записом.</span></section>
  <section class="card c12 rise"><div class="card-h"><h2>Анкети відкритих хвиль</h2></div>
    <div class="rows">${todo.length ? todo.map(a => `<div class="row"><div class="grow"><div class="t">${esc(a.questionnaire_title)}</div><div class="s">${esc(a.campaign_title)}</div></div>${a.submitted ? pill("Пройдено", "p-good") : `<a class="btn btn-primary" href="#survey">Пройти анкету ${IC.arrowR}</a>`}</div>`).join("") : `<div class="lbl">Зараз немає відкритих анкет для вас.</div>`}</div>
    ${S.role === "checklist_editor" ? `<div class="lbl" style="margin-top:10px">Ви в робочій групі: <a class="link" href="#checklist">заповнити чек-лист</a>.</div>` : ""}</section>
  ${latest ? `<section class="c12 rise toolbar"><span class="lbl">${esc(latest.campaign_title)}${latest.closed_on ? `, закрито ${ua(latest.closed_on)}` : ""}</span></section>
    ${latest.my_unit ? apiScopeHTML(latest.my_unit, "Мій підрозділ: " + latest.my_unit.unit_name) : ""}
    ${apiScopeHTML(latest.institution, "Заклад: " + latest.institution.unit_name)}
    ${latest.summary && latest.summary.length ? `<section class="card c12 rise"><div class="card-h"><h2>Коротко</h2></div><div class="rows">${latest.summary.map(t => `<div class="row"><span class="dot" style="background:var(--teal)"></span><div class="grow">${esc(t)}</div></div>`).join("")}</div></section>` : ""}`
    : `<section class="card c12 rise"><div class="empty"><b>Результатів ще немає</b><br>Вони зʼявляться після закриття хвилі.</div></section>`}
  <section class="c12 rise"><div class="lbl" style="text-align:center">Тут лише узагальнені дані груп не менше k осіб. Окремих відповідей, імен і порівнянь підрозділів немає.</div></section>`;
}

/* --- Керування циклом (уповноважений) --- */
const CST = { draft: ["Чернетка", "p-mute"], open: ["Триває", "p-good"], closed: ["Завершено", "p-info"] };
async function apiLoadAdm(sel) {
  const [campaigns, units, qs] = await Promise.all([api("/campaigns"), api("/admin/units"), api("/questionnaires?status=published")]);
  const cur = sel || (API.adm && API.adm.sel) || (campaigns.find(c => c.status !== "closed") || campaigns[0] || {}).id;
  const progress = cur ? await api(`/campaigns/${cur}/progress`).catch(() => null) : null;
  return { campaigns, units, qs, sel: cur, progress, links: API.adm && API.adm.sel === cur ? API.adm.links : null };
}
function apiAdmReload(sel) { API.adm = null; API.loading.adm = true; apiLoadAdm(sel).then(v => { API.adm = v; }, e => { API.adm = { error: apiErrText(e) }; }).finally(() => { API.loading.adm = false; render(true); }); }
const dn = t => String(t || "").replace(/\s*\(демо\)/gi, "");
/* --- Вибір підрозділу: пошук по назві й (для уповноваженого) створення нового прямо зі списку --- */
function unitCombo(id, units, sel, canCreate) {
  const cur = units.find(u => u.id === sel) || units.find(u => !u.parent_id) || units[0];
  return `<div class="combo" id="${id}" data-val="${cur ? cur.id : ""}" data-create="${canCreate ? 1 : 0}"><input class="inp" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" placeholder="Почніть вводити назву підрозділу" value="${esc(dn(cur ? cur.name : ""))}"><ul class="combo-list" role="listbox" hidden></ul></div>`;
}
function comboDraw(box, all) {
  const inp = box.querySelector("input"), ul = box.querySelector("ul"), units = API.adm.units, q = inp.value.trim().toLowerCase();
  const curName = (units.find(u => u.id === box.dataset.val) || {}).name;
  const show = all || !q || dn(curName).toLowerCase() === q ? units : units.filter(u => dn(u.name).toLowerCase().includes(q));
  const exact = units.some(u => dn(u.name).toLowerCase() === q);
  const parent = units.find(u => u.id === box.dataset.val);
  const items = show.slice(0, 50).map((u, i) => `<li role="option" data-id="${u.id}" class="${u.id === box.dataset.val ? "sel" : ""}">${u.parent_id ? "└ " : ""}${esc(dn(u.name))}</li>`);
  if (box.dataset.create === "1" && q && !exact) items.unshift(`<li role="option" class="add" data-new="${esc(inp.value.trim())}">${IC.plus}Створити «${esc(inp.value.trim())}»${parent ? ` всередині «${esc(dn(parent.name))}»` : ""}</li>`);
  ul.innerHTML = items.join("") || `<li class="none">Нічого не знайдено</li>`;
  ul.hidden = false; inp.setAttribute("aria-expanded", "true");
}
function comboClose(box) { box.querySelector("ul").hidden = true; box.querySelector("input").setAttribute("aria-expanded", "false"); const u = API.adm.units.find(x => x.id === box.dataset.val); if (u) box.querySelector("input").value = dn(u.name); }
async function comboPick(box, li) {
  if (li.dataset.new) {
    try { const u = await api("/admin/units", { method: "POST", body: { name: li.dataset.new, parent_id: box.dataset.val || null } }); API.adm.units.push(u); box.dataset.val = u.id; toast(`Підрозділ «${u.name}» створено`); }
    catch (e) { return toast(apiErrText(e)); }
  } else if (li.dataset.id) box.dataset.val = li.dataset.id; else return;
  comboClose(box);
}
document.addEventListener("input", e => { const box = e.target.closest && e.target.closest(".combo"); if (box && e.target.tagName === "INPUT") comboDraw(box); });
document.addEventListener("focusin", e => { const box = e.target.closest && e.target.closest(".combo"); if (box && e.target.tagName === "INPUT") { e.target.select(); comboDraw(box, true); } });
document.addEventListener("mousedown", e => {
  const li = e.target.closest && e.target.closest(".combo li"); if (li) { e.preventDefault(); comboPick(li.closest(".combo"), li); return; }
  document.querySelectorAll(".combo").forEach(b => { if (!b.contains(e.target) && !b.querySelector("ul").hidden) comboClose(b); });
});
document.addEventListener("keydown", e => {
  const box = e.target.closest && e.target.closest(".combo"); if (!box || e.target.tagName !== "INPUT") return;
  const ul = box.querySelector("ul"), items = [...ul.querySelectorAll("li[data-id],li[data-new]")], cur = ul.querySelector("li.act"); let i = items.indexOf(cur);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (ul.hidden) comboDraw(box, true); i = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1); items.forEach(x => x.classList.remove("act")); if (items[i]) { items[i].classList.add("act"); items[i].scrollIntoView({ block: "nearest" }); } }
  else if (e.key === "Enter") { e.preventDefault(); const t = cur || (items.length === 1 ? items[0] : null); if (t) comboPick(box, t); }
  else if (e.key === "Escape") comboClose(box);
});

function apiManageView() {
  if (!apiEnsure("adm", () => apiLoadAdm())) return apiLoadingHTML("Керування циклом");
  const A = API.adm; if (A.error) return apiErrorHTML(A.error);
  const c = A.campaigns.find(x => x.id === A.sel), unitName = id => dn((A.units.find(u => u.id === id) || {}).name);
  const surveys = c ? A.qs.filter(q => c.questionnaire_ids.includes(q.id) && q.kind !== "checklist") : [];
  return `
  <section class="card c8 rise">
    ${c ? `<div class="card-h"><h2>${esc(dn(c.title))}</h2>${pill(CST[c.status][0], CST[c.status][1])}<div class="sp"></div><span class="lbl">${c.opened_on ? ua(c.opened_on) : "ще не відкрито"} – ${c.closed_on ? ua(c.closed_on) : "триває"}</span></div>
    <div class="rows">${(A.progress ? A.progress.items : []).map(i => { const n = i.too_few_people ? 30 : Math.max(1, Math.min(30, i.eligible || 30)), on = i.too_few_people || !i.eligible ? 0 : Math.round((i.submitted || 0) / i.eligible * n); return `<div class="row prog-row"><div class="grow"><div class="prog-h"><span class="t">${esc(i.questionnaire_title)}</span>${i.too_few_people ? `<span class="prog-lock" data-tip="Менше ${c.min_group_size} осіб: кількості приховано">${IC.lock}</span>` : ""}<b class="tnum prog-n">${i.too_few_people ? "приховано" : `${i.submitted} з ${i.eligible}`}</b></div>
      <div class="ticks" style="height:14px;margin-top:8px">${Array.from({ length: n }, (_, j) => `<span ${j < on ? 'style="background:var(--teal)"' : ""}></span>`).join("")}</div></div></div>`; }).join("") || `<div class="lbl">Анкет у хвилі немає.</div>`}</div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap" id="cActs">
      ${c.status === "draft" ? `<button class="btn btn-primary" onclick="apiCampaignAct('${c.id}','open')">${IC.ok}Відкрити хвилю</button>` : ""}
      ${c.status === "open" ? `<button class="btn btn-soft" onclick="apiAskClose('${c.id}')">${IC.lock}Завершити й порахувати індекс</button>` : ""}
    </div>` : `<div class="empty"><b>Хвиль ще немає</b><br>Створіть першу хвилю оцінювання.</div>`}
  </section>
  <section class="card c4 rise waves-card">
    <div class="card-h"><h2>Хвилі</h2><div class="sp"></div><button class="btn btn-soft" style="padding:6px 12px" onclick="apiNewCampaign()">${IC.plus}Нова</button></div>
    <div class="rows">${A.campaigns.map(x => `<a class="row click" href="javascript:void 0" onclick="apiAdmReload('${x.id}')" ${x.id === A.sel ? 'style="background:var(--soft)"' : ""}><div class="grow"><div class="t">${esc(dn(x.title))}</div><div class="s">${x.access_mode === "token" ? "анонімно за посиланнями" : "за обліковими записами"}</div></div>${pill(CST[x.status][0], CST[x.status][1])}</a>`).join("")}</div>
  </section>
  ${c && c.access_mode === "token" && c.status !== "closed" ? `<section class="card c12 rise">
    <div class="card-h"><h2>Одноразові посилання</h2></div>
    <div class="lbl" style="margin-bottom:12px">Кожне посилання відкриває анкету один раз і без входу. Система зберігає лише хеш і не знає, кому ви його дали. Посилання показуються тільки зараз: збережіть їх.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="flex:2;min-width:220px"><label for="t-q">Анкета</label><select class="inp" id="t-q">${surveys.map(q => `<option value="${q.id}" data-cat="${q.target_category}">${esc(q.title)}</option>`).join("")}</select></div>
      <div class="field" style="flex:1;min-width:180px"><label for="t-u">Підрозділ</label>${unitCombo("t-u", A.units, c.unit_id, false)}</div>
      <div class="field" style="width:110px"><label for="t-n">Кількість</label><input class="inp tnum" id="t-n" type="number" min="1" max="1000" value="10"></div>
      <button class="btn btn-primary" onclick="apiIssueTokens('${c.id}')">Видати</button>
    </div>
    ${A.links ? `<div class="note-box" style="margin-top:14px">${A.links.warning ? `<b style="color:var(--amber)">${esc(A.links.warning)}</b>` : `<b>Видано посилань: ${A.links.urls.length}</b>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn btn-soft" onclick="apiCopyLinks()">${IC.copy}Копіювати всі</button><button class="btn btn-soft" onclick="download('links.csv','\\ufefflink\\n'+API.adm.links.urls.join('\\n'),'text/csv')">${IC.file}CSV</button></div>
      <div class="link-list tnum">${A.links.urls.map((u, i) => `<div class="link-row"><span class="link-n">${i + 1}</span><a class="link" href="${esc(u)}" target="_blank" rel="noreferrer">${esc(u)}</a><button type="button" class="icon-btn sm" aria-label="Копіювати посилання ${i + 1}" data-tip="Копіювати це посилання" onclick="apiCopyOne(${i})">${IC.copy}</button></div>`).join("")}</div></div>` : ""}
    <div style="margin-top:12px"><button class="btn btn-ghost" onclick="apiRevoke('${c.id}')">Відкликати всі невикористані</button></div>
  </section>` : ""}`;
}
function apiNewCampaign() {
  const A = API.adm;
  openDrawer("Нова хвиля оцінювання", `
    <div class="note-box"><span class="lbl">Хвиля це один раунд оцінювання: ви обираєте підрозділ та анкети, відкриваєте хвилю, люди відповідають, потім ви її завершуєте і система рахує індекс.</span></div>
    <div class="field"><label for="n-t">Назва</label><input class="inp" id="n-t" placeholder="Хвиля 3 (весна)"></div>
    <div class="field"><label for="n-u">Підрозділ</label>${unitCombo("n-u", A.units, null, true)}<span class="lbl">Оцінювання охопить цей підрозділ і всі його дочірні. Немає потрібного? Введіть назву й оберіть «Створити».</span></div>
    <div class="field"><label>Анкети</label>${A.qs.map(q => `<label class="chk-row"><input type="checkbox" class="n-q" value="${q.id}" checked><span>${esc(q.title)} <span class="lbl">v${q.version}</span></span></label>`).join("")}</div>
    <div class="field"><label>Як проходять</label><div class="seg" id="n-m"><button type="button" class="on" data-m="login">За обліковими записами</button><button type="button" data-m="token">Анонімно за посиланнями</button></div><span class="lbl" id="n-mh">Люди входять у систему під своїм логіном. Система знає, хто вже пройшов (щоб не пустити вдруге), але не показує нікому, що саме він відповів.</span></div>
    <div class="field"><label for="n-k">Мінімальна група k</label><input class="inp tnum" id="n-k" type="number" min="5" value="${S.k}"><span class="lbl">Якщо відповіли менше цієї кількості людей, результати групи не показуються, щоб нікого не можна було впізнати. Не менше 5.</span></div>
    <span class="lbl" id="n-err" style="color:var(--red)"></span>
    <button class="btn btn-primary" id="n-ok" style="justify-content:center">${IC.plus}Створити чернетку</button>`, b => {
    let mode = "login"; b.querySelectorAll("#n-m button").forEach(x => x.onclick = () => { mode = x.dataset.m; b.querySelectorAll("#n-m button").forEach(y => y.classList.toggle("on", y === x)); b.querySelector("#n-mh").textContent = mode === "token" ? "Кожному видається одноразове посилання без входу в систему. Система не знає навіть, хто пройшов: лише скільки посилань використано." : "Люди входять у систему під своїм логіном. Система знає, хто вже пройшов (щоб не пустити вдруге), але не показує нікому, що саме він відповів."; });
    b.querySelector("#n-ok").onclick = async () => {
      const ids = [...b.querySelectorAll(".n-q:checked")].map(x => x.value), title = b.querySelector("#n-t").value.trim();
      if (!title) return void (b.querySelector("#n-err").textContent = "Вкажіть назву.");
      if (!ids.length) return void (b.querySelector("#n-err").textContent = "Оберіть хоча б одну анкету.");
      try { const c = await api("/campaigns", { method: "POST", body: { title, unit_id: b.querySelector("#n-u").dataset.val, questionnaire_ids: ids, min_group_size: +b.querySelector("#n-k").value, access_mode: mode } }); closeDrawer(); toast(`Хвилю «${c.title}» створено як чернетку`); apiAdmReload(c.id); }
      catch (e) { b.querySelector("#n-err").textContent = apiErrText(e); }
    };
  });
}
async function apiCampaignAct(id, act) {
  try { await api(`/campaigns/${id}/${act}`, { method: "POST" }); toast(act === "open" ? "Хвилю відкрито: респонденти бачать анкети" : "Хвилю закрито: знімок результатів збережено"); if (act === "close") API.model = null; apiAdmReload(id); }
  catch (e) { apiFail(e); }
}
function apiAskClose(id) {
  $("#cActs").innerHTML = `<div class="lbl" style="width:100%">Прийом відповідей зупиниться, система порахує індекс і збереже незмінний знімок. Невикористані посилання стануть недійсними. Скасувати не можна.</div><button class="btn btn-ghost" onclick="render(true)">Скасувати</button><button class="btn btn-danger" onclick="apiCampaignAct('${id}','close')">Завершити</button>`;
}
async function apiIssueTokens(id) {
  const sel = $("#t-q"), cat = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.cat;
  try {
    const r = await api(`/campaigns/${id}/tokens`, { method: "POST", body: { questionnaire_id: sel.value, unit_id: cat === "expert" ? null : $("#t-u").dataset.val, count: +$("#t-n").value } });
    API.adm.links = { urls: r.tokens.map(t => t.link.startsWith("/") ? location.origin + t.link : t.link), warning: r.warning };
    toast(`Видано посилань: ${r.tokens.length}`); render(true);
  } catch (e) { apiFail(e); }
}
function apiCopyOne(i) { const t = API.adm.links.urls[i]; const ok = () => toast(`Посилання ${i + 1} скопійовано`); try { navigator.clipboard.writeText(t).then(ok, () => fallbackCopy(t, ok)); } catch (e) { fallbackCopy(t, ok); } }
function apiCopyLinks() { const t = API.adm.links.urls.join("\n"); try { navigator.clipboard.writeText(t).then(() => toast("Посилання скопійовано"), () => fallbackCopy(t, () => toast("Скопійовано"))); } catch (e) { fallbackCopy(t, () => toast("Скопійовано")); } }
async function apiRevoke(id) { try { const r = await api(`/campaigns/${id}/tokens/revoke`, { method: "POST", body: {} }); toast(`Відкликано невикористаних посилань: ${r.revoked}`); } catch (e) { apiFail(e); } }

/* --- Анкети (укладач) --- */
const QST = { draft: ["Чернетка", "p-warn"], published: ["Опубліковано", "p-good"], archived: ["В архіві", "p-mute"] };
const QCAT = { working_group: "Робоча група", staff: "Особовий склад", expert: "Зовнішні експерти" };
function apiSurveysView() {
  if (!apiEnsure("qs", () => api("/questionnaires"))) return apiLoadingHTML("Анкети");
  if (API.qs.error) return apiErrorHTML(API.qs.error);
  const F = { q: "", st: "latest", kind: "all", ...API.qF }, qq = F.q.trim().toLowerCase();
  const all = [...API.qs].sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);
  const newest = {}; all.forEach(q => { if (q.status !== "archived" && (!newest[q.code] || q.version > newest[q.code])) newest[q.code] = q.version; });
  const list = all.filter(q => (F.st === "all" || (F.st === "latest" ? q.status !== "archived" && q.version === newest[q.code] : F.st === "active" ? q.status !== "archived" : q.status === F.st)) && (F.kind === "all" || q.kind === F.kind) && (!qq || `${q.title} ${q.code} v${q.version}`.toLowerCase().includes(qq)));
  return `
  <section class="c12 rise toolbar"><label class="search inst-search"><span>${IC.search}</span><input id="qsQ" placeholder="Назва або код анкети" value="${esc(F.q)}" oninput="qsSet('q',this.value)"></label>
    <select class="inp" aria-label="Статус" onchange="qsSet('st',this.value)">${[["latest", "Найновіші версії"], ["active", "Усі версії без архіву"], ["published", "Лише опубліковані"], ["draft", "Лише чернетки"], ["archived", "Лише архів"], ["all", "Усі, разом з архівом"]].map(([v, n]) => `<option value="${v}" ${F.st === v ? "selected" : ""}>${n}</option>`).join("")}</select>
    <select class="inp" aria-label="Вид" onchange="qsSet('kind',this.value)"><option value="all">Усі види</option><option value="survey" ${F.kind === "survey" ? "selected" : ""}>Анкети зрілості</option><option value="checklist" ${F.kind === "checklist" ? "selected" : ""}>Чек-листи</option></select>
    <span class="lbl tnum">Показано ${list.length} з ${all.length}</span><div class="sp"></div><button class="btn btn-primary" onclick="bldNew()">${IC.plus}Нова анкета</button></section>
  ${list.length ? "" : `<section class="card c12 rise"><div class="empty"><b>Анкет за цими умовами немає</b><br>Змініть фільтр або створіть нову анкету.</div></section>`}
  ${list.map(q => `<section class="card c6 rise">
    <div class="comp-top"><span class="comp-ic" style="background:var(--lime-soft);color:var(--teal-deep)">${q.kind === "checklist" ? IC.check : IC.survey}</span><b>${esc(q.title)}</b><div class="sp" style="flex:1"></div>${pill(QST[q.status][0], QST[q.status][1])}</div>
    <div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr);margin-top:14px"><div><small>Група</small><b style="font-size:14px">${q.kind === "checklist" ? "Чек-лист" : QCAT[q.target_category]}</b></div><div><small>Версія</small><b>${q.version}</b></div><div><small>Код</small><b style="font-size:12px">${esc(q.code)}</b></div></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center"><span class="lbl">Оновлено ${ua(q.updated_at.slice(0, 10))}</span><div class="sp" style="flex:1"></div>
      <button class="btn btn-soft" onclick="apiOpenQ('${q.id}')">${IC.eye}Переглянути</button>
      ${q.status === "draft" ? `<button class="btn btn-soft" onclick="bldOpen('${q.id}')">${IC.edit}Редагувати</button><button class="btn btn-primary" onclick="apiQAct('${q.id}','publish')">${IC.ok}Опублікувати</button>` : q.status === "published" ? `<button class="btn btn-ghost" onclick="apiQAct('${q.id}','new-version')">${IC.plus}Нова версія</button><button class="btn btn-ghost" onclick="apiQAct('${q.id}','archive')">В архів</button>` : ""}</div>
  </section>`).join("")}`;
}
async function apiOpenQ(id) {
  try {
    const q = await api(`/questionnaires/${id}`);
    const pl = (n, one, few, many) => (n % 100 >= 11 && n % 100 <= 14) ? many : (n % 10 === 1) ? one : (n % 10 >= 2 && n % 10 <= 4) ? few : many;
    const nSec = q.sections.length;
    const nQ = q.sections.reduce((a, s) => a + s.questions.length, 0);
    const head = `<div style="display:flex;gap:6px;flex-wrap:wrap">${pill("Версія " + q.version, "p-mute nodot")}${pill(q.kind === "checklist" ? "Чек-лист" : QCAT[q.target_category], "p-mute nodot")}${pill(`${nSec} ${pl(nSec, "розділ", "розділи", "розділів")}, ${nQ} ${pl(nQ, "питання", "питання", "питань")}`, "p-mute nodot")}</div>`;
    const secs = q.sections.map((s, i) => `<section class="pv-sec">
        <div class="pv-sec-h"><span class="pv-num">${i + 1}</span><b class="pv-sec-t">${esc(s.title)}</b><span class="pv-cnt">${s.questions.length} ${pl(s.questions.length, "питання", "питання", "питань")}</span></div>
        ${s.questions.map((x, j) => `<div class="pv-q">
          <div class="pv-qt"><span class="pv-qn">${j + 1}.</span> ${esc(x.text)}</div>
          ${x.options.length ? `<ul class="pv-opts">${x.options.map(o => `<li><span class="pv-score">${fb(o.score)}</span><span>${esc(o.text)}</span></li>`).join("")}</ul>` : `<div class="s">Шкала від ${esc(x.scale_min)} до ${esc(x.scale_max)}</div>`}
        </div>`).join("")}
      </section>`).join("");
    openDrawer(q.title, head + secs);
  } catch (e) { apiFail(e); }
}
async function apiQAct(id, act) {
  try {
    if (act === "publish") { const issues = await api(`/questionnaires/${id}/validate`); if (issues.length) { toast("Не можна опублікувати: " + issues.map(i => i.message).join("; ")); return; } }
    const q = await api(`/questionnaires/${id}/${act}`, { method: "POST" });
    toast(act === "publish" ? `Опубліковано: ${q.title}` : act === "new-version" ? `Створено чернетку версії ${q.version}` : `В архіві: ${q.title}`);
    API.qs = null; render(true);
    if (act === "new-version") bldOpen(q.id); // нова версія це чернетка: одразу відкриваємо в конструкторі
  } catch (e) { apiFail(e); }
}
function qsSet(k, v) { API.qF = { ...(API.qF || {}), [k]: v }; render(true); const i = $("#qsQ"); if (k === "q" && i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
function apiSurveysReload() { API.qs = null; render(true); }

/* --- Чек-лист: вносить робоча група, підтверджує укладач --- */
const CKS = { full: ["Впроваджено повністю", "p-good"], partial: ["Частково", "p-warn"], none: ["Не впроваджено", "p-bad"] };
async function apiLoadCk(sel) {
  let camps;
  if (S.role === "checklist_editor") camps = (await api("/me/assignments")).filter(a => a.kind === "checklist").map(a => ({ id: a.campaign_id, title: a.campaign_title, status: "open" }));
  else camps = (await api("/campaigns")).filter(c => c.status !== "draft").map(c => ({ id: c.id, title: c.title, status: c.status }));
  const cur = sel || (camps.find(c => c.status === "open") || camps[0] || {}).id;
  let data = null, err = null;
  if (cur) { try { data = await api(`/campaigns/${cur}/checklist`); } catch (e) { err = apiErrText(e); } }
  return { camps, sel: cur, data, err };
}
function apiCkReload(sel) { API.ck = null; API.loading.ck = true; apiLoadCk(sel).then(v => { API.ck = v; }, e => { API.ck = { error: apiErrText(e) }; }).finally(() => { API.loading.ck = false; render(true); }); }
function apiChecklistView() {
  if (!apiEnsure("ck", () => apiLoadCk())) return apiLoadingHTML("Чек-лист");
  const K = API.ck; if (K.error) return apiErrorHTML(K.error);
  if (!K.camps.length) return `<section class="card c12 rise"><div class="empty"><b>Немає хвилі з чек-листом</b><br>Чек-лист зʼявиться, коли уповноважений відкриє хвилю з ним.</div></section>`;
  const camp = K.camps.find(c => c.id === K.sel), open = camp && camp.status === "open";
  const ed = S.role === "checklist_editor" && open, ap = S.role === "commissioner" && open, D = K.data;
  const head = `<section class="c12 rise toolbar">${ed || ap ? "" : `<span class="lbl">Режим перегляду.</span>`}<div class="sp"></div>
    ${K.camps.length > 1 ? `<select class="inp" aria-label="Хвиля" onchange="apiCkReload(this.value)">${K.camps.map(c => `<option value="${c.id}" ${c.id === K.sel ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select>` : `<span class="wave-chip"><span class="lbl">Хвиля</span><b>${esc(dn(camp ? camp.title : ""))}</b>${camp ? pill(CST[camp.status][0], CST[camp.status][1]) : ""}</span>`}</section>`;
  if (!D) return head + `<section class="card c12 rise"><div class="empty"><b>Чек-лист недоступний</b><br>${esc(K.err || "")}</div></section>`;
  return head + `
  <div class="c12 kpi-row kpi-row-s">
  <section class="card rise kpi-tile"><div class="kt-h"><span class="kt-ic">${IC.check}</span><span class="lbl">Пунктів</span></div><div class="kt-b"><span class="mid tnum">${D.total}</span></div></section>
  <section class="card rise kpi-tile"><div class="kt-h"><span class="kt-ic">${IC.edit}</span><span class="lbl">Внесено</span></div><div class="kt-b"><span class="mid tnum">${D.filled}</span></div></section>
  <section class="card rise kpi-tile"><div class="kt-h"><span class="kt-ic">${IC.ok}</span><span class="lbl">Підтверджено</span></div><div class="kt-b"><span class="mid tnum">${D.confirmed}</span></div></section>
  </div>
  <section class="card c12 rise"><div class="tbl-wrap"><table><thead><tr><th>Пункт</th><th>Компонент</th><th>Стан і доказ</th><th>Файли</th><th></th></tr></thead><tbody>
  ${D.items.map(it => `<tr id="ck-${it.question_id}"><td style="min-width:260px"><b style="font-weight:600">${esc(it.number)}.</b> ${esc(it.text.replace(/^\d+(\.\d+)*\.\s*/, ""))}</td>
    <td>${COMPS.includes(it.component) ? pill(COMP[it.component].n, "p-mute nodot") : ""}</td>
    <td style="min-width:200px">${it.status ? pill(CKS[it.status][0], CKS[it.status][1]) : pill("Не внесено", "p-mute")} ${it.confirmed ? pill("Підтверджено", "p-good nodot") : it.status ? pill("Не підтверджено", "p-mute nodot") : ""}${it.evidence ? `<div class="lbl" style="margin-top:4px">${esc(it.evidence)}</div>` : ""}</td>
    <td class="lbl" style="min-width:160px">${it.files.map(f => `<div><a class="link" href="javascript:void 0" onclick="apiDownload('${K.sel}','${it.question_id}','${f.id}','${esc(f.filename).replace(/'/g, "")}')">${esc(f.filename)}</a> <span class="hash" title="sha256 ${f.sha256}">${f.sha256.slice(0, 10)}</span>${ed ? ` <a class="link" href="javascript:void 0" aria-label="Прибрати файл" onclick="apiDelFile('${K.sel}','${it.question_id}','${f.id}')">×</a>` : ""}</div>`).join("") || "—"}</td>
    <td style="white-space:nowrap">${ed ? `<button class="btn btn-soft" style="padding:6px 12px" onclick="apiEditItem('${it.question_id}')">${IC.edit}Внести</button>` : ""}${ap && it.status ? (it.confirmed ? `<button class="btn btn-ghost" style="padding:6px 12px" onclick="apiConfirm('${it.question_id}',false)">Відкликати</button>` : `<button class="btn btn-primary" style="padding:6px 12px" onclick="apiConfirm('${it.question_id}',true)">${IC.ok}Підтвердити</button>`) : ""}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}
function apiEditItem(qid) {
  const it = API.ck.data.items.find(x => x.question_id === qid), camp = API.ck.sel;
  openDrawer("Внести пункт чек-листа", `<div><div class="lbl">Пункт ${esc(it.number)}</div><div style="font-weight:600;margin-top:4px">${esc(it.text)}</div></div>
    ${it.indicator ? `<div class="lbl">${esc(it.indicator)}</div>` : ""}
    <div class="field"><label>Статус</label><div class="seg" id="e-st">${Object.entries(CKS).map(([k, [n]]) => `<button type="button" data-s="${k}" class="${it.status === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="field"><label for="e-ev">Доказ (документ, наказ, посилання)</label><textarea class="inp" id="e-ev" rows="3">${esc(it.evidence)}</textarea></div>
    <div class="field"><label for="e-cm">Коментар</label><input class="inp" id="e-cm" value="${esc(it.comment)}"></div>
    <div class="field"><label for="e-f">Файл-доказ (PDF, зображення, документ; до ${Math.round(API.cfg.evidence.max_bytes / 1048576)} МБ)</label><input class="inp" id="e-f" type="file" accept="${API.cfg.evidence.allowed_extensions.map(x => "." + x).join(",")}"></div>
    <span class="lbl" id="e-err" style="color:var(--red)"></span>
    <button class="btn btn-primary" id="e-ok" style="justify-content:center">${IC.send}Зберегти</button>`, b => {
    let st = it.status; b.querySelectorAll("#e-st button").forEach(x => x.onclick = () => { st = x.dataset.s; b.querySelectorAll("#e-st button").forEach(y => y.classList.toggle("on", y === x)); });
    b.querySelector("#e-ok").onclick = async () => {
      if (!st) return void (b.querySelector("#e-err").textContent = "Оберіть статус.");
      try {
        await api(`/campaigns/${camp}/checklist/${qid}`, { method: "PUT", body: { status: st, evidence: b.querySelector("#e-ev").value.trim(), comment: b.querySelector("#e-cm").value.trim() } });
        const f = b.querySelector("#e-f").files[0];
        if (f) { const fd = new FormData(); fd.append("file", f); const r = await api(`/campaigns/${camp}/checklist/${qid}/files`, { method: "POST", body: fd }); toast(`Файл «${r.filename}» додано, sha256 ${r.sha256.slice(0, 12)}…`); }
        else toast(`Пункт ${it.number} збережено`);
        closeDrawer(); apiCkReload(camp);
      } catch (e) { b.querySelector("#e-err").textContent = apiErrText(e); }
    };
  });
}
async function apiConfirm(qid, yes) {
  const camp = API.ck.sel;
  try { await api(`/campaigns/${camp}/checklist/${qid}/confirm`, { method: yes ? "POST" : "DELETE" }); toast(yes ? "Пункт підтверджено" : "Підтвердження відкликано"); apiCkReload(camp); }
  catch (e) { apiFail(e); }
}
async function apiDelFile(camp, qid, fid) { try { await api(`/campaigns/${camp}/checklist/${qid}/files/${fid}`, { method: "DELETE" }); toast("Файл прибрано з пункту (лишається в журналі)"); apiCkReload(camp); } catch (e) { apiFail(e); } }
async function apiDownload(camp, qid, fid, name) {
  try { const r = await api(`/campaigns/${camp}/checklist/${qid}/files/${fid}`, { raw: true }); const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  catch (e) { apiFail(e); }
}

/* --- Журнал --- */
const AUDIT_ENT = { campaign: "Хвиля", questionnaire: "Анкета", user: "Користувач", unit: "Підрозділ", checklist_entry: "Чек-лист", evidence_file: "Файл-доказ", measure: "Захід", recommendation: "Рекомендація", results: "Результати", indicator: "Факт", report: "Звіт", assistant: "Асистент", audit_log: "Журнал" };
// Людські назви дій бекенду: «сутність:дія» → текст
const AUDIT_ACT = {
  "assistant:ask": "Запит до асистента", "audit_log:verify": "Перевірено цілісність журналу",
  "campaign:create": "Створено хвилю", "campaign:update": "Змінено хвилю", "campaign:open": "Відкрито хвилю", "campaign:close": "Закрито хвилю, збережено знімок результатів",
  "campaign:set_participants": "Змінено учасників хвилі", "campaign:clear_participants": "Очищено учасників хвилі", "campaign:import_participants": "Імпортовано учасників",
  "campaign:issue_tokens": "Видано одноразові посилання", "campaign:import_tokens": "Імпортовано посилання", "campaign:revoke_tokens": "Відкликано посилання",
  "campaign:export_report": "Експортовано звіт", "campaign:view_dashboard": "Переглянуто огляд закладу", "campaign:view_recommendations": "Переглянуто рекомендації", "campaign:view_results": "Переглянуто результати",
  "checklist_entry:set": "Внесено пункт чек-листа", "checklist_entry:confirm": "Підтверджено пункт чек-листа", "checklist_entry:revoke_confirm": "Відкликано підтвердження пункту чек-листа",
  "evidence_file:upload": "Додано файл-доказ", "evidence_file:download": "Завантажено файл-доказ", "evidence_file:delete": "Видалено файл-доказ", "evidence_file:integrity_fail": "Файл-доказ не пройшов перевірку цілісності",
  "indicator:upsert": "Передано факт із зовнішньої системи",
  "measure:create": "Створено захід", "measure:update": "Змінено захід", "measure:external_status": "Статус заходу оновлено із зовнішньої системи",
  "questionnaire:create": "Створено анкету", "questionnaire:update_meta": "Змінено анкету", "questionnaire:publish": "Опубліковано анкету", "questionnaire:new_version": "Створено нову версію анкети", "questionnaire:archive": "Анкету архівовано", "questionnaire:delete": "Видалено анкету",
  "recommendation:decide": "Ухвалено рішення щодо рекомендації",
  "unit:create": "Створено підрозділ", "unit:update": "Змінено підрозділ", "unit:delete": "Видалено підрозділ", "unit:compare": "Порівняно хвилі підрозділу", "unit:view_history": "Переглянуто історію підрозділу",
  "user:create": "Створено користувача", "user:update": "Змінено користувача", "user:login_proxy": "Вхід через проксі",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function apiLoadLog() {
  return Promise.all([
    api("/admin/audit-log?limit=500"),
    api("/admin/units").catch(() => []), // лише для адміністратора; аудитору покажемо скорочений код
    api("/admin/users").catch(() => []),
  ]).then(([rows, units, users]) => ({ rows, units, users }));
}
// Читабельний рядок із деталей запису: назви підрозділів замість UUID, без службових полів
function auditDetails(x, units) {
  const unit = id => { const u = units.find(u => u.id === id); return u ? dn(u.name) : "підрозділ …" + String(id).slice(-4); };
  const d = x.details || {}, out = [];
  if (d.unit_id) out.push(unit(d.unit_id));
  if (d.unit_name) out.push(dn(d.unit_name));
  if (d.title) out.push(`«${dn(d.title)}»`);
  if (d.recalculate === true) out.push("з перерахунком");
  if (d.access_mode) out.push(d.access_mode === "token" ? "анонімно за посиланнями" : "за обліковими записами");
  if (d.count != null) out.push(`кількість: ${d.count}`);
  if (d.ok != null) out.push(d.ok ? "ланцюг цілий" : "ланцюг порушено");
  if (d.checked != null) out.push(`перевірено записів: ${d.checked}`);
  return out.join(" · ");
}
function auditSet(k, v) { API.logF = { ...(API.logF || {}), [k]: v }; render(true); const i = $("#logQ"); if (k === "q" && i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
function apiAuditView() {
  if (!apiEnsure("log", apiLoadLog)) return apiLoadingHTML("Журнал");
  if (API.log.error) return apiErrorHTML(API.log.error);
  const { rows, units, users } = API.log, F = { q: "", ent: "all", who: "all", ...API.logF };
  const who = id => { const u = users.find(u => u.id === id); return u ? u.display_name : id ? "Користувач …" + String(id).slice(-4) : "Система"; };
  const act = x => AUDIT_ACT[`${x.entity}:${x.action}`] || `${AUDIT_ENT[x.entity] || x.entity}: ${x.action}`;
  const fmt = at => new Date(at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
  const items = rows.map(x => ({ x, a: act(x), w: who(x.actor_id), d: auditDetails(x, units), t: fmt(x.at) }));
  const q = (F.q || "").trim().toLowerCase();
  const shown = items.filter(i => (F.ent === "all" || i.x.entity === F.ent) && (F.who === "all" || i.x.actor_id === F.who) && (!q || `${i.a} ${i.w} ${i.d} ${i.t} ${i.x.seq} ${i.x.hash}`.toLowerCase().includes(q)));
  const groups = []; shown.forEach(i => { const g = groups[groups.length - 1]; if (g && g[0].a === i.a && g[0].w === i.w && g[0].d === i.d) g.push(i); else groups.push([i]); });
  const ents = [...new Set(rows.map(x => x.entity))].sort((a, b) => (AUDIT_ENT[a] || a).localeCompare(AUDIT_ENT[b] || b, "uk"));
  const actors = [...new Set(rows.map(x => x.actor_id).filter(Boolean))].map(id => [id, who(id)]).sort((a, b) => a[1].localeCompare(b[1], "uk"));
  return `<section class="card c12 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Журнал дій</h2><div class="sp"></div><span id="chainSt">${API.chain ? pill(API.chain.ok ? `Ланцюг цілісний: перевірено ${API.chain.checked} записів` : `Ланцюг порушено на записі № ${API.chain.broken_seq}`, API.chain.ok ? "p-good" : "p-bad") : ""}</span><button class="btn btn-soft" onclick="apiVerify()">${IC.shield}Перевірити цілісність</button></div>
    <div class="lbl" style="margin-bottom:10px">Хто, коли й що змінив. Кожен запис містить хеш попереднього (sha256), тож тиха правка чи видалення ламає ланцюг. Подань анкет у журналі немає.</div>
    <div class="toolbar" style="margin-bottom:8px"><label class="search inst-search"><span>${IC.search}</span><input id="logQ" placeholder="Дія, хто, підрозділ, дата або хеш" value="${esc(F.q || "")}" oninput="auditSet('q',this.value)"></label>
      <select class="inp" aria-label="Тип дії" onchange="auditSet('ent',this.value)"><option value="all">Усі дії</option>${ents.map(e => `<option value="${e}" ${F.ent === e ? "selected" : ""}>${esc(AUDIT_ENT[e] || e)}</option>`).join("")}</select>
      ${actors.length ? `<select class="inp" aria-label="Хто" onchange="auditSet('who',this.value)"><option value="all">Усі користувачі</option>${actors.map(([id, n]) => `<option value="${id}" ${F.who === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      <span class="lbl tnum">Показано ${shown.length} з ${rows.length}</span></div>
    ${groups.length ? `<div class="tl">${groups.map((g, i) => { const f = g[0], l = g[g.length - 1]; return `<div class="tl-i rise" style="animation-delay:${Math.min(i, 12) * 40}ms"><span class="nd"></span><div><div style="font-weight:500">${esc(f.a)}${g.length > 1 ? ` <span class="pill p-mute nodot">×${g.length}</span>` : ""}</div><div class="lbl">${esc(f.w)} · ${g.length > 1 ? `${l.t} – ${f.t}` : f.t}${f.d ? " · " + esc(f.d) : ""}</div></div><span class="hash" data-tip="Запис № ${f.x.seq}">${f.x.hash.slice(0, 10)}</span></div>`; }).join("")}</div>` : `<div class="empty">Записів за цим запитом немає.</div>`}
  </section>`;
}
async function apiVerify() {
  try { API.chain = await api("/admin/audit-log/verify", { method: "POST" }); API.log = null; render(true); }
  catch (e) { apiFail(e); }
}
