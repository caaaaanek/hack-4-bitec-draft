/* ---------- Views ---------- */
const V = {};
const cur = () => inst(S.role === "observer" ? S.inst : ALPHA);
const can = r => NAV.some(n => n[0] === r && n[3].includes(S.role));
const backToInst = () => S.role === "observer" ? `<div class="c12 crumbs rise"><a href="#institutions">${IC.arrowL}Усі заклади</a><span class="lbl">/</span><b>${esc(cur().name)}</b></div>` : "";

/* «Чому такий індекс» */
function whyText(m, noTrust) {
  const t = m.delta > 0 ? `що на ${pts(m.delta)} вище, ніж у попередньому циклі` : m.delta < 0 ? `що на ${pts(m.delta)} нижче, ніж у попередньому циклі` : "що не змінилося порівняно з попереднім циклом";
  let s = `Заклад перебуває на рівні зрілості ${m.level} «${LEVELS[m.level - 1]}»: індекс доброчесності ${f1(m.index)} з 100, ${t}.`;
  if (m.limited) s += ` Для компонента «${COMP[m.limited.id].n}» сприйняття (${fb(m.limited.P)}) помітно вище за факти (${fb(m.limited.F)}), тому зараховано ${fb(m.limited.cr.v)}.`;
  const tr = TRUST[m.trust]; if (!noTrust) s += ` Достовірність ${tr[0]}: ${tr[1].toLowerCase()}${m.trust === "C" ? ", тож спершу варто підтвердити факти документами" : ""}.`;
  return s;
}
// Плашка «Достовірність»: скільки прапорців і які саме (для чату ШІ та запасної панелі)
function flagsText(m) {
  const maj = m.raised.filter(f => f.w === "major").length, min = m.raised.length - maj, tr = TRUST[m.trust];
  let s = `Варто перевірити додатково. Достовірність ${tr[0]}: ${tr[1].toLowerCase()}. Спрацювало прапорців: ${m.raised.length}${m.raised.length ? ` (серйозних ${maj}, незначних ${min})` : ""}.`;
  if (m.raised.length) s += "\n" + m.raised.map(f => `• ${f.t}${f.w === "major" ? " (серйозний)" : " (незначний)"}. ${f.ex}`).join("\n");
  return s + "\nЦе напрям для додаткового аналізу, а не висновок про людей чи підрозділи.";
}
// Клік на картку індексу: висновок і прапорці показує асистент; якщо ШІ вимкнено або недоступний для ролі, ті самі тексти правил у панелі
function openWhy() {
  if (S.aiOn && AI_ROLES.includes(S.role)) return aiOpen("Чому такий індекс?");
  const m = cur(), lim = m.limited;
  openDrawer("Чому такий індекс", `
    <div><div class="lbl" style="margin-bottom:4px">Короткий висновок</div><div style="line-height:1.55">${whyText(m)}</div></div>
    ${lim ? `<div class="note-box"><b>Показано з обмеженням</b><span class="lbl">${lim.cr.reason}</span>${capBars(lim)}</div>` : ""}
    <div><div class="card-h" style="margin-bottom:6px"><h2>Варто перевірити додатково</h2><div class="sp"></div>${trustPill(m.trust)}</div>
      <div class="lbl" style="margin-bottom:8px">Спрацювало прапорців: ${m.raised.length}</div>
      ${m.raised.length ? `<div class="rows">${m.raised.map(f => `<div class="row" style="align-items:flex-start"><span class="flag-ic ${f.w}">${f.w === "major" ? IC.alert : IC.flag}</span><div class="grow"><div style="font-weight:600">${esc(f.t)} ${pill(f.w === "major" ? "Серйозний" : "Незначний", "p-mute nodot")}</div><div class="lbl">${f.ex}</div></div></div>`).join("")}</div>` : `<div>Жоден прапорець не спрацював.</div>`}
      <div class="lbl" style="margin-top:10px">Напрям для додаткового аналізу. Це не висновок про людей чи підрозділи.</div></div>`);
}
// Картка «Достовірність»: яка літера, за яким правилом і результат кожної з чотирьох перевірок
const CHECK_OK = { "tf-gap": "Сприйняття ніде не перевищує факти більш ніж на 25 пунктів.", "tf-same": "Підозріло однакових анкет не виявлено." };
const CHECK_BAD = { "tf-jump": "Індекс різко змінився між циклами, і пояснення цьому немає.", "tf-experts": "Експертних анкет надійшло менше, ніж очікувалось." };
const checkText = f => f.raised ? (CHECK_BAD[f.id] || f.ex) : (CHECK_OK[f.id] || f.ex);
function trustText(m) {
  const tr = TRUST[m.trust], n = m.raised.length;
  let s = m.trust === "insufficient" ? `Достовірність не оцінюється: ${tr[2].toLowerCase()}` : `Достовірність ${tr[0]}: ${tr[1].toLowerCase()}. ${n ? `Спрацювало прапорців: ${n} з ${m.flags.length}.` : `Жоден із ${m.flags.length} прапорців не спрацював.`}`;
  s += `\n\nЛітера ставиться за правилом: A без прапорців, B один-два незначних, C хоча б один серйозний або три і більше незначних.`;
  s += `\n\nПеревірки цього циклу:\n` + m.flags.map(f => `${f.raised ? "⚠" : "✓"} ${FLAGS.find(x => x.id === f.id).t} (${f.w === "major" ? "серйозний" : "незначний"}): ${f.raised ? "спрацював" : "не спрацював"}. ${checkText(f)}`).join("\n");
  return s + "\n\nПрапорець означає напрям для додаткової перевірки даних, а не висновок про людей чи підрозділи.";
}
function openTrust() {
  if (S.aiOn && AI_ROLES.includes(S.role)) return aiOpen("Чому така достовірність?");
  const m = cur();
  openDrawer("Достовірність результату", `
    <div class="card-h"><h2>${TRUST[m.trust][1]}</h2><div class="sp"></div>${trustPill(m.trust)}</div>
    <div class="lbl">${TRUST_HINT}</div>
    <div class="rows">${m.flags.map(f => `<div class="row" style="align-items:flex-start"><span class="flag-ic ${f.raised ? f.w : "ok"}">${f.raised ? (f.w === "major" ? IC.alert : IC.flag) : IC.ok}</span><div class="grow"><div style="font-weight:600">${esc(FLAGS.find(x => x.id === f.id).t)} ${pill(f.raised ? "Спрацював" : "Не спрацював", (f.raised ? "p-bad" : "p-good") + " nodot")}</div><div class="lbl">${checkText(f)} ${f.w === "major" ? "Серйозний прапорець." : "Незначний прапорець."}</div></div></div>`).join("")}</div>
    <div class="lbl">Прапорець означає напрям для додаткової перевірки даних, а не висновок про людей чи підрозділи.</div>`);
}
// Іконка «i» на картці індексу: як рахується і шкала
function openHow() {
  const m = cur();
  const scale = [1, 2, 3, 4, 5].map(l => { const lo = [0, ...BOUNDS][l - 1], hi = [...BOUNDS, 100][l - 1]; return `<div class="row" style="align-items:flex-start"><span class="lvsq lv${l} ${l === m.level ? "on" : ""}">${l}</span><div class="grow">${LEVELS[l - 1]} <span class="lbl">${l === 1 ? `від 0 до ${fb(hi)}` : l === 5 ? `вище ${fb(lo)}` : `вище ${fb(lo)} до ${fb(hi)}`}</span><div class="lbl" style="font-size:12.5px;margin-top:2px">${LDESC[l - 1]}</div></div>${l === m.level ? pill("Поточний", "p-good nodot") : ""}</div>`; }).join("");
  openDrawer("Як рахується індекс", `
    <div><div class="lbl" style="margin-bottom:6px">Як це рахується</div><ol class="howto">
      <li>Індекс від 0 до 100 це середнє трьох компонентів: Культура, Система, Підзвітність.</li>
      <li>Кожен компонент складається зі сприйняття (анкети) і фактів (чек-лист та дані обліку).</li>
      <li>Сприйняття не може бути вищим за факти більш ніж на ${CAP} пунктів. Якщо розрив більший, зараховується «факти + ${CAP}».</li>
      <li>Рівень зрілості від 1 до 5 визначають межі шкали нижче.</li>
      <li>Достовірність показує, наскільки результату можна довіряти. Вона залежить від прапорців: автоматичних перевірок даних.</li></ol>
      ${route().r !== "explain" ? `<a class="link" href="#explain" onclick="closeDrawer()">Відкрити розклад індексу ${IC.arrowR}</a>` : ""}</div>
    <div><div class="lbl" style="margin-bottom:4px">Шкала рівнів зрілості</div><div class="rows">${scale}</div></div>`);
}
function capBars(c) {
  const bar = (n, v, col) => `<div class="cap-row"><span class="lbl">${n}</span><div class="dist-bar"><i style="width:${v}%;background:${col}"></i></div><b class="tnum">${fb(v)}</b></div>`;
  return `<div class="cap">${bar("Сприйняття", c.P, "var(--blue)")}${bar("Факти", c.F, "var(--amber)")}${bar("Зараховано", c.cr.v, "var(--teal)")}</div>`;
}

