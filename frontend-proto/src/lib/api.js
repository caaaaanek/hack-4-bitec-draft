/* ---------- Підключення до бекенду ----------
 * Якщо поруч є API (GET /api/v1/config відповідає), сторінка працює з даними сервера: вхід, результати,
 * рекомендації й рішення, заходи, анкети (за обліковим записом і анонімно: QR /q/<код> → посилання /s/<токен>),
 * чек-лист із файлами-доказами, хвилі й посилання, журнал. Без API (відкрито з файлу, Vercel) — демо-дані
 * в браузері. Решта коду бере дані через гачки: inst(), buildRecs(), measures(), SV()/SQ() і екрани в views/Api*.
 */
import { S, NAV, HOME, ROLE, freshSurvey, loadDraft, clearDraft } from "./state.js";
import { TITLES } from "./nav.js";
import { COMPS, COMP, ALPHA, r1, finish, setClock, TRUST, factText, M_ST } from "./model.js";
import { fb, esc, quarters } from "./format.js";
import { render, toast, closeDrawer, ui } from "./store.js";

export const API = {
  on: false, booting: true, base: "/api/v1", cfg: null, user: null, anon: false, token: null, loginMsg: null,
  model: null, empty: false, recs: [], ms: [], campaignId: null, unitId: null, res: null,
  survey: null, surveyUsed: false, surveyMsg: null, surveyTarget: null, formError: null,
  my: null, assignments: null, adm: null, qs: null, ck: null, log: null, logF: null, chain: null, loading: {},
  down: false, resErr: null, mod: {}, deptUnit: null, invite: null, positions: null,
};
const SESSION_KEY = "ii-session";

/* --- Запити --- */
function apiToken() { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
function apiSetToken(t) { try { if (t) sessionStorage.setItem(SESSION_KEY, t); else sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* сховище недоступне */ } }
export const apiAuth = () => { const t = apiToken(); return t ? { Authorization: "Bearer " + t } : {}; };
export class ApiErr extends Error { constructor(status, body, requestId) { super((body && body.message) || "Сервер не відповів"); this.status = status; this.code = body && body.code; this.hint = (body && body.hint) || ""; this.requestId = (body && body.request_id) || requestId || null; this.errors = body && Array.isArray(body.errors) ? body.errors : []; this.missing = body && Array.isArray(body.missing_question_ids) ? body.missing_question_ids : []; } }
export async function api(path, { method = "GET", body, headers = {}, auth = true, raw = false } = {}) {
  const h = { Accept: "application/json", ...(auth ? apiAuth() : {}), ...headers };
  let b;
  if (body instanceof FormData) b = body; else if (body !== undefined) { h["Content-Type"] = "application/json"; b = JSON.stringify(body); }
  let r;
  try { r = await fetch(path.startsWith("/api/") ? path : API.base + path, { method, headers: h, body: b }); }
  catch (e) { throw new ApiErr(0, { message: "Немає зв’язку із сервером", hint: "Перевірте мережу." }); }
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    if (r.status === 401 && auth && apiToken() && API.user) { apiSetToken(null); API.user = null; showLogin("Сесія завершилась. Увійдіть знову."); }
    throw new ApiErr(r.status, j, r.headers.get("X-Request-ID"));
  }
  if (raw) return r;
  if (r.status === 204) return null;
  return (r.headers.get("content-type") || "").includes("json") ? r.json() : r.text();
}
// Для збоїв сервера (5xx) додаємо код запиту: за ним адміністратор знайде запис у журналі сервера
// Відмова переходу статусу містить службові назви статусів: показуємо зрозумілий текст
// 422 з переліком полів: до трьох причин з errors (без шляхів полів), інакше видно лише «Дані не пройшли перевірку»
// Назви полів сервера в повідомленнях перевірки → підписи з інтерфейсу
const FIELD_UA = { planned_open_on: "Відкрити", planned_close_on: "Закрити не пізніше", close_at_percent: "Поріг участі", remind_every_days: "Нагадувати кожні", min_group_size: "Мінімальна група",
  title: "Назва", unit_id: "Підрозділ", questionnaire_ids: "Анкети", access_mode: "Як проходять", due_date: "Строк", owner: "Відповідальний", password: "Пароль", username: "Логін" };
const FIELD_RE = new RegExp(`\\b(${Object.keys(FIELD_UA).join("|")})\\b`, "g");
export const uaFields = t => String(t || "").replace(FIELD_RE, k => `«${FIELD_UA[k]}»`);
// Шлях поля з 422 (sections.0.questions.1.text) → назва поля в інтерфейсі; англійське повідомлення pydantic не показуємо
export const fieldName = path => {
  const p = String(path || ""), m = p.match(/^sections\.(\d+)(?:\.questions\.(\d+))?\.(\w+)$/);
  if (m) return m[2] != null ? `${m[3] === "text" ? "текст питання" : "питання"} ${+m[2] + 1} у розділі ${+m[1] + 1}` : `${m[3] === "title" ? "назву розділу" : "розділ"} ${+m[1] + 1}`;
  const k = p.split(".").pop(); return FIELD_UA[k] ? `«${FIELD_UA[k]}»` : "";
};
const EN_RE = /[A-Za-z]{4,}.*[A-Za-z]{4,}/;
export const fieldErrText = errs => { const n = [...new Set((errs || []).map(i => fieldName(i && i.path)).filter(Boolean))]; return n.length ? `Заповніть або виправте: ${n.slice(0, 4).join(", ")}${n.length > 4 ? ` і ще ${n.length - 4}` : ""}` : ""; };
const errReasons = e => { const f = fieldErrText(e.errors); if (f) return f; return [...new Set(e.errors.map(i => uaFields(String((i && i.message) || "").replace(/^Value error,\s*/i, "").trim())).filter(t => t && !EN_RE.test(t)))].slice(0, 3).join("; "); };
// Політика STAFF_TOKEN_ONLY: сервер пояснює технічно (access_mode), показуємо людською мовою
const STAFF_TOKEN_TXT = "Анкети особового складу проходять лише анонімно: за QR або одноразовими посиланнями. Створіть для особового складу окрему хвилю з режимом «QR або посилання», а за логіном лишіть робочу групу й експертів.";
export const staffTokenOnly = () => !!(API.cfg && API.cfg.policies && API.cfg.policies.staff_token_only) && API.user && API.user.category === "staff";
// Нові коди помилок сервера (20.11): короткий людський текст замість технічного пояснення
const CODE_TXT = { urn_pending: "Закриття чекає двох частин ключа. Власники вводять їх на екрані «Урна».", null_value: "Заповніть обов'язкові поля", unit_required: "Оберіть заклад", weight_from_methodology: "Вагу цієї категорії задає методика", not_assigned: "Підтвердження цього пункту призначено іншій людині" };
export const apiErrText = e => e instanceof ApiErr && CODE_TXT[e.code] ? CODE_TXT[e.code] : e instanceof ApiErr && e.code === "staff_token_only" ? STAFF_TOKEN_TXT : e instanceof ApiErr && e.code === "bad_transition" ? "Такий перехід статусу недоступний. Оновіть сторінку: статус могли змінити." : e instanceof ApiErr ? `${uaFields(e.message)}${errReasons(e) ? ": " + errReasons(e) : ""}${e.hint ? ". " + uaFields(e.hint) : ""}${e.status >= 500 && e.requestId ? ` Код запиту: ${e.requestId}` : ""}` : "Не вдалося виконати дію";
export const apiFail = e => toast(apiErrText(e));

/* --- Ролі: обліковий запис → роль інтерфейсу --- */
function frontRole(u) {
  if (!u) return "respondent";
  if (["admin", "leader", "auditor", "coordinator"].includes(u.role)) return u.role;
  if (u.role === "department") return "observer"; // Департамент: огляд закладів по одному й анкети
  return u.category === "working_group" ? "checklist_editor" : "respondent";
}
const RESULT_ROLES = ["leader", "auditor", "admin"];
export const allowed = r => NAV.some(n => n[0] === r && n[3].includes(S.role)) && (!API.anon || r === "survey");

