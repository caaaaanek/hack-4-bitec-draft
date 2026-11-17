/* ---------- Views ---------- */
const V = {};
const cur = () => inst(S.role === "observer" ? S.inst : ALPHA);
const can = r => NAV.some(n => n[0] === r && n[3].includes(S.role));
const backToInst = () => S.role === "observer" ? `<div class="c12 crumbs rise"><a href="#institutions">${IC.arrowL}Усі заклади</a><span class="lbl">/</span><b>${esc(cur().name)}</b></div>` : "";

/* «Чому такий індекс» */
function whyText(m) {
  const t = m.delta > 0 ? `що на ${pts(m.delta)} вище, ніж у попередньому циклі` : m.delta < 0 ? `що на ${pts(m.delta)} нижче, ніж у попередньому циклі` : "що не змінилося порівняно з попереднім циклом";
  let s = `Заклад перебуває на рівні зрілості ${m.level} «${LEVELS[m.level - 1]}»: індекс доброчесності ${f1(m.index)} з 100, ${t}.`;
  if (m.limited) s += ` Для компонента «${COMP[m.limited.id].n}» сприйняття (${fb(m.limited.P)}) помітно вище за факти (${fb(m.limited.F)}), тому зараховано ${fb(m.limited.cr.v)}.`;
  const tr = TRUST[m.trust]; s += ` Достовірність ${tr[0]}: ${tr[1].toLowerCase()}${m.trust === "C" ? ", тож спершу варто підтвердити факти документами" : ""}.`;
  return s;
}
function openWhy(focusFlags) {
  const m = cur(), lim = m.limited, tr = TRUST[m.trust];
  const scale = [1, 2, 3, 4, 5].map(l => { const lo = [0, ...BOUNDS][l - 1], hi = [...BOUNDS, 100][l - 1]; return `<div class="row"><span class="lvsq lv${l} ${l === m.level ? "on" : ""}">${l}</span><div class="grow">${LEVELS[l - 1]} <span class="lbl">${l === 1 ? `від 0 до ${fb(hi)}` : l === 5 ? `вище ${fb(lo)}` : `вище ${fb(lo)} до ${fb(hi)}`}</span></div>${l === m.level ? pill("Поточний", "p-good nodot") : ""}</div>`; }).join("");
  openDrawer("Чому такий індекс", `
    <div><div class="lbl" style="margin-bottom:4px">Короткий висновок</div><div style="line-height:1.55">${whyText(m)}</div></div>
    ${lim ? `<div class="note-box"><b>Показано з обмеженням</b><span class="lbl">${lim.cr.reason}</span>${capBars(lim)}</div>` : ""}
    <div><div class="lbl" style="margin-bottom:6px">Як це рахується</div><ol class="howto">
      <li>Індекс від 0 до 100 це середнє трьох компонентів: Культура, Система, Підзвітність.</li>
      <li>Кожен компонент складається зі сприйняття (анкети) і фактів (чек-лист та дані обліку).</li>
      <li>Сприйняття не може бути вищим за факти більш ніж на ${CAP} пунктів: у такому разі зараховується менше значення.</li>
      <li>Рівень зрілості від 1 до 5 визначають межі шкали нижче.</li>
      <li>Достовірність показує, наскільки результату можна довіряти. Вона залежить від прапорців.</li></ol>
      <a class="link" href="#explain" onclick="closeDrawer()">Відкрити розклад індексу ${IC.arrowR}</a></div>
    <div><div class="lbl" style="margin-bottom:4px">Шкала рівнів зрілості</div><div class="rows">${scale}</div></div>
    <div id="why-flags"><div class="card-h" style="margin-bottom:6px"><h2>Варто перевірити додатково</h2><div class="sp"></div>${trustPill(m.trust)}</div>
      <div class="lbl" style="margin-bottom:8px">${TRUST_HINT}</div>
      ${m.raised.length ? `<div class="rows">${m.raised.map(f => `<div class="row" style="align-items:flex-start"><span class="flag-ic ${f.w}">${f.w === "major" ? IC.alert : IC.flag}</span><div class="grow"><div style="font-weight:600">${esc(f.t)} ${pill(f.w === "major" ? "Серйозний" : "Незначний", "p-mute nodot")}</div><div class="lbl">${f.ex}</div></div></div>`).join("")}</div>` : `<div>Жоден прапорець не спрацював.</div>`}
      <div class="lbl" style="margin-top:10px">Напрям для додаткового аналізу. Це не висновок про людей чи підрозділи.</div></div>
  `, b => { if (focusFlags) setTimeout(() => b.querySelector("#why-flags").scrollIntoView({ behavior: "smooth", block: "start" }), 300); });
}
function capBars(c) {
  const bar = (n, v, col) => `<div class="cap-row"><span class="lbl">${n}</span><div class="dist-bar"><i style="width:${v}%;background:${col}"></i></div><b class="tnum">${fb(v)}</b></div>`;
  return `<div class="cap">${bar("Сприйняття", c.P, "var(--blue)")}${bar("Факти", c.F, "var(--amber)")}${bar("Зараховано", c.cr.v, "var(--teal)")}</div>`;
}

