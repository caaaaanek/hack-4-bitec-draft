/* Звіт */
V.report = () => {
  const m = cur(), recs = m.id === ALPHA ? buildRecs(m) : [], ms = m.id === ALPHA ? measures() : [];
  const itemRows = arr => arr.map(x => `<tr><td>${esc(x.t)}</td><td>${COMP[x.c].n}</td><td>${x.src ? SRC[x.src][0] : x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`}</td><td class="tnum">${x.w}</td><td class="tnum"><b>${fb(x.v)}</b></td></tr>`).join("");
  return `${backToInst()}
  <div class="c12 rise toolbar"><div class="sp"></div>
    ${S.aiOn && AI_ROLES.includes(S.role) ? `<button class="btn btn-soft" onclick="aiOpen('Підготуй чернетку опису результатів для звіту')">${IC.spark}Чернетка опису</button>` : ""}
    <button class="btn btn-soft" onclick="copyOut('csv')">${IC.copy}Копіювати CSV</button>
    <button class="btn btn-soft" onclick="copyOut('csv',true)">${IC.file}CSV</button>
    <button class="btn btn-soft" onclick="copyOut('json',true)">${IC.file}JSON</button>
    <button class="btn btn-soft" onclick="copyOut('html',true)">${IC.file}HTML</button>
    <button class="btn btn-primary" onclick="window.print()">${IC.print}Друк / PDF</button>
  </div>
  <article class="paper c12 rise">
    <div class="lbl">Звіт за результатами оцінювання · цикл ${CYCLE} · дані станом на ${TODAY_UA}</div>
    <h2 style="margin-top:6px">${esc(m.name)}</h2>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin:18px 0 6px;align-items:flex-end">
      <div><div class="lbl">Індекс доброчесності</div><div class="big tnum" style="font-size:44px">${numHTML(m.index)}<span class="of">з 100</span></div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${lvPill(m.level)}${trustPill(m.trust)}${deltaHTML(m.delta)}</div>
    </div>
    <p style="line-height:1.6">${whyText(m)}</p>
    <h3>Компоненти</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Компонент</th><th>Сприйняття</th><th>Факти</th><th>Зараховано</th><th>Рівень</th><th>Зміна</th></tr></thead><tbody>
    ${m.components.map(c => `<tr><td><b>${COMP[c.id].n}</b>${c.cr.lim ? " " + pill("Обмежувач", "p-warn nodot") : ""}</td><td class="tnum">${fb(c.P)}</td><td class="tnum">${fb(c.F)}</td><td class="tnum"><b>${fb(c.cr.v)}</b></td><td>${lvPill(level(c.cr.v))}</td><td>${deltaHTML(r1(c.cr.v - m.series[m.series.length - 2].cr[c.id]))}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Сприйняття: питання анкет</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Питання</th><th>Компонент</th><th>Джерело</th><th>Вага, %</th><th>Значення</th></tr></thead><tbody>${itemRows(m.pItems)}</tbody></table></div>
    <h3>Факти: чек-лист і дані обліку</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Показник</th><th>Компонент</th><th>Дані</th><th>Вага, %</th><th>Значення</th></tr></thead><tbody>${itemRows(m.fItems)}</tbody></table></div>
    <h3>Достовірність ${m.trust === "insufficient" ? "" : m.trust}: ${TRUST[m.trust][1].toLowerCase()}</h3>
    <div class="rows">${m.raised.map(f => `<div class="row"><span class="dot" style="background:${f.w === "major" ? "var(--red)" : "var(--amber)"}"></span><div class="grow">${esc(f.t)}<div class="s">${f.ex}</div></div></div>`).join("") || `<div class="lbl">Жоден прапорець не спрацював.</div>`}</div>
    ${S.notes.length && m.id === ALPHA ? `<h3>Опис результатів</h3>${S.notes.map((n, i) => `<div class="note-ai"><div>${esc(n.t)}</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${pill("Чернетка ШІ · затверджено", "p-info nodot")}<span class="lbl">${n.who} · ${n.at}</span>${S.role === "leader" ? `<button class="btn btn-ghost noprint" style="padding:4px 10px;font-size:12px;margin-left:auto" onclick="S.notes.splice(${i},1);persist();render(true)">Прибрати</button>` : ""}</div></div>`).join("")}` : ""}
    ${recs.length ? `<h3>Рекомендації та рішення</h3><div class="rows">${recs.map(r => `<div class="row"><div class="grow">${r.t}<div class="s">${COMP[r.c].n} · пріоритет ${PRI[r.pri][0].toLowerCase()}${r.note.reason ? " · причина: " + esc(r.note.reason) : ""}${r.note.comment ? " · коментар: " + esc(r.note.comment) : ""}</div></div>${pill(REC_ST[r.st][0], REC_ST[r.st][1])}</div>`).join("")}</div>` : ""}
    ${ms.length ? `<h3>Заходи</h3><div class="rows">${ms.map(x => `<div class="row"><div class="grow">${x.t}<div class="s">${x.who} · до ${ua(x.due)}</div></div>${pill(M_ST[dispSt(x)][0], M_ST[dispSt(x)][1])}</div>`).join("")}</div>` : ""}
    <p class="lbl" style="margin-top:24px">Усі оцінки, рівні й прапорці розраховано явними правилами методики. Окремих відповідей, імен і порівнянь підрозділів у звіті немає.</p>
  </article>`;
};
function copyOut(kind, dl) {
  const m = cur(); let txt;
  if (kind === "html") { const doc = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Звіт ${CYCLE}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 6px;font-size:12px;text-align:left}.dec{color:#999}svg,button{display:none}.pill{padding:2px 8px;border-radius:9px;background:#eee;font-size:12px;margin-right:4px}.row{display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #eee}.s,.lbl{color:#666;font-size:12px}</style></head><body>${document.querySelector(".paper").innerHTML}</body></html>`; return download(`integrity-report-${m.id}-${CYCLE}.html`, doc, "text/html"); }
  if (kind === "csv") txt = ["id;component;kind;label;source;weight;value", ...allItems(m).map(x => [x.id, x.c, x.src ? "perception" : "fact", `"${x.t.replace(/"/g, '""')}"`, x.src || x.kind, x.w, fb(x.v)].join(";")), ...m.components.map(c => [c.id, c.id, "component", COMP[c.id].n, "credited", "33.3", fb(c.cr.v)].join(";")), ["index", "", "index", "Індекс доброчесності", "", "100", fb(m.index)].join(";")].join("\n");
  else txt = JSON.stringify({ institution: m.name, cycle: CYCLE, asOf: TODAY, index: m.index, level: m.level, trust: m.trust, delta: m.delta,
    components: Object.fromEntries(m.components.map(c => [c.id, { perception: c.P, facts: c.F, credited: c.cr.v, limited: c.cr.lim }])),
    flags: m.raised.map(f => ({ id: f.id, weight: f.w, title: f.t })), measures: m.id === ALPHA ? measures() : [] }, null, 2);
  if (dl) return download(`integrity-${m.id}-${CYCLE}.${kind}`, (kind === "csv" ? "﻿" : "") + txt, kind === "csv" ? "text/csv" : "application/json");
  const done = () => { toast(kind.toUpperCase() + " скопійовано"); addLog(me(), `Експорт звіту (${kind.toUpperCase()})`); };
  try { navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done)); } catch (e) { fallbackCopy(txt, done); }
}
function download(name, txt, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: type + ";charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast("Завантажено: " + name); addLog(me(), `Експорт звіту (${name})`); }
function fallbackCopy(txt, done) { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Не вдалося скопіювати"); } ta.remove(); }

/* Керування циклом (уповноважений-адміністратор: лише кількості) */
V.manage = () => {
  const tot = GROUPS.reduce((a, g) => a + g.inv, 0), used = GROUPS.reduce((a, g) => a + g.resp, 0);
  return `
  <section class="card c8 rise">
    <div class="card-h"><h2>Цикл ${CYCLE}</h2>${pill(S.cycleOpen ? "Триває" : "Завершено", S.cycleOpen ? "p-good" : "p-mute")}<div class="sp"></div><span class="lbl">01.11 – 20.11.2026</span></div>
    <div class="lbl" style="margin-bottom:6px">Видані й використані жетони за групами</div>
    <div class="rows">${GROUPS.map((g, i) => { const hidden = g.unit && g.resp < S.k; return `<div class="row"><div class="grow"><div class="t" style="display:flex;gap:8px;align-items:center">${g.n}${hidden ? `<span style="display:inline-flex;width:15px;color:var(--muted)" data-tip="Менше ${S.k} відповідей: результати групи приховано, показано рівень вище">${IC.lock}</span>` : ""}</div><div class="ticks" style="height:14px;margin-top:6px">${Array.from({ length: 30 }, (_, j) => `<span class="${j < Math.round(g.resp / g.inv * 30) ? (hidden ? "f3" : "f2") : ""} bar-a" style="animation-delay:${i * 60 + j * 10}ms"></span>`).join("")}</div></div><span class="tnum" style="min-width:70px;text-align:right"><b>${g.resp}</b><span class="lbl"> / ${g.inv}</span></span></div>`; }).join("")}</div>
  </section>
  <section class="card c4 rise">
    <div class="card-h"><h2>Налаштування</h2></div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="field"><label for="kin">Мінімальна група k</label><div style="display:flex;gap:10px;align-items:center"><input type="range" min="5" max="20" id="kin" value="${S.k}" style="flex:1"><b class="tnum" id="kv" style="min-width:24px">${S.k}</b></div><span class="lbl">Групи з меншою кількістю відповідей приховано, показано рівень вище.</span></div>
      <div class="stat4" style="grid-template-columns:1fr 1fr"><div><small>Жетонів видано</small><b class="tnum">${numHTML(tot, 0)}</b></div><div><small>Використано</small><b class="tnum">${numHTML(used, 0)}</b></div></div>
      <div id="closeZone">${S.cycleOpen ? `<button class="btn btn-soft" style="width:100%;justify-content:center" onclick="askClose()">Завершити цикл</button>` : `<button class="btn btn-primary" style="width:100%;justify-content:center" onclick="S.cycleOpen=true;addLog(me(),'Цикл ${CYCLE} відновлено');persist();render(true)">Відновити цикл</button>`}</div>
    </div>
  </section>
  <section class="card c12 rise"><div class="lock">${IC.lock}<div><b>Ця роль не має доступу до відповідей респондентів, навіть узагальнених.</b><div class="lbl">Результати бачать лише ті ролі, яким вони потрібні для рішень. Тут видно тільки кількість виданих і використаних жетонів.</div></div></div></section>
  <section class="card c12 rise">
    <div class="card-h"><h2>Цикли оцінювання</h2></div>
    <div class="tbl-wrap"><table><thead><tr><th>Цикл</th><th>Період</th><th>Мінімальна група k</th><th>Жетонів видано / використано</th><th>Статус</th></tr></thead><tbody>
    ${[["2026-11", "01.11 – 20.11.2026", S.k, `${tot} / ${used}`, S.cycleOpen ? ["Триває", "p-good"] : ["Завершено", "p-mute"]], ["2026-06", "02.06 – 20.06.2026", 10, "82 / 71", ["Завершено", "p-mute"]], ["2025-12", "01.12 – 19.12.2025", 10, "80 / 66", ["Завершено", "p-mute"]], ["2025-06", "02.06 – 20.06.2025", 10, "78 / 59", ["Завершено", "p-mute"]]].map(([c, p, k, t, st]) => `<tr><td><b>${c}</b></td><td>${p}</td><td class="tnum">${k}</td><td class="tnum">${t}</td><td>${pill(st[0], st[1])}</td></tr>`).join("")}
    </tbody></table></div>
  </section>`;
};
V.manage.after = () => {
  const k = $("#kin"); if (!k) return;
  k.oninput = () => { $("#kv").textContent = k.value; };
  k.onchange = () => { S.k = +k.value; addLog(me(), `Мінімальна група k = ${S.k}`); persist(); render(true); toast(`Мінімальна група k = ${S.k}`); };
};
function askClose() {
  $("#closeZone").innerHTML = `<div class="lbl" style="margin-bottom:8px">Після завершення відповіді більше не прийматимуться, а жетони, що лишились, стануть недійсними.</div><div style="display:flex;gap:8px"><button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="render(true)">Скасувати</button><button class="btn btn-danger" style="flex:1;justify-content:center" onclick="S.cycleOpen=false;addLog(me(),'Цикл ${CYCLE} завершено');persist();render(true)">Завершити</button></div>`;
}

/* Анкети (укладач) */
V.surveys = () => `
  <section class="card c12 rise"><div class="lock">${IC.lock}<div><b>Ця роль не має доступу до відповідей респондентів.</b><div class="lbl">Укладач не бачить, хто та скільки людей пройшли анкету. Опублікована версія не змінюється: правки йдуть у нову версію.</div></div></div></section>
  ${S.qs.map((q, i) => `<section class="card c6 rise">
    <div class="comp-top"><span class="comp-ic" style="background:var(--lime-soft);color:var(--teal-deep)">${IC.survey}</span><b>${q.t}</b><div class="sp" style="flex:1"></div>${pill(q.st === "published" ? "Опубліковано" : "Чернетка", q.st === "published" ? "p-good" : "p-warn")}</div>
    <div class="stat4 tnum" style="grid-template-columns:repeat(3,1fr);margin-top:14px"><div><small>Група</small><b style="font-size:14px">${q.grp}</b></div><div><small>Версія</small><b>${q.ver}</b></div><div><small>Питань</small><b>${q.n}</b></div></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center"><span class="lbl">Оновлено ${q.upd}</span><div class="sp" style="flex:1"></div>
      <button class="btn btn-soft" onclick="openQ(${i})">${IC.eye}Переглянути</button>
      ${q.st === "published" ? `<button class="btn btn-ghost" onclick="newVer(${i})">${IC.plus}Нова версія</button>` : `<button class="btn btn-primary" onclick="publishQ(${i})">${IC.ok}Опублікувати в цикл ${CYCLE}</button>`}</div>
  </section>`).join("")}`;
function openQ(i) {
  const q = S.qs[i], body = q.id === "q-os" || q.id.startsWith("q-os") ? SURVEY.sections.map(s => `<div><div class="lbl" style="margin-bottom:6px">Розділ «${s.t}» · ${s.about}</div><div class="rows">${s.q.map(([id, t, o], j) => `<div class="row" style="align-items:flex-start"><span class="lbl tnum">${j + 1}</span><div class="grow">${t}<div class="s">${o.length} варіанти відповіді, рівні 1–5</div></div></div>`).join("")}</div></div>`).join("") : `<div class="lbl">Перелік питань цієї анкети підключається з Рекомендацій НУОУ (Додаток В). У прототипі показано повністю анкету особового складу.</div>`;
  openDrawer(q.t, `<div style="display:flex;gap:6px;flex-wrap:wrap">${pill("Версія " + q.ver, "p-mute nodot")}${pill(q.grp, "p-mute nodot")}</div>${body}`);
}
function newVer(i) { const q = S.qs[i]; S.qs.splice(i + 1, 0, { ...q, id: q.id + "-v" + (q.ver + 1), ver: q.ver + 1, st: "draft", upd: TODAY_UA }); addLog(me(), `Створено чернетку «${q.t}», версія ${q.ver + 1}`); persist(); render(true); toast("Створено чернетку нової версії"); }
function publishQ(i) { const q = S.qs[i]; S.qs.forEach(x => { if (x.t === q.t && x !== q && x.st === "published") x.st = "archived"; }); q.st = "published"; q.upd = TODAY_UA; S.qs = S.qs.filter(x => x.st !== "archived"); addLog(me(), `Опубліковано «${q.t}», версія ${q.ver}, у цикл ${CYCLE}`); persist(); render(true); toast("Анкету опубліковано в цикл"); }

/* Чек-лист: чотири ока — один вносить, інший підтверджує */
const valText = (f, val) => f.kind === "pct" ? `${val[0]} з ${val[1]}` : `Рівень ${val} з 5`;
V.checklist = () => {
  const ed = S.role === "checklist_editor", m = inst(ALPHA);
  const pend = Object.keys(S.fpend).length, ret = FACTS.filter(f => S.fpend[f.id] && S.fpend[f.id].ret).length;
  return `
  <section class="card c4 rise kpi-tile"><div class="kt-h"><span class="kt-ic">${IC.ok}</span><span class="lbl">Підтверджено</span></div><div class="kt-b"><span class="mid tnum">${FACTS.length - pend}</span><div class="kt-s lbl">з ${FACTS.length} показників фактів</div></div></section>
  <section class="card c4 rise kpi-tile"><div class="kt-h"><span class="kt-ic">${IC.history}</span><span class="lbl">Очікують підтвердження</span></div><div class="kt-b"><span class="mid tnum" style="color:${pend - ret ? "var(--amber)" : "inherit"}">${pend - ret}</span><div class="kt-s lbl">До індексу не потрапляють</div></div></section>
  <section class="card c4 rise kpi-tile"><div class="kt-h"><span class="kt-ic">${IC.reset}</span><span class="lbl">Повернуто на уточнення</span></div><div class="kt-b"><span class="mid tnum" style="color:${ret ? "var(--red)" : "inherit"}">${ret}</span><div class="kt-s lbl">${ed ? "Виправте й внесіть знову" : "Чекають на виконавця"}</div></div></section>
  <section class="card c12 rise">
    <div class="card-h"><h2>Показники фактів</h2><div class="sp"></div><span class="lbl">${ed ? "Ви вносите дані. Підтверджує інший працівник." : "Ви підтверджуєте дані, які вніс інший працівник."}</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Показник</th><th>Компонент</th><th>Підтверджене значення</th><th>Джерело і дата</th><th>Стан</th><th></th></tr></thead><tbody>
    ${FACTS.map(f => { const conf = S.facts[f.id], p = S.fpend[f.id], val = conf ? conf.val : f.base, meta = conf ? [conf.at, conf.by] : FACT_META[f.id] || ["10.11.2026", "Вносить дані чек-листа"];
      return `<tr><td style="min-width:240px"><b style="font-weight:600">${f.t}</b></td><td>${pill(COMP[f.c].n, "p-mute nodot")}</td>
        <td class="tnum" style="white-space:nowrap">${valText(f, val)}<div class="lbl">${fb(factValue(f, val))} зі 100</div></td>
        <td class="lbl" style="min-width:160px">${esc(conf && conf.src || f.from)}<br>${meta[0]} · ${meta[1]}</td>
        <td style="min-width:170px">${p ? (p.ret ? `${pill("Повернуто", "p-bad")}<div class="lbl" style="margin-top:4px">${esc(p.ret)}</div>` : `${pill("Очікує підтвердження", "p-warn")}<div class="lbl tnum" style="margin-top:4px">Нове: ${valText(f, p.val)} (${fb(factValue(f, p.val))})</div>`) : pill("Підтверджено", "p-good")}</td>
        <td style="white-space:nowrap">${ed ? `<button class="btn btn-soft" style="padding:6px 12px" onclick="editFact('${f.id}')">${IC.edit}Внести</button>` : p && !p.ret ? `<button class="btn btn-primary" style="padding:6px 12px" onclick="approveFact('${f.id}')">${IC.ok}Підтвердити</button> <button class="btn btn-ghost" style="padding:6px 12px" onclick="returnFact('${f.id}')">Повернути</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>
  </section>
  <section class="card c12 rise"><div class="lock">${IC.shield}<div><b>До індексу потрапляють лише підтверджені значення.</b><div class="lbl">Поточний індекс закладу ${f1(m.index)}. Після підтвердження система одразу перераховує компонент, обмежувач і прапорці. Кожна дія записується в журнал.</div></div></div></section>`;
};
function editFact(id) {
  const f = FACTS.find(x => x.id === id), p = S.fpend[id], conf = S.facts[id], val = p ? p.val : conf ? conf.val : f.base;
  openDrawer("Внести дані чек-листа", `
    <div><div class="lbl">${COMP[f.c].n}</div><div style="font-weight:600;margin-top:4px">${f.t}</div></div>
    ${f.kind === "pct" ? `<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="f-num">Кількість</label><input class="inp tnum" type="number" min="0" id="f-num" value="${val[0]}"></div><div class="field" style="flex:1"><label for="f-den">З них усього</label><input class="inp tnum" type="number" min="1" id="f-den" value="${val[1]}"></div></div>`
      : `<div class="field"><label>Рівень за анкетою чек-листа</label><div class="seg" id="f-lvl">${[1, 2, 3, 4, 5].map(l => `<button type="button" class="${l === val ? "on" : ""}" data-l="${l}">${l}</button>`).join("")}</div><span class="lbl">Рівень переводиться у шкалу 0-100: рівень 1 це 0, рівень 5 це 100.</span></div>`}
    <div class="field"><label for="f-src">Джерело (документ, реєстр)</label><input class="inp" id="f-src" value="${esc(conf && conf.src || f.from)}"></div>
    <span class="lbl" id="f-err"></span>
    <button class="btn btn-primary" id="f-ok" style="justify-content:center">${IC.send}Надіслати на підтвердження</button>`, b => {
    let lvl = val; b.querySelectorAll("#f-lvl button").forEach(x => x.onclick = () => { lvl = +x.dataset.l; b.querySelectorAll("#f-lvl button").forEach(y => y.classList.toggle("on", y === x)); });
    b.querySelector("#f-ok").onclick = () => {
      let v = lvl;
      if (f.kind === "pct") { const n = +b.querySelector("#f-num").value, d = +b.querySelector("#f-den").value; if (!(d > 0) || n < 0 || n > d || !Number.isInteger(n) || !Number.isInteger(d)) { const e = b.querySelector("#f-err"); e.textContent = "Кількість має бути цілим числом від 0 до загальної кількості."; e.style.color = "var(--red)"; return; } v = [n, d]; }
      S.fpend[id] = { val: v, src: b.querySelector("#f-src").value.trim() || f.from, at: TODAY_UA, by: me() };
      addLog(me(), `Чек-лист: внесено «${f.t}» = ${valText(f, v)}`); persist(); closeDrawer(); render(true); toast("Надіслано на підтвердження");
    };
  });
}
function approveFact(id) {
  const f = FACTS.find(x => x.id === id), p = S.fpend[id], before = inst(ALPHA).index;
  S.facts[id] = { val: p.val, src: p.src, at: TODAY_UA, by: p.by }; delete S.fpend[id];
  const after = inst(ALPHA).index;
  addLog(me(), `Чек-лист: підтверджено «${f.t}» = ${valText(f, p.val)}${after !== before ? `; індекс ${f1(before)} → ${f1(after)}` : ""}`); persist(); render(true);
  toast(after !== before ? `Підтверджено. Індекс перераховано: ${f1(before)} → ${f1(after)}` : "Підтверджено. Індекс не змінився.");
}
function returnFact(id) {
  const f = FACTS.find(x => x.id === id);
  openDrawer("Повернути на уточнення", `<div style="font-weight:600">${f.t}</div><div class="field"><label for="f-why">Що потрібно виправити</label><textarea class="inp" id="f-why" rows="3"></textarea></div><button class="btn btn-danger" id="f-no" style="justify-content:center">Повернути</button>`, b => {
    b.querySelector("#f-no").onclick = () => { const t = b.querySelector("#f-why").value.trim(); if (!t) { b.querySelector("#f-why").focus(); return; } S.fpend[id].ret = t; addLog(me(), `Чек-лист: «${f.t}» повернуто: ${t}`); persist(); closeDrawer(); render(true); toast("Повернуто виконавцю"); };
  });
}

/* Журнал */
V.audit = () => {
  const items = logItems().reverse();
  return `<section class="card c12 rise">
    <div class="card-h"><h2>Журнал дій</h2><div class="sp"></div><span id="chainSt">${pill("Ланцюг цілісний", "p-good")}</span><button class="btn btn-soft" onclick="verifyChain()">${IC.shield}Перевірити цілісність</button></div>
    <div class="lbl" style="margin-bottom:10px">Хто, коли й що змінив у налаштуваннях і даних. Кожен запис містить хеш попереднього, тож тиха правка ламає ланцюг. Відповідей респондентів у журналі немає.</div>
    <div class="tl">${items.map((x, i) => `<div class="tl-i rise" style="animation-delay:${Math.min(i, 12) * 40}ms"><span class="nd"></span><div><div style="font-weight:500">${esc(x.a)}</div><div class="lbl">${x.who} · ${x.t}</div></div><span class="hash">${x.h}</span></div>`).join("")}</div>
  </section>`;
};
function verifyChain() { let prev = "0", ok = true; logItems().forEach(x => { const h = fnv(prev + x.t + x.who + x.a); if (h !== x.h) ok = false; prev = h; }); $("#chainSt").innerHTML = pill(ok ? `Перевірено: ${logItems().length} записів, розривів немає` : "Ланцюг порушено", ok ? "p-good" : "p-bad"); addLog(me(), "Перевірка цілісності журналу"); }

/* Опитування за жетоном */
const answered = () => SURVEY_Q.filter(q => S.survey.a[q.id] != null).length;
V.survey = () => {
  const sv = S.survey, N = SURVEY_Q.length;
  if (S.tokenUsed && sv.phase !== "done") return `<div class="survey c12"><section class="card rise" style="padding:32px;text-align:center"><div class="done-ic" style="background:var(--soft);color:var(--muted)">${IC.lock}</div>
    <h2 style="margin:18px 0 6px;font-size:22px;font-weight:600">Цю анкету вже заповнено</h2><p class="lbl" style="max-width:480px;margin:0 auto 20px">Повторно відповісти за цим посиланням не можна: так ми захищаємо анонімність і не допускаємо подвоєних відповідей. Дякуємо за участь.</p>
    <a class="btn btn-primary" href="#me">Мої результати ${IC.arrowR}</a></section></div>`;
  if (sv.phase === "intro") return `<div class="survey c12"><section class="card rise" style="padding:28px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px"><span class="comp-ic" style="background:var(--lime-soft);color:var(--teal-deep)">${IC.shield}</span><span class="lbl">${SURVEY.cat} · жетон demo</span></div>
      <h2 style="margin:6px 0 4px;font-size:24px;font-weight:600;letter-spacing:-.02em">${SURVEY.title}</h2>
      <p class="lbl" style="margin:0 0 18px">Перш ніж почати: ${N} питань, анкета займе кілька хвилин. Ось що ми гарантуємо.</p>
      <div class="guar">
        <div>${IC.lock}<b>Без імен</b><span class="lbl">Ваші відповіді не повʼязані з вами і не містять імен.</span></div>
        <div>${IC.eye}<b>Лише кількість</b><span class="lbl">Адміністратор бачить лише кількість відповідей, а не те, що ви відповіли.</span></div>
        <div>${IC.users}<b>Від ${S.k} осіб</b><span class="lbl">Результати показують лише для груп не менше ${S.k} осіб.</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;flex-wrap:wrap;gap:12px"><span class="lbl">${answered() ? `Збережені раніше відповіді на цьому пристрої буде підставлено (${answered()} з ${N}).` : "Відповіді зберігаються на цьому пристрої, поки ви заповнюєте."}</span><button class="btn btn-primary" onclick="S.survey.phase='form';render()">Розумію, почати ${IC.arrowR}</button></div>
    </section></div>`;
  if (sv.phase === "done") return `<div class="survey c12"><section class="card rise" style="padding:36px;text-align:center"><div class="done-ic">${IC.ok}</div>
    <h2 style="margin:18px 0 6px;font-size:24px;font-weight:600">Дякуємо. Ваші відповіді збережено анонімно.</h2>
    <p class="lbl" style="max-width:520px;margin:0 auto 20px">Що далі: коли відповість достатньо людей (не менше ${S.k}), ви зможете побачити узагальнені результати свого підрозділу. Окремих відповідей і імен там не буде.</p>
    <a class="btn btn-primary" href="#me">Переглянути результати підрозділу ${IC.arrowR}</a></section></div>`;
  const sec = SURVEY.sections[sv.sec], last = sv.sec === SURVEY.sections.length - 1, miss = SURVEY_Q.filter(q => sv.a[q.id] == null);
  return `<div class="survey c12">
    <div class="sv-top"><span class="lbl">Розділ ${sv.sec + 1} з ${SURVEY.sections.length}</span><div class="qprog" style="flex:1">${SURVEY_Q.map(q => `<span class="${q.si === sv.sec ? "cur" : ""} ${sv.a[q.id] != null ? "done" : ""}"></span>`).join("")}</div><span class="lbl tnum">Відповіли на ${answered()} з ${N}</span><button class="icon-btn" aria-label="Закрити" onclick="S.survey.phase='intro';render();toast('Відповіді лишаються на цьому пристрої. Їх ще не надіслано.')">${IC.x}</button></div>
    <section class="card qcard" style="padding:24px" key="${sv.sec}">
      <div class="comp-top" style="margin-bottom:4px"><span class="comp-ic" style="background:${COMP[sec.id].s};color:${COMP[sec.id].c}">${IC[COMP[sec.id].ic]}</span><b style="font-size:18px">${sec.t}</b><span class="lbl">${sec.about}</span></div>
      ${sec.q.map(([id, t, o], qi) => `<fieldset class="qf" id="q-${id}"><legend>${qi + 1}. ${t}</legend><div class="opts">${o.map((x, i) => `<button type="button" class="opt ${sv.a[id] === i ? "on" : ""}" aria-pressed="${sv.a[id] === i}" onclick="pick('${id}',${i})"><span class="rb"></span><span>${x}</span></button>`).join("")}</div></fieldset>`).join("")}
      ${sv.miss && last && miss.length ? `<div class="note-box" style="margin-top:12px"><b>Залишилось відповісти на ${miss.length} ${miss.length === 1 ? "питання" : miss.length < 5 ? "питання" : "питань"}</b><span class="lbl">Натисніть на питання, щоб перейти до нього.</span>${miss.map(q => `<a class="link" href="javascript:void 0" onclick="S.survey.sec=${q.si};S.survey.miss=false;render(true);setTimeout(()=>document.getElementById('q-${q.id}').scrollIntoView({behavior:'smooth',block:'center'}),60)">Розділ «${SURVEY.sections[q.si].t}», питання ${q.qi + 1}</a>`).join("")}</div>` : ""}
      <div style="display:flex;justify-content:space-between;margin-top:20px;gap:10px">
        <button class="btn btn-ghost" ${sv.sec === 0 ? "disabled" : ""} onclick="S.survey.sec--;S.survey.miss=false;render();window.scrollTo(0,0)">${IC.arrowL}Назад</button>
        ${last ? `<button class="btn btn-primary" onclick="submitSurvey()">${IC.send}Надіслати</button>` : `<button class="btn btn-primary" onclick="S.survey.sec++;render();window.scrollTo(0,0)">Далі ${IC.arrowR}</button>`}
      </div>
    </section></div>`;
};
V.survey.after = () => { if (S.survey.phase === "done") S.survey.phase = "intro"; };
function pick(id, i) { S.survey.a[id] = i; try { localStorage.setItem("ii-survey-draft", JSON.stringify(S.survey.a)); } catch (e) {} render(true); }
function submitSurvey() {
  if (answered() < SURVEY_Q.length) { S.survey.miss = true; render(true); return; }
  S.survey = { phase: "done", sec: 0, a: {}, miss: false }; S.tokenUsed = true; UNIT_RESP[S.unit] = (UNIT_RESP[S.unit] || 0) + 1;
  try { localStorage.removeItem("ii-survey-draft"); } catch (e) {}
  addLog("Система", "Отримано анонімну відповідь, жетон погашено"); persist(); render();
}

/* Мої результати */
V.me = () => {
  const r = resolveUnit(S.unit), cr = UNIT_CR[r.unit.id] || Object.fromEntries(inst(ALPHA).components.map(c => [c.id, c.cr.v])), idx = indexOf(cr), lv = level(idx);
  return `
  <section class="c12 rise toolbar"><span class="lbl">Дякуємо, ось що ви допомогли побачити.</span><div class="sp"></div>
    <label class="lbl">Мій підрозділ <select class="inp" onchange="S.unit=this.value;persist();render(true)">${UNITS.filter(u => u.parent && u.id !== "unit-v").map(u => `<option value="${u.id}" ${u.id === S.unit ? "selected" : ""}>${u.n}</option>`).join("")}</select></label></section>
  ${r.hidden ? `<section class="card c12 rise"><div class="lock">${IC.lock}<div><b>${r.req.n}: результати приховано</b><div class="lbl">Недостатньо відповідей, щоб показати результати цієї групи (${UNIT_RESP[r.req.id]} з потрібних ${S.k}). Нижче дані підрозділу «${r.unit.n}». Це рівень вище, а не ваш підрозділ. Так захищено анонімність учасників.</div></div></div></section>` : ""}
  <section class="card c5 rise">
    <div class="lbl">${r.unit.n}: відповіли ${r.resp} осіб (потрібно не менше ${S.k})</div>
    <div class="big tnum" style="margin-top:12px">${numHTML(idx)}<span class="of">з 100</span></div>
    <div style="margin:10px 0 14px">${lvPill(lv)}</div>
    ${levelBar(idx)}
    <div class="lbl" style="margin-top:12px">Що це: індекс доброчесності від 0 до 100, середнє трьох компонентів. Шкала рівнів від 1 до 5.</div>
  </section>
  <section class="card c7 rise">
    <div class="card-h"><h2>Три компоненти</h2></div>
    <div style="display:flex;flex-direction:column;gap:18px">${COMPS.map((c, i) => `<div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span style="display:flex;gap:10px;align-items:center"><span class="comp-ic" style="background:${COMP[c].s};color:${COMP[c].c}">${IC[COMP[c].ic]}</span><b>${COMP[c].n}</b></span><span style="display:flex;gap:8px;align-items:center"><b class="tnum">${fb(cr[c])} з 100</b>${lvPill(level(cr[c]))}</span></div>
      <div class="ticks" style="height:18px;margin-top:10px">${Array.from({ length: 20 }, (_, j) => `<span class="${j < Math.round(cr[c] / 5) ? "f2" : ""} bar-a" style="animation-delay:${i * 120 + j * 20}ms;${j < Math.round(cr[c] / 5) ? `background:${COMP[c].c}` : ""}"></span>`).join("")}</div></div>`).join("")}</div>
    <div class="lbl" style="margin-top:14px">Значення компонента від 0 до 100: чим більше, тим системніше працює напрям.</div>
  </section>
  <section class="card c6 rise"><div class="card-h"><h2>Що зроблено з минулого циклу</h2></div>
    <div class="rows">${["Спростили процедуру звернень: тепер подати звернення можна за кілька хвилин.", "Провели два практичних заняття з прикладами з роботи закладу.", "Оприлюднили підсумки минулої перевірки разом із кроками, що робитимуть далі."].map(t => `<div class="row" style="align-items:flex-start"><span class="comp-ic" style="background:var(--teal-soft);color:var(--teal-deep);width:28px;height:28px">${IC.ok}</span><div class="grow">${t}</div></div>`).join("")}</div></section>
  <section class="card c6 rise"><div class="card-h"><h2>Що буде далі</h2></div>
    <div class="rows">${["Опублікуємо короткий посібник про те, куди й як повідомляти про проблеми.", "У наступному циклі окремо запитаємо, чи стало зрозуміліше, що відбувається після звернення."].map(t => `<div class="row" style="align-items:flex-start"><span class="comp-ic" style="background:var(--amber-soft);color:var(--amber);width:28px;height:28px">${IC.arrowR}</span><div class="grow">${t}</div></div>`).join("")}</div></section>
  <section class="c12 rise"><div class="lbl" style="text-align:center">Тут лише узагальнені дані групи. Окремих відповідей, імен і порівнянь підрозділів немає.</div></section>`;
};