// Плашка «Відповідей у циклі»: скільки відповіли за групами і що означає k
function respGroups(m) {
  if (m.id === ALPHA) return GROUPS.map(g => ({ ...g }));
  const n = m.responses, wg = Math.round(n * .2), ex = 5, os = n - wg - ex;
  return [{ n: "Робоча група", inv: wg + 1, resp: wg }, { n: "Особовий склад", inv: os + 8, resp: os }, { n: "Експерти", inv: ex, resp: ex }];
}
function openResp() {
  const m = cur(), gs = respGroups(m), inv = gs.reduce((a, g) => a + g.inv, 0), resp = gs.reduce((a, g) => a + g.resp, 0);
  openDrawer("Відповіді в циклі " + CYCLE, `
    <div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr)"><div><small>Запрошено</small><b>${inv}</b></div><div><small>Відповіли</small><b>${resp}</b></div><div><small>Охоплення</small><b>${Math.round(resp / inv * 100)} %</b></div></div>
    <div><div class="lbl" style="margin-bottom:6px">За групами</div><div class="rows">${gs.map(g => { const hid = g.resp < S.k && g.unit; return `<div class="row"><div class="grow"><div class="t">${g.n}</div><div class="dist-bar" style="margin-top:6px"><i style="width:${g.resp / g.inv * 100}%;background:${hid ? "var(--faint)" : "var(--teal)"}"></i></div></div><b class="tnum">${g.resp} з ${g.inv}</b>${hid ? pill("Приховано", "p-mute nodot") : ""}</div>`; }).join("")}</div></div>
    <div class="note-box"><b>Мінімальна група k = ${S.k}</b><span class="lbl">Результати групи показуються, лише якщо відповіли щонайменше ${S.k} людей. Менші групи додаються до вищого рівня, щоб нікого не можна було впізнати. Окремі відповіді не зберігаються разом з особою: жетон одноразовий і не повʼязаний з іменем.</span></div>`);
}
const LIST_MAX = 3; // скільки пунктів показувати в «Що потребує уваги» і «Сильні сторони» до розгортання
/* Огляд */
V.overview = () => {
  const m = cur(), ms = measures(), od = ms.filter(x => overdueDays(x) > 0).length, prev = m.series[m.series.length - 2];
  const tile = (ic, title, big, sub, act, info) => `<section class="card rise kpi-tile" ${act ? `role="button" tabindex="0" onclick="${act}"` : ""}><div class="kt-h"><span class="kt-ic">${IC[ic]}</span><span class="lbl">${title}</span>${info ? `<button type="button" class="kt-info" aria-label="Підказка: як рахується" data-tip="Як рахується і шкала рівнів" onclick="event.stopPropagation();${info}">${IC.info}</button>` : ""}</div><div class="kt-b">${big}<div class="kt-s">${sub}</div></div></section>`;
  return `${backToInst()}
  <div class="c12 kpi-row">
  ${tile("gauge", "Індекс доброчесності", `<span class="mid tnum">${numHTML(m.index)}</span>`, `<span data-tip="Рівень зрілості визначається за індексом<small>${LDESC[m.level - 1]}</small>">Рівень зрілості ${m.level} з 5: ${LSHORT[m.level - 1]}</span><br>${deltaHTML(m.delta)}`, "openWhy()", "openHow()")}
  ${tile("shield", "Достовірність", `<span class="mid">${m.trust === "insufficient" ? "?" : m.trust}</span>`, `${TRUST[m.trust][1]}<br><span class="lbl">Прапорці: ${m.raised.length}</span>`, "openTrust()")}
  ${S.role === "observer" ? tile("users", "Відповідей у циклі", `<span class="mid tnum">${m.responses}</span>`, `<span class="lbl">Мінімальна група k = ${S.k}</span>`, "openResp()") : tile("target", "Заходи в трекері", `<span class="mid tnum">${ms.length}</span>`, od ? `<span style="color:var(--red);font-weight:600">З них ${od} прострочено</span>` : `<span class="lbl">Прострочених немає</span>`, "location.hash='tracker'")}
  </div>
  <section class="card c8 rise" id="attn">
    <div class="attn-cols"><div>
    <div class="card-h"><h2>Що потребує уваги</h2></div>
    ${m.attention.length ? `<div class="rows">${(S.attnAll ? m.attention : m.attention.slice(0, LIST_MAX)).map(a => `<a class="row click" href="#explain/${a.c}"${a.q ? ` onclick="event.preventDefault();openApiQ('${a.q}')"` : ""} data-tip="${esc(a.hint)}"><span class="dot" style="background:${SCOL[status(a.v)]}"></span><div class="grow"><div class="t">${esc(a.t)}</div></div>${pill(COMP[a.c].n, "p-mute nodot")}<b class="tnum">${fb(a.v)}</b></a>`).join("")}</div>` : `<div class="lbl">Зауважень немає: нічого не потребує уваги.</div>`}
    </div><div>
    <div class="card-h"><h2>Сильні сторони</h2></div>
    ${m.strengths.length ? `<div class="rows">${(S.attnAll ? m.strengths : m.strengths.slice(0, LIST_MAX)).map(a => `<a class="row click" href="${a.c ? "#explain/" + a.c : "#trends"}" data-tip="${esc(a.hint)}"><span class="dot" style="background:var(--teal)"></span><div class="grow"><div class="t">${a.t}</div></div><b class="tnum">${a.unit ? "+" : ""}${fb(a.v)}</b></a>`).join("")}</div>` : `<div class="lbl">Поки що немає даних про сильні сторони.</div>`}
    </div></div>
  ${m.attention.length > LIST_MAX || m.strengths.length > LIST_MAX ? `<button class="link-btn" style="margin-top:8px" onclick="S.attnAll=!S.attnAll;render(true)">${S.attnAll ? "Згорнути" : `Показати всі (${m.attention.length + m.strengths.length})`}</button>` : ""}
  </section>
  <section class="card c4 rise dyn-card">${dynCard(m)}</section>
  <div class="c12 comp-row">${m.components.map((c, ci) => {
    const C = COMP[c.id], pv = prev.cr[c.id], d = r1(c.cr.v - pv), lv = level(c.cr.v);
    return `<a class="card rise comp-card" href="#explain/${c.id}">
      <div class="comp-top"><span class="comp-ic" style="background:${C.s};color:${C.c}">${IC[C.ic]}</span><b>${C.n}</b><div class="sp" style="flex:1"></div>${lvPill(lv)}</div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:14px">
        <div><div class="mid tnum">${numHTML(c.cr.v)}</div><div style="margin-top:6px">${deltaHTML(d)}</div></div>
        <div class="pf">${[["Сприйняття", c.P, "var(--blue)"], ["Факти", c.F, "var(--amber)"], ["Зараховано", c.cr.v, C.c]].map(([n, v, col], j) => `<div data-tip="${n}: ${fb(v)}"><i class="bar-a" style="height:${Math.max(4, v * .6)}px;background:${col};animation-delay:${300 + ci * 100 + j * 80}ms"></i><small>${n[0]}</small></div>`).join("")}</div>
      </div>
      ${c.cr.lim ? `<div style="margin-top:14px">${pill("Зараховано з обмеженням", "p-warn")}</div>` : ""}
    </a>`;
  }).join("")}</div>
  <section class="card c8 rise lv-card">
    <div class="card-h"><h2>Рівень зрілості</h2><div class="sp"></div><button type="button" class="pill-btn" onclick="openHow()">${IC.help}Як рахується</button></div>
    <div class="lbl" style="margin-bottom:14px">Індекс ${f1(m.index)} з 100 відповідає рівню ${m.level} «${LEVELS[m.level - 1]}» за Моделлю зрілості НАЗК.</div>
    ${levelBar(m.index)}
    <div class="lbl" style="margin-top:14px">${LDESC[m.level - 1]}</div>
    <div class="lbl" style="margin:20px 0 8px">Компоненти на тій самій шкалі</div>
    <div class="lv-comps">${m.components.map(c => { const v = c.cr.v, l = level(v); return `<a class="lv-comp" href="#explain/${c.id}"><b>${COMP[c.id].n}</b><div class="lvc-track">${[12.5, 25, 25, 25, 12.5].map((w, i) => `<span class="lv-b${i + 1} ${i + 1 === l ? "here" : ""}" style="flex:${w}"></span>`).join("")}<i style="left:${v}%" data-tip="${COMP[c.id].n}: ${fb(v)}"></i></div><span class="tnum">${fb(v)}</span>${lvPill(l)}</a>`; }).join("")}</div>
  </section>
  <section class="card c4 rise radar-card">
    <div class="card-h"><h2>Радар компонентів</h2></div>
    <div class="radar-body"><div class="radar-main"><div class="chart" id="radar"></div>
    <div class="legend lg-lines" style="justify-content:center"><span><i class="ar" style="background:color-mix(in srgb,var(--teal) 30%,transparent);border-color:var(--teal)"></i>Цикл ${CYCLE}</span><span><i class="ln dash" style="border-color:var(--faint)"></i>Цикл ${prev.cycle}</span></div>
    <div class="lbl" style="text-align:center;margin-top:6px">Зараховані значення компонентів, 0–100.</div></div>
    <div class="radar-side"><table><thead><tr><th>Компонент</th><th>Сприйняття</th><th>Факти</th><th>Зараховано</th></tr></thead><tbody>${m.components.map(c => `<tr><td><b>${COMP[c.id].n}</b></td><td class="tnum">${fb(c.P)}</td><td class="tnum">${fb(c.F)}</td><td class="tnum"><b>${fb(c.cr.v)}</b></td></tr>`).join("")}</tbody></table><div class="lbl" style="margin-top:8px">Зараховано це сприйняття, обмежене фактами: не більше ніж «факти + ${CAP}».</div></div></div>
  </section>
  ${readGuide("Як читати цей екран")}`;
};
V.overview.after = () => {
  const m = cur(), prev = m.series[m.series.length - 2];
  miniTrend($("#dynMini"), m.series);
  radar($("#radar"), [{ cls: "r-st", v: COMPS.map(c => m.byId[c].cr.v), delay: 150 }, { cls: "r-prev", v: COMPS.map(c => prev.cr[c]), delay: 0 }]);
};

