/* Стан демо (localStorage), ролі, меню, анкета й журнал із ланцюгом хешів. */
import { API } from "./api.js";
import { render, toast } from "./store.js";

/* ---------- Анкета особового складу (токен demo) ---------- */
export const SURVEY = {
  title: "Анонімне опитування про систему доброчесності закладу", cat: "Особовий склад",
  sections: [
    { id: "culture", t: "Культура", about: "про ставлення до доброчесності", q: [
      ["cu-1", "Як у вашому підрозділі обговорюють питання етики й доброчесності?", ["Не обговорюють взагалі, і ніхто цього не планує", "Обговорюють лише після окремих випадків", "Обговорюють за планом, але учасники здебільшого слухають", "Обговорюють регулярно, учасники висловлюються й ставлять запитання", "Обговорюють системно, висновки застосовують і щороку переглядають формат"]],
      ["cu-2", "Наскільки керівники підрозділу особистим прикладом підтримують правила доброчесності?", ["Правила й практика керівників помітно розходяться", "Приклад є в окремих керівників, але непослідовно", "Більшість керівників діють відповідно до правил", "Керівники діють відповідно до правил і пояснюють свої рішення", "Приклад керівників системний, його оцінюють і він покращується разом із практикою"]],
      ["cu-3", "Чи можна повідомити про проблему, не боячись наслідків для себе?", ["Ні, про проблеми краще мовчати", "Скоріше ні, бо відомі випадки тиску", "Інколи так, залежить від людей", "Так, і відомо, що повідомлення розглядають по суті", "Так, це перевірено на практиці, а захист заявників регулярно оцінюють і вдосконалюють"]],
    ] },
    { id: "system", t: "Система", about: "про процедури й канали звернень", q: [
      ["sy-1", "Наскільки зрозумілі процедури, за якими приймають рішення щодо доброчесності?", ["Процедур не існує або про них нічого не відомо", "Процедури існують, але їх знають одиниці", "Процедури описано, і більшість знає, де їх знайти", "Процедури зрозумілі, їх застосовують однаково", "Процедури працюють системно, перевіряються й удосконалюються"]],
      ["sy-2", "Чи доступні канали звернень (куди повідомити про проблему чи поставити запитання)?", ["Каналів немає або вони не працюють", "Канал є, але мало хто знає про нього", "Канали відомі, але користуватися ними незручно", "Канали відомі, зручні, відповідь надходить у зазначений строк", "Канали працюють стабільно, їх якість перевіряють і поліпшують"]],
      ["sy-3", "Як навчають правилам доброчесності та чи допомагає це в роботі?", ["Навчання не проводять", "Навчання проводять рідко й формально", "Навчання проводять за планом, але без практичних прикладів", "Навчання регулярне, з прикладами з роботи закладу", "Навчання системне, його результати перевіряють і оновлюють зміст"]],
    ] },
    { id: "accountability", t: "Підзвітність", about: "про прозорість рішень і виконання заходів", q: [
      ["ac-1", "Наскільки прозорі рішення керівництва щодо доброчесності?", ["Рішення приймають закрито, причини невідомі", "Про рішення дізнаються випадково", "Про рішення повідомляють, але причини пояснюють не завжди", "Рішення оприлюднюють разом із поясненням причин", "Рішення прозорі, а їх зрозумілість регулярно перевіряють і покращують"]],
      ["ac-2", "Чи оприлюднюють результати перевірок і що з ними роблять далі?", ["Результатів перевірок немає або їх не оприлюднюють", "Результати оприлюднюють рідко й без наступних кроків", "Результати оприлюднюють, наступні кроки визначають не завжди", "Результати оприлюднюють, і за ними визначено заходи зі строками", "Результати та виконання заходів відстежують системно й оприлюднюють щоразу"]],
      ["ac-3", "Як контролюють виконання заходів із доброчесності?", ["Виконання не контролюють", "Контролюють лише коли щось пішло не так", "Контролюють, але без чітких строків і відповідальних", "Контролюють за строками, відповідальні відомі", "Контроль системний, а його ефективність перевіряють і вдосконалюють"]],
    ] },
  ],
};
export const SURVEY_Q = SURVEY.sections.flatMap((s, si) => s.q.map(([id, t, o], qi) => ({ id, t, o, si, qi })));
// Анкета, яку зараз проходять: з сервера (api.js) або демо.
export const SV = () => API.survey || SURVEY;
export const SQ = () => API.survey ? API.survey.sections.flatMap((s, si) => s.q.map(([id, t, o], qi) => ({ id, t, o, si, qi }))) : SURVEY_Q;

