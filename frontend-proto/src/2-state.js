/* ---------- Анкета особового складу (токен demo) ---------- */
const SURVEY = {
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
const SURVEY_Q = SURVEY.sections.flatMap((s, si) => s.q.map(([id, t, o], qi) => ({ id, t, o, si, qi })));

/* ---------- Ролі ---------- */
const ROLE = {
  admin: ["Уповноважений (адміністратор)", "УП"],
  commissioner: ["Укладач анкет", "УА"],
  respondent: ["Респондент", "Р"],
  leader: ["Керівник закладу", "КЗ"],
  observer: ["Спостерігач Департаменту", "СД"],
  checklist_editor: ["Вносить дані чек-листа", "ВД"],
  checklist_approver: ["Підтверджує дані чек-листа", "ПД"],
  auditor: ["Внутрішній аудит", "ВА"],
};
const NAV = [
  ["institutions", "Заклади", "building", ["observer"]],
  ["overview", "Огляд", "gauge", ["leader", "observer", "auditor"]],
  ["explain", "Розклад індексу", "tree", ["leader", "observer", "auditor"]],
  ["trends", "Динаміка", "trend", ["leader", "observer", "auditor"]],
  ["compare", "Порівняння", "compare", ["leader", "observer", "auditor"]],
  ["recs", "Рекомендації", "bulb", ["leader"]],
  ["tracker", "Трекер", "target", ["leader", "auditor"]],
  ["sources", "Джерела", "plug", ["leader", "observer", "auditor"]],
  ["report", "Звіт", "file", ["leader", "observer"]],
  ["manage", "Керування циклом", "sliders", ["admin"]],
  ["surveys", "Анкети", "survey", ["commissioner"]],
  ["checklist", "Чек-лист", "check", ["checklist_editor", "checklist_approver"]],
  ["audit", "Журнал", "history", ["admin", "auditor"]],
  ["survey", "Пройти опитування", "survey", ["respondent"]],
  ["me", "Мої результати", "user", ["respondent"]],
];
const HOME = { admin: "manage", commissioner: "surveys", respondent: "me", leader: "overview", observer: "institutions", checklist_editor: "checklist", checklist_approver: "checklist", auditor: "overview" };
const AI_ROLES = ["leader", "observer", "auditor"];

/* ---------- Стан ---------- */
const FACT_META = { "sy-f1": ["12.11.2026", "Уповноважений"] };
const QUESTIONNAIRES = [
  { id: "q-os", t: "Анонімне опитування особового складу", grp: "Особовий склад", ver: 3, st: "published", n: 9, upd: "02.11.2026" },
  { id: "q-wg", t: "Анкета робочої групи", grp: "Робоча група", ver: 2, st: "published", n: 11, upd: "28.10.2026" },
  { id: "q-ex", t: "Експертне оцінювання", grp: "Експерти", ver: 1, st: "published", n: 8, upd: "28.10.2026" },
  { id: "q-ck", t: "Чек-лист: анкети фактів", grp: "Відповідальні за чек-лист", ver: 1, st: "draft", n: 4, upd: "14.11.2026" },
];
const DEFAULTS = () => ({
  role: "leader", k: 10, inst: ALPHA, unit: "unit-a", cycleOpen: true,
  facts: {}, fpend: {}, dec: { rec: {}, mst: {}, added: [] }, qs: QUESTIONNAIRES.map(q => ({ ...q })),
  log: [], notes: [], aiOn: true, tokenUsed: false,
  mode: "credited", trackView: "table", recF: { st: "all", c: "all" }, trF: { st: "all", who: "all" },
  trend: { from: 0, to: 3, lines: [] }, cmp: { a: 0, b: 3 }, cmpCycle: -1, a11y: { z: 1, hc: false }, insts: { extra: [], renamed: {}, archived: [] }, instQ: "", instArch: false,
});
const S = Object.assign(DEFAULTS(), { chat: [], survey: { phase: "intro", sec: 0, a: {}, miss: false }, open: {} });
const KEY = "ii-proto-v2";
const SAVE = ["role", "k", "inst", "unit", "cycleOpen", "facts", "fpend", "dec", "qs", "log", "notes", "aiOn", "tokenUsed", "mode", "trackView", "recF", "trF", "trend", "cmp", "cmpCycle", "a11y", "insts", "instArch"];
try { const saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved) SAVE.forEach(k => { if (saved[k] !== undefined) S[k] = saved[k]; }); } catch (e) {}
try { const d = JSON.parse(localStorage.getItem("ii-survey-draft") || "null"); if (d) S.survey.a = d; } catch (e) {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(SAVE.map(k => [k, S[k]])))); } catch (e) {} };
function resetDemo() { const role = S.role, a11y = S.a11y; Object.assign(S, DEFAULTS(), { role, a11y, chat: [], survey: { phase: "intro", sec: 0, a: {}, miss: false } }); try { localStorage.removeItem("ii-survey-draft"); } catch (e) {} addLog(me(), "Демо-дані скинуто"); persist(); render(); toast("Демо-дані скинуто"); }