/* Компактна динаміка індексу на «Огляді»: лише лінія індексу, повний екран на #trends */
function dynCard(m) {
  const sr = m.series, a = sr[0], b = sr[sr.length - 1], d = r1(b.index - a.index);
  const txt = d > 0 ? `Зріс на ${pts(d)}` : d < 0 ? `Знизився на ${pts(d)}` : "Не змінився";
  const alt = `Індекс за цикли від ${a.cycle} до ${b.cycle}: з ${f1(a.index)} до ${f1(b.index)}. ${txt} за період.`;
  return `<div class="card-h"><h2>Динаміка індексу</h2><div class="sp"></div><a class="pill-btn" href="#trends" aria-label="Детальніше: відкрити екран «Динаміка»">${IC.arrowR}Детальніше</a></div>
    <div class="chart dyn-mini" id="dynMini" role="img" aria-label="${esc(alt)}"></div>
    <div class="dyn-sum"><span class="lbl">${a.cycle}: <b class="tnum">${f1(a.index)}</b></span><span class="dyn-d ${d > 0 ? "up" : d < 0 ? "down" : ""}">${txt}</span><span class="lbl">${b.cycle}: <b class="tnum">${f1(b.index)}</b></span></div>`;
}
/* Динаміка: картка з вибором періоду й ліній (екран «Динаміка») */
const trendRange = m => { const t = S.trend, n = m.series.length - 1, a = clamp(Math.min(t.from, t.to), 0, n), b = clamp(Math.max(t.from, t.to), 0, n); return [a, b]; };
function trendCard(m, id) {
  const t = S.trend, [from, to] = trendRange(m), rows = m.series.slice(from, to + 1), d = r1(rows[rows.length - 1].index - rows[0].index);
  const evs = m.events.filter(e => rows.slice(0, -1).some(r => r.cycle === e.after));
  const chip = (k, n, c, on) => `<button class="chip ${on ? "on" : ""}" style="--c:${c}" aria-pressed="${on}" onclick="toggleLine('${k}')"><i ${k === "index" ? 'class="solid"' : ""}></i>${n}</button>`;
  return `<div class="card-h" style="flex-wrap:wrap"><h2>Динаміка індексу</h2><div class="sp"></div>
      <button type="button" class="pill-btn" aria-haspopup="dialog" onclick="openPeriod(this)">${IC.cal}${rows[0].cycle} – ${rows[rows.length - 1].cycle}</button>
      <button class="pill-btn" onclick="S.trTable=!S.trTable;render(true)">${S.trTable ? IC.trend + "Діаграма" : IC.table + "Таблиця"}</button></div>
    ${S.trTable ? "" : `<div class="chips-row"><span class="lbl">Лінії:</span>${chip("index", "Індекс", "var(--teal-deep)", !t.noIdx)}${COMPS.map(c => chip(c, COMP[c].n, COMP[c].c, t.lines.includes(c))).join("")}</div>`}
    ${S.trTable ? `<div class="tbl-wrap"><table><thead><tr><th>Цикл</th><th>Індекс</th><th>Рівень</th>${COMPS.map(c => `<th>${COMP[c].n}</th>`).join("")}<th>Події після циклу</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${r.cycle}</b></td><td class="tnum"><b>${f1(r.index)}</b></td><td>${lvPill(level(r.index))}</td>${COMPS.map(c => `<td class="tnum">${fb(r.cr[c])}</td>`).join("")}<td class="lbl">${m.events.filter(e => e.after === r.cycle && r !== rows[rows.length - 1]).map(e => e.t).join("; ") || "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="chart" id="${id}"></div>`}
    <div class="lbl" style="margin-top:8px;display:flex;align-items:center;flex-wrap:wrap;gap:4px"><span class="ev-ic">${IC.diamond}</span>Виконані заходи між циклами: ${evs.reduce((a, e) => a + (e.n || 1), 0)}. ${d > 0 ? `За період індекс зріс на ${pts(d)}.` : d < 0 ? `За період індекс знизився на ${pts(d)}.` : "За період індекс не змінився."}</div>`;
}
function drawTrend(id, m) { const [from, to] = trendRange(m); trendChart($("#" + id), m.series.slice(from, to + 1), S.trend.lines, m.events, !S.trend.noIdx); }
function toggleLine(c) {
  const t = S.trend;
  if (c === "index") t.noIdx = !t.noIdx; else t.lines = t.lines.includes(c) ? t.lines.filter(x => x !== c) : [...t.lines, c];
  if (t.noIdx && !t.lines.length) { t.noIdx = false; toast("Має лишитися хоча б одна лінія"); }
  persist(); render(true);
}
// Вибір періоду: календар місяців, у яких були цикли (клік на початок, потім на кінець)
const MON = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
let pickA = null;
function openPeriod(btn) {
  const pop = $("#pop"); if (pop.classList.contains("on") && pop._btn === btn) return closePop();
  pop._btn = btn; pickA = null; drawPeriod(); pop.classList.add("on");
  placePop(btn);
}
function drawPeriod() {
  const m = cur(), sr = m.series, [from, to] = trendRange(m), years = [...new Set(sr.map(r => r.cycle.slice(0, 4)))];
  const lo = pickA ?? from, hi = pickA != null ? pickA : to;
  $("#pop").innerHTML = `<div class="lbl" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">Оберіть період</div>
    <div style="font-size:17px;font-weight:600;margin:2px 0 10px">${pickA != null ? `${sr[pickA].cycle} – …` : `${sr[from].cycle} – ${sr[to].cycle}`}</div>
    ${years.map(y => `<div class="mp-y">${y}</div><div class="mp">${MON.map((mn, i) => { const cy = `${y}-${String(i + 1).padStart(2, "0")}`, k = sr.findIndex(r => r.cycle === cy); if (k < 0) return `<span class="off">${mn}</span>`; const end = k === lo || k === hi, mid = k > lo && k < hi; return `<button class="${end ? "end" : mid ? "mid" : ""}" onclick="pickCycle(${k})" data-tip="Цикл ${cy}">${mn}</button>`; }).join("")}</div>`).join("")}
    <div class="lbl" style="margin-top:8px">Активні місяці це цикли оцінювання.</div>
    <div style="display:flex;justify-content:space-between;margin-top:10px"><button class="link-btn" onclick="S.trend.from=0;S.trend.to=${sr.length - 1};persist();closePop();render(true)">Увесь період</button><button class="link-btn" onclick="S.trend.from=${Math.max(0, sr.length - 2)};S.trend.to=${sr.length - 1};persist();closePop();render(true)">Останні два цикли</button></div>`;
}
function pickCycle(k) {
  if (pickA == null) { pickA = k; return drawPeriod(); }
  const a = Math.min(pickA, k), b = Math.max(pickA, k); pickA = null;
  if (a === b) { toast("Оберіть два різні цикли"); return drawPeriod(); }
  S.trend.from = a; S.trend.to = b; persist(); closePop(); render(true);
}
function closePop() { const p = $("#pop"); p.classList.remove("on"); p.style.width = ""; pickA = null; }
document.addEventListener("click", e => { const p = $("#pop"); if (p.classList.contains("on") && !p.contains(e.target) && !(p._btn && p._btn.contains(e.target)) && !e.target.closest("#pop")) closePop(); }, true);

/* Розклад індексу */
const MODES = { perception: "Сприйняття", facts: "Факти", credited: "Зараховано" };
function tree(m, mode) {
  return m.components.map(c => {
    const val = mode === "perception" ? c.P : mode === "facts" ? c.F : c.cr.v, lim = mode === "credited" && c.cr.lim;
    const k = mode === "credited" && c.P > 0 ? c.cr.v / c.P : 1;
    const items = (mode === "facts" ? m.fItems : m.pItems).filter(x => x.c === c.id).map(x => { const v = x.v * k; return { ...x, vv: v, contrib: v / 3 * x.w / 100, lim }; });
    return { ...c, val, lim, contrib: val / 3, items };
  });
}
V.explain = () => {
  const m = cur(), mode = S.mode, T = tree(m, mode), sum = r1(T.reduce((a, c) => a + c.contrib, 0)), hl = S.focus;
  const maxC = Math.max(...T.flatMap(c => c.items.map(x => x.contrib)));
  const row = x => `<div class="tree-row ${hl === x.id ? "hl" : ""}" id="n-${x.id}" role="button" tabindex="0" onclick="openItem('${x.id}')" onkeydown="if(event.key==='Enter')openItem('${x.id}')">
      <span class="tn"><span>${esc(x.t)}</span><span class="tsub">${x.kind === "p" ? srcDot(x.src) + SRC[x.src][0] : srcDot("facts") + (x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`)}${x.lim ? `<span class="lim-tag">Частка обмеження компонента</span>` : ""}</span></span>
      <span class="tnum hm">${fb(x.w)} %</span><b class="tnum">${fb(x.vv)}</b>
      <span class="hm"><div class="contrib"><i style="width:${x.contrib / maxC * 100}%;background:${COMP[x.c].c}"></i></div><span class="lbl tnum">${f2(x.contrib)}</span></span><span></span></div>`;
  const table = `<div class="tbl-wrap"><table><thead><tr><th>Вузол</th><th>Рівень</th><th>Вага, %</th><th>Значення</th><th>Внесок, пункти</th><th>Джерело</th></tr></thead><tbody>
    <tr><td><b>Індекс доброчесності</b></td><td>1</td><td class="tnum">100</td><td class="tnum">${fb(sum)}</td><td class="tnum">${f2(T.reduce((a, c) => a + c.contrib, 0))}</td><td></td></tr>
    ${T.map(c => `<tr><td><b>${COMP[c.id].n}</b>${c.lim ? " " + pill("Обмежувач", "p-warn nodot") : ""}</td><td>2</td><td class="tnum">33,3</td><td class="tnum">${fb(c.val)}</td><td class="tnum">${f2(c.contrib)}</td><td></td></tr>${c.items.map(x => `<tr><td style="padding-left:28px">${esc(x.t)}</td><td>3</td><td class="tnum">${x.w}</td><td class="tnum">${fb(x.vv)}</td><td class="tnum">${f2(x.contrib)}</td><td>${x.src ? SRC[x.src][0] : "Факти"}</td></tr>`).join("")}`).join("")}
  </tbody></table></div>`;
  return `${backToInst()}
  <section class="c12 rise toolbar"><div class="sp"></div>
    <button class="btn btn-ghost" onclick="openHow()">${IC.help}Як це рахується</button>
    <div class="seg" role="group" aria-label="Що показувати">${Object.entries(MODES).map(([k, n]) => `<button class="${mode === k ? "on" : ""}" aria-pressed="${mode === k}" onclick="S.mode='${k}';persist();render(true)">${n}</button>`).join("")}</div>
    <button class="btn btn-ghost" onclick="S.exTable=!S.exTable;render(true)">${S.exTable ? IC.tree + "Показати як дерево" : IC.table + "Показати як таблицю"}</button></section>
  ${mode !== "credited" ? `<div class="c12 note-box rise" style="flex-direction:row;align-items:center;gap:10px">${IC.info}<span>Режим «${MODES[mode]}»: значення без обмежувача, тому верхній рядок (${f1(sum)}) не дорівнює індексу ${f1(m.index)}. До індексу йдуть зараховані значення.</span></div>` : ""}
  <section class="card c12 rise">
    ${S.exTable ? table : `<div class="tree-cols lbl"><span>Складова</span><span class="hm"></span><span>Значення</span><span class="hm">Внесок в індекс, пункти</span><span></span></div>
    ${mode === "credited" && T.some(c => c.lim) ? `<div class="lim-callout" role="note"><span class="lim-ic">${IC.alert}</span><div><b>Результат знижено обмежувачем</b>${T.filter(c => c.lim).map(c => `<div><b>${COMP[c.id].n}:</b> ${c.cr.reason}</div>`).join("")}</div></div>` : ""}
    <div class="tree-root"><span><b>Індекс доброчесності</b><span class="lbl" style="display:block;font-size:12.5px">Середнє трьох компонентів: кожен дає третину індексу</span></span><span class="hm"></span><b class="tnum">${fb(sum)}</b><span class="lbl tnum hm">${f2(T.reduce((a, c) => a + c.contrib, 0))}</span><span></span></div>
    ${T.map((c, ci) => `<div class="tree-c ${S.open[c.id] ? "open" : ""} ${hl === c.id ? "hl" : ""}" id="n-${c.id}">
      <button class="tree-head" onclick="S.open['${c.id}']=!S.open['${c.id}'];this.parentNode.classList.toggle('open')" aria-expanded="${!!S.open[c.id]}">
        <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="comp-ic" style="background:${COMP[c.id].s};color:${COMP[c.id].c}">${IC[COMP[c.id].ic]}</span><span><b>${COMP[c.id].n}</b>${mode === "credited" ? `<span class="pf-sub tnum"><span>Сприйняття ${fb(c.P)}</span><span>Факти ${fb(c.F)}</span></span>` : ""}</span>${c.lim ? pill("Обмежувач", "p-warn") : ""}</span>
        <span class="hm"></span><b class="tnum">${fb(c.val)}</b>
        <span class="hm"><div class="contrib"><i style="width:${c.contrib / 34 * 100}%;background:${COMP[c.id].c};animation-delay:${ci * 120}ms"></i></div><span class="lbl tnum">${f2(c.contrib)}</span></span>
        <span class="chev">${IC.chev}</span></button>
      <div class="tree-body"><div class="tree-row lbl hdr"><span>${mode === "facts" ? "Показник" : "Питання"}</span><span class="hm">Вага</span><span>Значення</span><span class="hm">Внесок</span><span></span></div>${c.items.map(row).join("")}</div>
    </div>`).join("")}`}
  </section>`;
};
V.explain.after = () => { if (S.focus) { const el = document.getElementById("n-" + S.focus); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 200); S.focus = null; } };

function openItem(id) {
  const m = cur(), x = allItems(m).find(i => i.id === id); if (!x) return;
  const c = m.byId[x.c], isP = x.kind === "p", q = isP && x.id !== "sy-p3" ? SURVEY_Q.find(q => q.si === COMPS.indexOf(x.c) && q.qi === (+x.id.slice(-1) - 1)) : null;
  openDrawer(isP ? "Питання анкети" : "Показник фактів", `
    <div><div class="lbl">${COMP[x.c].n} · ${isP ? SRC[x.src][0] : "Факти"}</div><div style="font-size:16px;font-weight:600;margin-top:4px">${esc(x.t)}</div></div>
    <div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr)"><div><small>Значення</small><b>${fb(x.v)}</b></div><div><small>Вага в компоненті</small><b>${x.w} %</b></div><div><small>Внесок в індекс</small><b>${f2(x.v * (c.cr.v / (isP ? c.P : c.F) || 1) / 3 * x.w / 100)}</b></div></div>
    <div><div class="lbl" style="margin-bottom:4px">Звідки число</div><div style="line-height:1.55">${isP ? `${SRC_HINT[x.src]} Відповіді переводяться в бали: варіант 1 це 0, варіант 5 це 100.` : x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}, тобто ${fb(x.v)} %. Джерело: ${x.from}.` : `Рівень ${x.val} з 5 за анкетою чек-листа. Рівень переводиться в бали: (рівень − 1) × 25 = ${fb(x.v)}. Джерело: ${x.from}.`}</div></div>
    ${q ? `<div><div class="lbl" style="margin-bottom:6px">Відповідне питання в анкеті особового складу</div><div style="font-weight:500;margin-bottom:6px">${esc(q.t)}</div><ol class="howto">${q.o.map(o => `<li>${esc(o)}</li>`).join("")}</ol></div>` : ""}
    <div><div class="lbl" style="margin-bottom:4px">Як іде в індекс</div><div style="line-height:1.55">Компонент «${COMP[x.c].n}»: ${isP ? `сприйняття ${fb(c.P)}` : `факти ${fb(c.F)}`} це зважене середнє ${isP ? "питань" : "показників"}. Зараховано ${fb(c.cr.v)}${c.cr.lim ? " з обмеженням: " + c.cr.reason : "."} Індекс це середнє трьох компонентів.</div></div>`);
}

/* Динаміка */
V.trends = () => {
  const m = cur(), sr = m.series, t = S.trend, from = Math.min(t.from, t.to), to = Math.max(t.from, t.to), rows = sr.slice(from, to + 1);
  const a = sr[Math.min(S.cmp.a, sr.length - 1)], b = sr[Math.min(S.cmp.b, sr.length - 1)];
  const evs = m.events.filter(e => rows.slice(0, -1).some(r => r.cycle === e.after));
  const d = r1(rows[rows.length - 1].index - rows[0].index);
  const cmpRows = [["Індекс доброчесності", a.index, b.index], ...COMPS.map(c => [COMP[c].n, a.cr[c], b.cr[c]])];
  const pos = COMPS.filter(c => b.cr[c] > a.cr[c]), neg = COMPS.filter(c => b.cr[c] < a.cr[c]);
  const opt = (sel, lim) => sr.map((r, i) => `<option value="${i}" ${i === sel ? "selected" : ""} ${lim && !lim(i) ? "disabled" : ""}>${r.cycle}</option>`).join("");
  return `${backToInst()}
  <section class="card c12 rise">${trendCard(m, "trend")}</section>
  <section class="card c7 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Порівняти два цикли</h2><div class="sp"></div>
      <label class="lbl">Було <select class="inp" onchange="S.cmp.a=+this.value;persist();render(true)">${opt(S.cmp.a)}</select></label>
      <label class="lbl">Стало <select class="inp" onchange="S.cmp.b=+this.value;persist();render(true)">${opt(S.cmp.b)}</select></label></div>
    ${a === b ? `<div class="empty">Оберіть два різні цикли, щоб побачити, що змінилося.</div>` : `<div class="tbl-wrap"><table><thead><tr><th>Показник</th><th>Було</th><th>Стало</th><th>Зміна</th></tr></thead><tbody>${cmpRows.map(([n, x, y]) => `<tr><td><b>${n}</b></td><td class="tnum">${fb(x)}</td><td class="tnum">${fb(y)}</td><td>${deltaHTML(r1(y - x))}</td></tr>`).join("")}</tbody></table></div>`}
  </section>
  <section class="card c5 rise">
    <div class="card-h"><h2>Висновок за весь період</h2></div>
    ${(() => { const f = sr[0], l = sr[sr.length - 1], p = COMPS.filter(c => l.cr[c] > f.cr[c]), n = COMPS.filter(c => l.cr[c] < f.cr[c]); return `<div class="rows">
      <div class="row" style="align-items:center"><span class="comp-ic" style="background:var(--teal-soft);color:var(--teal-deep);width:28px;height:28px">${IC.up}</span><div class="grow">${p.length ? `Позитивна динаміка: ${p.map(c => `${COMP[c].n} (${pts(l.cr[c] - f.cr[c])})`).join(", ")}.` : "Позитивної динаміки за період немає."}</div></div>
      <div class="row" style="align-items:center"><span class="comp-ic" style="background:${n.length ? "var(--red-soft)" : "var(--soft)"};color:${n.length ? "var(--red)" : "var(--muted)"};width:28px;height:28px">${n.length ? IC.down : IC.flat}</span><div class="grow">${n.length ? `Потребує уваги: ${n.map(c => `${COMP[c].n} (−${pts(f.cr[c] - l.cr[c])})`).join(", ")}.` : "Негативної динаміки за компонентами немає."}</div></div>
      ${m.events.map(e => `<div class="row"><span class="ev-ic ev-c">${IC.diamond}</span><div class="grow"><div class="t">${e.t}</div><div class="s">Після циклу ${e.after}</div></div></div>`).join("")}</div>`; })()}
  </section>`;
};
V.trends.after = () => drawTrend("trend", cur());

/* Рекомендації */
V.recs = () => {
  const all = buildRecs(), f = S.recF, list = all.filter(r => (f.st === "all" || r.st === f.st) && (f.c === "all" || r.c === f.c));
  return `
  <section class="c12 rise toolbar"><span class="lbl">Рекомендація це пропозиція системи, рішення приймає керівник.</span><div class="sp"></div>
    <select class="inp" aria-label="Статус" onchange="S.recF.st=this.value;persist();render(true)"><option value="all">Усі статуси</option>${Object.entries(REC_ST).map(([k, [n]]) => `<option value="${k}" ${f.st === k ? "selected" : ""}>${n}</option>`).join("")}</select>
    <select class="inp" aria-label="Компонент" onchange="S.recF.c=this.value;persist();render(true)"><option value="all">Усі компоненти</option>${COMPS.map(c => `<option value="${c}" ${f.c === c ? "selected" : ""}>${COMP[c].n}</option>`).join("")}</select>
    <span class="lbl tnum">Показано ${list.length} з ${all.length}</span></section>
  <div class="c12 recs">${list.length ? list.map((r, i) => `<article class="rec card rise" style="animation-delay:${i * 60}ms" id="${r.id}">
    <span class="pri" style="background:${PRI[r.pri][1]};color:${PRI[r.pri][2]}" data-tip="Пріоритет: ${PRI[r.pri][0].toLowerCase()}">${IC[r.pri === "high" ? "alert" : "flag"]}</span>
    <div style="min-width:0">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${pill("Пріоритет: " + PRI[r.pri][0].toLowerCase(), "nodot " + (r.pri === "high" ? "p-bad" : "p-mute"))}${pill(COMP[r.c].n, "p-mute nodot")}${pill(REC_ST[r.st][0], REC_ST[r.st][1])}</div>
      <h3>${r.t}</h3>
      <div class="lbl" style="margin:10px 0 4px">Чому система це пропонує</div><div>${r.why}</div>
      <div class="lbl" style="margin:12px 0 4px">На підставі</div>
      <div class="ev">${r.evidence.map(e => `<a href="#explain/${e.id}" class="ev-i"${e.q ? ` onclick="event.preventDefault();openApiQ('${e.q}')"` : ""}><span>${e.item ? "" : `<span class="ev-flag">${IC.alert}</span>`}${esc(e.t)}: <b>${e.v}</b></span><span class="lbl">${e.q ? "Відкрити питання" : "Відкрити в розкладі"} ${IC.arrowR}</span></a>`).join("")}</div>
      <details class="acts"><summary>Запропоновані дії (${r.acts.length})</summary><ol>${r.acts.map(a => `<li>${a}</li>`).join("")}</ol></details>
      ${r.note.reason ? `<div class="note-box" style="margin-top:10px"><b>Причина відхилення</b><span>${esc(r.note.reason)}</span></div>` : ""}
      ${r.note.comment ? `<div class="note-box" style="margin-top:10px"><b>Коментар до уточнення</b><span>${esc(r.note.comment)}</span></div>` : ""}
    </div>
    <div class="rec-actions">${r.st === "accepted" ? `<a class="btn btn-soft" href="#tracker">${IC.target}Подивитися захід у трекері</a>` : REC_NEXT[r.st].map(n => n === "accepted" ? `<button class="btn btn-primary" onclick="acceptRec('${r.id}')">${IC.ok}Прийняти</button>` : n === "clarified" ? `<button class="btn btn-soft" onclick="noteRec('${r.id}','clarified')">Уточнити</button>` : `<button class="btn btn-ghost" onclick="noteRec('${r.id}','rejected')">Відхилити</button>`).join("")}</div>
  </article>`).join("") : `<section class="card"><div class="empty"><b>За цими фільтрами рекомендацій немає</b><br>Змініть статус або компонент. Нові рекомендації зʼявляються після кожного циклу оцінювання.</div></section>`}</div>`;
};
function acceptRec(id) {
  const r = buildRecs().find(x => x.id === id); if (!r) return;
  openDrawer("Прийняти рекомендацію", `
    <div><div class="lbl">${COMP[r.c].n}</div><div style="font-size:16px;font-weight:600;margin-top:4px">${r.t}</div></div>
    <div class="field"><label for="f-who">Відповідальна посада</label><select id="f-who" class="inp">${POSITIONS.map(w => `<option>${w}</option>`).join("")}</select></div>
    <div class="field"><label for="f-due">Строк виконання</label>${datePicker("f-due", "2027-02-28", TODAY)}<span class="err lbl" id="f-err"></span></div>
    <div class="note-box"><span class="lbl">Після прийняття в трекері зʼявиться захід із цією посадою й строком. Посаду і строк можна буде уточнити пізніше.</span></div>
    <div style="display:flex;gap:8px"><button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeDrawer()">Скасувати</button><button class="btn btn-primary" id="f-ok" style="flex:2;justify-content:center">${IC.ok}Прийняти й створити захід</button></div>`, b => {
    b.querySelector("#f-ok").onclick = () => {
      const due = b.querySelector("#f-due").dataset.val;
      if (!due || due < TODAY) { b.querySelector("#f-err").textContent = "Оберіть строк не раніше за сьогодні."; return; }
      if (API.on) { b.querySelector("#f-ok").disabled = true; apiDecide(id, "accepted", "", { owner: b.querySelector("#f-who").value, due_date: due }).then(() => { closeDrawer(); toast(`Рекомендацію прийнято. Захід «${r.t}» додано до трекера.`); }, e => { b.querySelector("#f-err").textContent = apiErrText(e); b.querySelector("#f-ok").disabled = false; }); return; }
      const mid = "m-" + (BASE_MEASURES.length + S.dec.added.length + 1);
      S.dec.rec[id] = { status: "accepted" };
      S.dec.added.push({ id: mid, recId: id, rec: r.t, t: r.t, who: b.querySelector("#f-who").value, due, st: "accepted", ind: r.items[0] });
      addLog(me(), `Рекомендацію «${r.t}» прийнято, створено захід ${mid}`); persist(); closeDrawer(); render(true);
      toast(`Рекомендацію прийнято. Захід «${r.t}» додано до трекера.`);
    };
  });
}
function noteRec(id, kind) {
  const r = buildRecs().find(x => x.id === id); if (!r) return; const rej = kind === "rejected";
  openDrawer(rej ? "Відхилити рекомендацію" : "Уточнити рекомендацію", `
    <div style="font-weight:600">${r.t}</div>
    <div class="field"><label for="f-why">${rej ? "Причина відхилення" : "Короткий коментар"}</label><textarea class="inp" id="f-why" rows="4" style="resize:vertical"></textarea><span class="lbl" id="f-err">${rej ? "Причина обов’язкова: вона допоможе наступним оцінюванням." : "Що потрібно уточнити, перш ніж ухвалити рішення."}</span></div>
    <div style="display:flex;gap:8px"><button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeDrawer()">Скасувати</button><button class="btn ${rej ? "btn-danger" : "btn-primary"}" id="f-ok" style="flex:2;justify-content:center">${rej ? "Відхилити" : "Надіслати уточнення"}</button></div>`, b => {
    b.querySelector("#f-ok").onclick = () => {
      const t = b.querySelector("#f-why").value.trim();
      if (!t) { const e = b.querySelector("#f-err"); e.textContent = rej ? "Вкажіть причину відхилення." : "Напишіть, що саме потрібно уточнити."; e.style.color = "var(--red)"; b.querySelector("#f-why").focus(); return; }
      if (API.on) { apiDecide(id, rej ? "rejected" : "clarify", t).then(() => { closeDrawer(); toast(rej ? "Рекомендацію відхилено. Причину збережено." : "Рекомендацію позначено як «Уточнено». Коментар збережено."); }, e => { const er = b.querySelector("#f-err"); er.textContent = apiErrText(e); er.style.color = "var(--red)"; }); return; }
      S.dec.rec[id] = rej ? { status: "rejected", reason: t } : { status: "clarified", comment: t };
      addLog(me(), `Рекомендацію «${r.t}» ${rej ? "відхилено" : "позначено «Уточнено»"}: ${t}`); persist(); closeDrawer(); render(true);
      toast(rej ? "Рекомендацію відхилено. Причину збережено." : "Рекомендацію позначено як «Уточнено». Коментар збережено.");
    };
  });
}

