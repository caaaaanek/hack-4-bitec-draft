/* Звіт */
// Звіт за шаблоном Додатку Г Рекомендацій НУОУ: формальний документ без кольорів і бейджів
const SEC_ABOUT = {
  culture: "Розділ оцінює роль керівництва, інтеграцію цінностей доброчесності в корпоративну культуру, ефективність освітніх заходів та рівень відкритості.",
  system: "Розділ аналізує інституційну спроможність у сфері антикорупції та доброчесності: організацію роботи антикорупційного уповноваженого, процедури й канали звернень.",
  accountability: "Розділ оцінює практичні механізми контролю та реагування: прозорість рішень, оприлюднення результатів перевірок, контроль виконання заходів.",
};
const GRP = { wg: "РГ", os: "ОС", experts: "Експерти" };
V.report = () => {
  const m = cur(), recs = m.id === ALPHA ? buildRecs(m) : [], ms = m.id === ALPHA ? measures() : [], gs = respGroups(m);
  const g = k => gs.filter(x => k === "wg" ? x.n === "Робоча група" : k === "ex" ? x.n === "Експерти" : x.n !== "Робоча група" && x.n !== "Експерти").reduce((a, x) => a + x.resp, 0);
  const lvT = v => `${level(v)}. ${LEVELS[level(v) - 1]}`;
  const best = [...m.components].filter(c => !c.cr.lim).sort((a, b) => b.cr.v - a.cr.v), low = [...m.components].sort((a, b) => a.cr.v - b.cr.v).filter(c => c.cr.v < 65 || c.cr.lim);
  const weakItems = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
  const props = recs.filter(r => r.st !== "rejected");
  return `${backToInst()}
  <div class="c12 rise toolbar"><span class="lbl">Форма звіту відповідає Додатку Г Рекомендацій НУОУ.</span><div class="sp"></div>
    ${S.aiOn && AI_ROLES.includes(S.role) ? `<button class="btn btn-soft" onclick="aiOpen('Підготуй чернетку опису результатів для звіту')">${IC.spark}Чернетка опису</button>` : ""}
    <button class="btn btn-primary" onclick="openExport()">${IC.download}Експорт</button>
  </div>
  <article class="paper doc c12 rise">
    <div class="doc-approve">ЗАТВЕРДЖУЮ<br>Голова робочої групи<br><span class="doc-blank">військове звання</span><br><span class="doc-blank">Імʼя ПРІЗВИЩЕ</span><br>«___» ____________ 2026 року</div>
    <h2 class="doc-title">ЗВІТ</h2>
    <p class="doc-sub">про результати опитувань з визначення поточного рівня зрілості доброчесності<br>${esc(m.name)}</p>
    <p class="doc-meta">Цикл оцінювання ${CYCLE}. Дані станом на ${TODAY_UA}. Синтетичні дані для демонстрації.</p>
    <p>На підставі наказу керівника закладу ${esc(m.name)} від «___» ____________ 2026 року № ___ «Про організацію роботи з трансформації функціонування закладу на засадах прозорості та доброчесності» проведено роботу з визначення поточного рівня зрілості доброчесності за Моделлю зрілості НАЗК.</p>
    <p>Проведено анонімне опитування трьох категорій респондентів:</p>
    <p>І категорія: члени робочої групи (далі РГ), відповіли ${g("wg")} осіб.<br>ІІ категорія: особовий склад закладу (далі ОС), відповіли ${g("os")} осіб.<br>ІІІ категорія: зовнішні експерти, відповіли ${g("ex")} осіб.</p>
    <p><b>Мета опитування:</b></p>
    <ul>
      <li>визначення фактичного рівня зрілості системи доброчесності за кожним ключовим напрямом;</li>
      <li>ідентифікація найслабших місць у робочих процесах і визначення сильних сторін;</li>
      <li>формування базового показника («точки відліку») для відстеження подальшого розвитку;</li>
      <li>забезпечення керівництва обʼєктивними даними для планування заходів.</li></ul>
    <p><b>Методика дослідження:</b></p>
    <p>Онлайн-опитування на платформі з одноразовими анонімними жетонами. Результати групи показуються, лише якщо відповіли щонайменше ${S.k} осіб. Відповіді переведено в бали від 0 до 100. Сприйняття за кожним напрямом зіставлено з фактами контрольного чек-листа та даних обліку. Якщо сприйняття перевищує факти більш ніж на ${CAP} пунктів, зараховується значення «факти + ${CAP}». Індекс доброчесності є середнім трьох напрямів, рівень зрілості визначається межами 12,5 / 37,5 / 62,5 / 87,5.</p>
    <p><b>Основна частина:</b></p>
    <p>Аналіз проведено за трьома розділами Моделі зрілості НАЗК: «Культура», «Система» та «Підзвітність».</p>
    ${m.components.map((c, ci) => `
    <h3>Розділ ${ci + 1}. ${COMP[c.id].n}</h3>
    <p>${SEC_ABOUT[c.id]}</p>
    <p class="doc-cap">Таблиця ${ci * 2 + 1}. Сприйняття за питаннями анкет</p>
    <table class="doc-t"><thead><tr><th>№</th><th>Питання</th><th>Категорія</th><th>Вага, %</th><th>Середній бал</th><th>Рівень зрілості (за моделлю НАЗК)</th></tr></thead><tbody>
    ${m.pItems.filter(x => x.c === c.id).map((x, i) => `<tr><td>${ci + 1}.${i + 1}</td><td>${esc(x.t)}</td><td>${GRP[x.src]}</td><td class="tnum">${x.w}</td><td class="tnum">${fb(x.v)}</td><td>${lvT(x.v)}</td></tr>`).join("")}</tbody></table>
    <p class="doc-cap">Таблиця ${ci * 2 + 2}. Факти: контрольний чек-лист і дані обліку</p>
    <table class="doc-t"><thead><tr><th>№</th><th>Показник</th><th>Дані</th><th>Вага, %</th><th>Бал</th></tr></thead><tbody>
    ${m.fItems.filter(x => x.c === c.id).map((x, i) => `<tr><td>${ci + 1}.${i + 1}</td><td>${esc(x.t)}</td><td>${x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`}</td><td class="tnum">${x.w}</td><td class="tnum">${fb(x.v)}</td></tr>`).join("")}</tbody></table>
    <p>За розділом «${COMP[c.id].n}» сприйняття становить ${fb(c.P)}, факти ${fb(c.F)}, зараховано ${fb(c.cr.v)} з 100, що відповідає рівню зрілості ${lvT(c.cr.v)}.${c.cr.lim ? ` ${c.cr.reason}` : ""} ${c.P - c.F > 10 ? "Самооцінка помітно вища за підтверджені факти, тож висновки потребують підтвердження документами." : c.F - c.P > 10 ? "Факти вищі за сприйняття: наявні процедури варто краще доносити до особового складу." : "Сприйняття й факти в цілому узгоджуються."}</p>`).join("")}
    <h3>Розділ 4. Достовірність результатів</h3>
    <p>Достовірність ${m.trust === "insufficient" ? "не оцінюється" : m.trust}: ${TRUST[m.trust][1].toLowerCase()}. ${m.raised.length ? `Спрацювало автоматичних перевірок: ${m.raised.length}.` : "Жодна автоматична перевірка не спрацювала."}</p>
    ${m.raised.length ? `<ol>${m.raised.map(f => `<li>${esc(f.t)} (${f.w === "major" ? "серйозна" : "незначна"}). ${f.ex}</li>`).join("")}</ol>` : ""}
    <h3>Висновок</h3>
    <p>На основі аналізу відповідей респондентів за критеріями розділів «Культура», «Система» та «Підзвітність» Моделі зрілості НАЗК <b>загальний рівень зрілості доброчесності у ${esc(m.name)} можна оцінити як «${LEVELS[m.level - 1]}»</b> (рівень ${m.level} з 5; індекс доброчесності ${f1(m.index)} з 100; ${m.delta > 0 ? `на ${pts(m.delta)} вище` : m.delta < 0 ? `на ${pts(m.delta)} нижче` : "без змін"} порівняно з попереднім циклом).</p>
    <p><i>Довідково:</i> ${m.fItems.filter(x => x.kind === "pct").map(x => `${x.t.toLowerCase()}: ${x.val[0]} з ${x.val[1]}`).join("; ")}.</p>
    <p><b>Найбільш ефективні напрями:</b></p>
    <ol>${best.slice(0, 2).map(c => `<li>${COMP[c.id].n}: зараховано ${fb(c.cr.v)}, рівень ${lvT(c.cr.v)}.</li>`).join("")}</ol>
    <p><b>Напрями, що потребують більшої уваги:</b></p>
    <ol>${(low.length ? low.map(c => `<li>${COMP[c.id].n}: ${c.cr.lim ? "самооцінку не підтверджують факти" : `зараховано ${fb(c.cr.v)}`}.</li>`) : []).concat(weakItems.map(x => `<li>${x.t}: ${fb(x.v)} з 100.</li>`)).slice(0, 4).join("")}</ol>
    <p><b>Пропозиції:</b></p>
    ${props.length ? `<ol>${props.map(r => `<li>${r.t} (${COMP[r.c].n}; ${REC_ST[r.st][0].toLowerCase()}).</li>`).join("")}</ol>` : `<ol>${weakItems.map(x => `<li>Розробити заходи щодо показника «${x.t}».</li>`).join("")}</ol>`}
    ${S.notes.length && m.id === ALPHA ? `<p><b>Опис результатів</b> (чернетку підготовлено асистентом, затверджено керівником):</p>${S.notes.map((n, i) => `<div class="note-ai"><p>${esc(n.t)}</p><div class="noprint" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="lbl">${n.who} · ${n.at}</span>${S.role === "leader" ? `<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;margin-left:auto" onclick="S.notes.splice(${i},1);persist();render(true)">Прибрати</button>` : ""}</div></div>`).join("")}` : ""}
    ${ms.length ? `<p class="doc-cap">Таблиця 7. Заходи плану трансформації</p><table class="doc-t"><thead><tr><th>№</th><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Стан</th></tr></thead><tbody>${ms.map((x, i) => `<tr><td>${i + 1}</td><td>${x.t}</td><td>${x.who}</td><td class="tnum">${ua(x.due)}</td><td>${M_ST[dispSt(x)][0]}</td></tr>`).join("")}</tbody></table>` : ""}
    <p class="doc-note">Усі бали, рівні й перевірки розраховано явними правилами методики v1.0. Окремих відповідей, імен і порівнянь підрозділів у звіті немає.</p>
    <div class="doc-sign"><span>Секретар робочої групи</span><span class="doc-blank">підпис</span><span class="doc-blank">Імʼя ПРІЗВИЩЕ</span></div>
  </article>`;
};
// Експорт: одна кнопка, формат обирається у вікні
function openExport() {
  const opts = [...(API.on ? [["docx", IC.file, "Документ Word (.docx)", "Звіт за структурою Додатку Г, готовий до підпису."], ["xlsx", IC.table, "Таблиця Excel (.xlsx)", "Звіт із таблицями за розділами."]] : []), ["print", IC.print, "PDF або друк", "Звіт у форматі документа. У вікні друку оберіть «Зберегти як PDF»."], ["html", IC.file, "Документ HTML", "Відкривається в будь-якому браузері, можна відкрити в Word."], ["csv", IC.table, "Таблиця CSV", "Усі питання й показники з балами. Для Excel."], ["json", IC.file, "Дані JSON", "Для інших систем і бекенду."], ["copy", IC.copy, "Копіювати CSV", "У буфер обміну, щоб вставити в таблицю."]];
  const d = $("#exp");
  d.innerHTML = `<form method="dialog" class="exp-box"><div class="card-h"><h2>Експорт звіту</h2><div class="sp"></div><button class="icon-btn" value="x" aria-label="Закрити">${IC.x}</button></div>
    <div class="lbl" style="margin-bottom:10px">${esc(cur().name)} · цикл ${CYCLE}</div>
    <div class="exp-list">${opts.map(([k, ic, t, ds]) => `<button type="button" class="exp-opt" onclick="doExport('${k}')"><span class="comp-ic" style="background:var(--soft)">${ic}</span><span><b>${t}</b><span class="lbl">${ds}</span></span></button>`).join("")}</div></form>`;
  d.showModal();
}
async function apiDownloadReport(fmt) {
  try {
    const q = API.unitId ? `&unit_id=${API.unitId}` : "";
    const r = await fetch(`${API.base}/campaigns/${API.campaignId}/report?format=${fmt}${q}`, { headers: apiAuth() });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Не вдалося сформувати файл");
    const cd = r.headers.get("content-disposition") || "", name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || `integrity-report.${fmt}`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast("Завантажено: " + name);
  } catch (e) { toast(e.message); }
}
function doExport(k) { $("#exp").close(); if (k === "docx" || k === "xlsx") return apiDownloadReport(k); if (k === "print") { addLog(me(), "Експорт звіту (PDF / друк)"); return setTimeout(() => window.print(), 50); } if (k === "copy") return copyOut("csv"); copyOut(k, true); }
function copyOut(kind, dl) {
  const m = cur(); let txt;
  if (kind === "html") { const doc = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Звіт ${CYCLE}</title><style>body{font:14pt/1.5 "Times New Roman",Times,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#000}table{border-collapse:collapse;width:100%;margin:6px 0 12px}td,th{border:1px solid #000;padding:4px 6px;font-size:12pt;text-align:left;vertical-align:top}th{font-weight:bold}.doc-approve{margin-left:auto;width:300px}.doc-title{text-align:center;font-size:16pt;margin:24px 0 4px}.doc-sub{text-align:center;font-weight:bold}.doc-meta,.doc-note{font-size:11pt}.doc-cap{text-align:right;font-style:italic;margin-bottom:2px}.doc-sign{display:flex;justify-content:space-between;margin-top:36px}.doc-blank{display:inline-block;min-width:140px;border-top:1px solid #000;font-size:10pt;text-align:center}.noprint,svg,button{display:none}p{text-align:justify}</style></head><body>${document.querySelector(".paper").innerHTML}</body></html>`; return download(`integrity-report-${m.id}-${CYCLE}.html`, doc, "text/html"); }
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
  const all = logItems(), q = (S.logQ || "").trim().toLowerCase(), who = S.logWho || "all";
  const shown = all.map((x, i) => ({ ...x, n: i + 1 })).filter(x => (who === "all" || x.who === who) && (!q || (x.a + " " + x.who + " " + x.t + " " + x.h).toLowerCase().includes(q))).reverse();
  // однакові записи підряд (наприклад, кілька перевірок) показуються одним рядком з лічильником
  const groups = []; shown.forEach(x => { const g = groups[groups.length - 1]; if (g && g[0].a === x.a && g[0].who === x.who) g.push(x); else groups.push([x]); });
  const actors = [...new Set(all.map(x => x.who))].sort();
  return `<section class="card c12 rise">
    <div class="card-h" style="flex-wrap:wrap"><h2>Журнал дій</h2><div class="sp"></div><span id="chainSt">${pill("Ланцюг цілісний", "p-good")}</span><button class="btn btn-soft" onclick="verifyChain()">${IC.shield}Перевірити цілісність</button></div>
    <div class="toolbar" style="margin-bottom:8px"><label class="search inst-search"><span>${IC.search}</span><input id="logQ" placeholder="Дія, роль, дата або хеш" value="${esc(S.logQ || "")}" oninput="S.logQ=this.value;render(true);const i=$('#logQ');i.focus();i.setSelectionRange(i.value.length,i.value.length)"></label>
      <select class="inp" aria-label="Хто" onchange="S.logWho=this.value;render(true)"><option value="all">Усі ролі</option>${actors.map(a => `<option ${who === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <span class="lbl tnum">Показано ${shown.length} з ${all.length}</span></div>
    ${groups.length ? `<div class="tl">${groups.map((g, i) => { const x = g[0]; return `<div class="tl-i rise click" role="button" tabindex="0" style="animation-delay:${Math.min(i, 12) * 40}ms" onclick="openLog(${x.n}${g.length > 1 ? `,${g[g.length - 1].n}` : ""})" onkeydown="if(event.key==='Enter')this.click()"><span class="nd"></span><div><div style="font-weight:500">${esc(x.a)}${g.length > 1 ? ` <span class="pill p-mute nodot">×${g.length}</span>` : ""}</div><div class="lbl">${esc(x.who)} · ${g.length > 1 ? `${g[g.length - 1].t} – ${x.t}` : x.t}</div></div><span class="hash">${x.h}</span></div>`; }).join("")}</div>` : `<div class="empty">Записів за цим запитом немає.</div>`}
  </section>`;
};
// Подробиці запису: що, хто, коли, номер у ланцюгу, хеш попереднього, перевірка саме цього запису
function openLog(n, n2) {
  const all = logItems(), x = all[n - 1], prev = n > 1 ? all[n - 2].h : "0", ok = fnv(prev + x.t + x.who + x.a) === x.h;
  openDrawer("Запис журналу", `
    <div><div class="lbl">Запис № ${n} з ${all.length}</div><div style="font-size:16px;font-weight:600;margin-top:4px">${esc(x.a)}</div></div>
    ${n2 ? `<div class="note-box"><span class="lbl">Таких записів підряд: ${n - n2 + 1} (№ ${n2}–${n}). Показано останній.</span></div>` : ""}
    <dl class="inst-kv" style="grid-template-columns:auto 1fr"><dt>Хто</dt><dd>${esc(x.who)}</dd><dt>Коли</dt><dd class="tnum">${x.t}</dd><dt>Хеш запису</dt><dd><span class="hash">${x.h}</span></dd><dt>Хеш попереднього</dt><dd><span class="hash">${prev}</span></dd></dl>
    <div>${pill(ok ? "Запис не змінювали" : "Запис змінено після створення", ok ? "p-good" : "p-bad")}</div>
    <div class="lbl">Хеш рахується з попереднього хешу, часу, ролі й опису дії. Якщо змінити будь-що в цьому чи попередніх записах, хеші далі по ланцюгу не зійдуться. Імен і відповідей респондентів у журналі немає, лише ролі.</div>`);
}
function verifyChain() { let prev = "0", ok = true; logItems().forEach(x => { const h = fnv(prev + x.t + x.who + x.a); if (h !== x.h) ok = false; prev = h; }); addLog(me(), "Перевірка цілісності журналу"); const n = logItems().length; render(true); $("#chainSt").innerHTML = pill(ok ? `Перевірено ${n} записів, розривів немає` : "Ланцюг порушено", ok ? "p-good" : "p-bad"); toast(ok ? "Ланцюг цілісний. Сама перевірка теж записана в журнал." : "Ланцюг порушено"); }

/* Опитування за жетоном */
const answered = () => SQ().filter(q => S.survey.a[q.id] != null).length;
V.survey = () => {
  const sv = S.survey, N = SQ().length;
  if ((API.on ? API.surveyUsed : S.tokenUsed) && sv.phase !== "done") return `<div class="survey c12"><section class="card rise" style="padding:32px;text-align:center"><div class="done-ic" style="background:var(--soft);color:var(--muted)">${IC.lock}</div>
    <h2 style="margin:18px 0 6px;font-size:22px;font-weight:600">Цю анкету вже заповнено</h2><p class="lbl" style="max-width:480px;margin:0 auto 20px">Повторно відповісти за цим посиланням не можна: так ми захищаємо анонімність і не допускаємо подвоєних відповідей. Дякуємо за участь.</p>
    ${API.anon ? "" : `<a class="btn btn-primary" href="#me">Мої результати ${IC.arrowR}</a>`}</section></div>`;
  if (sv.phase === "intro") return `<div class="survey c12"><section class="card rise" style="padding:28px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px"><span class="comp-ic" style="background:var(--lime-soft);color:var(--teal-deep)">${IC.shield}</span><span class="lbl">${SV().cat} · ${API.on ? (API.anon ? "одноразове посилання" : "за обліковим записом") : "жетон demo"}</span></div>
      <h2 style="margin:6px 0 18px;font-size:24px;font-weight:600;letter-spacing:-.02em">${SV().title}</h2>
      <div class="guar">
        <div>${IC.lock}<b>Без імен</b><span class="lbl">Ваші відповіді не повʼязані з вами і не містять імен.</span></div>
        <div>${IC.eye}<b>Лише кількість</b><span class="lbl">Адміністратор бачить лише кількість відповідей, а не те, що ви відповіли.</span></div>
        <div>${IC.users}<b>Від ${S.k} осіб</b><span class="lbl">Результати показують лише для груп не менше ${S.k} осіб.</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;flex-wrap:wrap;gap:12px"><span class="lbl">${answered() ? `Збережені раніше відповіді на цьому пристрої буде підставлено (${answered()} з ${N}).` : "Відповіді зберігаються на цьому пристрої, поки ви заповнюєте."}</span><button class="btn btn-primary" onclick="S.survey.phase='form';render()">Розумію, почати ${IC.arrowR}</button></div>
    </section></div>`;
  if (sv.phase === "done") return `<div class="survey c12"><section class="card rise" style="padding:36px;text-align:center"><div class="done-ic">${IC.ok}</div>
    <h2 style="margin:18px 0 6px;font-size:24px;font-weight:600">Дякуємо. Ваші відповіді збережено анонімно.</h2>
    <p class="lbl" style="max-width:520px;margin:0 auto 20px">Що далі: коли відповість достатньо людей (не менше ${S.k}), ${API.anon ? "узагальнені результати підрозділу стануть доступні керівництву й учасникам" : "ви зможете побачити узагальнені результати свого підрозділу"}. Окремих відповідей і імен там не буде.</p>
    ${API.anon ? "" : `<a class="btn btn-primary" href="#me">Переглянути результати підрозділу ${IC.arrowR}</a>`}</section></div>`;
  const sec = SV().sections[sv.sec], SC = COMP[sec.id] || { s: "var(--soft)", c: "var(--muted)", ic: "survey" }, last = sv.sec === SV().sections.length - 1, miss = SQ().filter(q => sv.a[q.id] == null);
  return `<div class="survey c12">
    <div class="sv-top"><span class="lbl">Розділ ${sv.sec + 1} з ${SV().sections.length}</span><div class="qprog" style="flex:1">${SQ().map(q => `<span class="${q.si === sv.sec ? "cur" : ""} ${sv.a[q.id] != null ? "done" : ""}"></span>`).join("")}</div><span class="lbl tnum">Відповіли на ${answered()} з ${N}</span><button class="icon-btn" aria-label="Закрити" onclick="S.survey.phase='intro';render();toast('Відповіді лишаються на цьому пристрої. Їх ще не надіслано.')">${IC.x}</button></div>
    <div class="qcard" key="${sv.sec}">
      <div class="sv-sec-h"><span class="comp-ic" style="background:${SC.s};color:${SC.c}">${IC[SC.ic]}</span><div><b>${sec.t}</b><div class="lbl">${sec.about}</div></div></div>
      ${sec.q.map(([id, t, o], qi) => `<fieldset class="card qf" id="q-${id}"><legend>${qi + 1}. ${t}</legend><div class="opts">${o.map((x, i) => `<button type="button" class="opt ${sv.a[id] === i ? "on" : ""}" aria-pressed="${sv.a[id] === i}" onclick="pick('${id}',${i})"><span class="rb"></span><span>${x}</span></button>`).join("")}</div></fieldset>`).join("")}
      ${sv.miss && last && miss.length ? `<div class="note-box" style="margin-top:12px"><b>Залишилось відповісти на ${miss.length} ${miss.length === 1 ? "питання" : miss.length < 5 ? "питання" : "питань"}</b><span class="lbl">Натисніть на питання, щоб перейти до нього.</span>${miss.map(q => `<a class="link" href="javascript:void 0" onclick="S.survey.sec=${q.si};S.survey.miss=false;render(true);setTimeout(()=>document.getElementById('q-${q.id}').scrollIntoView({behavior:'smooth',block:'center'}),60)">Розділ «${SV().sections[q.si].t}», питання ${q.qi + 1}</a>`).join("")}</div>` : ""}
      <div style="display:flex;justify-content:space-between;margin-top:20px;gap:10px">
        <button class="btn btn-ghost" ${sv.sec === 0 ? "disabled" : ""} onclick="S.survey.sec--;S.survey.miss=false;render();window.scrollTo(0,0)">${IC.arrowL}Назад</button>
        ${last ? `<button class="btn btn-primary" onclick="submitSurvey()">${IC.send}Надіслати</button>` : `<button class="btn btn-primary" onclick="S.survey.sec++;render();window.scrollTo(0,0)">Далі ${IC.arrowR}</button>`}
      </div>
    </div></div>`;
};
V.survey.after = () => { if (S.survey.phase === "done") S.survey.phase = "intro"; };
function pick(id, i) { S.survey.a[id] = i; try { localStorage.setItem("ii-survey-draft", JSON.stringify(S.survey.a)); } catch (e) {} render(true); }
function submitSurvey() {
  if (answered() < SQ().length) { S.survey.miss = true; render(true); return; }
  if (API.on) return apiSubmitSurvey();
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