/* Журнал дій із ланцюгом хешів */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); }
const SEEDLOG = [
  ["2026-11-01 09:12", "Уповноважений (адміністратор)", "Відкрито цикл 2026-11, мінімальна група k = 10"],
  ["2026-11-01 09:20", "Уповноважений (адміністратор)", "Видано 84 одноразові жетони (РГ 15, ОС 64, експерти 5)"],
  ["2026-11-02 10:05", "Укладач анкет", "Опубліковано анкету «Анонімне опитування особового складу», версія 3"],
  ["2026-11-10 14:05", "Вносить дані чек-листа", "Чек-лист: внесено 8 показників фактів"],
  ["2026-11-11 10:41", "Підтверджує дані чек-листа", "Чек-лист: підтверджено 8 показників"],
  ["2026-11-12 16:20", "Уповноважений (адміністратор)", "Журнал звернень: внесено 36 з 60 розглянутих у строк"],
  ["2026-11-15 18:00", "Система", "Розрахунок індексу за методикою v1.0: 54,2"],
];
const logItems = () => { let prev = "0"; return [...SEEDLOG, ...S.log].map(([t, who, a]) => { const h = fnv(prev + t + who + a); prev = h; return { t, who, a, h }; }); };
function addLog(who, a) { const t = new Date().toISOString().slice(0, 16).replace("T", " "); S.log.push([t, who, a]); persist(); }
const me = () => ROLE[S.role][0];

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const strip = h => String(h).replace(/<[^>]+>/g, "");
const fb = v => r1(v).toLocaleString("uk-UA", { maximumFractionDigits: 1 });
const f1 = v => r1(v).toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = v => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pts = v => { const a = Math.abs(r1(v)); const w = Number.isInteger(a) ? (a % 10 === 1 && a % 100 !== 11 ? "пункт" : [2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100) ? "пункти" : "пунктів") : "пункта"; return `${fb(a)} ${w}`; };
const ua = d => d.split("-").reverse().join(".");
const numHTML = (v, d = 1) => { const s = d ? f1(v) : fb(v); const [a, b] = s.split(","); return `<span class="cu" data-v="${v}" data-d="${d}">${a}<span class="dec">${b ? "," + b : ""}</span></span>`; };
const deltaHTML = (d, suf = "") => { const up = d > 0, dn = d < 0; return `<span class="delta ${up ? "up" : dn ? "down" : "flat"}"><i>${up ? IC.up : dn ? IC.down : IC.flat}</i><b>${up || dn ? pts(d) : "Без змін"}</b>${up ? " зросло" : dn ? " знизилось" : ""}${suf ? " " + suf : ""}</span>`; };
const pill = (txt, cls) => `<span class="pill ${cls}">${txt}</span>`;
const lvPill = l => `<span class="pill lv lv${l} nodot" data-tip="Рівень зрілості ${l} з 5: ${LSHORT[l - 1]}<small>${LDESC[l - 1]}</small>"><b>${l}</b>${LSHORT[l - 1]}</span>`;
const trustPill = g => `<span class="pill ${TRUST[g][3]} nodot" data-tip="${esc(TRUST[g][2])}">${g === "insufficient" ? "" : `<b>${g}</b>`}${TRUST[g][1]}</span>`;
const srcDot = s => `<span class="src-dot ${SRC[s][2]}" style="--c:${SRC[s][1]}"></span>`;
const allItems = m => [...m.pItems, ...m.fItems];
function countUp(root) {
  root.querySelectorAll(".cu").forEach(el => {
    const v = +el.dataset.v, d = +el.dataset.d, t0 = performance.now(), dur = 1100;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = t => {
      const p = reduce ? 1 : Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      const s = d ? f1(v * e) : fb(v * e); const [a, b] = s.split(",");
      el.innerHTML = `${a}<span class="dec">${b ? "," + b : ""}</span>`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2400); }
const tip = $("#tip");
// Масштаб тексту (zoom на <html>): координати getBoundingClientRect екранні, а left/top задаються в CSS-пікселях
const Z = () => parseFloat(document.documentElement.style.zoom) || 1;
const zr = r => { const z = Z(); return { left: r.left / z, right: (r.right ?? r.left + r.width) / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z }; };
function placePop(btn) { const p = $("#pop"), r = zr(btn.getBoundingClientRect()), w = p.offsetWidth, vw = innerWidth / Z(); p.style.left = Math.max(8, Math.min(r.right - w, vw - w - 8)) + "px"; p.style.top = (r.bottom + 6) + "px"; }
function showTip(r, html) {
  r = zr(r); const innerWidth = window.innerWidth / Z(), innerHeight = window.innerHeight / Z();
  tip.innerHTML = html; tip.style.left = "0px"; tip.style.top = "0px";
  const w = tip.offsetWidth, h = tip.offsetHeight, m = 8, gap = 10;
  const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, m), innerWidth - w - m);
  const y = r.top - h - gap >= m ? r.top - h - gap : Math.min(r.bottom + gap, innerHeight - h - m);
  tip.style.left = x + "px"; tip.style.top = y + "px"; tip.classList.add("on");
}
function hideTip() { tip.classList.remove("on"); }
document.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); if (!el) return; const r = el.getBoundingClientRect(); showTip(r, el.dataset.tip); });
document.addEventListener("mouseout", e => { if (e.target.closest("[data-tip]")) hideTip(); });

