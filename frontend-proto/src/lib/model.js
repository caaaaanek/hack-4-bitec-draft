/* Модель і методика (як у робочій версії команди). Чисті дані й функції без DOM. */
import { S } from "./state.js";
import { API } from "./api.js";
import { fb } from "./format.js";

export const COMPS = ["culture", "system", "accountability"];
export const COMP = {
  culture: { n: "Культура", loc: "Культурі", ic: "users", c: "var(--teal)", s: "var(--teal-soft)" },
  system: { n: "Система", loc: "Системі", ic: "layers", c: "var(--blue)", s: "var(--blue-soft)" },
  accountability: { n: "Підзвітність", loc: "Підзвітності", ic: "scale", c: "var(--amber)", s: "var(--amber-soft)" },
};
export const LEVELS = ["Початковий (хаотичний)", "Керований", "Визначений", "Вимірюваний", "Оптимізуючий"];
export const LSHORT = ["Початковий", "Керований", "Визначений", "Вимірюваний", "Оптимізуючий"];
export const BOUNDS = [12.5, 37.5, 62.5, 87.5];
// Коротко за Моделлю зрілості НАЗК (Рекомендації НУОУ, розділ про рівні зрілості)
export const LDESC = [
  "Системи доброчесності немає: норми виконуються вибірково, до питання повертаються лише після порушень.",
  "Є базові правила й контроль: цінності названі, призначено уповноваженого, ухвалено програму доброчесності.",
  "Система описана й працює: процедури чіткі, відомі всім і виконуються, канали повідомлень налагоджені.",
  "Цілі вимірюються: заклад стежить за показниками, оцінює кожен захід і проводить аудит системи.",
  "Система постійно вдосконалюється на основі даних, доброчесність стала частиною культури, є зовнішній аудит.",
];
export const CAP = 25;
// З бекендом дата й цикл беруться з останньої закритої хвилі (api.js → setClock).
export let TODAY = "2026-11-16", TODAY_UA = "16.11.2026", CYCLE = "2026-11";
export function setClock(today, cycle) { TODAY = today; TODAY_UA = today.split("-").reverse().join("."); CYCLE = cycle; }
export const r1 = v => Math.round(v * 10) / 10;
export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
// Рівень за мінімальними межами 0 / 12,5 / 37,5 / 62,5 / 87,5: бал >= межі (як maturity_level на сервері)
export const level = v => 1 + BOUNDS.filter(b => v >= b).length;
// Слабка ланка (методика v2.1): рівень індексу не вищий за рівень найслабшого компонента плюс 1
export const indexLevel = (idx, comps) => { const c = comps.filter(v => v != null); return c.length ? Math.min(level(idx), Math.min(...c.map(level)) + 1) : level(idx); };
export const lvl100 = l => (l - 1) * 25;
export const status = v => v >= 65 ? "good" : v >= 40 ? "warn" : "bad";
export const ST = { good: ["Сильна сторона", "p-good"], warn: ["Потребує уваги", "p-warn"], bad: ["Критична зона", "p-bad"] };
export const SCOL = { good: "var(--teal)", warn: "var(--amber)", bad: "var(--red)" };
export const SRC = { wg: ["Робоча група", "var(--blue)", "circle"], os: ["Особовий склад", "var(--teal)", "square"], experts: ["Експерти", "#8b6fd6", "diamond"], facts: ["Підтверджено фактами", "var(--amber)", "triangle"] };
export const SRC_HINT = { wg: "Середня оцінка відповідей робочої групи, 0-100.", os: "Середня оцінка відповідей особового складу, 0-100.", experts: "Середня оцінка експертів, 0-100." };
export const wmean = arr => { const w = arr.reduce((a, x) => a + x.w, 0); return r1(arr.reduce((a, x) => a + x.w * x.v, 0) / w); };
export const indexOf = cr => r1(COMPS.reduce((a, c) => a + cr[c] / 3, 0));