/* Огляд */
V.overview = () => {
  const m = cur(), ms = measures(), od = ms.filter(x => overdueDays(x) > 0).length, prev = m.series[m.series.length - 2];
  const tile = (ic, title, big, sub, act) => `<section class="card c3 rise kpi-tile" ${act ? `role="button" tabindex="0" onclick="${act}"` : ""}><div class="kt-h"><span class="kt-ic">${IC[ic]}</span><span class="lbl">${title}</span></div><div class="kt-b">${big}<div class="kt-s">${sub}</div></div></section>`;
  return `${backToInst()}
  ${tile("gauge", "Індекс доброчесності", `<span class="mid tnum">${numHTML(m.index)}</span>`, `Рівень ${m.level}: ${LSHORT[m.level - 1]}<br>${deltaHTML(m.delta)}`, "openWhy()")}
  ${tile("shield", "Достовірність", `<span class="mid">${m.trust === "insufficient" ? "?" : m.trust}</span>`, `${TRUST[m.trust][1]}<br><span class="lbl">Прапорці: ${m.raised.length}</span>`, "openWhy(true)")}
  ${tile("eye", "Напрями, що потребують уваги", `<span class="mid tnum">${m.attention.filter(a => a.v < 65).length}</span>`, `<span class="lbl">З трьох компонентів індексу</span>`, "document.getElementById('attn').scrollIntoView({behavior:'smooth',block:'center'})")}
  ${S.role === "observer" ? tile("users", "Відповідей у циклі", `<span class="mid tnum">${m.responses}</span>`, `<span class="lbl">Мінімальна група k = ${S.k}</span>`) : tile("target", "Заходи в трекері", `<span class="mid tnum">${ms.length}</span>`, od ? `<span style="color:var(--red);font-weight:600">З них ${od} прострочено</span>` : `<span class="lbl">Прострочених немає</span>`, "location.hash='tracker'")}
  <section class="card c8 rise">
    <div class="hero">
      <div class="hero-l">
        <div class="card-h" style="margin:0"><span class="lbl">${esc(m.name)}</span></div>
        <div class="big tnum">${numHTML(m.index)}<span class="of">з 100</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${lvPill(m.level)}${trustPill(m.trust)}${deltaHTML(m.delta)}</div>
        <div style="font-weight:500">${m.summary}</div>
        ${levelBar(m.index)}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
        <div class="quick">${`<button class="btn btn-primary" onclick="openWhy()">${IC.help}Чому такий індекс</button>`}${can("recs") ? `<a class="btn btn-soft" href="#recs">${IC.bulb}Рекомендації</a>` : ""}${can("report") ? `<a class="btn btn-soft" href="#report">${IC.file}Звіт</a>` : ""}</div>
        <div class="chart" id="cv" style="margin-top:auto"></div>
        <div class="lbl" style="text-align:right">Дані станом на ${TODAY_UA} · цикл ${CYCLE}</div>
      </div>
    </div>
  </section>
  <section class="card c4 rise" id="attn">
    <div class="card-h"><h2>Що потребує уваги</h2></div>
    <div class="rows">${m.attention.map(a => `<a class="row click" href="#explain/${a.c === "culture" || a.c === "accountability" ? (a.t.startsWith("Підтвердити") || a.t.startsWith("Більше") ? a.c : a.c) : a.c}" data-tip="${esc(a.hint)}"><span class="dot" style="background:${SCOL[status(a.v)]}"></span><div class="grow"><div class="t">${a.t}</div></div>${pill(COMP[a.c].n, "p-mute nodot")}<b class="tnum">${fb(a.v)}</b></a>`).join("")}</div>
    <div class="lbl" style="margin:16px 0 4px">Сильні сторони</div>
    <div class="rows">${m.strengths.map(a => `<a class="row click" href="${a.c ? "#explain/" + a.c : "#trends"}" data-tip="${esc(a.hint)}"><span class="dot" style="background:var(--teal)"></span><div class="grow"><div class="t">${a.t}</div></div><b class="tnum">${a.unit ? "+" : ""}${fb(a.v)}</b></a>`).join("")}</div>
  </section>
  ${m.components.map((c, ci) => {
    const C = COMP[c.id], pv = prev.cr[c.id], d = r1(c.cr.v - pv), lv = level(c.cr.v);
    return `<a class="card c4 rise comp-card" href="#explain/${c.id}">
      <div class="comp-top"><span class="comp-ic" style="background:${C.s};color:${C.c}">${IC[C.ic]}</span><b>${C.n}</b><div class="sp" style="flex:1"></div>${lvPill(lv)}</div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:14px">
        <div><div class="mid tnum">${numHTML(c.cr.v)}</div><div style="margin-top:6px">${deltaHTML(d)}</div></div>
        <div class="pf">${[["Сприйняття", c.P, "var(--blue)"], ["Факти", c.F, "var(--amber)"], ["Зараховано", c.cr.v, C.c]].map(([n, v, col], j) => `<div data-tip="${n}: ${fb(v)}"><i class="bar-a" style="height:${Math.max(4, v * .6)}px;background:${col};animation-delay:${300 + ci * 100 + j * 80}ms"></i><small>${n[0]}</small></div>`).join("")}</div>
      </div>
      <div style="margin-top:14px;min-height:26px">${c.cr.lim ? pill("Зараховано з обмеженням", "p-warn") : `<span class="lbl">Сприйняття ${fb(c.P)} · факти ${fb(c.F)}</span>`}</div>
    </a>`;
  }).join("")}
  <section class="card c8 rise">
    <div class="card-h"><h2>Динаміка індексу</h2><div class="sp"></div><a class="pill-btn" href="#trends">${IC.trend}Детальніше</a></div>
    <div class="chart" id="ovTrend"></div>
    <div class="lbl"><span class="ev-ic">${IC.diamond}</span>Виконані заходи між циклами: ${m.events.length}</div>
  </section>
  <section class="card c4 rise">
    <div class="card-h"><h2>Радар компонентів</h2></div>
    <div class="chart" id="radar"></div>
    <div class="legend" style="justify-content:center"><span><i style="background:var(--teal)"></i>Цикл ${CYCLE}</span><span><i style="background:var(--faint)"></i>Цикл ${prev.cycle}</span></div>
  </section>`;
};
V.overview.after = () => {
  const m = cur(), prev = m.series[m.series.length - 2];
  curveChart($("#cv"), m.series.map(r => r.index), m.series.map(r => r.cycle));
  trendChart($("#ovTrend"), m.series, [], m.events);
  radar($("#radar"), [{ cls: "r-st", v: COMPS.map(c => m.byId[c].cr.v), delay: 150 }, { cls: "r-prev", v: COMPS.map(c => prev.cr[c]), delay: 0 }]);
};

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
  const row = x => `<div class="tree-row ${hl === x.id ? "hl" : ""}" id="n-${x.id}">
      <span class="tn"><span>${esc(x.t)}</span><span class="tsub">${x.kind === "p" ? srcDot(x.src) + SRC[x.src][0] : srcDot("facts") + (x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`)}${x.lim ? `<span class="lim-tag">Частка обмеження компонента</span>` : ""}</span></span>
      <span class="tnum hm">${fb(x.w)} %</span><b class="tnum">${fb(x.vv)}</b>
      <span><div class="contrib"><i style="width:${x.contrib / maxC * 100}%;background:${COMP[x.c].c}"></i></div><span class="lbl tnum">${f2(x.contrib)}</span></span></div>`;
  const table = `<div class="tbl-wrap"><table><thead><tr><th>Вузол</th><th>Рівень</th><th>Вага, %</th><th>Значення</th><th>Внесок, пункти</th><th>Джерело</th></tr></thead><tbody>
    <tr><td><b>Індекс доброчесності</b></td><td>1</td><td class="tnum">100</td><td class="tnum">${fb(sum)}</td><td class="tnum">${f2(T.reduce((a, c) => a + c.contrib, 0))}</td><td></td></tr>
    ${T.map(c => `<tr><td><b>${COMP[c.id].n}</b>${c.lim ? " " + pill("Обмежувач", "p-warn nodot") : ""}</td><td>2</td><td class="tnum">33,3</td><td class="tnum">${fb(c.val)}</td><td class="tnum">${f2(c.contrib)}</td><td></td></tr>${c.items.map(x => `<tr><td style="padding-left:28px">${esc(x.t)}</td><td>3</td><td class="tnum">${x.w}</td><td class="tnum">${fb(x.vv)}</td><td class="tnum">${f2(x.contrib)}</td><td>${x.src ? SRC[x.src][0] : "Факти"}</td></tr>`).join("")}`).join("")}
  </tbody></table></div>`;
  return `${backToInst()}
  <section class="c12 rise toolbar"><span class="lbl">Звідки взялося кожне число: індекс, компоненти, питання й показники.</span><div class="sp"></div>
    <button class="btn btn-ghost" onclick="openWhy()">${IC.help}Як це рахується</button>
    <div class="seg" role="group" aria-label="Що показувати">${Object.entries(MODES).map(([k, n]) => `<button class="${mode === k ? "on" : ""}" aria-pressed="${mode === k}" onclick="S.mode='${k}';persist();render(true)">${n}</button>`).join("")}</div>
    <button class="btn btn-ghost" onclick="S.exTable=!S.exTable;render(true)">${S.exTable ? IC.tree + "Показати як дерево" : IC.table + "Показати як таблицю"}</button></section>
  <section class="card c12 rise">
    ${S.exTable ? table : `<div class="tree-root"><span><b>Індекс доброчесності</b></span><span class="lbl tnum hm">100 %</span><b class="tnum">${fb(sum)}</b><span class="lbl tnum">${f2(T.reduce((a, c) => a + c.contrib, 0))}</span></div>
    ${T.map((c, ci) => `<div class="tree-c ${S.open[c.id] ? "open" : ""} ${hl === c.id ? "hl" : ""}" id="n-${c.id}">
      <button class="tree-head" onclick="S.open['${c.id}']=!S.open['${c.id}'];this.parentNode.classList.toggle('open')" aria-expanded="${!!S.open[c.id]}">
        <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="comp-ic" style="background:${COMP[c.id].s};color:${COMP[c.id].c}">${IC[COMP[c.id].ic]}</span><b>${COMP[c.id].n}</b>${c.lim ? pill("Обмежувач", "p-warn") : ""}</span>
        <span class="lbl tnum hm">33,3 %</span><b class="tnum">${fb(c.val)}</b>
        <span class="hm"><div class="contrib"><i style="width:${c.contrib / 34 * 100}%;background:${COMP[c.id].c};animation-delay:${ci * 120}ms"></i></div><span class="lbl tnum">${f2(c.contrib)}</span></span>
        <span class="chev">${IC.chev}</span></button>
      ${c.lim ? `<div class="lim-note">${c.cr.reason}</div>` : ""}
      <div class="tree-body"><div class="tree-row lbl hdr"><span>${mode === "facts" ? "Показник" : "Питання"}</span><span class="hm">Вага</span><span>Значення</span><span>Внесок</span></div>${c.items.map(row).join("")}</div>
    </div>`).join("")}`}
    <div class="sum-ok">${IC.ok}${mode === "credited" ? `Сума внесків = Індекс ${f1(sum)}` : `Сума внесків = ${f1(sum)}. Це середнє за режимом «${MODES[mode]}» без обмежувача. До індексу йдуть зараховані значення.`}</div>
  </section>`;
};
V.explain.after = () => { if (S.focus) { const el = document.getElementById("n-" + S.focus); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 200); S.focus = null; } };

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
  <section class="c12 rise"><span class="lbl">Як змінювався індекс доброчесності від циклу до циклу. Показано лише цей заклад, без порівняння з іншими.</span></section>
  <section class="card c12 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Динаміка індексу</h2><div class="sp"></div>
      <label class="lbl">Від <select class="inp" onchange="S.trend.from=+this.value;persist();render(true)">${opt(from, i => i < to)}</select></label>
      <label class="lbl">До <select class="inp" onchange="S.trend.to=+this.value;persist();render(true)">${opt(to, i => i > from)}</select></label>
      <button class="btn btn-ghost" onclick="S.trTable=!S.trTable;render(true)">${S.trTable ? IC.trend + "Показати як діаграму" : IC.table + "Показати як таблицю"}</button></div>
    <div class="chips-row"><span class="lbl">Додати лінію:</span>${COMPS.map(c => `<button class="chip ${t.lines.includes(c) ? "on" : ""}" style="--c:${COMP[c].c}" aria-pressed="${t.lines.includes(c)}" onclick="toggleLine('${c}')"><i></i>${COMP[c].n}</button>`).join("")}</div>
    ${S.trTable ? `<div class="tbl-wrap"><table><thead><tr><th>Цикл</th><th>Індекс</th><th>Рівень</th>${COMPS.map(c => `<th>${COMP[c].n}</th>`).join("")}<th>Події після циклу</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${r.cycle}</b></td><td class="tnum"><b>${f1(r.index)}</b></td><td>${lvPill(level(r.index))}</td>${COMPS.map(c => `<td class="tnum">${fb(r.cr[c])}</td>`).join("")}<td class="lbl">${m.events.filter(e => e.after === r.cycle && r !== rows[rows.length - 1]).map(e => e.t).join("; ") || "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="chart" id="trend"></div>`}
    <div class="lbl" style="margin-top:8px"><span class="ev-ic">${IC.diamond}</span>Виконані заходи між циклами: ${evs.length}. ${d > 0 ? `За період індекс зріс на ${pts(d)}.` : d < 0 ? `За період індекс знизився на ${pts(d)}.` : "За період індекс не змінився."}</div>
  </section>
  <section class="card c7 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Порівняти два цикли</h2><div class="sp"></div>
      <label class="lbl">Було <select class="inp" onchange="S.cmp.a=+this.value;persist();render(true)">${opt(S.cmp.a)}</select></label>
      <label class="lbl">Стало <select class="inp" onchange="S.cmp.b=+this.value;persist();render(true)">${opt(S.cmp.b)}</select></label></div>
    ${a === b ? `<div class="empty">Оберіть два різні цикли, щоб побачити, що змінилося.</div>` : `<div class="tbl-wrap"><table><thead><tr><th>Показник</th><th>Було</th><th>Стало</th><th>Зміна</th></tr></thead><tbody>${cmpRows.map(([n, x, y]) => `<tr><td><b>${n}</b></td><td class="tnum">${fb(x)}</td><td class="tnum">${fb(y)}</td><td>${deltaHTML(r1(y - x))}</td></tr>`).join("")}</tbody></table></div>
    <div class="lbl" style="margin-top:8px">Було: значення в циклі ${a.cycle}. Стало: у циклі ${b.cycle}. Зміна в пунктах шкали 0-100.</div>`}
  </section>
  <section class="card c5 rise">
    <div class="card-h"><h2>Висновок за весь період</h2></div>
    ${(() => { const f = sr[0], l = sr[sr.length - 1], p = COMPS.filter(c => l.cr[c] > f.cr[c]), n = COMPS.filter(c => l.cr[c] < f.cr[c]); return `<div class="rows">
      <div class="row" style="align-items:flex-start"><span class="comp-ic" style="background:var(--teal-soft);color:var(--teal-deep);width:28px;height:28px">${IC.up}</span><div class="grow">${p.length ? `Позитивна динаміка: ${p.map(c => `${COMP[c].n} (${pts(l.cr[c] - f.cr[c])})`).join(", ")}.` : "Позитивної динаміки за період немає."}</div></div>
      <div class="row" style="align-items:flex-start"><span class="comp-ic" style="background:${n.length ? "var(--red-soft)" : "var(--soft)"};color:${n.length ? "var(--red)" : "var(--muted)"};width:28px;height:28px">${n.length ? IC.down : IC.flat}</span><div class="grow">${n.length ? `Потребує уваги: ${n.map(c => `${COMP[c].n} (−${pts(f.cr[c] - l.cr[c])})`).join(", ")}.` : "Негативної динаміки за компонентами немає."}</div></div>
      ${m.events.map(e => `<div class="row"><span class="ev-ic">${IC.diamond}</span><div class="grow"><div class="t">${e.t}</div><div class="s">Після циклу ${e.after}</div></div></div>`).join("")}</div>`; })()}
  </section>`;
};
V.trends.after = () => { const m = cur(), t = S.trend, from = Math.min(t.from, t.to), to = Math.max(t.from, t.to); trendChart($("#trend"), m.series.slice(from, to + 1), t.lines, m.events); };
function toggleLine(c) { const l = S.trend.lines; S.trend.lines = l.includes(c) ? l.filter(x => x !== c) : [...l, c]; persist(); render(true); }

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
      <div class="ev">${r.evidence.map(e => `<a href="#explain/${e.id}" class="ev-i">${e.item ? "" : `<span style="color:var(--red);display:inline-flex;width:14px">${IC.alert}</span>`}<span>${esc(e.t)}: <b>${e.v}</b></span><span class="lbl">Відкрити в розкладі ${IC.arrowR}</span></a>`).join("")}</div>
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
    <div class="field"><label for="f-due">Строк виконання</label><input class="inp" type="date" id="f-due" min="${TODAY}" value="2027-02-28"><span class="err lbl" id="f-err"></span></div>
    <div class="note-box"><span class="lbl">Після прийняття в трекері зʼявиться захід із цією посадою й строком. Посаду і строк можна буде уточнити пізніше.</span></div>
    <div style="display:flex;gap:8px"><button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeDrawer()">Скасувати</button><button class="btn btn-primary" id="f-ok" style="flex:2;justify-content:center">${IC.ok}Прийняти й створити захід</button></div>`, b => {
    b.querySelector("#f-ok").onclick = () => {
      const due = b.querySelector("#f-due").value;
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
  const stCell = x => { const d = overdueDays(x); return d > 0 ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${pill(`Прострочено на ${d} ${daysWord(d)}`, "p-bad")}<span class="lbl">Статус: ${M_ST[x.st][0]}</span></div>` : pill(M_ST[x.st][0], M_ST[x.st][1]); };
  const actCell = x => x.st === "confirmed" ? `<span class="lbl">Змінює наступне оцінювання</span>` : edit ? `<div class="mv">${M_NEXT[x.st].map(s => `<button class="btn btn-ghost" onclick="setMSt('${x.id}','${s}')">${IC.arrowR}${M_ST[s][0]}</button>`).join("")}</div>` : `<span class="lbl">—</span>`;
  const board = ["accepted", "inprogress", "done", "confirmed", "notconfirmed"].map(st => { const cards = list.filter(x => x.st === st); return `<div class="col-b"><div class="col-h">${pill(M_ST[st][0], M_ST[st][1])}<span class="lbl tnum">${cards.length}</span></div>${cards.map(x => `<div class="b-card"><b>${x.t}</b><span class="lbl">${x.who}</span><div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><span class="lbl tnum" ${overdueDays(x) ? 'style="color:var(--red);font-weight:600"' : ""}>Строк: ${ua(x.due)}</span>${overdueDays(x) ? pill(`+${overdueDays(x)} ${daysWord(overdueDays(x))}`, "p-bad nodot") : ""}</div>${edit && M_NEXT[x.st].length ? `<div class="seg sm">${M_NEXT[x.st].map(s => `<button onclick="setMSt('${x.id}','${s}')">${IC.arrowR}${M_ST[s][0]}</button>`).join("")}</div>` : ""}</div>`).join("") || `<div class="lbl" style="padding:8px">Порожньо</div>`}</div>`; }).join("");
  const conf = all.filter(x => x.st === "confirmed").length, wait = all.filter(x => x.st === "done").length, rev = all.filter(x => x.st === "notconfirmed").length;
  return `
  <section class="c12 rise toolbar"><span class="lbl">${all.length} заходів${od ? `, з них ${od} прострочено` : ", прострочених немає"}. ${edit ? "Статуси змінює керівник." : "Режим читання: змінювати статуси може лише керівник."}</span><div class="sp"></div>
    <div class="seg" role="group" aria-label="Вигляд">${[["table", "Таблиця", "table"], ["board", "Дошка", "board"]].map(([k, n, ic]) => `<button class="${S.trackView === k ? "on" : ""}" onclick="S.trackView='${k}';persist();render(true)">${n}</button>`).join("")}</div>
    <select class="inp" aria-label="Статус" onchange="S.trF.st=this.value;persist();render(true)"><option value="all">Усі статуси</option>${Object.entries(M_ST).map(([k, [n]]) => `<option value="${k}" ${f.st === k ? "selected" : ""}>${n}</option>`).join("")}</select>
    <select class="inp" aria-label="Відповідальна посада" onchange="S.trF.who=this.value;persist();render(true)"><option value="all">Усі посади</option>${[...new Set(all.map(x => x.who))].sort().map(w => `<option ${f.who === w ? "selected" : ""}>${w}</option>`).join("")}</select>
    <span class="lbl tnum">Показано ${list.length} з ${all.length}</span></section>
  ${!list.length ? `<section class="card c12"><div class="empty"><b>За цими фільтрами заходів немає</b><br>Змініть статус або посаду. Нові заходи зʼявляються, коли керівник приймає рекомендацію.<br><br>${can("recs") ? `<a class="btn btn-soft" href="#recs">Перейти до рекомендацій</a>` : ""}</div></section>` : S.trackView === "board" ? `<section class="c12 board rise">${board}</section>` : `
  <section class="card c12 rise"><div class="tbl-wrap"><table><thead><tr><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Статус</th><th>Верифікація</th><th>Змінити статус</th></tr></thead><tbody>
    ${list.map(x => `<tr><td style="min-width:220px"><b style="font-weight:600">${x.t}</b><div class="lbl">З рекомендації: ${x.rec}</div></td><td style="min-width:160px">${x.who}</td><td class="tnum" style="white-space:nowrap">${ua(x.due)}</td><td>${stCell(x)}</td><td>${pill(verif(x)[0], verif(x)[1] + " nodot")}</td><td>${actCell(x)}</td></tr>`).join("")}
  </tbody></table></div></section>`}
  <section class="card c12 rise">
    <div class="card-h"><h2>Верифікація наступним оцінюванням</h2></div>
    <div class="lbl" style="max-width:820px">Статус «Виконано» ще не означає, що захід спрацював. Після наступного циклу оцінювання система перевіряє, чи покращились показники, пов’язані із заходом. Результат може бути «Підтверджено наступним оцінюванням» або «Не підтверджено, потрібен перегляд».</div>
    <div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr);margin-top:14px"><div><small>Підтверджено</small><b>${conf}</b></div><div><small>Очікують наступного оцінювання</small><b>${wait}</b></div><div><small>Потребують перегляду</small><b>${rev}</b></div></div>
  </section>`;
};
function setMSt(id, st) { if (API.on) return apiSetMSt(id, st); const x = measures().find(m => m.id === id); if (!x || !M_NEXT[x.st].includes(st)) return; S.dec.mst[id] = st; addLog(me(), `Захід «${x.t}»: статус «${M_ST[st][0]}»`); persist(); render(true); toast(`Статус заходу змінено на «${M_ST[st][0]}».`); }

/* Звідки беруться дані */
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
V.sources = () => `
  <section class="c12 rise"><span class="lbl">Чесні статуси: що працює вже, що вносять вручну, а що лише планується.</span></section>
  <section class="card c12 rise"><div class="card-h"><h2>Джерела даних за метриками</h2></div>
    <div class="tbl-wrap"><table><thead><tr><th>Метрика</th><th>Джерело</th><th>Режим</th><th>Вік даних</th><th>Пояснення</th></tr></thead><tbody>
    ${SOURCES.map(([a, b, mo, age, ex]) => `<tr><td><b style="font-weight:600">${a}</b></td><td>${b}</td><td>${pill(MODE[mo][0], MODE[mo][1])}</td><td class="lbl" style="min-width:150px">${age}</td><td class="lbl" style="min-width:260px">${ex}</td></tr>`).join("")}
    </tbody></table></div></section>
  <section class="c12 rise"><div class="card-h" style="margin:6px 0 0"><h2>Карта інтеграцій</h2></div></section>
  ${INTEG.map(([n, mo, why, how, ic], i) => `<section class="card c4 rise integ ${mo}"><div class="comp-top"><span class="comp-ic" style="background:var(--soft)">${IC[ic]}</span><b>${n}</b><div class="sp" style="flex:1"></div>${pill(MODE[mo][0], MODE[mo][1])}</div>
    <div style="margin-top:12px"><span class="lbl">Навіщо</span><div>${why}</div></div><div style="margin-top:8px"><span class="lbl">Метод</span><div>${how}</div></div></section>`).join("")}`;

/* Заклади (спостерігач) */
V.institutions = () => `
  <section class="c12 rise"><span class="lbl">Показано узагальнені дані. Заклади не порівнюються між собою й подані в алфавітному порядку за назвою.</span></section>
  ${INSTITUTIONS().map((m, i) => `<a class="card c6 rise inst" href="#overview" onclick="S.inst='${m.id}';persist()">
    <div class="comp-top"><span class="comp-ic" style="background:var(--lime-soft);color:var(--teal-deep)">${IC.building}</span><b>${esc(m.name)}</b></div>
    <div style="display:flex;align-items:flex-end;gap:14px;margin-top:16px;flex-wrap:wrap"><div class="mid tnum">${numHTML(m.index)}<span class="of">індекс з 100</span></div><div style="display:flex;gap:6px;flex-wrap:wrap">${lvPill(m.level)}${trustPill(m.trust)}</div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">${deltaHTML(m.delta, "до попереднього циклу")}<span class="link">Відкрити огляд ${IC.arrowR}</span></div>
  </a>`).join("")}`;

/* Порівняння: сприйняття за групами проти фактів */
V.compare = () => {
  const m = cur(), srcAvg = (c, src) => { const a = m.pItems.filter(x => x.c === c && x.src === src); return a.length ? wmean(a) : null; };
  const pctFacts = m.fItems.filter(x => x.kind === "pct");
  const marks = [["wg", "Робоча група"], ["os", "Особовий склад"], ["experts", "Експерти"]];
  return `${backToInst()}
  <section class="c12 rise"><span class="lbl">Де самооцінка розходиться з документами і з думкою персоналу. Розрив понад ${CAP} пунктів між сприйняттям і фактами вмикає обмежувач.</span></section>
  <section class="card c5 rise">
    <div class="card-h"><h2>Профіль компонентів</h2></div>
    <div class="chart" id="cmpRadar"></div>
    <div class="legend" style="justify-content:center;margin-top:8px"><span><i style="background:var(--blue)"></i>Сприйняття</span><span><i style="background:var(--fg);border-radius:2px"></i>Факти</span><span><i style="background:var(--teal)"></i>Зараховано</span></div>
  </section>
  <section class="card c7 rise">
    <div class="card-h"><h2>Сприйняття проти фактів</h2><div class="sp"></div><div class="legend">${marks.map(([s, n]) => `<span>${srcDot(s)}${n}</span>`).join("")}<span><i style="background:var(--fg);border-radius:2px;transform:rotate(45deg) scale(.85)"></i>Факти</span></div></div>
    ${m.components.map((c, i) => { const vals = marks.map(([s]) => [s, srcAvg(c.id, s)]).filter(([, v]) => v != null); const all = [...vals.map(x => x[1]), c.F]; const lo = Math.min(...all), hi = Math.max(...all), gap = r1(c.P - c.F);
      return `<div class="db" style="cursor:pointer" onclick="location.hash='explain/${c.id}'"><span class="t"><b>${COMP[c.id].n}</b><br><span class="lbl">Сприйняття ${fb(c.P)} · факти ${fb(c.F)}</span></span>
        <div class="track"><div class="gap ${gap > CAP ? "bad" : ""}" style="left:${lo}%;width:${hi - lo}%;animation-delay:${i * 80}ms"></div>
        ${vals.map(([s, v], j) => `<span class="m ${s === "wg" ? "wg" : s === "os" ? "st" : "ex"}" style="left:${v}%;animation-delay:${200 + i * 80 + j * 60}ms" data-tip="${SRC[s][0]}: ${fb(v)}"></span>`).join("")}
        <span class="m f" style="left:${c.F}%;animation-delay:${400 + i * 80}ms" data-tip="Факти: ${fb(c.F)}"></span></div>
        <b class="tnum" style="text-align:right;color:${gap > CAP ? "var(--red)" : "var(--fg)"}" data-tip="Сприйняття мінус факти">${gap > 0 ? "+" : ""}${fb(gap)}</b></div>`; }).join("")}
    <div class="lbl" style="margin-top:10px">Праворуч різниця «сприйняття мінус факти». Червоним позначено розрив понад ${CAP} пунктів.</div>
  </section>
  <section class="card c8 rise">
    <div class="card-h"><h2>Обʼєктивні показники</h2><div class="sp"></div><a class="pill-btn" href="#sources">${IC.plug}Джерела</a></div>
    <div class="kpis">${pctFacts.map(f => { const r = 18, C = 2 * Math.PI * r; return `<a class="kpi" href="#explain/${f.id}" style="text-decoration:none;color:inherit"><div class="ring"><svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="23" cy="23" r="${r}" fill="none" stroke="${SCOL[status(f.v)]}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" style="stroke-dashoffset:${C * (1 - f.v / 100)};transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 1s" class="kring" data-off="${C * (1 - f.v / 100)}" data-c="${C}"/></svg><span class="mid tnum" style="font-size:24px">${numHTML(f.v, 0)}<span class="dec">%</span></span></div><span class="lbl">${f.t}</span><span class="lbl tnum">${f.val[0]} з ${f.val[1]} · ${COMP[f.c].n}</span></a>`; }).join("")}</div>
  </section>
  <section class="card c4 rise">
    <div class="card-h"><h2>Достовірність</h2><div class="sp"></div>${trustPill(m.trust)}</div>
    <div class="rows">${m.raised.map(f => `<div class="row" style="align-items:flex-start"><span class="flag-ic ${f.w}">${f.w === "major" ? IC.alert : IC.flag}</span><div class="grow" style="font-size:13px"><b style="font-weight:600">${esc(f.t)}</b><div class="lbl">${f.ex}</div></div></div>`).join("") || `<div class="lbl">Жоден прапорець не спрацював.</div>`}</div>
  </section>
  <section class="card c12 rise">
    <div class="card-h"><h2>Питання анкет за групами</h2><div class="sp"></div><div class="legend"><span><i style="background:var(--teal)"></i>≥ 65</span><span><i style="background:var(--amber)"></i>40–65</span><span><i style="background:var(--red)"></i>&lt; 40</span></div></div>
    <div class="ibars" style="grid-template-columns:repeat(${m.pItems.length},1fr)">${m.pItems.map((x, i) => { const col = SCOL[status(x.v)]; return `<a class="ibar" href="#explain/${x.id}" style="text-decoration:none;color:inherit" data-tip="${esc(x.t)}<small>${SRC[x.src][0]} · ${COMP[x.c].n}</small>"><div class="v tnum">${fb(x.v)}</div><div class="b" style="height:${Math.max(8, x.v * 1.5)}px;background:${col};opacity:${0.45 + x.v / 100 * 0.55};animation-delay:${i * 50}ms"></div><div class="n">${srcDot(x.src)}</div></a>`; }).join("")}</div>
  </section>`;
};
V.compare.after = () => {
  const m = cur();
  radar($("#cmpRadar"), [{ cls: "r-wg", v: COMPS.map(c => m.byId[c].P), delay: 0 }, { cls: "r-f", v: COMPS.map(c => m.byId[c].F), delay: 150 }, { cls: "r-st", v: COMPS.map(c => m.byId[c].cr.v), delay: 300 }].map((s, i, a) => i === 0 ? { ...a[2], delay: 300 } : i === 2 ? { ...a[0], delay: 0 } : s));
  document.querySelectorAll(".kring").forEach(c => { const o = c.dataset.off; c.style.strokeDashoffset = c.dataset.c; requestAnimationFrame(() => requestAnimationFrame(() => c.style.strokeDashoffset = o)); });
};