/* ---------- Ролі ---------- */
export const ROLE = {
  admin: ["Уповноважений (адміністратор)", "УП"],
  respondent: ["Респондент", "Р"],
  leader: ["Керівник закладу", "КЗ"],
  observer: ["Департамент", "Д"],
  checklist_editor: ["Вносить дані чек-листа", "ВД"],
  checklist_approver: ["Внутрішній аудит: підтверджує чек-лист", "ВА"],
  auditor: ["Внутрішній аудит", "ВА"],
  coordinator: ["Технічний адміністратор", "ТА"],
};
export const NAV = [
  ["institutions", "Заклади", "building", ["observer"]],
  ["overview", "Огляд", "gauge", ["leader", "observer", "auditor"]],
  ["explain", "Розклад індексу", "tree", ["leader", "observer", "auditor"]],
  ["trends", "Динаміка", "trend", ["leader", "observer", "auditor"]],
  ["compare", "Порівняння", "compare", ["leader", "observer", "auditor"]],
  ["whatif", "Що, якщо", "sliders", ["leader", "observer", "auditor"]],
  ["recs", "Рекомендації", "bulb", ["leader"]],
  ["tracker", "Трекер заходів", "target", ["leader", "auditor"]],
  ["sources", "Джерела", "plug", ["leader", "observer", "auditor"]],
  ["advocate", "Питання перевірки", "scale", ["leader", "observer", "auditor", "admin"]],
  ["report", "Звіт", "file", ["leader", "observer"]],
  ["manage", "Керування циклом", "sliders", ["admin"]],
  ["checks", "Перевірки", "shield", ["admin"]],
  ["surveys", "Анкети", "survey", ["observer"]],
  ["checklist", "Чек-лист", "check", ["checklist_editor", "checklist_approver"]],
  ["normative", "Що змінилось", "layers", ["leader", "observer", "auditor", "admin"]],
  ["people", "Люди", "users", ["coordinator"]],
  ["units", "Підрозділи", "building", ["coordinator"]],
  ["summary", "Зведення", "gauge", ["coordinator"]],
  ["dicts", "Довідники", "layers", []],
  ["risks", "Реєстр ризиків", "flag", []],
  ["audit", "Журнал", "history", ["admin", "auditor"]],
  ["views", "Перегляди підрозділів", "eye", ["admin", "auditor"]],
  ["approvals", "Запити другій людині", "users", ["admin", "auditor", "coordinator"]],
  ["urn", "Урна з трьома ключами", "lock", ["admin", "auditor", "respondent", "checklist_editor"]],
  ["survey", "Пройти опитування", "survey", ["respondent"]],
  ["me", "Мої результати", "user", ["respondent"]],
  ["learn", "Навчання", "book", ["respondent", "checklist_editor", "checklist_approver", "leader", "observer", "auditor", "admin"]],
];
// Групи меню: «Результати», «Дії», «Інструменти» (маршрути без змін)
export const NAV_GROUP = { overview: "res", explain: "res", trends: "res", compare: "res", whatif: "res", institutions: "res", recs: "act", tracker: "act", manage: "act", surveys: "act", checklist: "act", survey: "act", me: "act", autopilot: "act", checks: "act" };
export const NAV_GROUP_T = { res: "Результати", act: "Дії", tools: "Інструменти" };
// «Простий режим» для вищого керівництва: у меню лише Огляд і Звіт (брифінг на «Огляді»).
// Вибір зберігається в localStorage (лише "1" або "0", без персональних даних); за замовчуванням увімкнено для Департаменту.
const SIMPLE_KEY = "ii-simple-mode";
export const SIMPLE_ROUTES = ["institutions", "overview", "report", "surveys"]; // анкети Департаменту лишаються і в простому режимі
// Департамент і в простому режимі бачить реєстри ризиків своїх закладів (лише перегляд)
export const simpleRoute = r => SIMPLE_ROUTES.includes(r) || (S.role === "observer" && r === "risks");
export function simpleMode() { try { const v = localStorage.getItem(SIMPLE_KEY); if (v === "1" || v === "0") return v === "1"; } catch (e) { /* сховище недоступне */ } return S.role === "observer"; }
export function setSimpleMode(on) { try { localStorage.setItem(SIMPLE_KEY, on ? "1" : "0"); } catch (e) { /* сховище недоступне */ } render(true); }
export const HOME = { admin: "manage", respondent: "me", leader: "overview", observer: "institutions", checklist_editor: "checklist", checklist_approver: "checklist", auditor: "overview", coordinator: "people" };
export const AI_ROLES = ["leader", "observer", "auditor"];