export const PERCEPTION = [
  ["cu-p1", "culture", "Відкритість до обговорення етичних питань", 30, 70, "wg"],
  ["cu-p2", "culture", "Особистий приклад керівників", 30, 50, "os"],
  ["cu-p3", "culture", "Готовність повідомляти про проблеми без страху наслідків", 20, 45, "os"],
  ["cu-p4", "culture", "Розуміння правил доброчесності", 20, 62.5, "experts"],
  ["sy-p1", "system", "Зрозумілість процедур", 30, 40, "os"],
  ["sy-p2", "system", "Доступність каналів звернень", 30, 50, "wg"],
  ["sy-p3", "system", "Захищеність тих, хто повідомляє про проблеми", 20, 40, "os"],
  ["sy-p4", "system", "Якість внутрішніх документів", 20, 50, "experts"],
  ["ac-p1", "accountability", "Прозорість рішень керівництва", 30, 85, "wg"],
  ["ac-p2", "accountability", "Оприлюднення результатів перевірок", 30, 80, "wg"],
  ["ac-p3", "accountability", "Відповідальність за виконання заходів", 20, 75, "os"],
  ["ac-p4", "accountability", "Контроль виконання рішень", 20, 77.5, "experts"],
].map(([id, c, t, w, v, src]) => ({ id, c, t, w, v, src, kind: "p" }));

// Факти: відсоток за даними обліку або рівень 1–5 за анкетою чек-листа
export const FACTS = [
  ["cu-f1", "culture", "Прапорці, за якими прийнято рішення або захід протягом 30 днів", 50, "pct", [11, 20], "Журнал рішень уповноваженого"],
  ["cu-f2", "culture", "Рівень за анкетою «Етичні практики»", 25, "lvl", 2, "Чек-лист закладу"],
  ["cu-f3", "culture", "Рівень за анкетою «Навчання з доброчесності»", 25, "lvl", 2, "Чек-лист закладу"],
  ["sy-f1", "system", "Скарги й звернення, розглянуті в строк", 50, "pct", [36, 60], "Журнал звернень закладу"],
  ["sy-f2", "system", "Рівень за анкетою «Процедури та інструкції»", 25, "lvl", 3, "Чек-лист закладу"],
  ["sy-f3", "system", "Рівень за анкетою «Захист заявників»", 25, "lvl", 3, "Чек-лист закладу"],
  ["ac-f1", "accountability", "Подано декларацій вчасно серед зобовʼязаних", 40, "pct", [45, 100], "Відкрита база декларацій (поки вручну)"],
  ["ac-f2", "accountability", "Потенційні конфлікти інтересів, за якими уповноважений дав висновок у строк", 40, "pct", [6, 20], "Журнал уповноваженого"],
  ["ac-f3", "accountability", "Рівень за анкетою «Звітність і оприлюднення»", 20, "lvl", 2, "Чек-лист закладу"],
].map(([id, c, t, w, kind, val, from]) => ({ id, c, t, w, kind, base: val, from }));
export const factValue = (f, val) => f.kind === "pct" ? Math.round(val[0] / val[1] * 1000) / 10 : lvl100(val);
// Один запис факту скрізь (рекомендації, звіт, асистент): частка, з чого вона, і бал рівня за порогами методики
export const factText = f => f.kind === "pct" && Array.isArray(f.val) ? `${fb(f.val[1] ? f.val[0] / f.val[1] * 100 : 0)} % (${f.val[0]} з ${f.val[1]}), бал ${fb(f.v)} з 100` : f.val != null && f.kind ? `рівень ${f.val}, бал ${fb(f.v)} з 100` : `${fb(f.v)} з 100`;

