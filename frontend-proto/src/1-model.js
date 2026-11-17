/* ---------- Icons ---------- */
const I = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  grid: I('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  gauge: I('<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/><circle cx="12" cy="14" r="1.5"/>'),
  tree: I('<path d="M4 5h6M4 12h6M4 19h6M14 5h6M14 12h6M14 19h6"/><path d="M7 5v14"/>'),
  trend: I('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  plug: I('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  building: I('<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01"/>'),
  survey: I('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  check: I('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>'),
  bulb: I('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  target: I('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  file: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  history: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  sliders: I('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  up: I('<path d="M7 17L17 7M9 7h8v8"/>', 2.4),
  down: I('<path d="M7 7l10 10M17 9v8H9"/>', 2.4),
  flat: I('<path d="M5 12h14"/>', 2.4),
  search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  shield: I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c2.4.6 4 2.4 4 5.4"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  scale: I('<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>'),
  copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  chev: I('<path d="M6 9l6 6 6-6"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  dots: I('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', 2.4),
  a11y: I('<circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5l7 1.5 7-1.5M12 10v5M12 15l-3.5 6M12 15l3.5 6"/>'),
  download: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  ok: I('<path d="M5 12l5 5 9-10"/>', 2.6),
  arrowR: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowL: I('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  send: I('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2),
  pulse: I('<path d="M3 12h4l3-8 4 16 3-8h4"/>', 2.2),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  help: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>'),
  alert: I('<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4M12 17h.01"/>'),
  flag: I('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  table: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>'),
  board: I('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'),
  reset: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  print: I('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  compare: I('<path d="M8 3v18M16 3v18"/><path d="M3 8h5M16 16h5M3 16h5M16 8h5"/>'),
  diamond: I('<path d="M12 3l9 9-9 9-9-9z"/>'),
};

/* ---------- Методика (як у робочій версії команди) ---------- */
const COMPS = ["culture", "system", "accountability"];
const COMP = {
  culture: { n: "Культура", loc: "Культурі", ic: "users", c: "var(--teal)", s: "var(--teal-soft)" },
  system: { n: "Система", loc: "Системі", ic: "layers", c: "var(--blue)", s: "var(--blue-soft)" },
  accountability: { n: "Підзвітність", loc: "Підзвітності", ic: "scale", c: "var(--amber)", s: "var(--amber-soft)" },
};
const LEVELS = ["Початковий (хаотичний)", "Керований", "Визначений", "Вимірюваний", "Оптимізуючий"];
const LSHORT = ["Початковий", "Керований", "Визначений", "Вимірюваний", "Оптимізуючий"];
const BOUNDS = [12.5, 37.5, 62.5, 87.5];
// Коротко за Моделлю зрілості НАЗК (Рекомендації НУОУ, розділ про рівні зрілості)
const LDESC = [
  "Системи доброчесності немає: норми виконуються вибірково, до питання повертаються лише після порушень.",
  "Є базові правила й контроль: цінності названі, призначено уповноваженого, ухвалено програму доброчесності.",
  "Система описана й працює: процедури чіткі, відомі всім і виконуються, канали повідомлень налагоджені.",
  "Цілі вимірюються: заклад стежить за показниками, оцінює кожен захід і проводить аудит системи.",
  "Система постійно вдосконалюється на основі даних, доброчесність стала частиною культури, є зовнішній аудит.",
];
const CAP = 25;
// let: з бекендом дата й цикл беруться з останньої закритої хвилі (0-api.js).
let TODAY = "2026-11-16", TODAY_UA = "16.11.2026", CYCLE = "2026-11";
const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const level = v => { const i = BOUNDS.findIndex(b => v <= b); return i === -1 ? 5 : i + 1; };
const lvl100 = l => (l - 1) * 25;
const status = v => v >= 65 ? "good" : v >= 40 ? "warn" : "bad";
const ST = { good: ["Сильна сторона", "p-good"], warn: ["Потребує уваги", "p-warn"], bad: ["Критична зона", "p-bad"] };
const SCOL = { good: "var(--teal)", warn: "var(--amber)", bad: "var(--red)" };
const SRC = { wg: ["Сприйняття РГ", "var(--blue)", "circle"], os: ["Сприйняття ОС", "var(--teal)", "square"], experts: ["Експерти", "#8b6fd6", "diamond"], facts: ["Факти", "var(--amber)", "triangle"] };
const SRC_HINT = { wg: "Середня оцінка відповідей робочої групи, 0-100.", os: "Середня оцінка відповідей особового складу, 0-100.", experts: "Середня оцінка експертів, 0-100." };
const wmean = arr => { const w = arr.reduce((a, x) => a + x.w, 0); return r1(arr.reduce((a, x) => a + x.w * x.v, 0) / w); };
const indexOf = cr => r1(COMPS.reduce((a, c) => a + cr[c] / 3, 0));

const PERCEPTION = [
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
const FACTS = [
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
const factValue = (f, val) => f.kind === "pct" ? Math.round(val[0] / val[1] * 1000) / 10 : lvl100(val);

function credit(P, F) {
  const lim = F + CAP;
  return P <= lim ? { v: P, lim: false } : { v: lim, lim: true, reason: `Сприйняття (${fb(P)}) вище за факти (${fb(F)}) більш ніж на ${CAP} пунктів. Тому зараховано не ${fb(P)}, а факти + ${CAP}: ${fb(F)} + ${CAP} = ${fb(lim)}.` };
}
function components(pItems, fItems) {
  return COMPS.map(c => {
    const P = wmean(pItems.filter(x => x.c === c)), F = wmean(fItems.filter(x => x.c === c));
    return { id: c, P, F, cr: credit(P, F) };
  });
}
function trust(flags, responses) {
  if (responses < S.k) return "insufficient";
  const raised = flags.filter(f => f.raised), major = raised.filter(f => f.w === "major").length, minor = raised.length - major;
  return major >= 1 || minor >= 3 ? "C" : minor >= 1 ? "B" : "A";
}
const TRUST = {
  A: ["A", "Підтверджується", "Жоден прапорець не спрацював.", "p-good"],
  B: ["B", "Є зауваження", "Спрацювали один або два незначні прапорці.", "p-warn"],
  C: ["C", "Потрібна перевірка", "Спрацював хоча б один серйозний прапорець або три і більше незначних.", "p-bad"],
  insufficient: ["?", "Недостатньо даних", "У групі менше k відповідей, тому достовірність не оцінюється.", "p-mute"],
};
const TRUST_HINT = "Наскільки результату можна довіряти. Літера залежить від прапорців: A без прапорців, B один-два незначних, C серйозний або три і більше незначних.";
const FLAGS = [
  { id: "tf-gap", w: "major", t: "Розбіжність сприйняття й фактів", ex: "Сприйняття значно вище за факти, тому зараховано з обмеженням. Варто звірити з чек-листом." },
  { id: "tf-same", w: "minor", t: "Однакові відповіді в частині анкет особового складу", ex: "У частині анкет усі відповіді однакові. Це може означати, що анкету заповнювали поспіхом. Варто перевірити додатково." },
  { id: "tf-jump", w: "major", t: "Різка зміна індексу між циклами без пояснення", ex: "Індекс змінився помірно, різкого стрибка немає." },
  { id: "tf-experts", w: "minor", t: "Замало відповідей від експертів", ex: "Отримано всі очікувані експертні анкети." },
];
const ATTN_TITLE = { culture: "Більше практичних прикладів", system: "Зробити процедури помітнішими", accountability: "Підтвердити факти" };

/* ---------- Заклади ---------- */
const ALPHA = "alpha";
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
const OTHERS = [
  { id: "beta", name: "Умовний навчальний центр «Бета»", seed: 11, perception: [62, 58, 66], facts: [55, 50, 52] },
  { id: "gamma", name: "Умовна академія «Гамма»", seed: 23, perception: [72, 68, 70], facts: [70, 64, 66] },
  { id: "omega", name: "Умовний університет «Омега»", seed: 37, perception: [44, 40, 48], facts: [40, 36, 38], declining: "system" },
];
function rng(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 1831565813) >>> 0; let e = t; e = Math.imul(e ^ (e >>> 15), e | 1); e ^= e + Math.imul(e ^ (e >>> 7), e | 61); return ((e ^ (e >>> 14)) >>> 0) / 4294967296; };
}
const round5 = v => Math.round(clamp(v) / 5) * 5;

function finish(m) {
  const cur = m.series[m.series.length - 1], prev = m.series[m.series.length - 2];
  m.index = cur.index; m.level = level(cur.index); m.prevIndex = prev.index; m.delta = r1(cur.index - prev.index);
  m.limited = m.components.find(c => c.cr.lim);
  m.trust = trust(m.flags, m.responses);
  m.raised = m.flags.filter(f => f.raised);
  m.summary = m.limited ? `${COMP[m.limited.id].n}: самооцінку не підтверджують факти` : "Суттєвих розбіжностей між сприйняттям і фактами немає";
  m.byId = Object.fromEntries(m.components.map(c => [c.id, c]));
  return m;
}
function buildAlpha() {
  const facts = FACTS.map(f => { const st = S.facts[f.id]; const val = st ? st.val : f.base; return { ...f, val, v: factValue(f, val) }; });
  const comps = components(PERCEPTION, facts);
  const cr = Object.fromEntries(comps.map(c => [c.id, c.cr.v]));
  const series = [...ALPHA_HISTORY.map(h => ({ cycle: h.cycle, index: indexOf(h.cr), cr: h.cr })), { cycle: CYCLE, index: indexOf(cr), cr }];
  const lim = comps.find(c => c.cr.lim);
  const flags = FLAGS.map(f => ({ ...f, raised: f.id === "tf-gap" ? !!lim : f.id === "tf-same", t: f.id === "tf-gap" && lim ? `Розбіжність сприйняття й фактів у ${COMP[lim.id].loc} (${fb(lim.P)} проти ${fb(lim.F)})` : f.t }));
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
    const prev = Object.fromEntries(COMPS.map(c => { const d = 2 + t() * 5, a = o.declining === c && cy === "2026-06" ? -3 : d; return [c, r1(clamp(u[c] - a))]; }));
    series.unshift({ cycle: cy, index: indexOf(prev), cr: prev }); u = prev;
  }
  const lim = comps.find(c => c.cr.lim);
  const flags = FLAGS.map(f => ({ ...f, t: f.id === "tf-gap" && lim ? `Розбіжність сприйняття й фактів у ${COMP[lim.id].loc} (${fb(lim.P)} проти ${fb(lim.F)})` : f.t, raised: f.id === "tf-gap" ? !!lim : f.id !== "tf-jump" && t() < 0.35 }));
  const responses = 40 + Math.floor(t() * 30);
  const m = finish({ id: o.id, name: o.name, components: comps, pItems, fItems, series, flags, responses,
    events: [{ after: "2025-12", t: "Виконано захід: оновлено процедури" }, { after: "2026-06", t: "Виконано захід: проведено навчання" }] });
  const sorted = [...comps].sort((a, b) => a.cr.v - b.cr.v), top = sorted[sorted.length - 1];
  m.attention = sorted.map(c => ({ t: ATTN_TITLE[c.id], c: c.id, v: c.cr.v, hint: `Зараховане значення компонента ${COMP[c.id].n}, 0-100.` }));
  m.strengths = [
    { t: `Найвищий результат у компоненті ${COMP[top.id].n}`, c: top.id, v: top.cr.v, hint: `Зараховане значення компонента ${COMP[top.id].n}, 0-100.` },
    { t: "Зростання індексу кілька циклів поспіль", v: r1(m.index - series[0].index), hint: "Сумарне зростання індексу з першого циклу, у пунктах.", unit: "пт" },
  ];
  return m;
}
const OTHER_MODELS = {};
function inst(id) {
  if (API.on) return API.model;
  const o = OTHERS.find(x => x.id === id);
  const m = !o ? buildAlpha() : OTHER_MODELS[id] || (OTHER_MODELS[id] = buildOther(o));
  const ren = S.insts && S.insts.renamed[m.id]; if (ren) m.name = ren; else if (o) m.name = o.name;
  m.edrpou = EDRPOU[m.id]; return m;
}
// Синтетичні коди ЄДРПОУ (не справжні) і синтетичний «реєстр» для демо пошуку
const EDRPOU = { alpha: "99000101", beta: "99000102", gamma: "99000103", omega: "99000104" };
const REGISTRY = [
  ["99000101", "Умовний військовий інститут «Альфа»"], ["99000102", "Умовний навчальний центр «Бета»"], ["99000103", "Умовна академія «Гамма»"], ["99000104", "Умовний університет «Омега»"],
  ["99000105", "Умовний військовий ліцей «Дельта»"], ["99000106", "Умовна військова академія «Сигма»"], ["99000107", "Умовний навчальний центр «Каппа»"], ["99000108", "Умовний інститут «Лямбда»"],
  ["99000109", "Умовний коледж сержантського складу «Тета»"], ["99000110", "Умовна кафедра військової підготовки «Йота»"],
];
const INSTITUTIONS = () => [inst(ALPHA), ...OTHERS.map(o => inst(o.id)), ...(S.insts ? S.insts.extra.map(x => ({ ...x, name: S.insts.renamed[x.id] || x.name, empty: true })) : [])].sort((a, b) => a.name.localeCompare(b.name, "uk"));

/* ---------- Підрозділи й поріг k ---------- */
const UNITS = [
  { id: ALPHA, n: "Умовний військовий інститут «Альфа»", parent: null },
  { id: "unit-a", n: "Підрозділ А", parent: ALPHA },
  { id: "unit-b", n: "Підрозділ Б", parent: ALPHA },
  { id: "unit-v", n: "Підрозділ В", parent: ALPHA },
];
const UNIT_RESP = { [ALPHA]: 48, "unit-a": 12, "unit-b": 3, "unit-v": 33 };
const UNIT_CR = { "unit-a": { culture: 58, system: 47, accountability: 52 } };
function resolveUnit(id) {
  const req = UNITS.find(u => u.id === id) || UNITS[0]; let u = req;
  while ((UNIT_RESP[u.id] || 0) < S.k && u.parent) u = UNITS.find(x => x.id === u.parent);
  return { unit: u, req, hidden: u.id !== req.id, resp: UNIT_RESP[u.id] || 0 };
}
const GROUPS = [
  { n: "Робоча група", inv: 15, resp: 14 },
  { n: "Підрозділ А", inv: 15, resp: 12, unit: "unit-a" },
  { n: "Підрозділ Б", inv: 9, resp: 3, unit: "unit-b" },
  { n: "Підрозділ В", inv: 40, resp: 33, unit: "unit-v" },
  { n: "Експерти", inv: 5, resp: 5 },
];

/* ---------- Рекомендації: явні правила ---------- */
const REC_RULES = [
  { id: "rec-procurement", t: "Розібрати закупівлі, що потребують додаткової перевірки", c: "accountability", items: ["ac-p1", "ac-f1"], flags: ["tf-gap"],
    why: "Працівники оцінюють прозорість рішень високо, а факти це не підтверджують. Розбір закупівель допоможе звірити сприйняття з документами.",
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
const PRI = { high: ["Високий", "var(--red-soft)", "var(--red)", "!"], medium: ["Середній", "var(--amber-soft)", "var(--amber)", "2"], low: ["Низький", "var(--blue-soft)", "var(--blue)", "3"] };
const REC_ST = { proposed: ["Запропоновано", "p-info"], accepted: ["Прийнято", "p-good"], clarified: ["Уточнено", "p-warn"], rejected: ["Відхилено", "p-mute"] };
const REC_NEXT = { proposed: ["accepted", "clarified", "rejected"], clarified: ["accepted", "rejected"], accepted: [], rejected: [] };
const priority = (vals, flag) => { const mn = vals.length ? Math.min(...vals) : 100; return mn < 40 || (flag && mn < 65) ? "high" : mn < 65 || flag ? "medium" : "low"; };
function buildRecs(m = inst(ALPHA)) {
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
const pendingRecs = () => buildRecs().filter(r => r.st === "proposed" || r.st === "clarified").length;

/* ---------- Трекер заходів ---------- */
const POSITIONS = ["Заступник начальника з виховної роботи", "Начальник навчального відділу", "Начальник юридичного відділу", "Уповноважений з доброчесності", "Начальник штабу"];
const BASE_MEASURES = [
  { id: "m-1", rec: "Запровадити канал анонімних звернень", t: "Запровадити канал анонімних звернень", who: "Заступник начальника з виховної роботи", due: "2026-03-31", st: "confirmed", ind: "sy-p2" },
  { id: "m-2", rec: "Провести навчання для кураторів груп", t: "Провести навчання для кураторів груп", who: "Начальник навчального відділу", due: "2026-10-15", st: "done", ind: "cu-p3" },
  { id: "m-3", rec: "Оновити порядок розгляду скарг", t: "Оновити порядок розгляду скарг і звернень", who: "Начальник юридичного відділу", due: "2026-11-05", st: "inprogress", ind: "sy-f1" },
  { id: "m-4", rec: "Скласти календар обов’язкових декларацій", t: "Скласти календар подання декларацій", who: "Уповноважений з доброчесності", due: "2026-12-15", st: "inprogress", ind: "ac-f1" },
  { id: "m-5", rec: "Підготувати пам’ятку з правил доброчесності", t: "Підготувати пам’ятку з правил доброчесності", who: "Заступник начальника з виховної роботи", due: "2026-12-20", st: "inprogress", ind: "cu-p4" },
  { id: "m-6", rec: "Оновити порядок розгляду скарг", t: "Призначити відповідальну особу за облік звернень", who: "Начальник штабу", due: "2027-01-31", st: "accepted", ind: "sy-f1" },
];
const M_ST = {
  accepted: ["Прийнято", "p-info"], inprogress: ["В роботі", "p-warn"], done: ["Виконано", "p-good"],
  confirmed: ["Підтверджено", "p-good"], notconfirmed: ["Не підтверджено", "p-bad"], overdue: ["Прострочено", "p-bad"],
};
const M_NEXT = { accepted: ["inprogress"], inprogress: ["done", "accepted"], done: ["inprogress"], confirmed: [], notconfirmed: ["inprogress"] };
const dayMs = 864e5, utc = d => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
const overdueDays = m => ["done", "confirmed", "notconfirmed"].includes(m.st) ? 0 : Math.max(0, Math.floor((utc(TODAY) - utc(m.due)) / dayMs));
const dispSt = m => overdueDays(m) > 0 ? "overdue" : m.st;
const daysWord = n => { const t = n % 100, u = n % 10; return t >= 11 && t <= 14 ? "днів" : u === 1 ? "день" : u >= 2 && u <= 4 ? "дні" : "днів"; };
const measures = () => API.on ? API.ms : [...BASE_MEASURES, ...S.dec.added].map(m => S.dec.mst[m.id] ? { ...m, st: S.dec.mst[m.id] } : m);
const verif = m => m.st === "confirmed" ? ["Підтверджено наступним оцінюванням", "p-good"] : m.st === "notconfirmed" ? ["Не підтверджено, потрібен перегляд", "p-bad"] : m.st === "done" ? ["Очікує наступного оцінювання", "p-info"] : ["Ще не настав час", "p-mute"];