/* Трекер */
V.tracker = () => {
  const all = measures(), f = S.trF, edit = S.role === "leader";
  const list = all.filter(x => (f.st === "all" || dispSt(x) === f.st || (f.st === "overdue" && overdueDays(x) > 0)) && (f.who === "all" || x.who === f.who));
  const od = all.filter(x => overdueDays(x) > 0).length;
  const stCell = x => pill(M_ST[x.st][0], M_ST[x.st][1]);
  const actCell = x => x.st === "confirmed" ? `<span class="lbl">Змінює наступне оцінювання</span>` : edit ? `<div class="mv">${M_NEXT[x.st].map(s => `<button class="btn btn-ghost" onclick="setMSt('${x.id}','${s}')">${IC.arrowR}${M_ST[s][0]}</button>`).join("")}</div>` : `<span class="lbl">—</span>`;
  const board = ["accepted", "inprogress", "done", "confirmed", "notconfirmed", ...(list.some(x => x.st === "cancelled") ? ["cancelled"] : [])].map(st => { const cards = list.filter(x => x.st === st); return `<div class="col-b" data-st="${st}"><div class="col-h">${pill(M_ST[st][0], M_ST[st][1])}<span class="lbl tnum">${cards.length}</span></div>${cards.map(x => `<div class="b-card tr-click" tabindex="0" ${edit && M_NEXT[x.st].length ? `draggable="true" data-id="${x.id}" data-st="${x.st}"` : ""} onclick="if(!event.target.closest('button'))openMeasure('${x.id}')"><b>${x.t}</b><span class="lbl">${x.who}</span><div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><span class="lbl tnum" ${overdueDays(x) ? 'style="color:var(--red);font-weight:600"' : ""}>Строк: ${ua(x.due)}</span>${overdueDays(x) ? pill(`+${overdueDays(x)} ${daysWord(overdueDays(x))}`, "p-bad nodot") : ""}</div>${edit && M_NEXT[x.st].length ? `<div class="seg sm">${M_NEXT[x.st].map(s => `<button onclick="setMSt('${x.id}','${s}')">${IC.arrowR}${M_ST[s][0]}</button>`).join("")}</div>` : ""}</div>`).join("") || `<div class="lbl" style="padding:8px">Порожньо</div>`}</div>`; }).join("");
  const conf = all.filter(x => x.st === "confirmed").length, chk = all.filter(x => x.st === "done" && x.vf && x.vf[1] === "p-warn").length, wait = all.filter(x => x.st === "done").length - chk, rev = all.filter(x => x.st === "notconfirmed").length;
  return `
  <section class="c12 rise toolbar"><div class="sp"></div>
    <div class="seg" role="group" aria-label="Вигляд">${[["table", "Таблиця", "table"], ["board", "Дошка", "board"]].map(([k, n, ic]) => `<button class="${S.trackView === k ? "on" : ""}" onclick="S.trackView='${k}';persist();render(true)">${n}</button>`).join("")}</div>
    <select class="inp" aria-label="Статус" onchange="S.trF.st=this.value;persist();render(true)"><option value="all">Усі статуси</option>${Object.entries(M_ST).map(([k, [n]]) => `<option value="${k}" ${f.st === k ? "selected" : ""}>${n}</option>`).join("")}</select>
    <select class="inp" aria-label="Відповідальна посада" onchange="S.trF.who=this.value;persist();render(true)"><option value="all">Усі посади</option>${[...new Set(all.map(x => x.who))].sort().map(w => `<option ${f.who === w ? "selected" : ""}>${w}</option>`).join("")}</select>
    <span class="lbl tnum">Показано ${list.length} з ${all.length}</span></section>
  ${!list.length ? `<section class="card c12"><div class="empty"><b>За цими фільтрами заходів немає</b><br>Змініть статус або посаду. Нові заходи зʼявляються, коли керівник приймає рекомендацію.<br><br>${can("recs") ? `<a class="btn btn-soft" href="#recs">Перейти до рекомендацій</a>` : ""}</div></section>` : S.trackView === "board" ? `<section class="c12 board rise">${board}</section>` : `
  <section class="card c12 rise"><div class="tbl-wrap"><table><thead><tr><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Статус</th><th>Верифікація</th><th>Змінити статус</th></tr></thead><tbody>
    ${list.map(x => `<tr class="tr-click" tabindex="0" onclick="if(!event.target.closest('button'))openMeasure('${x.id}')" onkeydown="if(event.key==='Enter'&&!event.target.closest('button'))openMeasure('${x.id}')"><td style="min-width:220px"><b style="font-weight:600">${x.t}</b><div class="lbl">З рекомендації: ${x.rec}</div></td><td style="min-width:160px">${x.who}</td><td class="tnum" style="white-space:nowrap">${overdueDays(x) ? `<span style="color:var(--red);font-weight:600">${ua(x.due)}</span><div class="lbl" style="color:var(--red)">прострочено на ${overdueDays(x)} ${daysWord(overdueDays(x))}</div>` : ua(x.due)}</td><td>${stCell(x)}</td><td>${pill(verif(x)[0], verif(x)[1] + " nodot")}</td><td>${actCell(x)}</td></tr>`).join("")}
  </tbody></table></div></section>`}
  <section class="card c12 rise vf">
    <h2>Верифікація наступним оцінюванням</h2><button type="button" class="kt-info" aria-label="Як працює верифікація" data-tip="Чи спрацював виконаний захід, видно після наступного циклу: якщо повʼязаний показник зріс, захід підтверджено.">${IC.info}</button>
    <div class="sp"></div>
    <div class="vf-s tnum"><span><b>${conf}</b>Підтверджено</span><span><b>${wait}</b>Очікують оцінювання</span>${chk ? `<span><b>${chk}</b>Перевірити дані</span>` : ""}<span><b>${rev}</b>Потребують перегляду</span></div>
  </section>`;
};
// Захід: подробиці й перехід у систему звітування суміжної команди
const MEASURES_APP = { name: "Система звітування за заходами (суміжна команда)", url: "" };
function openMeasure(id) {
  const x = measures().find(m => m.id === id); if (!x) return;
  const m = cur(), it = allItems(m).find(i => i.id === x.ind), d = overdueDays(x), hist = logItems().filter(l => l.a.includes(x.t) || l.a.includes(x.id)).reverse();
  openDrawer("Захід", `
    <div><div class="lbl">З рекомендації: ${esc(x.rec)}</div><div style="font-size:16px;font-weight:600;margin-top:4px">${esc(x.t)}</div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${pill(M_ST[x.st][0], M_ST[x.st][1])}${d ? pill(`Прострочено на ${d} ${daysWord(d)}`, "p-bad") : ""}${pill(verif(x)[0], verif(x)[1] + " nodot")}</div>
    <dl class="inst-kv" style="grid-template-columns:auto 1fr"><dt>Відповідальна посада</dt><dd>${esc(x.who)}</dd><dt>Строк</dt><dd class="tnum">${ua(x.due)}</dd>${it ? `<dt>Повʼязаний показник</dt><dd><a class="link" href="#explain/${it.id}" onclick="closeDrawer()">${esc(it.t)}: ${fb(it.v)}</a></dd>` : ""}</dl>
    <div><div class="lbl" style="margin-bottom:6px">Історія в журналі</div>${hist.length ? `<div class="rows">${hist.map(l => `<div class="row"><div class="grow"><div class="t" style="font-size:13px">${esc(l.a)}</div><div class="s">${esc(l.who)} · ${l.t}</div></div></div>`).join("")}</div>` : `<div class="lbl">Змін статусу в цьому циклі ще не було.</div>`}</div>
    <div class="note-box"><b>Звіт виконавця</b><span class="lbl">Документи й звіти про виконання ведуться в окремому застосунку суміжної команди.</span>
      ${MEASURES_APP.url ? `<a class="btn btn-soft" href="${MEASURES_APP.url}" target="_blank" rel="noopener" style="justify-content:center">${IC.arrowR}Відкрити в застосунку звітування</a>` : `<button class="btn btn-soft" disabled style="justify-content:center;opacity:.6">${IC.arrowR}Відкрити в застосунку звітування</button><span class="lbl" style="font-size:12px">Посилання зʼявиться після погодження інтеграції.</span>`}</div>`);
}
function setMSt(id, st) { if (API.on) return apiSetMSt(id, st); const x = measures().find(m => m.id === id); if (!x || !M_NEXT[x.st].includes(st)) return; S.dec.mst[id] = st; addLog(me(), `Захід «${x.t}»: статус «${M_ST[st][0]}»`); persist(); render(true); toast(`Статус заходу змінено на «${M_ST[st][0]}».`); }