export function credit(P, F) {
  const lim = F + CAP;
  return P <= lim ? { v: P, lim: false } : { v: lim, lim: true, reason: `Самооцінка (${fb(P)}) вища за факти (${fb(F)}) більш ніж на ${CAP} пунктів, тобто факти її не підтверджують. Тому в індекс зараховано не ${fb(P)}, а факти + ${CAP}: ${fb(F)} + ${CAP} = ${fb(lim)}.` };
}
export function components(pItems, fItems) {
  return COMPS.map(c => {
    const P = wmean(pItems.filter(x => x.c === c)), F = wmean(fItems.filter(x => x.c === c));
    return { id: c, P, F, cr: credit(P, F) };
  });
}
export function trust(flags, responses) {
  if (responses < S.k) return "insufficient";
  const raised = flags.filter(f => f.raised), major = raised.filter(f => f.w === "major").length, minor = raised.length - major;
  return major >= 1 || minor >= 3 ? "C" : minor >= 1 ? "B" : "A";
}
export const TRUST = {
  A: ["A", "Висока", "Жоден прапорець не спрацював.", "p-good"],
  B: ["B", "Помірна", "Спрацювали один або два незначні прапорці.", "p-warn"],
  C: ["C", "Потрібна перевірка", "Спрацював хоча б один серйозний прапорець або три і більше незначних.", "p-bad"],
  insufficient: ["?", "Недостатньо даних", "Відповідей менше, ніж мінімальна група, тому достовірність не оцінюється.", "p-mute"],
};
export const TRUST_HINT = "Наскільки результату можна довіряти. Літера залежить від прапорців: A без прапорців, B один-два незначних, C серйозний або три і більше незначних.";
export const FLAGS = [
  { id: "tf-gap", w: "major", t: "Розбіжність самооцінки й фактів", ex: "Самооцінка значно вища за факти, тому її знижено до фактів + 25. Варто звірити з чек-листом." },
  { id: "tf-same", w: "minor", t: "Однакові відповіді в частині анкет особового складу", ex: "У частині анкет усі відповіді однакові. Це може означати, що анкету заповнювали поспіхом. Варто перевірити додатково." },
  { id: "tf-jump", w: "major", t: "Різка зміна індексу між циклами без пояснення", ex: "Індекс змінився помірно, різкого стрибка немає." },
  { id: "tf-experts", w: "minor", t: "Замало відповідей від експертів", ex: "Отримано всі очікувані експертні анкети." },
];
const ATTN_TITLE = { culture: "Більше практичних прикладів", system: "Зробити процедури помітнішими", accountability: "Підтвердити факти" };

/* ---------- Заклади ---------- */
export const ALPHA = "alpha";
const ALPHA_HISTORY = [
  { cycle: "2025-06", cr: { culture: 38, system: 30, accountability: 36 } },
  { cycle: "2025-12", cr: { culture: 44, system: 36, accountability: 43 } },
  { cycle: "2026-06", cr: { culture: 50, system: 41, accountability: 50 } },
];
const ALPHA_EVENTS = [
  { after: "2025-06", t: "Виконано захід: пам’ятка з правил доброчесності" },
  { after: "2025-12", t: "Виконано захід: канал анонімних звернень" },
  { after: "2026-06", t: "Виконано захід: навчання для кураторів груп" },
];
// Демо охоплює всі рівні зрілості й усі варіанти достовірності:
// «Гамма» 5 і A, «Сигма» 4 і B, «Альфа» 3 і C (еталон), «Бета» 2 і «Недостатньо даних», «Омега» 1 і C.
export const OTHERS = [
  { id: "beta", name: "Умовний навчальний центр «Бета»", seed: 11, perception: [32, 27, 30], facts: [27, 22, 25], flags: [], responses: 7 },
  { id: "gamma", name: "Умовна академія «Гамма»", seed: 23, perception: [96, 94, 95], facts: [94, 92, 93], flags: [], responses: 71 },
  { id: "omega", name: "Умовний університет «Омега»", seed: 37, perception: [12, 9, 11], facts: [5, 3, 4], declining: "all", flags: ["tf-jump", "tf-experts"], responses: 42 },
  { id: "sigma", name: "Умовна військова академія «Сигма»", seed: 53, perception: [80, 75, 78], facts: [74, 70, 72], flags: ["tf-same"], responses: 56 },
];
function rng(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 1831565813) >>> 0; let e = t; e = Math.imul(e ^ (e >>> 15), e | 1); e ^= e + Math.imul(e ^ (e >>> 7), e | 61); return ((e ^ (e >>> 14)) >>> 0) / 4294967296; };
}
const round5 = v => Math.round(clamp(v) / 5) * 5;