/* --- Старт --- */
export async function boot() {
  let cfg = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch("/api/v1/config", { signal: ctl.signal }); clearTimeout(t);
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) cfg = await r.json();
    else if (r.status >= 500) API.down = true; // сервер є, але не працює; 404 або сторінка: бекенда немає, демо-режим
  } catch (e) { API.down = true; }
  API.booting = false;
  if (!cfg) { render(); return; }
  API.down = false;
  API.on = true; API.cfg = cfg; S.k = cfg.min_group_size;
  // Розподіл прав як на бекенді: чек-лист підтверджують ролі з policies.checklist_confirmers (типово аудит),
  // робоча група ще й проходить анкету.
  const conf = ((cfg.policies && cfg.policies.checklist_confirmers) || ["auditor"]).filter(r => ["auditor", "admin"].includes(r));
  NAV.find(n => n[0] === "checklist")[3].push(...(conf.length ? conf : ["auditor"]));
  // Бекенд дає результати й уповноваженому (RESULT_READERS): лише перегляд агрегатів, без рішень і заходів.
  for (const r of ["overview", "explain", "trends", "compare"]) NAV.find(n => n[0] === r)[3].push("admin");
  for (const r of ["survey", "me"]) NAV.find(n => n[0] === r)[3].push("checklist_editor");
  NAV.find(n => n[0] === "survey")[1] = "Пройти анкету";
  // Назва організації з налаштувань (ORG_KIND): «заклад», «організація», «частина»
  if (cfg.org_terms) { NAV.find(n => n[0] === "institutions")[1] = orgCap("plural"); TITLES.overview = "Огляд " + orgT("genitive"); TITLES.institutions = orgCap("plural"); ROLE.leader[0] = "Керівник " + orgT("genitive"); }
  // Екрани лише з сервером. Людей і підрозділи веде технічний адміністратор; уповноважений їх лише обирає для хвилі.
  const nr = (r, roles) => { const n = NAV.find(x => x[0] === r); n[3].length = 0; n[3].push(...roles); };
  nr("people", ["coordinator"]);
  nr("units", ["coordinator"]);
  nr("summary", ["coordinator"]);
  // Довідники: категорії й посади веде техадмін, Департамент категорії лише переглядає, факти веде уповноважений
  nr("dicts", ["admin", "coordinator", "observer"]);
  nr("risks", ["leader", "admin", "auditor", "observer"]); // Департамент читає реєстри закладів своєї зони; імпорт лише уповноважений
  const tm = location.pathname.match(/^\/s\/([^/?#]+)/);
  if (tm) return bootToken(decodeURIComponent(tm[1]));
  const qm = location.pathname.match(/^\/q\/([^/?#]+)/);
  if (qm) return bootQr(decodeURIComponent(qm[1]));
  // Запрошення /#invite/<токен> (або /invite/<токен>): людина сама ставить пароль (POST /auth/invite), без входу
  const im = location.pathname.match(/^\/invite\/([^/?#]+)/) || location.hash.match(/^#invite\/([^/?#]+)/);
  if (im) { API.invite = decodeURIComponent(im[1]); render(); return; }
  if (apiToken()) {
    try { const me = await api("/auth/session"); return afterLogin(me); } catch (e) { apiSetToken(null); }
  }
  if (cfg.auth.proxy && !cfg.auth.password) {
    try { const s = await api("/auth/proxy", { method: "POST", auth: false }); apiSetToken(s.access_token); return afterLogin(s.user); } catch (e) { /* далі форма входу */ }
  }
  showLogin();
}

// Сервер недоступний: повторити запит конфігурації або піти в демо-режим
export function retryBoot() { API.down = false; API.booting = true; render(); boot(); }
export function startDemo() { API.down = false; render(); }

// Пароль за запрошенням встановлено: прибрати токен з адреси й показати вхід
export function apiInviteDone(msg) { API.invite = null; history.replaceState(null, "", "/"); showLogin(msg); }
// Посади для форми прийняття рекомендації: з довідника сервера (GET /dictionaries/positions)
export function apiPositions() {
  if (API.positions || API.loading.pos) return API.positions;
  API.loading.pos = true;
  api("/dictionaries/positions").then(p => { API.positions = p.filter(x => x.active).map(x => x.title); }, () => { API.positions = []; }).finally(() => { API.loading.pos = false; render(true); });
  return null;
}
// Назва організації з GET /config → org_terms (заклад / організація / частина)
const ORG_DEF = { nominative: "заклад", genitive: "закладу", plural: "заклади", full: "заклад вищої освіти" };
export const orgT = k => (API.cfg && API.cfg.org_terms && API.cfg.org_terms[k]) || ORG_DEF[k];
export const orgCap = k => { const t = orgT(k); return t.charAt(0).toUpperCase() + t.slice(1); };
export function showLogin(msg) {
  API.loginMsg = msg || null; ui.drawer = null; ui.ai = false; render();
}
export async function login(loginName, password) {
  const s = await api("/auth/session", { method: "POST", auth: false, body: { login: loginName, password } });
  apiSetToken(s.access_token); history.replaceState(null, "", "/"); await afterLogin(s.user); // вхід з форми: на стартовий екран ролі
}
export async function loginProxy() {
  try { const s = await api("/auth/proxy", { method: "POST", auth: false }); apiSetToken(s.access_token); await afterLogin(s.user); } catch (err) { toast(apiErrText(err)); }
}
export async function logout() {
  try { await api("/auth/session", { method: "DELETE" }); } catch (e) { /* сесія вже закрита */ }
  apiSetToken(null); API.user = null; API.model = null; API.mod = {}; API.positions = null; clearDraft(true); S.survey = freshSurvey(); history.replaceState(null, "", "/"); showLogin();
}

async function afterLogin(user) {
  API.user = user; S.role = frontRole(user); API.my = API.assignments = API.adm = API.qs = API.ck = API.log = API.logF = API.chain = API.dept = null; API.deptAuto = false; API.deptUnit = null; API.logLim = 0; API.survey = null; API.formError = null; API.loginMsg = null;
  API.resErr = null; API.mod = {};
  API.deptUnit = null;
  if (RESULT_ROLES.includes(S.role)) { try { await apiLoadResults(); } catch (e) { API.resErr = apiErrText(e); } }
  if (!allowed((location.hash || "").slice(1).split("/")[0]) || S.role === "observer") location.hash = HOME[S.role]; // Департамент починає зі списку закладів
  render();
}

/* --- Анонімне проходження за посиланням /s/<токен> --- */
async function bootToken(token) {
  API.anon = true; API.token = token; S.role = "respondent";
  API.surveyTarget = { kind: "token", token };
  location.hash = "survey";
  S.survey = freshSurvey();
  try { API.survey = apiSurveyModel(await api("/respond/form", { auth: false, headers: { "X-Response-Token": token } }), "token"); S.survey.a = loadDraft(Object.keys(API.survey.opt)); }
  catch (e) {
    API.survey = null; API.surveyMsg = e.code === "token_used" ? "used" : e.code === "campaign_not_open" ? "closed" : "invalid";
    // Після закриття хвилі те саме посилання показує узагальнені результати (GET /respond/results).
    if (API.surveyMsg !== "invalid") {
      try { API.tokenResults = await api("/respond/results", { auth: false, headers: { "X-Response-Token": token } }); }
      catch (e2) { API.tokenResults = null; }
    }
  }
  render();
}

/* --- Скан QR /q/<код>: свіжий одноразовий токен → /s/<токен>. Лише POST, щоб превʼю месенджера не витрачали форми. --- */
async function bootQr(code) {
  API.anon = true; S.role = "respondent";
  try {
    const r = await api(`/respond/qr/${encodeURIComponent(code)}`, { method: "POST", auth: false });
    history.replaceState(null, "", "/s/" + encodeURIComponent(r.token));
    return bootToken(r.token);
  } catch (e) {
    API.survey = null; location.hash = "survey";
    API.surveyMsg = e.code === "qr_limit" ? "qr_limit" : e.code === "campaign_not_open" ? "closed" : "qr_invalid";
    render();
  }
}

/* --- Результати: остання закрита хвиля --- */
export const CATEGORY_SRC = { staff: ["os", "Особовий склад (анкета 2)"], working_group: ["wg", "Робоча група (анкета 1)"], expert: ["experts", "Зовнішні експерти (анкета 3)"], checklist: ["wg", "Контрольний чек-лист (робоча група)"] };
const GROUP_FLAG = { low_participation: ["minor", "Низька участь", "Відповіла менша частка запрошених."], suspiciously_perfect: ["major", "Підозріло однакові «ідеальні» відповіді", "Значна частка анкет з однаковими найвищими відповідями."], insufficient_data: ["minor", "Недостатньо відповідей", "У групі замало відповідей для висновку."] };
const GRADE = { A: "A", B: "B", C: "C", insufficient_data: "insufficient" };
function cycleLabels(points) { const used = {}; return points.map(p => { const b = p.closed_on ? p.closed_on.slice(0, 7) : p.campaign_title; used[b] = (used[b] || 0) + 1; return used[b] === 1 ? b : `${b} (${used[b]})`; }); }

function apiModel(r, h) {
  const comps = COMPS.map(id => {
    const c = r.components.find(x => x.code === id) || {};
    // Компонент без даних лишається без числа (null): не підміняємо нулем, щоб не занизити рівень і слабку ланку
    const v = c.score ?? c.self_score ?? null, P = c.self_score ?? v, F = c.facts_score ?? P;
    return { id, P, F, nodata: v == null, cr: { v, lim: !!c.cut_by_facts, reason: c.cut_by_facts ? c.rule : undefined } };
  });
  const pItems = r.components.filter(c => COMPS.includes(c.code)).flatMap(c => {
    const src = (c.sources || []).filter(s => s.score != null && s.effective_weight > 0), tot = src.reduce((a, s) => a + s.effective_weight, 0) || 1;
    return src.map(s => { const [k, t] = CATEGORY_SRC[s.source] || ["wg", s.title]; return { id: `${c.code}-${s.source}`, c: c.code, t, w: r1(s.effective_weight / tot * 100), v: s.score, src: k, kind: "p" }; });
  });
  // Назви джерел фактів: модулі системи («Перевірки», флешкартки) і зовнішні реєстри.
  const SRC = { checks: "Модуль «Перевірки»", learning: "Флешкартки (навчання)", atestat: "Кадрова ІС (атестація)",
    reports: "Канал повідомлень", artemida: "ARTEMIDA", procurement: "Закупівлі", training: "Облік навчання" };
  const fItems = r.components.filter(c => COMPS.includes(c.code)).flatMap(c => {
    const fs = (c.facts || []).filter(f => f.score != null);
    return fs.map(f => ({ id: `${c.code}-f-${f.indicator}`, c: c.code, t: f.title, w: r1(100 / fs.length), v: f.score,
      kind: f.numerator != null && f.denominator ? "pct" : "lvl", val: f.numerator != null && f.denominator ? [f.numerator, f.denominator] : (f.level || 1),
      from: (f.sources || []).map(s => SRC[s] || s).join(", ") || "Дані обліку", rule: f.rule, per: quarters(f.periods) }));
  });
  const pts = (h && h.points) || [], labels = cycleLabels(pts);
  // Назви хвиль для фільтра трекера
  API.waveT = Object.fromEntries(pts.filter(p => p.campaign_id).map(p => [p.campaign_id, p.campaign_title || ""])); if (r.campaign_id) API.waveT[r.campaign_id] = r.campaign_title || API.waveT[r.campaign_id] || "";
  let series = pts.map((p, i) => ({ cycle: labels[i], index: p.index ?? null, cr: Object.fromEntries(COMPS.map(c => [c, (p.components || {})[c] ?? null])) }));
  const at = pts.findIndex(p => p.campaign_id === r.campaign_id);
  if (at >= 0) series = series.slice(0, at + 1);
  else series.push({ cycle: r.closed_on ? r.closed_on.slice(0, 7) : r.campaign_title, index: r.index.score ?? null, cr: Object.fromEntries(comps.map(c => [c.id, c.cr.v])) });
  if (series.length === 1) series = [series[0], series[0]];
  const events = pts.flatMap((p, i) => i > 0 && p.measures_done > 0 ? [{ after: labels[i - 1], n: p.measures_done, t: `Виконано заходів між циклами: ${p.measures_done}` }] : []);
  const flags = [];
  // Назви й пояснення прапорців — лише з GET /methodology (reliability.flags), власних текстів фронтенд не тримає
  const MF = (API.meth && API.meth.reliability && API.meth.reliability.flags) || {};
  const sev = x => x === "serious" ? "major" : x === "info" ? "info" : "minor";
  // Прапорці хвилі сервер віддає один раз у reliability_flags (зі списком компонентів); у components[].flags лишився
  // тільки self_not_confirmed, він стосується свого компонента
  const compT = code => (r.components.find(c => c.code === code) || {}).title || (COMP[code] && COMP[code].n) || code;
  for (const f of r.reliability_flags || []) {
    const d = MF[f.code] || {};
    flags.push({ id: f.code, w: sev(d.severity || f.severity), sevT: d.severity_title, title: d.title || f.title, comps: (f.components || []).map(compT), ex: d.explain || f.title, raised: true });
  }
  for (const c of r.components) for (const f of c.flags || []) if (f.code === "self_not_confirmed") {
    const d = MF[f.code] || {};
    flags.push({ id: `${f.code}:${c.code}`, w: sev(d.severity || f.severity), sevT: d.severity_title, title: d.title || f.title, comps: [c.title], ex: c.rule || d.explain || f.title, raised: true });
  }
  for (const x of flags) x.t = !x.comps.length || x.comps.length >= COMPS.length ? x.title : `${x.comps.join(", ")}: ${x.title}`;
  for (const g of r.groups) for (const code of g.flags || []) { const d = MF[code], o = GROUP_FLAG[code]; if (d || o) flags.push({ id: `${code}:${g.category}`, w: d ? sev(d.severity) : o[0], sevT: d && d.severity_title, t: `${g.title}: ${d ? d.title : o[1]}`, ex: d ? d.explain : o[2], raised: true }); }
  // Кількість відповідей — готові submitted із груп сервера; група, менша за поріг, має null і не додається
  const responses = r.groups.reduce((a, g) => a + (g.submitted ?? 0), 0);
  const m = finish({ id: ALPHA, name: dn(r.unit_name), components: comps, pItems, fItems, series, events, flags, responses });
  m.trust = GRADE[r.index.reliability] || "insufficient";
  // null від сервера — «недостатньо даних»: показуємо «—», а не число з історії чи демо
  m.index = r.index.score ?? null; m.level = m.index == null ? null : (r.index.level && r.index.level.level) || m.level;
  m.delta = m.index == null || m.prevIndex == null ? null : r1(m.index - m.prevIndex);
  if (!h) { m.noHistory = true; m.delta = null; m.prevIndex = null; } // попередніх циклів не отримано: зміна невідома
  if (r.index.reliability_reasons && r.index.reliability_reasons[0]) m.summary = r.index.reliability_reasons[0];
  m.groups = r.groups; m.rule = r.index.rule;
  const sorted = [...comps].sort((a, b) => a.cr.v - b.cr.v), top = sorted[sorted.length - 1];
  // «Що потребує уваги» і «Сильні сторони» — з сервера (problems, weakest_questions, strengths за зонами методики)
  const byCode = Object.fromEntries(comps.map(c => [c.id, c])), qComp = code => (code || "").split(".")[0];
  m.attention = [
    ...(r.problems || []).filter(p => byCode[p.code]).map(p => ({ t: byCode[p.code].cr.lim ? `${COMP[p.code].n}: підтвердити фактами` : `${COMP[p.code].n}: підсилити напрям`, c: p.code, v: p.score ?? byCode[p.code].cr.v, hint: `Зараховане значення компонента ${COMP[p.code].n}, 0-100.` })),
    ...(r.weakest_questions || []).filter(q => q.score != null && q.score < 62.5 && COMPS.includes(qComp(q.code))).slice(0, 3).map(q => ({ t: q.text, c: qComp(q.code), v: q.score, q: q.code, hint: `Середній бал питання ${esc(q.code)}, 0-100.` })),
  ];
  m.strengths = (r.strengths || []).filter(s => byCode[s.code]).map(s => ({ t: `Сильний компонент: ${COMP[s.code].n}`, c: s.code, v: s.score ?? byCode[s.code].cr.v, hint: `Зараховане значення компонента ${COMP[s.code].n}, 0-100.` }));
  if (!m.strengths.length && !m.attention.some(a => a.c === top.id && !a.q)) m.strengths = [{ t: `Найвищий результат у компоненті ${COMP[top.id].n}`, c: top.id, v: top.cr.v, hint: `Зараховане значення компонента ${COMP[top.id].n}, 0-100.` }];
  if (m.index != null && series[0].index != null && m.index > series[0].index) m.strengths.push({ t: "Зростання індексу з першого циклу", v: r1(m.index - series[0].index), hint: "Сумарна зміна індексу з першого закритого циклу, у пунктах.", unit: "пт" });
  return m;
}

const CK_ST = { full: "впроваджено повністю", partial: "частково", none: "не впроваджено" };
const DEC_ST = { accepted: "accepted", clarify: "clarified", rejected: "rejected" };
const BASIS = { self_score: "Самооцінка", facts_score: "Факти", score: "Зараховано", percent: "Відсоток", confirmed: "Підтверджено пунктів", total: "Усього", found: "Знайдено", pending: "Не розглянуто", change: "Зміна", level: "Рівень" };
// Значення факту для «На підставі»: сам факт (96 з 168, 57,1 %) і бал методики, а не лише бал (0 читається як «нічого не розібрано»)
const factV = factText;
// Правило, що лише переказує опис тими самими числами й словами, не повторюємо
const words = t => String(t || "").toLowerCase().match(/[\p{L}]+|\d+/gu) || [];
const sameText = (rule, desc) => { const r = words(rule), d = new Set(words(desc)); return r.length > 0 && r.filter(w => d.has(w)).length / r.length >= 0.6; };
function apiRec(x, m, res) {
  const c = COMPS.includes(x.component) ? x.component : "system", st = x.decision ? DEC_ST[x.decision.decision] || "proposed" : "proposed", cm = x.decision && x.decision.comment || "";
  // Звʼязок рекомендації з питанням чи показником, з якого вона виникла (код правила: fact:<показник>, question:<питання>)
  const [kind, ref] = x.code.split(":"), links = [];
  if (kind === "fact" && m) { const f = m.fItems.find(i => i.id.endsWith("-f-" + ref)); if (f) links.push({ id: f.id, t: f.t, v: factV(f), item: true }); }
  const qLink = q => ({ id: COMPS.includes(q.component) ? q.component : c, q: q.code, t: `Питання «${q.text}»`, v: q.score != null ? fb(q.score) : "–", item: true });
  if (kind === "checklist" && res && res.checklist) { const i = (res.checklist.items || []).find(i => i.number === ref); if (i) links.push({ id: COMPS.includes(i.component) ? i.component : c, ck: i.number, t: `Пункт чек-листа ${i.number}${i.text ? ` «${i.text.replace(/^[\d.]+\s*/, "")}»` : ""}`, v: CK_ST[i.status] || "не заповнено", item: true }); }
  if (kind === "question" && res) { const q = (res.questions || []).find(i => i.code === ref); if (q) links.push(qLink(q)); }
  if (kind === "cut" && m) m.fItems.filter(i => i.c === x.component && i.v < 62.5).slice(0, 2).forEach(f => links.push({ id: f.id, t: f.t, v: factV(f), item: true }));
  if (kind === "weakest" && res) (res.questions || []).filter(q => q.component === x.component && q.score != null).sort((a, b) => a.score - b.score).slice(0, 2).forEach(q => links.push(qLink(q)));
  return { id: x.code, t: x.title, c, pri: ["high", "medium", "low"].includes(x.priority) ? x.priority : "medium", items: links.filter(l => !l.q).map(l => l.id), links,
    why: sameText(x.rule, x.description) ? x.description : `${x.description} Правило: ${x.rule}`, acts: (x.suggested_measures || []).slice(0, 4).map(s => s.catalog_number ? `${s.catalog_number}. ${s.title}` : s.title),
    evidence: [...links, ...Object.entries(x.basis || {}).filter(([k, v]) => typeof v === "number" && BASIS[k] && !(links.length && k === "score")).slice(0, 4 - links.length).map(([k, v]) => ({ id: COMPS.includes(x.component) ? x.component : "", t: BASIS[k], v: fb(v), item: true }))],
    st, note: st === "rejected" ? { reason: cm } : st === "clarified" ? { comment: cm } : {},
    // Список без повторів: місце, група (компонент або «Загальне»), згорнута після перших N, які коди вона покриває
    rank: x.rank ?? null, group: x.group || null, groupT: x.group_title || null, collapsed: !!x.collapsed, covers: x.covers || [] };
}
// Тексти літер достовірності з методики сервера (reliability.grades)
function applyMethodology() {
  const g = API.meth && API.meth.reliability && API.meth.reliability.grades;
  if (g) for (const k of ["A", "B", "C"]) if (g[k]) TRUST[k][2] = g[k];
}
const MEAS_ST = { planned: "accepted", in_progress: "inprogress", done: "done", cancelled: "cancelled" };
// Перевірка наступною хвилею (бекенд, services/measures.verify): зріс компонент заходу — підтверджено; не зріс — потрібен перегляд
const VERIFY_ST = { improved: "confirmed", worsened: "notconfirmed", within_error: "notconfirmed" };
// Історія заходу з журналу дій: журнал читають лише уповноважений і аудит; фільтра за id у сервера немає, тож беремо записи заходів і відбираємо свій
export function apiMeasureHist(id) {
  if (!["admin", "auditor"].includes(S.role)) return { status: 403 };
  const r = apiMod("mhist", () => api("/admin/audit-log?entity=measure&limit=1000"));
  if (!r || !r.data) return r;
  return { data: r.data.filter(l => l.entity_id === String(id)).reverse().map(l => {
    const d = l.details || {}, st = s => (M_ST[MEAS_ST[s]] || [s])[0];
    const a = l.action === "create" ? "Захід створено" : d.from_status && d.status ? `Статус: ${st(d.from_status)} → ${st(d.status)}` : l.action === "external_status" ? "Оновлено стан у Mitra" : Object.keys(d).some(k => FIELD_T[k]) ? "Змінено: " + Object.keys(d).filter(k => FIELD_T[k]).map(k => FIELD_T[k]).join(", ") : "Захід змінено";
    return { a: a + (d.reason ? `. Причина: ${d.reason}` : ""), who: l.actor_display || (l.actor_id ? `Користувач …${String(l.actor_id).slice(-4)}` : "Система"), t: new Date(l.at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) };
  }) };
}
const FIELD_T = { title: "назва", owner: "відповідальна посада", due_date: "строк", status: "статус", done_on: "дата виконання", evidence: "доказ" };
function apiMeasure(x, titles) {
  const v = x.verification || {}, st = x.status === "done" && VERIFY_ST[v.status] ? VERIFY_ST[v.status] : MEAS_ST[x.status] || "accepted";
  const d = v.delta != null ? ` (${v.delta > 0 ? "+" : ""}${fb(v.delta)})` : "";
  const vf = x.status === "done" ? (st === "confirmed" ? [`Підтверджено: компонент зріс${d}`, "p-good"] : st === "notconfirmed" ? [`Не підтверджено: ${v.title || "без змін"}${d}`, "p-bad"] : v.status === "check_data" ? ["Перевірити дані: достовірність C", "p-warn"] : ["Очікує наступного оцінювання", "p-info"]) : null;
  return { id: x.id, rec: titles[x.recommendation_code] || (x.recommendation_code ? "попередньої хвилі" : "окремий захід"), t: x.title, who: x.owner, due: x.due_date, st, ind: x.component, vf, vrule: v.rule, ext: apiExternal(x.external), ev: x.evidence || "", doneOn: x.done_on || null, wave: x.campaign_id || null };
}
// Стан заходу в Mitra (тема 2): бекенд приймає лише посилання на адресу Mitra з налаштувань (THEME2_PUBLIC_URL)
function apiExternal(e) {
  if (!e) return null;
  const t = e.state_title || `надіслано в ${e.system}`;
  return { system: e.system, state: e.state, t: t.charAt(0).toUpperCase() + t.slice(1), url: e.url, note: e.note, summary: e.summary,
    docs: (e.documents || []).map(d => ({ name: d.name, sha: d.sha256, url: d.verify_url })) };
}
const MEAS_BACK = { accepted: "planned", inprogress: "in_progress", done: "done", cancelled: "cancelled" };

async function apiLoadResults() {
  API.model = null; API.empty = false; API.recs = []; API.ms = [];
  let d;
  // Департамент дивиться обраний заклад: без unit_id сервер відповідає 422 «Оберіть заклад»
  API.emptyCode = null;
  if (!API.meth) API.meth = await api("/methodology").catch(() => null);
  applyMethodology();
  try { d = await api("/dashboard" + (API.deptUnit ? `?unit_id=${API.deptUnit}` : "")); }
  catch (e) { if (e.status === 404 || e.status === 409) { API.empty = true; API.emptyCode = e.code || null; return; } throw e; }
  API.campaignId = d.campaign_id; API.unitId = d.unit_id;
  const q = d.unit_id ? `?unit_id=${d.unit_id}` : "";
  const [r, h, recs, ms] = await Promise.all([
    api(`/campaigns/${d.campaign_id}/results${q}`), api(`/units/${d.unit_id}/history`).catch(() => api(`/units/${d.unit_id}/history`)).catch(() => null), // один повтор на випадок короткого збою мережі чи сервера (код запиту збою — у журналі сервера)
    // 404 і 409 (хвиля ще не закрита) дають порожній список; інші збої не ховаємо
    api(`/campaigns/${d.campaign_id}/recommendations${q ? q + "&" : "?"}top=5`).catch(e => { if (e.status !== 404 && e.status !== 409) apiFail(e); return { items: [] }; }), api(`/measures${q}`).catch(() => []),
  ]);
  API.model = apiModel(r, h);
  API.res = r; API.recs = recs.items.map(x => apiRec(x, API.model, r)); API.recGroups = recs.groups || null;
  const titles = Object.fromEntries(recs.items.map(x => [x.code, x.title]));
  API.ms = ms.map(x => apiMeasure(x, titles));
  // Локальна дата, а не UTC: інакше з 00:00 до 02:00 за Києвом «сьогодні» було б учорашнім, і прострочення рахувалося б на день менше.
  const now = new Date(), localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Суфікс «(2)» розрізняє хвилі одного місяця лише на графіках; у шапку, асистента й імена файлів він не йде
  setClock(localToday, String(API.model.series[API.model.series.length - 1].cycle).replace(/ \(\d+\)$/, ""));
  API.waveTitle = r.campaign_title || "";
  const n = API.model.series.length;
  S.trend = { from: 0, to: n - 1, lines: [] }; S.cmp = { a: Math.max(0, n - 2), b: n - 1 };
}
// Департамент: обрати заклад і завантажити його результати (кожен заклад окремо, без рейтингу)
export async function apiSelectInst(id, stay) {
  API.deptUnit = id; API.mod = {}; API.resErr = null; API.model = null; render(true);
  try { await apiLoadResults(); } catch (e) { API.resErr = apiErrText(e); }
  if (!stay) location.hash = "overview"; render();
}
export async function apiReloadResults() { try { await apiLoadResults(); } catch (e) { apiFail(e); } render(true); }
// Повтор після збою завантаження результатів (екран «Не вдалося завантажити»)
export async function apiRetryResults() { API.resErr = null; render(true); try { await apiLoadResults(); } catch (e) { API.resErr = apiErrText(e); } render(true); }

export async function apiDecide(code, decision, comment, measure) {
  const r = await api(`/campaigns/${API.campaignId}/recommendations/${encodeURIComponent(code)}/decision`, { method: "POST", body: { unit_id: API.unitId, decision, comment, ...(measure ? { measure: { ...measure, description: "" } } : {}) } });
  await apiReloadResults();
  return r;
}
// Зміна статусу заходу на сервері; для «Виконано» потрібен доказ
export async function apiSendMSt(id, st, evidence, reason) {
  // done_on не передаємо: сервер ставить сьогоднішню дату за своїм часовим поясом (TIMEZONE), а не за UTC браузера.
  // reason: обов'язкова причина повернення виконаного заходу (сервер пише її в журнал дій).
  // Невідомий статус не підміняємо на in_progress: краще помилка, ніж тихо не той перехід.
  if (!MEAS_BACK[st]) throw new Error(`Невідомий статус заходу: ${st}`);
  await api(`/measures/${id}`, { method: "PATCH", body: { status: MEAS_BACK[st], ...(st === "done" ? { evidence } : {}), ...(reason ? { reason } : {}) } });
  delete API.mod.mhist;
  await apiReloadResults();
}

/* --- Анкета: форма сервера → модель proto --- */
function apiSurveyModel(form, kind, category) {
  const CAT = { working_group: "Робоча група", staff: "Особовий склад", expert: "Зовнішні експерти" };
  const guess = t => /культур/i.test(t) ? "culture" : /систем/i.test(t) ? "system" : /підзвітн/i.test(t) ? "accountability" : null;
  const opt = {};
  const sections = form.sections.map(s => {
    const id = s.component || guess(s.title) || "overall"; // компонент з сервера (culture/system/accountability/overall/candor); за назвою лише для старих відповідей
    // Розділ непрямих питань: респонденту не пояснюємо метод у назві, щоб не підказувати, яке твердження головне
    const candor = id === "candor";
    return { id, t: candor ? "Ситуації на службі" : s.title, about: COMPS.includes(id) ? { culture: "про ставлення до доброчесності", system: "про процедури й канали звернень", accountability: "про прозорість рішень і виконання заходів" }[id] : id === "overall" ? "" : candor ? "кілька коротких питань про повсякденні ситуації" : "за темою розділу",
      q: s.questions.map(q => {
        // Підказка до питання (help_text): для непрямого питання «скільки з переліку» в ній самі твердження.
        // Варіант переліку (A/B) лишається лише в ідентифікаторах відповідей, респондент його не бачить.
        const help = q.help_text || "";
        if (q.type === "scale" && !q.options.length) { const vals = []; for (let v = q.scale_min; v <= q.scale_max; v++) vals.push(v); opt[q.id] = vals.map(v => ({ value: v })); return [q.id, q.text, vals.map(String), help]; }
        opt[q.id] = q.options.map(o => ({ id: o.id })); return [q.id, q.text, q.options.map(o => o.text), help];
      }) };
  });
  return { title: form.title, cat: CAT[category] || "Анонімне опитування", sections, opt, kind, campaignId: form.campaign_id, questionnaireId: form.questionnaire_id, k: form.min_group_size };
}
export async function apiSubmitSurvey() {
  const sv = API.survey, answers = Object.entries(S.survey.a).filter(([qid]) => sv.opt[qid]).map(([qid, i]) => { const o = sv.opt[qid][i]; return o.id ? { question_id: qid, option_ids: [o.id] } : { question_id: qid, option_ids: [], value: o.value }; });
  let receipt = null;
  try {
    if (sv.kind === "token") await api("/respond/responses", { method: "POST", auth: false, headers: { "X-Response-Token": API.token }, body: { answers } });
    else receipt = await submitBallot(sv, answers); // за обліковим записом: анонімний жетон зі сліпим підписом і квитанція
  } catch (e) {
    // «Вже пройдено» лише коли сервер так і каже; інші 409 (хвиля не відкрита тощо) ідуть тостом
    if (e.code === "ballot_used") clearBallot(sv);
    if (e.code === "already_submitted" || e.code === "token_used" || e.code === "ballot_used") { API.surveyUsed = true; API.surveyMsg = "used"; render(); return; }
    if (e.code === "campaign_not_open") { API.survey = null; API.surveyMsg = "closed"; render(); return; }
    if (e.missing && e.missing.length) S.survey.miss = true;
    toast(apiErrText(e)); render(true); return;
  }
  S.survey = { phase: "done", sec: 0, a: {}, miss: false, receipt }; API.surveyUsed = sv.kind === "token";
  clearDraft();
  if (sv.kind !== "token") { sv.submitted = true; API.assignments = null; API.my = null; }
  render();
}
/* --- Жетон зі сліпим підписом (lib/ballot.js) --- */
// Жетон тримаємо в sessionStorage до успішного надсилання: якщо мережа впаде після підпису, повтор не потребує нового жетона
const ballotKey = sv => `ii-ballot:${sv.campaignId}:${sv.questionnaireId}`;
const clearBallot = sv => { try { sessionStorage.removeItem(ballotKey(sv)); } catch (e) { /* немає */ } };
async function submitBallot(sv, answers) {
  const B = await import("./ballot.js"), base = `/campaigns/${sv.campaignId}/questionnaires/${sv.questionnaireId}`;
  let t = null; try { t = JSON.parse(sessionStorage.getItem(ballotKey(sv)) || "null"); } catch (e) { /* немає */ }
  if (!t) {
    const key = await api(`${base}/ballot-key`), b = await B.blind(key.n, key.e);
    const s = await api(`${base}/ballot`, { method: "POST", body: { blinded: b.blinded } });
    const sig = B.unblind(key.n, s.blinded_signature, b.r);
    if (!await B.verifySig(key.n, key.e, b.nonce, sig)) throw new ApiErr(0, { message: "Жетон не пройшов перевірку в браузері", hint: "Оновіть сторінку й спробуйте ще раз." });
    t = { key_id: s.key_id, nonce: b.nonce, signature: sig };
    try { sessionStorage.setItem(ballotKey(sv), JSON.stringify(t)); } catch (e) { /* без збереження: повтор попросить новий жетон */ }
  }
  const r = await api("/respond/ballot", { method: "POST", auth: false, body: { answers, ...t } });
  clearBallot(sv);
  saveReceipt({ receipt: r.receipt, campaignId: sv.campaignId, title: sv.title });
  return r.receipt;
}
// Квитанції лише на цьому пристрої: з них не видно відповідей, тільки «чи врахована відповідь»
export const myReceipts = () => { try { return JSON.parse(localStorage.getItem("ii-receipts") || "[]"); } catch (e) { return []; } };
function saveReceipt(x) { try { localStorage.setItem("ii-receipts", JSON.stringify([...myReceipts().filter(r => r.receipt !== x.receipt), x].slice(-20))); } catch (e) { /* немає */ } }
export const apiCheckReceipt = r => api(`/respond/receipts/${r}`, { auth: false });
export function apiLoadForm(next) {
  if (API.loading.form || API.formError) return;
  API.loading.form = true;
  api(`/campaigns/${next.campaign_id}/questionnaires/${next.questionnaire_id}/form`)
    .then(f => { API.survey = apiSurveyModel(f, "account", API.user.category); S.survey = freshSurvey(); S.survey.a = loadDraft(Object.keys(API.survey.opt)); }, e => { API.formError = apiErrText(e); })
    .finally(() => { API.loading.form = false; render(true); });
}

/* --- Підвантаження даних екрана: true, якщо дані є --- */
export function apiEnsure(key, loader) {
  if (API[key] !== null && API[key] !== undefined) return true;
  if (!API.loading[key]) {
    API.loading[key] = true;
    // асинхронно, щоб не змінювати стан під час малювання
    Promise.resolve().then(loader).then(v => { API[key] = v; }, e => { API[key] = { error: apiErrText(e) }; }).finally(() => { API.loading[key] = false; render(true); });
  }
  return false;
}
export function apiRetry() { API.adm = API.qs = API.ck = API.log = API.my = API.assignments = API.formError = API.dept = null; API.mod = {}; render(); }
export const RESULT_VIEWS = ["overview", "explain", "trends", "compare", "whatif", "recs", "tracker", "report", "sources"];

/* --- Керування циклом (уповноважений) --- */
export const dn = t => String(t || "").replace(/\s*\(демо\)/gi, "");
export async function apiLoadAdm(sel) {
  // Підрозділи лише зони уповноваженого (/units); запити на відкриття, що чекають аудиту, — з /admin/approvals
  const [campaigns, units, qs, aps] = await Promise.all([api("/campaigns"), api("/units"), api("/questionnaires?status=published"),
    fourEyesOn() ? api("/admin/approvals?status=pending").catch(() => []) : []]);
  const waiting = {};
  for (const a of aps) if (a.kind === "open_campaign" && a.target_id) waiting[a.target_id] = a.id;
  for (const c of campaigns) c.waitingOpen = c.status === "draft" ? waiting[c.id] || null : null;
  const cur = sel || (API.adm && API.adm.sel) || (campaigns.find(c => c.status !== "closed") || campaigns[0] || {}).id;
  const c = campaigns.find(x => x.id === cur);
  const [progress, qr] = cur ? await Promise.all([
    api(`/campaigns/${cur}/progress`).catch(() => null),
    c.access_mode === "token" ? api(`/campaigns/${cur}/qr-links`).catch(() => []) : [],
  ]) : [null, []];
  return { campaigns, units, qs, sel: cur, progress, qr };
}
// Розділи «Урна» й «Автопілот» кешуються окремо: після дій із хвилею скидаємо й їх, інакше вони показують старий статус
export const dropWaveMods = () => { for (const k of Object.keys(API.mod)) if (/^(urn:|ap:|urncamp:|apc$|urnCamps$)/.test(k)) delete API.mod[k]; };
export function apiAdmReload(sel) { dropWaveMods(); API.adm = null; API.loading.adm = true; render(true); apiLoadAdm(sel).then(v => { API.adm = v; }, e => { API.adm = { error: apiErrText(e) }; }).finally(() => { API.loading.adm = false; render(true); }); }
export async function apiCreateCampaign(body) {
  const c = await api("/campaigns", { method: "POST", body });
  closeDrawer(); toast(`Хвилю «${c.title}» створено як чернетку`); apiAdmReload(c.id);
}
export async function apiCampaignAct(id, act) {
  if (API.campBusy) return;
  API.campBusy = id + act; render(true);
  try {
    const c = await api(`/campaigns/${id}/${act}`, { method: "POST" });
    // Принцип двох осіб: перший виклик лише створює запит на відкриття
    const pending = act === "open" && c && c.pending_approval_id && c.status !== "open";
    toast(pending ? "Запит на відкриття надіслано. Хвиля відкриється, коли його підтвердить внутрішній аудит" : act === "open" ? "Хвилю відкрито: респонденти бачать анкети" : "Хвилю закрито: знімок результатів збережено");
    // Після закриття оновлюємо результати, трекер, лічильники меню й модулі без перезавантаження сторінки
    if (act === "close") { API.mod = {}; API.ck = API.log = null; if (RESULT_ROLES.includes(S.role)) await apiReloadResults(); }
  } catch (e) { apiFail(e); }
  finally { API.campBusy = null; apiAdmReload(id); } // статус хвилі міг змінитися: показуємо актуальний
}
// QR для зали: одне посилання на групу (анкета + підрозділ), expected — скільки людей у групі
export async function apiQrCreate(id, questionnaireId, unitId, expected) {
  const l = await api(`/campaigns/${id}/qr-links`, { method: "POST", body: { questionnaire_id: questionnaireId, unit_id: unitId, expected } });
  API.adm.qr = [...(API.adm.qr || []), l]; render(true); return l;
}
export async function apiQrRevoke(cid, id) {
  try { const l = await api(`/campaigns/${cid}/qr-links/${id}/revoke`, { method: "POST" }); API.adm.qr = API.adm.qr.map(x => x.id === id ? l : x); toast("Нові скани зупинено"); render(true); }
  catch (e) { apiFail(e); }
}
// Живі лічильники відкритої анонімної хвилі: лише кількості, без перемонтування екрана
export async function apiQrTick() {
  const A = API.adm, c = A && A.campaigns && A.campaigns.find(x => x.id === A.sel);
  if (!c || c.status !== "open" || c.access_mode !== "token" || document.hidden) return;
  try {
    const [qr, progress] = await Promise.all([api(`/campaigns/${c.id}/qr-links`), api(`/campaigns/${c.id}/progress`)]);
    if (API.adm !== A || A.sel !== c.id) return;
    A.qr = qr; A.progress = progress; render(true);
  } catch (e) { /* наступна спроба за кілька секунд */ }
}

/* --- Анкети (Департамент) --- */
export const QST = { draft: ["Чернетка", "p-warn"], published: ["Опубліковано", "p-good"], archived: ["В архіві", "p-mute"] };
export const QCAT = { working_group: "Робоча група", staff: "Особовий склад", expert: "Зовнішні експерти" };
export function apiSurveysReload() { API.qs = null; render(true); }
export async function apiQAct(id, act) {
  if (API.qBusy) return;
  API.qBusy = id; render(true); // кнопки анкети неактивні, доки йде запит
  try {
    if (act === "publish") { const issues = await api(`/questionnaires/${id}/validate`); if (issues.length) { toast("Не можна опублікувати: " + issues.map(i => i.message).join("; ")); return; } }
    const q = await api(`/questionnaires/${id}/${act}`, { method: "POST" });
    toast(act === "publish" ? `Опубліковано: ${q.title}` : act === "new-version" ? `Створено чернетку версії ${q.version}` : act === "restore" ? `Повернуто з архіву: ${q.title}` : `В архіві: ${q.title}`);
    API.qs = null; render(true);
    if (act === "new-version") bldOpen(q.id); // нова версія це чернетка: одразу відкриваємо в конструкторі
  } catch (e) { toast(act === "publish" && e.errors && e.errors.length ? "Не можна опублікувати: " + e.errors.map(x => x.message).join("; ") : apiErrText(e)); }
  finally { API.qBusy = null; render(true); }
}
export async function bldOpen(id) {
  try { const q = await api(`/questionnaires/${id}`); ui.bld = { q, n: Date.now() }; render(true); } catch (e) { apiFail(e); }
}

/* --- Чек-лист: вносить робоча група, підтверджує внутрішній аудит --- */
export const CKS = { full: ["Впроваджено повністю", "p-good"], partial: ["Частково", "p-warn"], none: ["Не впроваджено", "p-bad"] };
export async function apiLoadCk(sel) {
  let camps;
  // Член РГ: відкриті хвилі з призначень і закриті з «Моїх результатів» (переглянути, що внесли минулого разу)
  if (S.role === "checklist_editor") {
    const [as, rs] = await Promise.all([api("/me/assignments"), api("/me/results").catch(() => [])]);
    camps = as.filter(a => a.kind === "checklist").map(a => ({ id: a.campaign_id, title: a.campaign_title, status: "open" }));
    (Array.isArray(rs) ? rs : []).forEach(r => { if (!camps.some(c => c.id === r.campaign_id)) camps.push({ id: r.campaign_id, title: r.campaign_title, status: "closed" }); });
  }
  // Лише хвилі з чек-листом (has_checklist від сервера; старий сервер без поля — показуємо всі)
  else camps = (await api("/campaigns")).filter(c => c.status !== "draft" && c.has_checklist !== false).map(c => ({ id: c.id, title: c.title, status: c.status }));
  const cur = sel || (camps.find(c => c.status === "open") || camps[0] || {}).id;
  let data = null, err = null;
  if (cur) { try { data = await api(`/campaigns/${cur}/checklist`); } catch (e) { err = apiErrText(e); } }
  return { camps, sel: cur, data, err };
}
export function apiCkReload(sel) { API.ck = null; API.loading.ck = true; render(true); apiLoadCk(sel).then(v => { API.ck = v; }, e => { API.ck = { error: apiErrText(e) }; }).finally(() => { API.loading.ck = false; render(true); }); }
// Внести пункт разом із документами одним запитом (multipart). Атомарно: якщо файл не пройшов, не змінюється нічого.
// Той самий документ (той самий sha256) вдруге не додаємо: сервер приймає дублікат мовчки
const sha256 = async f => { const h = await crypto.subtle.digest("SHA-256", await f.arrayBuffer()); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); };
async function dupFile(qid, files) {
  if (!files.length || !(window.crypto && crypto.subtle)) return false;
  const it = API.ck && API.ck.data && (API.ck.data.items || []).find(i => i.question_id === qid), seen = new Set(((it && it.files) || []).map(f => f.sha256).filter(Boolean));
  for (const f of files) { const h = await sha256(f); if (seen.has(h)) return true; seen.add(h); }
  return false;
}
export async function apiSaveItem(camp, qid, body, files = []) {
  if (await dupFile(qid, files)) throw new ApiErr(409, { message: "Цей документ уже додано", code: "dup_file" });
  const fd = new FormData();
  fd.append("status", body.status); fd.append("evidence", body.evidence || ""); fd.append("comment", body.comment || "");
  for (const f of files) fd.append("files", f);
  return api(`/campaigns/${camp}/checklist/${qid}/submit`, { method: "POST", body: fd });
}
export const fourEyesOn = () => !!(API.cfg && API.cfg.policies && API.cfg.policies.four_eyes);
export const requireFile = () => !!(API.cfg && API.cfg.policies && API.cfg.policies.checklist_require_file);
export async function apiConfirm(qid, yes) {
  const camp = API.ck.sel;
  try { await api(`/campaigns/${camp}/checklist/${qid}/confirm`, { method: yes ? "POST" : "DELETE" }); toast(yes ? "Пункт підтверджено" : "Підтвердження відкликано"); apiCkReload(camp); }
  catch (e) { apiFail(e); }
}
export async function apiDelFile(camp, qid, fid) { try { await api(`/campaigns/${camp}/checklist/${qid}/files/${fid}`, { method: "DELETE" }); toast("Файл прибрано з пункту (лишається в журналі)"); apiCkReload(camp); } catch (e) { apiFail(e); } }
export async function apiDownload(camp, qid, fid, name) {
  try { const r = await api(`/campaigns/${camp}/checklist/${qid}/files/${fid}`, { raw: true }); const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  catch (e) { apiFail(e); }
}

/* --- Журнал --- */
export const AUDIT_ENT = { campaign: "Хвиля", questionnaire: "Анкета", user: "Користувач", unit: "Підрозділ", checklist_entry: "Чек-лист", evidence_file: "Файл-доказ", measure: "Захід", recommendation: "Рекомендація", results: "Результати", indicator: "Факт", report: "Звіт", assistant: "Асистент", audit_log: "Журнал", autopilot: "Автопілот", normative: "Що змінилось", learning_deck: "Навчання", check_run: "Перевірка", check_finding: "Знахідка перевірки", approval: "Запит другій людині", category: "Категорія респондентів", checklist: "Чек-лист", fact_definition: "Показник фактів", position: "Посада" };
// Людські назви дій бекенду: «сутність:дія» → текст
export const AUDIT_ACT = {
  "assistant:ask": "Запит до асистента", "assistant:edit_report": "Звіт: запит до ШІ щодо фрагмента", "audit_log:verify": "Перевірено цілісність журналу",
  "campaign:create": "Створено хвилю", "campaign:update": "Змінено хвилю", "campaign:open": "Відкрито хвилю", "campaign:close": "Закрито хвилю, збережено знімок результатів",
  "campaign:set_participants": "Змінено учасників хвилі", "campaign:clear_participants": "Очищено учасників хвилі", "campaign:import_participants": "Імпортовано учасників",
  "campaign:issue_tokens": "Видано одноразові посилання", "campaign:import_tokens": "Імпортовано посилання", "campaign:revoke_tokens": "Відкликано посилання",
  "campaign:create_qr_link": "Створено QR для зали", "campaign:revoke_qr_link": "Зупинено скани QR",
  "campaign:export_report": "Експортовано звіт", "campaign:view_dashboard": "Переглянуто огляд закладу", "campaign:view_recommendations": "Переглянуто рекомендації", "campaign:view_results": "Переглянуто результати", "campaign:recalculate_results": "Перераховано результати за поточною методикою",
  "checklist_entry:set": "Внесено пункт чек-листа", "checklist_entry:confirm": "Підтверджено пункт чек-листа", "checklist_entry:revoke_confirm": "Відкликано підтвердження пункту чек-листа",
  "evidence_file:upload": "Додано файл-доказ", "evidence_file:download": "Завантажено файл-доказ", "evidence_file:delete": "Видалено файл-доказ", "evidence_file:integrity_fail": "Файл-доказ не пройшов перевірку цілісності",
  "indicator:upsert": "Передано факт із зовнішньої системи",
  "measure:create": "Створено захід", "measure:update": "Змінено захід", "measure:external_status": "Статус заходу оновлено із зовнішньої системи",
  "questionnaire:create": "Створено анкету", "questionnaire:update_meta": "Змінено анкету", "questionnaire:publish": "Опубліковано анкету", "questionnaire:new_version": "Створено нову версію анкети", "questionnaire:archive": "Анкету архівовано", "questionnaire:delete": "Видалено анкету",
  "recommendation:decide": "Ухвалено рішення щодо рекомендації",
  "unit:create": "Створено підрозділ", "unit:update": "Змінено підрозділ", "unit:delete": "Видалено підрозділ", "unit:compare": "Порівняно хвилі підрозділу", "unit:view_history": "Переглянуто історію підрозділу",
  "campaign:devils_advocate": "Переглянуто питання перевірки", "campaign:autopilot": "Змінено налаштування автопілота хвилі", "autopilot:tick": "Виконано крок автопілота",
  "normative:analyze": "Проаналізовано нормативний документ", "learning_deck:complete": "Пройдено колоду флешкарток", "indicator:publish": "Записано показник із модуля системи",
  "check_run:run": "Запущено перевірку", "check_run:fetch": "Отримано дані для перевірки", "check_finding:review": "Розглянуто знахідку перевірки",
  "approval:request_approval": "Запит на підтвердження другою людиною", "approval:approve": "Запит підтверджено другою людиною", "approval:reject": "Запит відхилено другою людиною",
  "audit_log:accept_anchor": "Аудит прийняв хеш журналу", "audit_log:verify_anchor": "Хеш журналу звірено з копією аудиту",
  "campaign:audit_lottery": "Проведено лотерею перевірок", "campaign:delete": "Видалено чернетку хвилі",
  "campaign:urn_setup": "Увімкнено урну з трьома ключами", "campaign:urn_disable": "Вимкнено урну", "campaign:urn_take_share": "Власник отримав свою частину ключа", "campaign:urn_submit_share": "Введено частину ключа урни", "campaign:urn_close_requested": "Запит на відкриття урни",
  "category:create": "Додано категорію респондентів", "category:update": "Змінено категорію респондентів", "checklist:assign": "Призначено відповідальних за пункти чек-листа",
  "fact_definition:create": "Додано показник фактів", "fact_definition:update": "Змінено показник фактів", "position:create": "Додано посаду", "position:deactivate": "Посаду вимкнено",
  "questionnaire:restore": "Анкету повернуто з архіву", "unit:import_risks": "Імпортовано реєстр корупційних ризиків", "user:invite": "Надіслано запрошення", "user:accept_invite": "Користувач прийняв запрошення й задав пароль",
  "user:create": "Створено користувача", "user:update": "Змінено користувача", "user:login_proxy": "Вхід через проксі",
};
export function apiLoadLog() {
  return Promise.all([
    api("/admin/audit-log?limit=500"),
    api("/units").catch(() => []),
    // Повного довідника людей уповноважений не має: імена беремо зі складу хвиль (/campaigns/{id}/people), аудит бачить лише себе
    API.user && API.user.role === "admin" ? api("/campaigns").then(cs => Promise.all((Array.isArray(cs) ? cs : cs.items || []).slice(0, 6).map(c => api(`/campaigns/${c.id}/people`).catch(() => [])))).then(ls => ls.flat()).catch(() => []) : [],
  ]).then(([rows, units, users]) => ({ rows, units, users: [...(API.user ? [{ id: API.user.id, display_name: API.user.display_name || API.user.login }] : []), ...users] }));
}
// Читабельний рядок із деталей запису: назви підрозділів замість UUID, без службових полів
export function auditDetails(x, units) {
  const unit = id => { const u = units.find(u => u.id === id); return u ? dn(u.name) : "підрозділ …" + String(id).slice(-4); };
  const d = x.details || {}, out = [];
  if (d.unit_id) out.push(unit(d.unit_id));
  if (d.unit_name) out.push(dn(d.unit_name));
  if (d.title) out.push(`«${dn(d.title)}»`);
  if (d.recalculate === true) out.push("з перерахунком");
  if (d.access_mode) out.push(d.access_mode === "token" ? "анонімно за QR" : "за обліковими записами");
  if (d.expected != null) out.push(`людей у групі: ${d.expected}`);
  if (d.count != null) out.push(`кількість: ${d.count}`);
  if (d.ok != null) out.push(d.ok ? "ланцюг цілий" : "ланцюг порушено");
  if (d.checked != null) out.push(`перевірено записів: ${d.checked}`);
  return out.join(" · ");
}
export async function apiVerify() {
  try { API.chain = await api("/admin/audit-log/verify", { method: "POST" }); API.log = null; render(true); }
  catch (e) { apiFail(e); }
}

/* --- Нові модулі: навчання, інсайти, нормативка, автопілот, сповіщення, перевірки --- */
// Дані екранів лежать у API.mod[ключ] (див. apiMod), скидаються при повторі й виході.
export function apiMod(key, loader) {
  const m = API.mod;
  if (m[key] !== undefined) return m[key];
  if (!API.loading["m:" + key]) {
    API.loading["m:" + key] = true;
    Promise.resolve().then(loader).then(v => { m[key] = { data: v }; }, e => { m[key] = { error: apiErrText(e), status: e && e.status }; })
      .finally(() => { API.loading["m:" + key] = false; render(true); });
  }
  return undefined;
}
export const apiModReset = (...keys) => { for (const k of keys) delete API.mod[k]; render(true); };
const enc = encodeURIComponent;
export const apiDecks = () => api("/learning/decks");
export const apiDeck = code => api(`/learning/decks/${enc(code)}`);
export const apiDeckDone = (code, seen) => api(`/learning/decks/${enc(code)}/complete`, { method: "POST", body: { seen } });
export const apiLearnStats = () => api("/learning/stats");
export const apiAdvocate = (cid, limit = 10) => api(`/campaigns/${cid}/devils-advocate?limit=${limit}`);
export const apiDigest = () => api("/agent/digest");
export const apiNotices = () => api("/me/notifications");
export function apiAnalyze(file, text, title) {
  const fd = new FormData();
  if (file) fd.append("file", file); else fd.append("text", text);
  if (title) fd.append("title", title);
  return api("/normative/analyze", { method: "POST", body: fd });
}
// Хвилі для автопілота: уповноважений і аудит бачать хвилі своєї зони
export async function apiAutopilotCampaigns() {
  return (await api("/campaigns")).map(c => ({ id: c.id, title: c.title, status: c.status }));
}
export const apiAutopilot = id => api(`/campaigns/${id}/autopilot`);
export const apiAutopilotSet = (id, body) => api(`/campaigns/${id}/autopilot`, { method: "PUT", body });
export const apiAutopilotTick = () => api("/autopilot/tick", { method: "POST" });
export async function apiAutopilotReport(id) {
  const r = await api(`/campaigns/${id}/autopilot/report`, { raw: true }), blob = await r.blob();
  const m = /filename="?([^";]+)"?/.exec(r.headers.get("content-disposition") || "");
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = m ? m[1] : "report.docx"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const apiCheckRuns = () => api("/checks/runs?limit=50");
export function apiCheckFindings(f) {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  return api(`/checks/findings?limit=200${q ? "&" + q : ""}`);
}
export const apiCheckReview = (id, status, comment) => api(`/checks/findings/${id}/review`, { method: "POST", body: { status, comment } });
export const apiCheckPublish = (unit_id, period) => api("/checks/publish", { method: "POST", body: { unit_id, period } });
// Запуск перевірки. live: живі реєстри (Prozorro чи НАЗК, якщо сервер дозволяє external_fetch);
// інакше тестовий набір для підрозділу й періоду (GET /checks/mock/{kind}). Обидва шляхи дають запуск у модулі «Перевірки».
export const liveChecks = () => !!(API.cfg && API.cfg.policies && API.cfg.policies.external_fetch);
export async function apiCheckRun(kind, unit_id, period, live = false) {
  if (live && kind === "procurement") return api("/checks/fetch/prozorro", { method: "POST", body: { unit_id, period, limit: 20 } });
  const body = live ? await api("/checks/fetch/nazk", { method: "POST", body: { unit_id, period, limit: 20 } })
    : await api(`/checks/mock/${kind}?unit_id=${unit_id}&period=${period}`);
  return api(`/checks/${kind}`, { method: "POST", body });
}
// Завантаження файлу з API (Word, Excel): назва з Content-Disposition або запасна
export async function apiFile(path, fallback) {
  const r = await api(path, { raw: true }), blob = await r.blob();
  const cd = r.headers.get("content-disposition") || "", star = /filename\*=UTF-8''([^;]+)/i.exec(cd), plain = /filename="?([^";]+)"?/i.exec(cd);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallback;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