/* Джерела */
const SOURCES = [
  ["Результати анкет", "Модуль анонімних опитувань платформи", "auto", "Оновлюється після кожної відповіді", "Відповіді респондентів агрегуються автоматично. Окремі відповіді не показуються."],
  ["Чек-лист", "Чек-лист закладу", "manual", "Внесено 10.11.2026", "Один працівник вносить дані, інший підтверджує їх. Кожен пункт має джерело й дату."],
  ["Декларації подані вчасно", "Відкрита база декларацій", "planned", "Немає даних: інтеграцію ще не підключено", "Поки значення вносять вручну в чек-лист. Автоматичне отримання планується."],
  ["Конфлікти інтересів", "Рішення з попереднього хакатону", "approval", "Немає даних: потрібне погодження власника рішення", "Рішення може підказувати випадки для перевірки. Використання потребує погодження."],
  ["Закупівлі", "Інший проєкт команди з оцінки закупівель", "planned", "Немає даних: інтеграцію ще не підключено", "Результати оцінки закупівель можуть стати фактами для компонента Підзвітність."],
  ["Скарги й звернення", "Журнал звернень закладу", "manual", "Внесено 12.11.2026", "Кількість звернень і розглянутих у строк вносить уповноважений."],
  ["Звітування за заходами", "Система суміжної команди", "approval", "Немає даних: інтеграцію ще не погоджено", "Автоматичне оновлення статусів заходів планується. Поки статуси змінюють вручну в трекері."],
];
const MODE = { auto: ["Автоматично", "p-good"], manual: ["Ручний ввід", "p-info"], planned: ["Планується", "p-mute"], approval: ["Потребує погодження", "p-warn"] };
const INTEG = [
  ["Модуль опитувань", "auto", "Зібрати сприйняття працівників без ідентифікації", "Одноразові коди доступу, агрегація на сервері", "survey"],
  ["Чек-лист закладу", "manual", "Підтвердити сприйняття фактами", "Ручний ввід і підтвердження другою особою", "check"],
  ["Відкрита база декларацій", "planned", "Перевіряти вчасність подання декларацій", "Отримання відкритих даних за розкладом", "file"],
  ["Рішення з попереднього хакатону", "approval", "Підказувати випадки конфліктів інтересів для перевірки", "Передача знеособлених результатів", "scale"],
  ["Проєкт оцінки закупівель", "planned", "Додати факти про закупівлі до Підзвітності", "Обмін агрегованими показниками", "layers"],
  ["Система суміжної команди", "approval", "Отримувати звіти про виконання заходів", "Обмін статусами заходів", "target"],
];
// Дошка: перетягування картки в дозволений стовпець (ті самі переходи, що й кнопки на картці)
V.tracker.after = () => {
  const board = document.querySelector(".board"); if (!board) return;
  let drag = null;
  const clear = () => { drag = null; board.classList.remove("dnd"); board.querySelectorAll(".dragging,.can-drop,.drop-over").forEach(x => x.classList.remove("dragging", "can-drop", "drop-over")); };
  board.ondragstart = e => {
    const c = e.target.closest(".b-card[draggable]"); if (!c) return;
    drag = { id: c.dataset.id, st: c.dataset.st }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", drag.id);
    c.classList.add("dragging"); board.classList.add("dnd");
    board.querySelectorAll(".col-b").forEach(col => col.classList.toggle("can-drop", (M_NEXT[drag.st] || []).includes(col.dataset.st)));
  };
  board.ondragend = clear;
  board.ondragover = e => {
    const col = e.target.closest(".col-b"); if (!drag || !col || !col.classList.contains("can-drop")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    board.querySelectorAll(".drop-over").forEach(x => x !== col && x.classList.remove("drop-over")); col.classList.add("drop-over");
  };
  board.ondrop = e => { const col = e.target.closest(".col-b"); if (!drag || !col || !col.classList.contains("can-drop")) return; e.preventDefault(); const id = drag.id; clear(); setMSt(id, col.dataset.st); };
};

V.sources = () => `
  <section class="card c12 rise"><div class="card-h"><h2>Джерела даних за метриками</h2><div class="sp"></div><span class="lbl">Клацніть на рядок, щоб переглянути дані</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Метрика</th><th>Джерело</th><th>Режим</th><th>Вік даних</th><th>Пояснення</th></tr></thead><tbody>
    ${SOURCES.map(([a, b, mo, age, ex], i) => `<tr class="tr-click" tabindex="0" onclick="openSource(${i})" onkeydown="if(event.key==='Enter')openSource(${i})"><td><b style="font-weight:600">${a}</b></td><td>${b}</td><td>${pill(MODE[mo][0], MODE[mo][1])}</td><td class="lbl" style="min-width:150px">${age}</td><td class="lbl" style="min-width:260px">${ex}</td></tr>`).join("")}
    </tbody></table></div></section>
  <section class="c12 rise"><div class="card-h" style="margin:6px 0 0"><h2>Карта інтеграцій</h2></div></section>
  ${INTEG.map(([n, mo, why, how, ic], i) => `<section class="card c4 rise integ ${mo}" role="button" tabindex="0" onclick="openSource(${[0, 1, 2, 3, 4, 6][i]})"><div class="comp-top"><span class="comp-ic" style="background:var(--soft)">${IC[ic]}</span><b>${n}</b><div class="sp" style="flex:1"></div>${pill(MODE[mo][0], MODE[mo][1])}</div>
    <div style="margin-top:12px"><span class="lbl">Навіщо</span><div>${why}</div></div><div style="margin-top:8px"><span class="lbl">Метод</span><div>${how}</div></div></section>`).join("")}`;

// Перегляд даних джерела (синтетичні записи)
const SRC_DATA = {
  decl: { n: 100, ok: 45, rows: [["Керівний склад", 12, 10], ["Науково-педагогічні працівники", 38, 19], ["Посадові особи служб забезпечення", 30, 11], ["Інші зобовʼязані особи", 20, 5]] },
  coi: [["КІ-2026-014", "Участь у комісії з відбору, де є родич", "Висновок у строк", "02.10.2026"], ["КІ-2026-015", "Сумісництво в компанії-постачальнику", "Висновок із запізненням", "05.10.2026"], ["КІ-2026-016", "Рецензування роботи підлеглого", "Висновок у строк", "11.10.2026"], ["КІ-2026-017", "Розподіл службового житла", "На розгляді", "20.10.2026"], ["КІ-2026-018", "Преміювання за поданням родича", "Висновок із запізненням", "27.10.2026"], ["КІ-2026-019", "Закупівля в компанії колишнього працівника", "На розгляді", "03.11.2026"]],
  proc: [["UA-2026-09-12-000341", "Продукти харчування", "1 учасник", "Високий"], ["UA-2026-09-30-001207", "Ремонт гуртожитку", "Зміни до договору після підписання", "Високий"], ["UA-2026-10-08-000519", "Навчальна література", "2 учасники", "Середній"], ["UA-2026-10-21-002144", "Паливо", "Ціна близька до очікуваної", "Низький"], ["UA-2026-11-02-000088", "Компʼютерна техніка", "Вимоги під одного постачальника", "Середній"]],
  comp: [["Освітній процес", 18, 13], ["Побутові питання", 14, 9], ["Дії посадових осіб", 12, 6], ["Фінансові питання", 9, 5], ["Інше", 7, 3]],
};
function openSource(i) {
  const [name, from, mo, age] = SOURCES[i], m = cur(), head = `<div><div class="lbl">${from}</div><div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">${pill(MODE[mo][0], MODE[mo][1])}<span class="lbl">${age}</span></div></div>`;
  const tbl = (hs, rows) => `<div class="tbl-wrap"><table><thead><tr>${hs.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const synth = `<div class="lbl">Записи синтетичні, для демонстрації. ${mo === "planned" || mo === "approval" ? "Після підключення інтеграції дані надходитимуть автоматично." : ""}</div>`;
  let body = "";
  if (i === 0) body = `<div class="lbl">Агреговані результати за питаннями. Окремих відповідей немає.</div>${tbl(["Питання", "Група", "Бал"], m.pItems.map(x => [esc(x.t), SRC[x.src][0].replace("Сприйняття ", ""), `<b class="tnum">${fb(x.v)}</b>`]))}<a class="link" href="#explain" onclick="closeDrawer()">Відкрити в розкладі індексу ${IC.arrowR}</a>`;
  else if (i === 1) body = `${tbl(["Показник", "Дані", "Ким внесено"], m.fItems.map(x => [esc(x.t), `<span class="tnum">${x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`}</span>`, (FACT_META[x.id] || ["10.11.2026", "Вносить дані чек-листа"]).join(", ") + ". Підтверджено"]))}`;
  else if (i === 2) { const d = SRC_DATA.decl; body = `<div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr)"><div><small>Зобовʼязані</small><b>${d.n}</b></div><div><small>Подали вчасно</small><b>${d.ok}</b></div><div><small>Частка</small><b>${d.ok} %</b></div></div>${tbl(["Категорія", "Зобовʼязані", "Вчасно"], d.rows.map(r => [r[0], `<span class="tnum">${r[1]}</span>`, `<span class="tnum">${r[2]}</span>`]))}${synth}`; }
  else if (i === 3) body = `<div class="lbl">Повідомлення про потенційні конфлікти інтересів і висновки уповноваженого. Імена не показуються.</div>${tbl(["Номер", "Суть", "Статус", "Дата"], SRC_DATA.coi.map(r => [`<span class="tnum">${r[0]}</span>`, r[1], pill(r[2], r[2].includes("у строк") ? "p-good nodot" : r[2].includes("запізн") ? "p-bad nodot" : "p-mute nodot"), `<span class="tnum">${r[3]}</span>`]))}${synth}`;
  else if (i === 4) body = `<div class="lbl">Закупівлі закладу з ознаками ризику з проєкту оцінки закупівель.</div>${tbl(["Ідентифікатор", "Предмет", "Ознака", "Ризик"], SRC_DATA.proc.map(r => [`<span class="tnum" style="font-size:12px">${r[0]}</span>`, r[1], r[2], pill(r[3], r[3] === "Високий" ? "p-bad nodot" : r[3] === "Середній" ? "p-warn nodot" : "p-good nodot")]))}${synth}`;
  else if (i === 5) { const c = SRC_DATA.comp, t = c.reduce((a, r) => a + r[1], 0), ok = c.reduce((a, r) => a + r[2], 0); body = `<div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr)"><div><small>Звернень</small><b>${t}</b></div><div><small>Розглянуто в строк</small><b>${ok}</b></div><div><small>Частка</small><b>${Math.round(ok / t * 100)} %</b></div></div>${tbl(["Тема", "Звернень", "У строк"], c.map(r => [r[0], `<span class="tnum">${r[1]}</span>`, `<span class="tnum">${r[2]}</span>`]))}${synth}`; }
  else body = `<div class="lbl">Поки статуси заходів змінюють вручну.</div>${can("tracker") ? `<a class="btn btn-soft" href="#tracker" onclick="closeDrawer()">${IC.target}Відкрити трекер заходів</a>` : `<div class="lbl">Заходів за цикл: ${measures().length}.</div>`}`;
  openDrawer(name, head + body);
}

/* Заклади (спостерігач) */
const readGuide = title => `
  <details class="card c12 rise guide" ${S.guideOpen ? "open" : ""} ontoggle="S.guideOpen=this.open;persist()">
    <summary class="card-h"><h2>${title}</h2><div class="sp"></div><span class="lbl guide-hint"></span><span class="chev">${IC.chev}</span></summary>
    <div class="legend3">
      <div><h3>Індекс доброчесності</h3><p class="lbl">Число від 0 до 100: середнє трьох компонентів (Культура, Система, Підзвітність). Кожен компонент поєднує анкети персоналу й факти з документів. Чим вище, тим краще працює система доброчесності закладу. Оцінюється система, а не окремі люди.</p></div>
      <div><h3>Рівень зрілості</h3><p class="lbl" style="margin-bottom:8px">Рівень за Моделлю зрілості НАЗК, визначається за індексом.</p>
        <div class="rows">${LSHORT.map((n, i) => `<div class="row" style="align-items:flex-start;gap:10px">${lvPill(i + 1)}<div class="grow lbl" style="font-size:12.5px"><span class="tnum">${i === 0 ? "0" : fb(BOUNDS[i - 1])}–${i === 4 ? "100" : fb(BOUNDS[i])}.</span> ${LDESC[i]}</div></div>`).join("")}</div></div>
      <div><h3>Достовірність</h3><p class="lbl" style="margin-bottom:8px">Наскільки можна довіряти результату. Залежить від прапорців: автоматичних перевірок даних на розбіжності й підозрілі відповіді.</p>
        <div class="rows">${["A", "B", "C", "insufficient"].map(g => `<div class="row" style="align-items:flex-start;gap:10px">${trustPill(g)}<div class="grow lbl" style="font-size:12.5px">${TRUST[g][2]}</div></div>`).join("")}</div></div>
    </div>
  </details>`;

V.institutions = () => {
  const q = S.instQ.trim().toLowerCase(), arch = S.insts.archived;
  const all = INSTITUTIONS().filter(m => !q || m.name.toLowerCase().includes(q) || (m.edrpou || "").includes(q));
  const list = all.filter(m => S.instArch ? arch.includes(m.id) : !arch.includes(m.id)), nArch = INSTITUTIONS().filter(m => arch.includes(m.id)).length;
  const menu = m => `<button type="button" class="icon-btn inst-more" aria-label="Керування закладом" data-tip="Перейменувати або архівувати" onclick="event.preventDefault();event.stopPropagation();openInstMenu('${m.id}')">${IC.dots || "⋯"}</button>`;
  return `
  <section class="c12 rise toolbar"><label class="search inst-search"><span>${IC.search}</span><input id="instQ" placeholder="Назва або код ЄДРПОУ" value="${esc(S.instQ)}" oninput="S.instQ=this.value;render(true);const i=$('#instQ');i.focus();i.setSelectionRange(i.value.length,i.value.length)"></label>
    <div class="seg" role="group" aria-label="Які заклади"><button class="${S.instArch ? "" : "on"}" onclick="S.instArch=false;persist();render(true)">Активні</button><button class="${S.instArch ? "on" : ""}" onclick="S.instArch=true;persist();render(true)">Архів${nArch ? ` (${nArch})` : ""}</button></div>
    <div class="sp"></div><button class="btn btn-primary" onclick="openAddInst()">${IC.plus || "+"}Додати заклад</button></section>
  ${list.length ? list.map(m => m.empty ? `<section class="card c6 rise inst"><div class="comp-top"><span class="comp-ic" style="background:var(--soft)">${IC.building}</span><b>${esc(m.name)}</b><div class="sp" style="flex:1"></div>${menu(m)}</div>
    <div class="lbl tnum" style="margin-top:6px">ЄДРПОУ ${m.edrpou}</div>
    <div class="note-box" style="margin-top:14px"><b>Оцінювання ще не проводилось</b><span class="lbl">Уповноважений закладу відкриє цикл і видасть жетони. Після першого циклу тут зʼявиться індекс.</span></div></section>`
  : `<a class="card c6 rise inst" href="#overview" onclick="S.inst='${m.id}';addLog(me(),'Переглянуто огляд закладу ${m.edrpou}');persist()">
    <div class="comp-top"><span class="comp-ic" style="background:var(--lime-soft);color:var(--teal-deep)">${IC.building}</span><b>${esc(m.name)}</b><div class="sp" style="flex:1"></div>${menu(m)}</div>
    <div class="lbl tnum" style="margin-top:6px">ЄДРПОУ ${m.edrpou}</div>
    <div class="inst-b"><div><span class="lbl">Індекс доброчесності</span><div class="mid tnum">${numHTML(m.index)}<span class="of">з 100</span></div></div>
      <dl class="inst-kv"><dt>Рівень зрілості</dt><dd>${lvPill(m.level)}</dd><dt>Достовірність</dt><dd>${trustPill(m.trust)}</dd></dl></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">${deltaHTML(m.delta, "до попереднього циклу")}<span class="link">Відкрити огляд ${IC.arrowR}</span></div>
  </a>`).join("") : `<section class="card c12"><div class="empty"><b>${q ? "Нічого не знайдено" : S.instArch ? "В архіві порожньо" : "Закладів немає"}</b><br>${q ? "Змініть запит або додайте заклад за кодом ЄДРПОУ." : ""}</div></section>`}
  ${readGuide("Як читати картки")}`;
};
function openInstMenu(id) {
  const m = INSTITUTIONS().find(x => x.id === id); if (!m) return; const ar = S.insts.archived.includes(id);
  openDrawer("Керування закладом", `
    <div><div class="lbl tnum">ЄДРПОУ ${m.edrpou}</div><div style="font-weight:600;margin-top:4px">${esc(m.name)}</div></div>
    <div class="field"><label for="f-name">Назва в системі</label><input class="inp" id="f-name" value="${esc(m.name)}" maxlength="160"><span class="lbl" id="f-err">Офіційна назва береться з реєстру. Тут можна задати скорочену.</span></div>
    <button class="btn btn-primary" id="f-ok" style="justify-content:center">${IC.ok}Зберегти назву</button>
    <div class="note-box"><b>${ar ? "Повернути з архіву" : "Архівувати"}</b><span class="lbl">${ar ? "Заклад знову зʼявиться в списку активних." : "Заклад зникне зі списку активних. Дані й історія циклів зберігаються, їх можна повернути."}</span>
      <button class="btn btn-ghost" id="f-arch" style="justify-content:center">${ar ? "Повернути з архіву" : "Перенести в архів"}</button></div>`, b => {
    b.querySelector("#f-ok").onclick = () => { const v = b.querySelector("#f-name").value.trim(); if (!v) { const e = b.querySelector("#f-err"); e.textContent = "Назва не може бути порожньою."; e.style.color = "var(--red)"; return; } S.insts.renamed[id] = v; addLog(me(), `Заклад ${m.edrpou}: назву змінено на «${v}»`); persist(); closeDrawer(); render(true); toast("Назву збережено"); };
    b.querySelector("#f-arch").onclick = () => { S.insts.archived = ar ? S.insts.archived.filter(x => x !== id) : [...S.insts.archived, id]; addLog(me(), `Заклад ${m.edrpou}: ${ar ? "повернуто з архіву" : "перенесено в архів"}`); persist(); closeDrawer(); render(true); toast(ar ? "Заклад повернуто з архіву" : "Заклад перенесено в архів"); };
  });
}
function openAddInst() {
  const have = new Set(INSTITUTIONS().map(m => m.edrpou));
  const results = q => { q = q.trim().toLowerCase(); return REGISTRY.filter(([c, n]) => !q || c.includes(q) || n.toLowerCase().includes(q)); };
  const draw = (b, q) => { b.querySelector("#reg").innerHTML = results(q).map(([c, n]) => `<label class="row reg-row"><input type="checkbox" value="${c}" ${have.has(c) ? "disabled checked" : ""}><div class="grow"><div class="t">${n}</div><div class="s tnum">ЄДРПОУ ${c}</div></div>${have.has(c) ? pill("Вже в системі", "p-mute nodot") : ""}</label>`).join("") || `<div class="lbl">У реєстрі нічого не знайдено.</div>`; };
  openDrawer("Додати заклад", `
    <div class="field"><label for="f-q">Пошук у реєстрі</label><input class="inp" id="f-q" placeholder="Код ЄДРПОУ (8 цифр) або частина назви" inputmode="search"></div>
    <div class="rows" id="reg"></div>
    <button class="btn btn-primary" id="f-add" style="justify-content:center">${IC.ok}Додати вибрані</button>
    <div class="note-box"><span class="lbl">Демо використовує синтетичний реєстр. У робочій версії пошук іде через бекенд у Єдиний державний реєстр (відкриті дані Мінʼюсту): назва й статус підтягуються автоматично, вручну нічого вводити не треба. Можна завантажити одразу всі заклади зі списку Міністерства оборони або файлом CSV з кодами.</span></div>`, b => {
    const inp = b.querySelector("#f-q"); draw(b, ""); inp.oninput = () => draw(b, inp.value);
    b.querySelector("#f-add").onclick = () => {
      const picked = [...b.querySelectorAll("#reg input:checked:not(:disabled)")].map(i => i.value);
      if (!picked.length) return toast("Оберіть хоча б один заклад");
      picked.forEach(c => { const [, n] = REGISTRY.find(r => r[0] === c); S.insts.extra.push({ id: "e" + c, name: n, edrpou: c }); addLog(me(), `Додано заклад ${c} з реєстру`); });
      persist(); closeDrawer(); render(true); toast(`Додано закладів: ${picked.length}`);
    };
  });
}

/* Порівняння: сприйняття за групами проти фактів */
V.compare = () => {
  const m = cur(), srcAvg = (c, src) => { const a = m.pItems.filter(x => x.c === c && x.src === src); return a.length ? wmean(a) : null; };
  const pctFacts = m.fItems.filter(x => x.kind === "pct");
  const marks = [["wg", "Робоча група"], ["os", "Особовий склад"], ["experts", "Експерти"]];
  return `${backToInst()}
  <section class="card c12 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Сприйняття проти фактів</h2><button type="button" class="kt-info" aria-label="Як читати" data-tip="Точки показують середню оцінку кожної групи, риска це факти. Праворуч різниця «сприйняття мінус факти». Червоним позначено розрив понад ${CAP} пунктів: тоді вмикається обмежувач.">${IC.info}</button><div class="sp"></div><div class="legend">${marks.map(([s, n]) => `<span><i class="mk ${s}"></i>${n}</span>`).join("")}<span><i class="mk f"></i>Факти</span></div></div>
    ${m.components.map((c, i) => { const vals = marks.map(([s]) => [s, srcAvg(c.id, s)]).filter(([, v]) => v != null); const all = [...vals.map(x => x[1]), c.F]; const lo = Math.min(...all), hi = Math.max(...all), gap = r1(c.P - c.F);
      return `<div class="db" style="cursor:pointer" role="link" tabindex="0" aria-label="${COMP[c.id].n}: розклад індексу" onclick="location.hash='explain/${c.id}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='explain/${c.id}'}"><span class="t"><b>${COMP[c.id].n}</b><br><span class="lbl">Сприйняття ${fb(c.P)} · факти ${fb(c.F)}</span></span>
        <div class="track"><div class="gap ${gap > CAP ? "bad" : ""}" style="left:${lo}%;width:${hi - lo}%;animation-delay:${i * 80}ms"></div>
        ${vals.map(([s, v], j) => `<span class="m mk ${s}" style="left:${v}%;animation-delay:${200 + i * 80 + j * 60}ms" data-tip="${SRC[s][0]}: ${fb(v)}"></span>`).join("")}
        <span class="m mk f" style="left:${c.F}%;animation-delay:${400 + i * 80}ms" data-tip="Факти: ${fb(c.F)}"></span></div>
        <b class="tnum" style="text-align:right;color:${gap > CAP ? "var(--red)" : "var(--fg)"}" data-tip="Сприйняття мінус факти">${gap > 0 ? "+" : ""}${fb(gap)}</b></div>`; }).join("")}
    <div class="db-axis lbl tnum"><span></span><div><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><span></span></div>
  </section>
  <section class="card c5 rise cmp-radar">
    <div class="card-h" style="flex-wrap:wrap"><h2>Профіль компонентів</h2><div class="sp"></div><label class="lbl">Цикл ${CYCLE} порівняти з <select class="inp" onchange="S.cmpCycle=+this.value;persist();render(true)"><option value="-1">без порівняння</option>${m.series.slice(0, -1).map((r, i) => `<option value="${i}" ${S.cmpCycle === i ? "selected" : ""}>${r.cycle}</option>`).join("")}</select></label></div>
    <div class="chart" id="cmpRadar"></div>
    <div class="legend lg-lines" style="justify-content:center;margin-top:8px"><span data-tip="Що думають люди: середнє за анкетами"><i class="ln" style="border-color:var(--blue)"></i>Сприйняття</span><span data-tip="Що підтверджують документи й облік"><i class="ln dash" style="border-color:var(--fg)"></i>Факти</span><span data-tip="Що пішло в індекс: сприйняття, але не більше ніж факти + ${CAP}"><i class="ar" style="background:color-mix(in srgb,var(--teal) 30%,transparent);border-color:var(--teal)"></i>Зараховано ${CYCLE}</span>${S.cmpCycle >= 0 && m.series[S.cmpCycle] ? `<span><i class="ln dash" style="border-color:var(--faint)"></i>Зараховано ${m.series[S.cmpCycle].cycle}</span>` : ""}</div>
    <div class="lbl" style="text-align:center;margin-top:6px">Що далі від центру, то вище значення (0–100).</div>
  </section>
  <div class="c7 cmp-stack">
  <section class="card rise">
    <div class="card-h"><h2>Обʼєктивні показники</h2><div class="sp"></div><a class="pill-btn" href="#sources">${IC.plug}Джерела</a></div>
    <div class="kpis">${pctFacts.map(f => { const r = 18, C = 2 * Math.PI * r, sh = f.val[1] ? f.val[0] / f.val[1] * 100 : f.v, sc = Math.abs(sh - f.v) >= 0.5; return `<a class="kpi" href="#explain/${f.id}" style="text-decoration:none;color:inherit"><span class="kpi-t">${f.t}</span><div class="ring"><svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="23" cy="23" r="${r}" fill="none" stroke="${SCOL[status(f.v)]}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" style="stroke-dashoffset:${C * (1 - sh / 100)};transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 1s" class="kring" data-off="${C * (1 - sh / 100)}" data-c="${C}"/></svg><span class="mid tnum" style="font-size:24px">${numHTML(sh, sc ? 1 : 0)}<span class="dec">%</span></span></div><span class="lbl tnum">${f.val[0]} з ${f.val[1]}${sc ? `<br><span${f.rule ? ` data-tip="${esc(f.rule)}"` : ""}>Бал методики: <b>${fb(f.v)}</b></span>` : ""}<br>${COMP[f.c].n}</span></a>`; }).join("")}</div>
  </section>
  <section class="card rise">
    <div class="card-h"><h2>Достовірність</h2><div class="sp"></div>${trustPill(m.trust)}</div>
    <div class="rows">${m.raised.map(f => `<div class="row click" role="button" tabindex="0" onclick="openTrust()" style="align-items:flex-start"><span class="flag-ic ${f.w}">${f.w === "major" ? IC.alert : IC.flag}</span><div class="grow" style="font-size:13px"><b style="font-weight:600">${esc(f.t)}</b><div class="lbl">${f.ex}</div></div></div>`).join("") || `<div class="lbl">Жоден прапорець не спрацював.</div>`}</div>
  </section>
  </div>
  <section class="card c12 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Питання анкет за групами</h2><div class="sp"></div><div class="legend"><span class="lbl">Бал:</span><span><i style="background:var(--teal)"></i>65 і вище</span><span><i style="background:var(--amber)"></i>40–65</span><span><i style="background:var(--red)"></i>нижче 40</span><span class="lbl" style="margin-left:6px">Група:</span>${marks.map(([s, n]) => `<span><i class="mk ${s}"></i>${n}</span>`).join("")}</div></div>
    <div class="lbl" style="margin:-4px 0 12px">Число над стовпчиком це середній бал питання від 0 до 100. ${m.pItems.some(x => IB_GRP[x.id.split("-").pop()]) ? "Під стовпчиком компонент (К культура, С система, П підзвітність) і джерело: ОС особовий склад, РГ робоча група, ЕК експерти, ЧЛ чек-лист. Наведіть або клацніть, щоб побачити деталі." : "Під стовпчиком код питання: К культура, С система, П підзвітність. Наведіть або клацніть, щоб побачити питання."}</div>
    <div class="ibars" style="grid-template-columns:repeat(${m.pItems.length},minmax(0,1fr))">${m.pItems.map((x, i) => { const col = SCOL[status(x.v)]; return `<a class="ibar" href="#explain/${x.id}" style="text-decoration:none;color:inherit" data-tip="${esc(x.t)}<small>${SRC[x.src][0]} · ${COMP[x.c].n}</small>"><div class="v tnum">${fb(x.v)}</div><div class="b" style="height:${Math.max(8, x.v * 1.5)}px;background:${col};opacity:${0.45 + x.v / 100 * 0.55};animation-delay:${i * 50}ms"></div><div class="n"><i class="mk ${x.src}"></i><span class="tnum">${{ culture: "К", system: "С", accountability: "П" }[x.c]}${IB_GRP[x.id.split("-").pop()] || x.id.slice(-1)}</span></div></a>`; }).join("")}</div>
  </section>`;
};
const IB_GRP = { staff: "·ОС", working_group: "·РГ", expert: "·ЕК", checklist: "·ЧЛ" };
V.compare.after = () => {
  const m = cur();
  const old = S.cmpCycle >= 0 && m.series[S.cmpCycle];
  radar($("#cmpRadar"), [{ cls: "r-st", v: COMPS.map(c => m.byId[c].cr.v), delay: 300 }, ...(old ? [{ cls: "r-prev", v: COMPS.map(c => old.cr[c]), delay: 0 }] : []), { cls: "r-f", v: COMPS.map(c => m.byId[c].F), delay: 150 }, { cls: "r-p", v: COMPS.map(c => m.byId[c].P), delay: 0 }]);
  document.querySelectorAll(".kring").forEach(c => { const o = c.dataset.off; c.style.strokeDashoffset = c.dataset.c; requestAnimationFrame(() => requestAnimationFrame(() => c.style.strokeDashoffset = o)); });
};