export function finish(m) {
  const cur = m.series[m.series.length - 1], prev = m.series[m.series.length - 2];
  m.index = cur.index; m.level = indexLevel(cur.index, m.components.map(c => c.cr.v)); m.prevIndex = prev.index; m.delta = cur.index == null || prev.index == null ? null : r1(cur.index - prev.index);
  m.limited = m.components.find(c => c.cr.lim);
  m.trust = trust(m.flags, m.responses);
  m.raised = m.flags.filter(f => f.raised);
  m.summary = m.limited ? `${COMP[m.limited.id].n}: самооцінку не підтверджують факти` : "Суттєвих розбіжностей між самооцінкою і фактами немає";
  m.byId = Object.fromEntries(m.components.map(c => [c.id, c]));
  return m;
}
function buildAlpha() {
  const facts = FACTS.map(f => { const st = S.facts[f.id]; const val = st ? st.val : f.base; return { ...f, val, v: factValue(f, val) }; });
  const comps = components(PERCEPTION, facts);
  const cr = Object.fromEntries(comps.map(c => [c.id, c.cr.v]));
  const series = [...ALPHA_HISTORY.map(h => ({ cycle: h.cycle, index: indexOf(h.cr), cr: h.cr })), { cycle: CYCLE, index: indexOf(cr), cr }];
  const lim = comps.find(c => c.cr.lim);
  const flags = FLAGS.map(f => ({ ...f, raised: f.id === "tf-gap" ? !!lim : f.id === "tf-same", t: f.id === "tf-gap" && lim ? `Розбіжність самооцінки й фактів у ${COMP[lim.id].loc} (${fb(lim.P)} проти ${fb(lim.F)})` : f.t }));
  const m = finish({ id: ALPHA, name: "Умовний військовий інститут «Альфа»", components: comps, pItems: PERCEPTION, fItems: facts, series, events: ALPHA_EVENTS, flags, responses: UNIT_RESP[ALPHA] });
  const byId = m.byId;
  m.attention = [
    { t: "Підтвердити факти", c: "accountability", v: byId.accountability.F, hint: "Факти за компонентом Підзвітність, 0-100." },
    { t: "Зробити процедури помітнішими", c: "system", v: byId.system.cr.v, hint: "Зараховане значення компонента Система, 0-100." },
    { t: "Більше практичних прикладів", c: "culture", v: byId.culture.F, hint: "Факти за компонентом Культура, 0-100." },
  ];
  m.strengths = [
    { t: "Відкритість до етичних питань", c: "culture", v: byId.culture.cr.v, hint: "Зараховане значення компонента Культура, 0-100." },
    { t: "Зростання індексу два цикли поспіль", v: r1(m.index - series[1].index), hint: "Сумарне зростання індексу з циклу 2025-12, у пунктах.", unit: "пт" },
  ];
  return m;
}
function buildOther(o) {
  const t = rng(o.seed), n = a => (t() * 2 - 1) * a, ci = c => COMPS.indexOf(c);
  const pItems = PERCEPTION.map(x => ({ ...x, v: round5(o.perception[ci(x.c)] + n(8)) }));
  const lv = new Map();
  const fItems = FACTS.map(f => {
    const base = o.facts[ci(f.c)];
    if (f.kind === "pct") { const den = f.base[1], num = Math.round(round5(base + n(10)) / 100 * den); return { ...f, val: [num, den], v: r1(num / den * 100) }; }
    if (!lv.has(f.c)) lv.set(f.c, Math.min(5, Math.max(1, Math.round(clamp(base + n(10)) / 25) + 1)));
    return { ...f, val: lv.get(f.c), v: lvl100(lv.get(f.c)) };
  });
  const comps = components(pItems, fItems);
  const cr = Object.fromEntries(comps.map(c => [c.id, c.cr.v]));
  const series = [{ cycle: CYCLE, index: indexOf(cr), cr }];
  let u = cr;
  for (const cy of ["2026-06", "2025-12", "2025-06"]) {
    const prev = Object.fromEntries(COMPS.map(c => { const d = 2 + t() * 5, a = (o.declining === c || o.declining === "all") && cy === "2026-06" ? (o.declining === "all" ? -(6 + t() * 4) : -3) : d; return [c, r1(clamp(u[c] - a))]; }));
    series.unshift({ cycle: cy, index: indexOf(prev), cr: prev }); u = prev;
  }
  const lim = comps.find(c => c.cr.lim);
  const flags = FLAGS.map(f => ({ ...f, t: f.id === "tf-gap" && lim ? `Розбіжність самооцінки й фактів у ${COMP[lim.id].loc} (${fb(lim.P)} проти ${fb(lim.F)})` : f.t, raised: f.id === "tf-gap" ? !!lim : o.flags ? o.flags.includes(f.id) : f.id !== "tf-jump" && t() < 0.35 }));
  const responses = o.responses ?? 40 + Math.floor(t() * 30);
  const m = finish({ id: o.id, name: o.name, components: comps, pItems, fItems, series, flags, responses,
    events: [{ after: "2025-12", t: "Виконано захід: оновлено процедури" }, { after: "2026-06", t: "Виконано захід: проведено навчання" }] });
  const sorted = [...comps].sort((a, b) => a.cr.v - b.cr.v), top = sorted[sorted.length - 1];
  m.attention = sorted.map(c => ({ t: ATTN_TITLE[c.id], c: c.id, v: c.cr.v, hint: `Зараховане значення компонента ${COMP[c.id].n}, 0-100.` }));
  m.strengths = [
    { t: `Найвищий результат у компоненті ${COMP[top.id].n}`, c: top.id, v: top.cr.v, hint: `Зараховане значення компонента ${COMP[top.id].n}, 0-100.` },
  ];
  // «Зростання поспіль» лише якщо індекс справді зростав останні цикли
  let k = series.length - 1; while (k > 0 && series[k].index > series[k - 1].index) k--;
  const streak = series.length - 1 - k;
  if (streak >= 2) m.strengths.push({ t: `Зростання індексу ${streak === 2 ? "два" : streak === 3 ? "три" : streak} цикли поспіль`, v: r1(m.index - series[k].index), hint: `Сумарне зростання індексу з циклу ${series[k].cycle}, у пунктах.`, unit: "пт" });
  else if (m.delta > 0) m.strengths.push({ t: "Індекс зріс за останній цикл", v: m.delta, hint: "Зміна індексу порівняно з попереднім циклом, у пунктах.", unit: "пт" });
  return m;
}
const OTHER_MODELS = {};
export function inst(id) {
  if (API.on) return API.model;
  const o = OTHERS.find(x => x.id === id);
  const m = !o ? buildAlpha() : OTHER_MODELS[id] || (OTHER_MODELS[id] = buildOther(o));
  const ren = S.insts && S.insts.renamed[m.id]; if (ren) m.name = ren; else if (o) m.name = o.name;
  m.edrpou = EDRPOU[m.id]; return m;
}
// Синтетичні коди ЄДРПОУ (не справжні) і синтетичний «реєстр» для демо пошуку
const EDRPOU = { alpha: "99000101", beta: "99000102", gamma: "99000103", omega: "99000104", sigma: "99000106" };
export const REGISTRY = [
  ["99000101", "Умовний військовий інститут «Альфа»"], ["99000102", "Умовний навчальний центр «Бета»"], ["99000103", "Умовна академія «Гамма»"], ["99000104", "Умовний університет «Омега»"],
  ["99000105", "Умовний військовий ліцей «Дельта»"], ["99000106", "Умовна військова академія «Сигма»"], ["99000107", "Умовний навчальний центр «Каппа»"], ["99000108", "Умовний інститут «Лямбда»"],
  ["99000109", "Умовний коледж сержантського складу «Тета»"], ["99000110", "Умовна кафедра військової підготовки «Йота»"],
];
export const INSTITUTIONS = () => [inst(ALPHA), ...OTHERS.map(o => inst(o.id)), ...(S.insts ? S.insts.extra.map(x => ({ ...x, name: S.insts.renamed[x.id] || x.name, empty: true })) : [])].sort((a, b) => a.name.localeCompare(b.name, "uk"));