/* ---------- Стан ---------- */
export const FACT_META = { "sy-f1": ["12.11.2026", "Уповноважений"] };
const QUESTIONNAIRES = [
  { id: "q-os", t: "Анонімне опитування особового складу", grp: "Особовий склад", ver: 3, st: "published", n: 9, upd: "02.11.2026" },
  { id: "q-wg", t: "Анкета робочої групи", grp: "Робоча група", ver: 2, st: "published", n: 11, upd: "28.10.2026" },
  { id: "q-ex", t: "Експертне оцінювання", grp: "Експерти", ver: 1, st: "published", n: 8, upd: "28.10.2026" },
  { id: "q-ck", t: "Чек-лист: анкети фактів", grp: "Відповідальні за чек-лист", ver: 1, st: "draft", n: 4, upd: "14.11.2026" },
];
const DEFAULTS = () => ({
  role: "leader", k: 5, inst: "alpha", unit: "unit-a", cycleOpen: true,
  facts: {}, fpend: {}, dec: { rec: {}, mst: {}, added: [] }, qs: QUESTIONNAIRES.map(q => ({ ...q })),
  log: [], notes: [], aiOn: true, tokenUsed: false,
  mode: "credited", trackView: "table", recF: { st: "all", c: "all" }, trF: { st: "all", who: "all" },
  trend: { from: 0, to: 3, lines: [] }, cmp: { a: 0, b: 3 }, cmpCycle: -1, a11y: { z: 1, hc: false }, insts: { extra: [], renamed: {}, archived: [] }, instQ: "", instArch: false, guideOpen: false, advDone: {}, digestCat: "all",
});
export const freshSurvey = () => ({ phase: "intro", sec: 0, a: {}, miss: false });
export const S = Object.assign(DEFAULTS(), { chat: [], survey: freshSurvey(), open: {} });
const KEY = "ii-proto-v2";
const SAVE = ["role", "k", "inst", "unit", "cycleOpen", "facts", "fpend", "dec", "qs", "log", "notes", "aiOn", "tokenUsed", "mode", "trackView", "recF", "trF", "trend", "cmp", "cmpCycle", "a11y", "insts", "instArch", "guideOpen", "advDone"];
try { const saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved) SAVE.forEach(k => { if (saved[k] !== undefined) S[k] = saved[k]; }); } catch (e) { /* без збереженого стану */ }
/* Чернетка анкети: окремий ключ для кожної хвилі й анкети (за обліковим записом) або для кожного посилання
   (хеш токена, не сам токен). Підставляється після завантаження форми; очищається після надсилання й при виході. */
const DRAFT = "ii-survey-draft";
export const draftKey = () => !API.on ? `${DRAFT}:demo` : API.anon ? `${DRAFT}:t:${fnv(String(API.token || ""))}` : API.survey ? `${DRAFT}:${API.survey.campaignId}:${API.survey.questionnaireId}` : null;
export function loadDraft(ids) {
  const k = draftKey(); if (!k) return {};
  try { const d = JSON.parse(localStorage.getItem(k) || "null") || {}; return ids ? Object.fromEntries(Object.entries(d).filter(([q]) => ids.includes(q))) : d; } catch (e) { return {}; }
}
export function saveDraft(a) { const k = draftKey(); if (k) try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) { /* сховище недоступне */ } }
export function clearDraft(all) { try { for (const k of Object.keys(localStorage)) if (all ? k.startsWith(DRAFT) : k === draftKey() || k === DRAFT) localStorage.removeItem(k); } catch (e) { /* немає */ } }
S.survey.a = loadDraft();
export const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(SAVE.map(k => [k, S[k]])))); } catch (e) { /* сховище недоступне */ } };
export function resetDemo() {
  const role = S.role, a11y = S.a11y;
  Object.assign(S, DEFAULTS(), { role, a11y, chat: [], survey: freshSurvey() });
  clearDraft(true);
  addLog(me(), "Демо-дані скинуто"); persist(); render(); toast("Демо-дані скинуто");
}

/* Журнал дій із ланцюгом хешів */
export function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); }
const SEEDLOG = [
  ["2026-11-01 09:12", "Уповноважений (адміністратор)", "Відкрито цикл 2026-11, мінімальна група 10 осіб"],
  ["2026-11-01 09:20", "Уповноважений (адміністратор)", "Видано 84 одноразові жетони (РГ 15, ОС 64, експерти 5)"],
  ["2026-11-02 10:05", "Департамент", "Опубліковано анкету «Анонімне опитування особового складу», версія 3"],
  ["2026-11-10 14:05", "Вносить дані чек-листа", "Чек-лист: внесено 8 показників фактів"],
  ["2026-11-11 10:41", "Внутрішній аудит", "Чек-лист: підтверджено 8 показників"],
  ["2026-11-12 16:20", "Уповноважений (адміністратор)", "Журнал звернень: внесено 36 з 60 розглянутих у строк"],
  ["2026-11-15 18:00", "Система", "Розрахунок індексу за методикою v1.0: 54,2"],
];
export const logItems = () => { let prev = "0"; return [...SEEDLOG, ...S.log].map(([t, who, a]) => { const h = fnv(prev + t + who + a); prev = h; return { t, who, a, h }; }); };
export function addLog(who, a) { const t = new Date().toISOString().slice(0, 16).replace("T", " "); S.log.push([t, who, a]); persist(); }
export const me = () => ROLE[S.role][0];