/* ---------- Charts ---------- */
const DEFS = `<defs>
  <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--teal)" stop-opacity=".28"/><stop offset="1" stop-color="var(--teal)" stop-opacity="0"/></linearGradient>
  <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--teal-deep)"/><rect width="2.2" height="7" fill="rgba(255,255,255,.22)"/></pattern>
</defs>`;
function smooth(p) { let d = `M${p[0][0]},${p[0][1]}`; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; } return d; }
function curveChart(el, vals, labels) {
  if (!el) return;
  const w = el.clientWidth || 400, h = 150, pad = 10;
  const min = Math.min(...vals) - 8, max = Math.max(...vals) + 6;
  const X = i => pad + i * (w - 2 * pad) / (vals.length - 1), Y = v => h - 24 - (v - min) / (max - min) * (h - 44);
  const p = vals.map((v, i) => [X(i), Y(v)]), line = smooth(p);
  el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DEFS}
    <path d="${line} L${X(vals.length - 1)},${h - 24} L${X(0)},${h - 24}Z" class="area-fill reveal"/>
    <path d="${line}" class="line-teal draw" style="stroke-dasharray:2000;--len:2000"/>
    ${p.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--panel)" stroke="var(--teal)" stroke-width="2" class="pop" style="animation-delay:${600 + i * 120}ms"/>`).join("")}
    ${labels.map((l, i) => `<text x="${X(i)}" y="${h - 4}" text-anchor="${i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}" class="ax">${l}</text>`).join("")}
    <line id="cvl" x1="0" x2="0" y1="0" y2="${h - 24}" stroke="var(--teal)" stroke-dasharray="3 3" opacity="0"/>
    <circle id="cvd" r="5" fill="var(--panel)" stroke="var(--teal)" stroke-width="2.5" opacity="0"/></svg>`;
  const svg = el.querySelector("svg"), vl = svg.querySelector("#cvl"), dt = svg.querySelector("#cvd");
  svg.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect(), i = Math.round(clamp((e.clientX - r.left - pad) / (w - 2 * pad) * (vals.length - 1), 0, vals.length - 1)), [px, py] = p[i];
    vl.setAttribute("x1", px); vl.setAttribute("x2", px); vl.setAttribute("opacity", 1); dt.setAttribute("cx", px); dt.setAttribute("cy", py); dt.setAttribute("opacity", 1);
    showTip({ left: r.left + px, top: r.top + py - 6, width: 0, bottom: r.top + py + 6 }, `${f1(vals[i])}<small>Цикл ${labels[i]}</small>`);
  });
  svg.addEventListener("mouseleave", () => { vl.setAttribute("opacity", 0); dt.setAttribute("opacity", 0); hideTip(); });
}
// Динаміка: індекс + лінії компонентів, межі рівнів зрілості, події між циклами
function trendChart(el, rows, lines, events, showIdx = true) {
  if (!el) return;
  const w = el.clientWidth || 600, wide = w > 520, h = 300, L = 40, Rr = wide ? 104 : 30, T = 26, B = 46;
  const n = rows.length, IP = 22, X = i => L + IP + (n === 1 ? (w - L - Rr - 2 * IP) / 2 : i * (w - L - Rr - 2 * IP) / (n - 1)), Y = v => T + (1 - v / 100) * (h - T - B);
  const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${L}" x2="${w - Rr}" y1="${Y(v)}" y2="${Y(v)}" class="grid-l"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join("");
  const bounds = BOUNDS.map(v => `<line x1="${L}" x2="${w - Rr + 4}" y1="${Y(v)}" y2="${Y(v)}" class="lv-bound"/>`).join("");
  const bands = [0, ...BOUNDS].map((lo, i) => { const hi = [...BOUNDS, 100][i], y1 = Y(hi), y2 = Y(lo); return `<g data-tip="Рівень зрілості ${i + 1}: ${LSHORT[i]}<small>Індекс від ${fb(lo)} до ${fb(hi)}</small>"><rect x="${w - Rr + 8}" y="${y1 + 1}" width="4" height="${y2 - y1 - 2}" rx="2" class="lv-band lv-b${i + 1}"/><text x="${w - Rr + 18}" y="${(y1 + y2) / 2 + 4}" class="ax">${wide ? `${i + 1} ${LSHORT[i]}` : i + 1}</text></g>`; }).join("");
  const heads = `<text x="${L - 8}" y="${T - 12}" text-anchor="end" class="ax">0–100</text>${wide ? `<text x="${w - Rr + 8}" y="${T - 12}" class="ax">Рівень зрілості</text>` : ""}`;
  const p = rows.map((r, i) => [X(i), Y(r.index)]);
  const area = n > 1 && showIdx ? `<path d="${smooth(p)} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)}Z" class="area-fill reveal"/>` : "";
  const compLines = lines.map(c => { const q = rows.map((r, i) => [X(i), Y(r.cr[c])]); return `<path d="${n > 1 ? smooth(q) : ""}" fill="none" stroke="${COMP[c].c}" stroke-width="2" stroke-dasharray="6 5" class="draw" style="--len:3000"/>${q.map(([x, y], i) => `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2" fill="${COMP[c].c}" class="pop" data-tip="${COMP[c].n}: ${fb(rows[i].cr[c])}<small>Цикл ${rows[i].cycle}</small>"/>${showIdx ? "" : `<text x="${x}" y="${y - 10}" text-anchor="middle" class="ax-strong">${fb(rows[i].cr[c])}</text>`}`).join("")}`; }).join("");
  const idx = showIdx ? `<path d="${n > 1 ? smooth(p) : ""}" class="line-teal draw" style="stroke-dasharray:3000;--len:3000"/>${p.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="5" fill="var(--panel)" stroke="var(--teal)" stroke-width="2.5" class="pop" style="animation-delay:${500 + i * 120}ms" data-tip="Індекс ${f1(rows[i].index)} · рівень ${level(rows[i].index)}<small>Цикл ${rows[i].cycle}</small>"/><text x="${x}" y="${y - 12}" text-anchor="middle" class="ax-strong">${f1(rows[i].index)}</text>`).join("")}` : "";
  const ev = events.map(e => { const i = rows.findIndex(r => r.cycle === e.after); if (i < 0 || i >= n - 1) return ""; const x = (X(i) + X(i + 1)) / 2, y = h - B + 21; return `<g class="pop" data-tip="${esc(e.t)}<small>Після циклу ${e.after}</small>"><rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="var(--panel)" stroke="var(--fg)" stroke-width="1.6" transform="rotate(45 ${x} ${y})"/></g>`; }).join("");
  el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Динаміка індексу доброчесності">${DEFS}${grid}${bounds}${bands}${heads}${area}${idx}${compLines}
    ${rows.map((r, i) => `<text x="${X(i)}" y="${h - B + 6}" text-anchor="middle" class="ax" style="dominant-baseline:hanging">${r.cycle}</text>`).join("")}${ev}</svg>`;
}
// Радар компонентів (два цикли)
function radar(el, series) {
  if (!el) return;
  const w = Math.min(el.clientWidth || 320, 360), h = w * 0.86, cx = w / 2, cy = h / 2 + 10, rad = Math.min(w, h) / 2 - 40, n = COMPS.length;
  const P = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * rad * v / 100, cy + Math.sin(a) * rad * v / 100]; };
  const rings = [...BOUNDS, 100].map(v => `<polygon class="radar-grid" points="${COMPS.map((_, i) => P(i, v).join(",")).join(" ")}"/>`).join("");
  const axes = COMPS.map((c, i) => { const [ex, ey] = P(i, 100), [lx, ly] = P(i, 124); return `<line class="radar-ax" x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}"/><text x="${lx}" y="${ly}" text-anchor="middle" class="ax">${COMP[c].n}</text><text x="${lx}" y="${ly + 15}" text-anchor="middle" class="ax-strong">${fb(series[0].v[i])}</text>`; }).join("");
  const polys = series.map(s => `<polygon class="${s.cls} pop" style="animation-delay:${s.delay || 0}ms" points="${s.v.map((v, i) => P(i, v).join(",")).join(" ")}"/>`).join("");
  el.innerHTML = `<svg width="${w}" height="${h + 14}" viewBox="0 0 ${w} ${h + 14}" style="margin:0 auto;max-width:100%">${rings}${axes}${polys}</svg>`;
}
// Шкала рівнів зрілості (нерівні межі 12,5 / 37,5 / 62,5 / 87,5) з позначкою індексу
function levelBar(v) {
  const spans = [[0, 12.5], [12.5, 37.5], [37.5, 62.5], [62.5, 87.5], [87.5, 100]], lv = level(v);
  return `<div class="lvscale" role="img" aria-label="Індекс ${f1(v)}: рівень ${lv} з 5, ${LSHORT[lv - 1]}">
    <div class="lvs-mark" style="left:${v}%"><b class="tnum">${f1(v)}</b><i></i></div>
    <div class="lvs-bar">${spans.map(([lo, hi], i) => `<span class="lv-b${i + 1} ${i + 1 === lv ? "here" : ""}" style="flex:${hi - lo}" data-tip="Рівень ${i + 1}: ${LSHORT[i]}<small>Індекс від ${fb(lo)} до ${fb(hi)}</small>"></span>`).join("")}</div>
    <div class="lvs-lbl">${spans.map(([lo, hi], i) => `<div style="flex:${hi - lo}" class="${i + 1 === lv ? "here" : ""}"><b>${i + 1}</b><span>${LSHORT[i]}</span><small class="tnum">${fb(lo)}–${fb(hi)}</small></div>`).join("")}</div>
  </div>`;
}

/* ---------- Drawer ---------- */
function openDrawer(title, html, after) {
  $("#dTitle").textContent = title; $("#dBody").innerHTML = html;
  [...$("#dBody").children].forEach((c, i) => c.style.animationDelay = (80 + i * 60) + "ms");
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false");
  countUp($("#dBody")); after && after($("#dBody"));
  setTimeout(() => { const f = $("#dBody").querySelector("textarea, input, select"); if (f) f.focus(); }, 350);
}
function closeDrawer() { $("#drawer").classList.remove("on"); if (!$("#ai").classList.contains("on")) $("#scrim").classList.remove("on"); $("#drawer").setAttribute("aria-hidden", "true"); }