/* ---------- Підрозділи й поріг k ---------- */
export const UNITS = [
  { id: ALPHA, n: "Умовний військовий інститут «Альфа»", parent: null },
  { id: "unit-a", n: "Підрозділ А", parent: ALPHA },
  { id: "unit-b", n: "Підрозділ Б", parent: ALPHA },
  { id: "unit-v", n: "Підрозділ В", parent: ALPHA },
];
export const UNIT_RESP = { [ALPHA]: 48, "unit-a": 12, "unit-b": 3, "unit-v": 33 };
export const UNIT_CR = { "unit-a": { culture: 58, system: 47, accountability: 52 } };
export function resolveUnit(id) {
  const req = UNITS.find(u => u.id === id) || UNITS[0]; let u = req;
  while ((UNIT_RESP[u.id] || 0) < S.k && u.parent) u = UNITS.find(x => x.id === u.parent);
  return { unit: u, req, hidden: u.id !== req.id, resp: UNIT_RESP[u.id] || 0 };
}
export const GROUPS = [
  { n: "Робоча група", inv: 15, resp: 14 },
  { n: "Підрозділ А", inv: 15, resp: 12, unit: "unit-a" },
  { n: "Підрозділ Б", inv: 9, resp: 3, unit: "unit-b" },
  { n: "Підрозділ В", inv: 40, resp: 33, unit: "unit-v" },
  { n: "Експерти", inv: 5, resp: 5 },
];

/* ---------- Рекомендації: явні правила ---------- */
const REC_RULES = [
  { id: "rec-procurement", t: "Розібрати закупівлі, що потребують додаткової перевірки", c: "accountability", items: ["ac-p1", "ac-f1"], flags: ["tf-gap"],
    why: "Працівники оцінюють прозорість рішень високо, а факти це не підтверджують. Розбір закупівель допоможе звірити самооцінку з документами.",
    acts: ["Скласти перелік закупівель за останній цикл, що потребують перевірки", "Звірити умови закупівель із чек-листом", "Оприлюднити короткий підсумок розбору"] },
  { id: "rec-conflicts", t: "Скоротити строки перевірки конфліктів інтересів", c: "accountability", items: ["ac-f2"], flags: [],
    why: "Лише частина випадків потенційних конфліктів інтересів розглянута в строк. Чіткі строки допоможуть закрити цю прогалину.",
    acts: ["Затвердити граничний строк розгляду повідомлення", "Призначити відповідальну особу за облік строків", "Щомісяця переглядати перелік нерозглянутих випадків"] },
  { id: "rec-complaints", t: "Дотримуватися строків розгляду скарг і звернень", c: "accountability", items: ["sy-f1", "ac-p3"], flags: [],
    why: "Частина скарг і звернень розглянута з порушенням строків. Прозорий облік строків підвищує довіру до каналів звернень.",
    acts: ["Запровадити облік строків розгляду в єдиному журналі", "Нагадувати виконавцям за три дні до граничного строку", "Повідомляти заявникам про результат розгляду"] },
  { id: "rec-procedures", t: "Зробити внутрішні процедури зрозумілішими", c: "system", items: ["sy-p1", "sy-p3"], flags: [],
    why: "Працівники вважають процедури недостатньо зрозумілими. Коротка пам’ятка зі схемою дій зменшує кількість помилок.",
    acts: ["Підготувати пам’ятку зі схемою дій для типових ситуацій", "Провести короткі роз’яснення в підрозділах", "Зібрати питання працівників і оновити пам’ятку"] },
  { id: "rec-culture", t: "Додати практичні приклади до навчання з доброчесності", c: "culture", items: ["cu-p3", "cu-f1"], flags: [],
    why: "Навчання проводять за планом, але працівники рідко бачать практичні приклади. Приклади допомагають вчасно повідомляти про проблеми.",
    acts: ["Підібрати три-чотири типові ситуації для обговорення", "Додати розбір ситуацій у плани занять", "Зібрати відгуки учасників після занять"] },
];
export const PRI = { high: ["Високий", "var(--red-soft)", "var(--red)", "!"], medium: ["Середній", "var(--amber-soft)", "var(--amber)", "2"], low: ["Низький", "var(--blue-soft)", "var(--blue)", "3"] };
export const REC_ST = { proposed: ["Запропоновано", "p-info"], accepted: ["Прийнято", "p-good"], clarified: ["Уточнено", "p-warn"], rejected: ["Відхилено", "p-mute"] };
export const REC_NEXT = { proposed: ["accepted", "clarified", "rejected"], clarified: ["accepted", "rejected"], accepted: [], rejected: [] };
const priority = (vals, flag) => { const mn = vals.length ? Math.min(...vals) : 100; return mn < 40 || (flag && mn < 65) ? "high" : mn < 65 || flag ? "medium" : "low"; };
export function buildRecs(m = inst(ALPHA)) {
  if (API.on) return API.recs;
  const all = [...m.pItems, ...m.fItems], out = [];
  for (const r of REC_RULES) {
    const items = all.filter(x => r.items.includes(x.id)), flags = m.flags.filter(f => r.flags.includes(f.id) && f.raised);
    if (!items.some(x => x.v < 65) && !flags.length) continue;
    out.push({ ...r, pri: priority(items.map(x => x.v), flags.length > 0), evidence: [...items.map(x => ({ id: x.id, t: x.t, v: `${fb(x.v)} зі 100`, item: true })), ...flags.map(f => ({ id: f.id, t: f.t, v: "Прапорець спрацював" }))],
      st: (S.dec.rec[r.id] || {}).status || "proposed", note: S.dec.rec[r.id] || {} });
  }
  const o = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => o[a.pri] - o[b.pri]);
}
export const pendingRecs = () => buildRecs().filter(r => r.st === "proposed" || r.st === "clarified").length;

/* ---------- Трекер заходів ---------- */
export const POSITIONS = ["Заступник начальника з виховної роботи", "Начальник навчального відділу", "Начальник юридичного відділу", "Уповноважений з доброчесності", "Начальник штабу"];
export const BASE_MEASURES = [
  { id: "m-1", rec: "Запровадити канал анонімних звернень", t: "Запровадити канал анонімних звернень", who: "Заступник начальника з виховної роботи", due: "2026-03-31", st: "confirmed", ind: "sy-p2" },
  { id: "m-2", rec: "Провести навчання для кураторів груп", t: "Провести навчання для кураторів груп", who: "Начальник навчального відділу", due: "2026-10-15", st: "done", ind: "cu-p3" },
  { id: "m-3", rec: "Оновити порядок розгляду скарг", t: "Оновити порядок розгляду скарг і звернень", who: "Начальник юридичного відділу", due: "2026-11-05", st: "inprogress", ind: "sy-f1" },
  { id: "m-4", rec: "Скласти календар обов’язкових декларацій", t: "Скласти календар подання декларацій", who: "Уповноважений з доброчесності", due: "2026-12-15", st: "inprogress", ind: "ac-f1" },
  { id: "m-5", rec: "Підготувати пам’ятку з правил доброчесності", t: "Підготувати пам’ятку з правил доброчесності", who: "Заступник начальника з виховної роботи", due: "2026-12-20", st: "inprogress", ind: "cu-p4" },
  { id: "m-6", rec: "Оновити порядок розгляду скарг", t: "Призначити відповідальну особу за облік звернень", who: "Начальник штабу", due: "2027-01-31", st: "accepted", ind: "sy-f1" },
];
export const M_ST = {
  accepted: ["Прийнято", "p-info"], inprogress: ["В роботі", "p-warn"], done: ["Виконано", "p-done"],
  confirmed: ["Підтверджено", "p-good"], notconfirmed: ["Не підтверджено", "p-bad"], overdue: ["Прострочено", "p-bad"], cancelled: ["Скасовано", "p-mute"],
};
export const M_NEXT = { accepted: ["inprogress"], inprogress: ["done", "accepted"], done: ["inprogress"], confirmed: [], notconfirmed: ["inprogress"], cancelled: [] };
const dayMs = 864e5, utc = d => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
export const overdueDays = m => ["done", "confirmed", "notconfirmed", "cancelled"].includes(m.st) ? 0 : Math.max(0, Math.floor((utc(TODAY) - utc(m.due)) / dayMs));
export const dispSt = m => overdueDays(m) > 0 ? "overdue" : m.st;
export const daysWord = n => { const t = n % 100, u = n % 10; return t >= 11 && t <= 14 ? "днів" : u === 1 ? "день" : u >= 2 && u <= 4 ? "дні" : "днів"; };
export const measures = () => API.on ? API.ms : [...BASE_MEASURES, ...S.dec.added].map(m => S.dec.mst[m.id] ? { ...m, st: S.dec.mst[m.id] } : m);
export const verif = m => m.vf ? m.vf : m.st === "cancelled" ? ["Захід скасовано", "p-mute"] : m.st === "confirmed" ? ["Підтверджено наступним оцінюванням", "p-good"] : m.st === "notconfirmed" ? ["Не підтверджено, потрібен перегляд", "p-bad"] : m.st === "done" ? ["Очікує наступного оцінювання", "p-info"] : ["Ще не настав час", "p-mute"];
export const allItems = m => [...m.pItems, ...m.fItems];
