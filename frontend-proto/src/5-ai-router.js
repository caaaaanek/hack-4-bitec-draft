/* ---------- ШІ-асистент: лише пояснення та чернетки ---------- */
const AI = { live: null, busy: false, model: "" };
const modelName = m => (m || "LLM").split("/").pop();
const SUGG = ["Поясни індекс", "Що робити в першу чергу?", "Чому спрацював обмежувач?", "Підготуй чернетку опису результатів для звіту"];
const SUGG_COL = ["var(--teal-soft)", "var(--blue-soft)", "var(--lime-soft)", "var(--amber-soft)"];
function aiCtx() {
  const m = cur();
  return {
    institution: m.name, cycle: CYCLE, asOf: TODAY, index: m.index, previousIndex: m.prevIndex, delta: m.delta,
    level: `${m.level} — ${LEVELS[m.level - 1]}`, trust: `${TRUST[m.trust][0]} — ${TRUST[m.trust][1]}`, summary: m.summary,
    components: m.components.map(c => ({ name: COMP[c.id].n, perception: c.P, facts: c.F, credited: c.cr.v, limitedByFacts: c.cr.lim, rule: c.cr.lim ? c.cr.reason : null })),
    perceptionItems: m.pItems.map(x => ({ name: x.t, component: COMP[x.c].n, source: SRC[x.src][0], weight: x.w, value: x.v })),
    factItems: m.fItems.map(x => ({ name: x.t, component: COMP[x.c].n, data: x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`, weight: x.w, value: x.v })),
    flags: m.raised.map(f => ({ title: f.t, weight: f.w === "major" ? "серйозний" : "незначний", explanation: f.ex })),
    recommendations: m.id === ALPHA ? buildRecs(m).map(r => ({ title: r.t, component: COMP[r.c].n, priority: PRI[r.pri][0], status: REC_ST[r.st][0], why: r.why, basedOn: r.evidence.map(e => `${e.t}: ${e.v}`) })) : [],
    measures: m.id === ALPHA ? measures().map(x => ({ title: x.t, responsible: x.who, due: x.due, status: M_ST[dispSt(x)][0] })) : [],
    anonymityThreshold: S.k, responses: m.responses,
  };
}
function aiTemplate(q) {
  const s = q.toLowerCase(), m = cur(), recs = m.id === ALPHA ? buildRecs(m) : [];
  const comps = m.components.map(c => `${COMP[c.id].n} ${fb(c.cr.v)}`);
  if (/чому така достовірн|прапор|достовірн/.test(s)) return { t: trustText(m), src: [`Достовірність ${TRUST[m.trust][0]}`, ...m.flags.map(f => `${f.id}: ${f.raised ? "так" : "ні"}`)], fixed: true };
  if (/чому такий індекс/.test(s)) return { t: `${whyText(m, true)}\n\n${flagsText(m)}`, src: ["Методика v1.0", `Індекс ${f1(m.index)}`, `Достовірність ${TRUST[m.trust][0]}`, ...m.raised.map(f => f.id)], fixed: true };
  if (/звіт|чернетк|опис/.test(s)) {
    const sorted = [...m.components].sort((a, b) => b.cr.v - a.cr.v), low = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
    const t = `За результатами циклу ${CYCLE} ${m.name} перебуває на рівні зрілості ${m.level} «${LEVELS[m.level - 1]}»: індекс доброчесності ${f1(m.index)} з 100, ${m.delta >= 0 ? "на " + pts(m.delta) + " вище" : "на " + pts(m.delta) + " нижче"}, ніж у попередньому циклі.

Найвищий результат має компонент «${COMP[sorted[0].id].n}» (${fb(sorted[0].cr.v)}), найнижчий — «${COMP[sorted[2].id].n}» (${fb(sorted[2].cr.v)}).${m.limited ? ` Для компонента «${COMP[m.limited.id].n}» самооцінку не підтверджують факти: сприйняття ${fb(m.limited.P)} проти фактів ${fb(m.limited.F)}, тому зараховано ${fb(m.limited.cr.v)}.` : ""}

Першочергової уваги потребують: ${low.map(x => `«${x.t}» (${fb(x.v)})`).join(", ")}. Достовірність результату: ${TRUST[m.trust][0]}, ${TRUST[m.trust][1].toLowerCase()}${m.raised.length ? `; прапорці: ${m.raised.map(f => f.t.toLowerCase()).join("; ")}` : ""}.`;
    return { t, draft: true, src: ["Методика v1.0", `Індекс ${f1(m.index)}`, ...low.map(x => `${x.id} ${fb(x.v)}`)] };
  }
  if (/перш|пріоритет|що робити|почати/.test(s)) {
    const open = recs.filter(r => r.st === "proposed" || r.st === "clarified").slice(0, 3);
    const t = open.length ? `Правила системи пропонують ${recs.length} рекомендацій. Без рішення зараз ${open.length}; першими варто розглянути:\n${open.map(r => `• ${r.t} (${COMP[r.c].n}, пріоритет ${PRI[r.pri][0].toLowerCase()}). Підстава: ${r.evidence.map(e => `${e.t.toLowerCase()} — ${e.v}`).join("; ")}.`).join("\n")}\n\nРішення про прийняття, строк і відповідальну посаду ухвалює керівник на екрані «Рекомендації».` : "Усі рекомендації вже мають рішення. Наступні зʼявляться після нового циклу оцінювання.";
    return { t, src: open.map(r => `Правило: ${r.id}`) };
  }
  if (/анонім|аноним|поріг|\bk\b/.test(s)) return { t: `Результати групи показуються лише тоді, коли в ній щонайменше ${S.k} відповідей. Менші групи приховано, а учасник бачить дані рівня вище. Анкети проходять за одноразовими жетонами, не повʼязаними з відповідями; адміністратор бачить лише кількість. Асистент отримує тільки узагальнені показники після цього порогу.`, src: [`k = ${S.k}`, "Одноразові жетони"] };
  if (/обмеж|\+ ?25|методик|ваг|формул|рахує/.test(s)) {
    const l = m.limited;
    return { t: `Індекс — середнє трьох компонентів з однаковою вагою (по 33,3 %). Кожен компонент має сприйняття (анкети РГ, ОС і експертів, зважене середнє питань) і факти (чек-лист і дані обліку).\nПравило обмежувача: зараховано = min(сприйняття; факти + ${CAP}).${l ? `\nЗараз воно спрацювало для «${COMP[l.id].n}»: ${l.cr.reason}` : "\nЗараз обмежувач не спрацював у жодному компоненті."}\nРівень зрілості визначають межі 12,5 / 37,5 / 62,5 / 87,5.`, src: ["Методика v1.0", "Розклад індексу"] };
  }
  const item = allItems(m).find(x => s.includes(x.t.toLowerCase().slice(0, 18)));
  const comp = COMPS.find(c => s.includes(COMP[c].n.toLowerCase().slice(0, 6)));
  if (item) return { t: `«${item.t}»: ${fb(item.v)} зі 100 (${ST[status(item.v)][0].toLowerCase()}). Це ${item.src ? SRC[item.src][0].toLowerCase() : "факт"} з вагою ${item.w} % у компоненті «${COMP[item.c].n}».${item.kind === "pct" ? ` Дані: ${item.val[0]} з ${item.val[1]}.` : item.kind === "lvl" ? ` Рівень ${item.val} з 5 за анкетою чек-листа.` : ""}`, src: [item.id, `${fb(item.v)} зі 100`] };
  if (comp) { const c = m.byId[comp]; return { t: `«${COMP[comp].n}»: зараховано ${fb(c.cr.v)} (рівень зрілості ${level(c.cr.v)}). Сприйняття ${fb(c.P)}, факти ${fb(c.F)}.${c.cr.lim ? " " + c.cr.reason : " Обмежувач не спрацював: сприйняття не перевищує факти більш ніж на 25 пунктів."}`, src: [`${COMP[comp].n} ${fb(c.cr.v)}`, "Методика v1.0"] }; }
  if (/індекс|загал|рівень|стан/.test(s)) return { t: whyText(m), src: ["Методика v1.0", ...comps] };
  return { t: "Можу пояснити індекс, будь-який компонент чи показник, методику й обмежувач, захист анонімності, підказати, з чого почати, або підготувати чернетку опису для звіту. Рішення щодо оцінок і заходів ухвалюють правила системи та посадові особи.", src: [] };
}
function aiModeHTML() {
  if (!S.aiOn) return `<i style="background:var(--faint)"></i>Вимкнено · розрахунки працюють без ШІ`;
  if (AI.live) return `<i style="background:var(--teal)"></i>${esc(modelName(AI.model))} · відповіді є лише чернетками`;
  return `<i style="background:var(--amber)"></i>Демо-режим · відповіді з шаблонів правил`;
}
function aiMsgHTML(m, i) {
  if (m.r === "u") return `<div class="m u">${esc(m.t)}</div>`;
  const canAccept = S.role === "leader" && m.draft;
  return `<div class="m a"><div class="m-h">${pill("Чернетка ШІ", "p-info nodot")}<span class="lbl">${m.live ? esc(modelName(m.model)) : "Шаблон правил"}</span></div>
    <div class="m-t" data-i="${i}">${esc(m.t)}</div>
    ${m.src && m.src.length ? `<div class="src">${m.src.map(x => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    <div class="m-act"><button type="button" onclick="aiCopy(${i})">${IC.copy}Копіювати</button>${canAccept ? (m.accepted ? `<button type="button" disabled>${IC.ok}Додано до звіту</button>` : `<button type="button" class="ok" onclick="aiAccept(${i})">${IC.ok}Затвердити у звіт</button>`) : ""}</div></div>`;
}
function aiRender(animateLast) {
  $("#aiMode").innerHTML = aiModeHTML(); $("#aiOn").checked = S.aiOn;
  $("#aiQ").disabled = !S.aiOn; $("#aiSend").disabled = !S.aiOn;
  const log = $("#aiLog");
  if (!S.aiOn) { log.innerHTML = `<div class="ai-off">${IC.lock}<b style="color:var(--fg)">Асистент вимкнено</b><span>Індекс, рекомендації та звіти працюють як і раніше: їх розраховують правила системи.</span></div>`; return; }
  if (!S.chat.length) {
    log.innerHTML = `<div class="ai-hello"><div class="ai-orb">${IC.spark}</div><b style="font-size:17px">Поясню результати й підготую чернетки</b><span class="lbl">Рішення ухвалюють правила та посадові особи</span>
      <div class="chips">${SUGG.map((q, i) => `<button type="button" class="chip-q" style="background:${SUGG_COL[i]};animation-delay:${150 + i * 70}ms" onclick="aiAsk(this.textContent)">${q}</button>`).join("")}</div></div>`;
    return;
  }
  log.innerHTML = S.chat.map(aiMsgHTML).join("") + (AI.busy ? `<div class="typing"><span></span><span></span><span></span></div>` : "");
  if (animateLast) {
    const el = log.querySelector(`.m-t[data-i="${S.chat.length - 1}"]`);
    if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const words = S.chat[S.chat.length - 1].t.split(/(\s+)/); let n = 0; el.textContent = "";
      const tick = () => { n += 3; el.textContent = words.slice(0, n).join(""); log.scrollTop = log.scrollHeight; if (n < words.length) setTimeout(tick, 28); };
      tick();
    }
  }
  log.scrollTop = log.scrollHeight;
}
function checkLive() {
  if (AI.live !== null) return;
  fetch("/api/assistant").then(r => r.ok ? r.json() : { live: false }).then(j => { AI.live = !!j.live; AI.model = j.model || ""; aiRender(); }).catch(() => { AI.live = false; aiRender(); });
}
async function aiAsk(q) {
  q = (q || "").trim(); if (!q || AI.busy || !S.aiOn) return;
  const history = S.chat.slice(-4).map(m => ({ role: m.r === "u" ? "user" : "assistant", content: m.t }));
  S.chat.push({ r: "u", t: q }); AI.busy = true; aiRender();
  const local = aiTemplate(q); let msg = null;
  if (AI.live && !local.fixed) {
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json", ...apiAuth() }, body: JSON.stringify({ question: q, context: aiCtx(), history }) });
      const j = await r.json();
      if (r.ok && j.text) msg = { r: "a", t: j.text, src: local.src, draft: local.draft || /звіт|чернетк|опис/i.test(q), live: true, model: j.model };
    } catch (e) {}
  } else await new Promise(res => setTimeout(res, 650));
  if (!msg) msg = { r: "a", ...local, live: false };
  S.chat.push(msg); AI.busy = false;
  addLog(me(), `Запит до ШІ-асистента (${msg.live ? modelName(msg.model) : "шаблон"}, лише агреговані дані)`);
  aiRender(true);
}
function aiCopy(i) { const t = S.chat[i].t; const done = () => toast("Скопійовано"); try { navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done)); } catch (e) { fallbackCopy(t, done); } }
function aiAccept(i) {
  const m = S.chat[i]; m.accepted = true;
  S.notes.push({ t: m.t, who: me(), at: new Date().toISOString().slice(0, 16).replace("T", " ") });
  addLog(me(), "Чернетку ШІ затверджено й додано до звіту"); persist(); aiRender(); toast("Додано до звіту");
  if (route().r === "report") render(true);
}
function aiOpen(q) {
  if (!AI_ROLES.includes(S.role)) return;
  $("#ai").classList.add("on"); $("#ai").setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on");
  aiRender(); checkLive();
  if (q) aiAsk(q); else setTimeout(() => S.aiOn && $("#aiQ").focus(), 350);
}
function aiClose() { $("#ai").classList.remove("on"); $("#ai").setAttribute("aria-hidden", "true"); if (!$("#drawer").classList.contains("on")) $("#scrim").classList.remove("on"); }
function aiBtn() { const b = $("#aiBtn"); b.innerHTML = `${IC.spark}<span class="hide-m">Асистент</span>`; b.classList.toggle("off", !S.aiOn); b.hidden = !AI_ROLES.includes(S.role); }

/* ---------- Router ---------- */
const allowed = r => NAV.some(n => n[0] === r && n[3].includes(S.role)) && (!API.anon || r === "survey");
function route() { const [r, p] = (location.hash || "").slice(1).split("/"); return allowed(r) ? { r, p } : { r: HOME[S.role], p: null }; }
function updateBadges() {
  const recs = pendingRecs(), ms = measures(), od = ms.filter(x => overdueDays(x) > 0).length, pend = Object.values(S.fpend).filter(p => !p.ret).length;
  document.querySelectorAll("#nav a").forEach(a => {
    const b = a.querySelector(".badge"); if (b) b.remove();
    const r = a.dataset.r, n = r === "recs" ? recs : r === "tracker" ? (od ? `${ms.length} · ${od}!` : ms.length) : r === "checklist" && S.role === "checklist_approver" ? pend : 0;
    if (n) a.insertAdjacentHTML("beforeend", `<span class="badge ${r === "tracker" && !od ? "mute" : ""}">${n}</span>`);
  });
}
function renderNav(cur) {
  $("#nav").innerHTML = NAV.filter(n => n[3].includes(S.role)).map(([r, n, ic]) => `<a href="#${r}" data-r="${r}" class="${r === cur ? "on" : ""}" ${r === cur ? 'aria-current="page"' : ""} aria-label="${n}"${document.documentElement.classList.contains("side-mini") ? ` data-tip="${n}"` : ""}>${IC[ic]}<span>${n}</span></a>`).join("");
  updateBadges();
}
const TITLES = { checks: () => "Перевірки", people: () => "Люди й ролі", summary: () => "Зведення", overview: () => "Огляд закладу", explain: () => "Розклад індексу", trends: () => "Динаміка", compare: () => "Порівняння: сприйняття і факти", recs: () => "Рекомендації", tracker: () => "Трекер заходів", sources: () => "Джерела", report: () => "Звіт", manage: () => "Керування циклом", surveys: () => "Анкети", checklist: () => "Чек-лист", audit: () => "Журнал", survey: () => "Анонімне опитування", me: () => "Мої результати", institutions: () => "Заклади" };
let lastRoute = null, lastApiView = false;
function render(soft) {
  if (API.on && !API.user && !API.anon) return showLogin();
  const { r, p } = route();
  if (r === "explain" && p) { S.focus = p; const m = cur(); const it = allItems(m).find(x => x.id === p); if (it && it.kind !== "p" && S.mode !== "facts") S.mode = "facts"; if (it && it.kind === "p" && S.mode === "facts") S.mode = "credited"; const c = COMPS.includes(p) ? p : it && it.c; if (c) S.open[c] = true; }
  const want = "#" + r + (p ? "/" + p : ""); if (location.hash !== want) history.replaceState(null, "", want);
  renderNav(r); hideTip(); if (r !== lastRoute) closePop();
  $("#title").textContent = TITLES[r]();
  const v = $("#view");
  const av = apiView(r); lastApiView = av != null;
  v.innerHTML = av ?? V[r]();
  if (!soft) [...v.querySelectorAll(":scope > .rise, :scope > .survey > .rise, :scope > .recs > .rise")].forEach((el, i) => el.style.animationDelay = (Math.min(i, 10) * 60) + "ms");
  else { v.querySelectorAll(".rise, .qcard, .bar-a, .pop, .draw, .reveal").forEach(el => el.style.animation = "none"); v.querySelectorAll(".cu").forEach(el => el.classList.remove("cu")); }
  countUp(v);
  av == null && V[r].after && V[r].after();
  if (soft) v.querySelectorAll(".pop, .draw, .reveal, .bar-a").forEach(el => el.style.animation = "none");
  if (r !== lastRoute) { if (!p) window.scrollTo(0, 0); lastRoute = r; }
  $("#side").classList.remove("on");
}
window.addEventListener("hashchange", () => render());
// Клік по пункту меню поточного екрана теж оновлює екран (напр., «Пройти опитування» одразу після надсилання)
$("#nav").addEventListener("click", e => { const a = e.target.closest("a[data-r]"); if (a && "#" + a.dataset.r === location.hash.split("/")[0]) { e.preventDefault(); render(); } });
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(redrawAfter, 150); });
// Перемалювати графіки поточного екрана (не на екранах сервера й не до завантаження даних)
function redrawAfter() { const { r } = route(); if (!lastApiView && (!API.on || API.model) && $("#view").children.length && V[r] && V[r].after) V[r].after(); }

/* ---------- Chrome ---------- */
$("#logo").innerHTML = IC.pulse.replace("<svg", '<svg width="20" height="20"');
$("#ic-search").innerHTML = IC.search.replace("<svg", '<svg width="17" height="17"');
$("#menuBtn").innerHTML = IC.menu; $("#menuBtn").onclick = () => { $("#side").classList.add("on"); $("#scrim").classList.add("on"); };
$("#cycleBtn").innerHTML = `${IC.cal}Цикл ${CYCLE}`; $("#cycleBtn").dataset.tip = "Цикл оцінювання: один повний раунд опитування й збору фактів. Індекс порівнюється з попереднім циклом.";
$("#dClose").innerHTML = IC.x; $("#dClose").onclick = closeDrawer;
$("#scrim").onclick = () => { closeDrawer(); aiClose(); $("#side").classList.remove("on"); $("#scrim").classList.remove("on"); };
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); aiClose(); } });
const role = $("#role");
role.innerHTML = Object.entries(ROLE).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join("");
role.value = S.role;
const setAvatar = () => { const av = $("#avatar"); av.textContent = ROLE[S.role][1]; av.dataset.tip = ROLE[S.role][0]; av.setAttribute("role", "button"); av.tabIndex = 0; av.setAttribute("aria-label", "Профіль і вихід"); };
// Клік по аватару: хто ви й кнопка «Вийти» (меню ліворуч на вузьких екранах приховане)
function openProfile(btn) {
  hideTip();
  const p = $("#pop"); if (p.classList.contains("on") && p._btn === btn) return closePop();
  const u = API.user;
  p._btn = btn; pickA = null;
  p.innerHTML = `<div style="font-weight:600">${esc(u ? u.display_name : ROLE[S.role][0])}</div><div class="lbl" style="margin:2px 0 12px">${ROLE[S.role][0]}${u ? ` · ${esc(u.login)}` : ""}</div>${u ? `<button class="btn btn-ghost" style="width:100%;justify-content:center" onclick="closePop();document.getElementById('logoutBtn').click()">${IC.arrowL}Вийти</button>` : `<div class="lbl">Демо-режим: вихід не потрібен.</div>`}`;
  p.classList.add("on"); placePop(btn);
}
$("#avatar").onclick = e => openProfile(e.currentTarget);
$("#avatar").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(e.currentTarget); } };
role.onchange = () => { S.role = role.value; addLog(ROLE[S.role][0], "Вхід у систему"); persist(); setAvatar(); aiBtn(); aiClose(); closeDrawer(); location.hash = HOME[S.role]; render(); toast("Роль: " + ROLE[S.role][0]); };
$("#resetBtn").innerHTML = `${IC.reset}Скинути демо-дані`; $("#resetBtn").onclick = resetDemo;
setAvatar();
function themeIcon() { const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; $("#themeBtn").innerHTML = dark ? IC.sun : IC.moon; }
$("#themeBtn").onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark"; themeIcon();
  try { localStorage.setItem("ii-theme", document.documentElement.dataset.theme); } catch (e) {}
};
try { const t = localStorage.getItem("ii-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
themeIcon();
/* Пошук: підказки під час введення (екрани, компоненти, питання й показники, заклади) */
function searchHits(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const has = t => t.toLowerCase().includes(q), out = [];
  NAV.filter(n => n[3].includes(S.role) && allowed(n[0]) && has(n[1])).forEach(n => out.push({ k: "Екран", t: n[1], go: () => location.hash = n[0] }));
  if (allowed("explain")) {
    COMPS.filter(c => has(COMP[c].n)).forEach(c => out.push({ k: "Компонент", t: COMP[c].n, go: () => location.hash = "explain/" + c }));
    try { allItems(cur()).filter(x => has(x.t)).forEach(x => out.push({ k: x.kind === "p" ? "Питання" : "Показник", t: x.t, go: () => location.hash = "explain/" + x.id })); } catch (e) {}
  }
  if (allowed("institutions") && !API.on) INSTITUTIONS().filter(m => !(S.insts.archived || []).includes(m.id) && (has(m.name) || (m.edrpou || "").includes(q))).forEach(m => out.push({ k: "Заклад", t: m.name, go: () => { S.inst = m.id; persist(); location.hash = "overview"; render(); } }));
  return out.slice(0, 8);
}
let qHits = [], qSel = 0;
function drawSearch() {
  const p = $("#pop"), box = document.querySelector(".side .search"), q = $("#q").value;
  qHits = searchHits(q); if (!q.trim()) return closePop();
  const hl = t => { const i = t.toLowerCase().indexOf(q.trim().toLowerCase()); return i < 0 ? esc(t) : esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.trim().length)) + "</mark>" + esc(t.slice(i + q.trim().length)); };
  p.innerHTML = qHits.length ? `<div class="qs" role="listbox" aria-label="Результати пошуку">${qHits.map((h, i) => `<button type="button" role="option" aria-selected="${i === qSel}" class="qs-i ${i === qSel ? "on" : ""}" onmousedown="event.preventDefault();pickSearch(${i})"><span class="qs-t">${hl(h.t)}</span><span class="lbl">${h.k}</span></button>`).join("")}</div>` : `<div class="lbl" style="padding:6px 4px">Нічого не знайдено</div>`;
  p._btn = box; p.classList.add("on");
  const r = zr(box.getBoundingClientRect()), w = Math.max(r.width, 320); p.style.width = w + "px"; p.style.left = Math.max(8, Math.min(r.left, innerWidth / Z() - w - 8)) + "px"; p.style.top = (r.bottom + 6) + "px";
}
function pickSearch(i) { const h = qHits[i]; if (!h) return; $("#q").value = ""; $("#q").blur(); closePop(); $("#pop").style.width = ""; h.go(); }
$("#q").addEventListener("input", () => { qSel = 0; drawSearch(); });
$("#q").addEventListener("focus", () => { if ($("#q").value.trim()) drawSearch(); });
$("#q").addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!qHits.length) return; e.preventDefault(); qSel = (qSel + (e.key === "ArrowDown" ? 1 : qHits.length - 1)) % qHits.length; drawSearch(); return; }
  if (e.key === "Escape") { $("#q").value = ""; closePop(); $("#q").blur(); return; }
  if (e.key !== "Enter") return; e.preventDefault();
  if (qHits.length) pickSearch(qSel); else if ($("#q").value.trim()) toast("Нічого не знайдено");
});
// Пошук: Ctrl+K (на Mac ⌘K) і «/». Ctrl+F лишаємо браузеру: це пошук по тексту сторінки
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$("#kbd").textContent = isMac ? "⌘K" : "Ctrl K"; $("#kbd").dataset.tip = `Швидкий пошук: ${isMac ? "⌘K" : "Ctrl+K"} або «/»`;
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") closePop();
});
/* Доступність: розмір тексту й підвищений контраст (як на сайтах держорганів) */
function applyA11y() { const a = S.a11y || { z: 1, hc: false }; document.documentElement.style.zoom = a.z === 1 ? "" : a.z; document.documentElement.classList.toggle("hc", !!a.hc); scaleMedia(a.z); }
// CSS zoom не змінює ширину, яку бачать медіазапити. Тому межі (max-width/min-width) множимо на масштаб:
// при 150 % на екрані 1280 px сторінка верстається як для 853 px, без горизонтального скролу (WCAG 1.4.10).
function scaleMedia(z) {
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) { if (!(r instanceof CSSMediaRule) || !/width/.test(r.media.mediaText + (r._mq || ""))) continue;
      r._mq = r._mq || r.media.mediaText;
      const t = r._mq.replace(/(min|max)-width:\s*([\d.]+)px/g, (_, k, n) => `${k}-width: ${Math.round(+n * z * 10) / 10}px`);
      if (r.media.mediaText !== t) { while (r.media.length) r.media.deleteMedium(r.media.item(0)); t.split(",").forEach(m => r.media.appendMedium(m.trim())); } } }
}
function drawA11y() {
  const a = S.a11y;
  $("#pop").innerHTML = `<div class="lbl" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin-bottom:8px">Розмір тексту</div>
    <div style="display:flex;align-items:center;gap:10px"><button class="icon-btn" aria-label="Зменшити текст" onclick="setZoom(-1)" ${a.z <= 1 ? "disabled" : ""}>−</button><b class="tnum" style="min-width:48px;text-align:center">${Math.round(a.z * 100)} %</b><button class="icon-btn" aria-label="Збільшити текст" onclick="setZoom(1)" ${a.z >= 1.5 ? "disabled" : ""}>+</button></div>
    <label class="a11y-row"><span>Підвищений контраст</span><span class="sw"><input type="checkbox" ${a.hc ? "checked" : ""} onchange="S.a11y.hc=this.checked;persist();applyA11y()"><span></span></span></label>
    <button class="link-btn" onclick="S.a11y={z:1,hc:false};persist();applyA11y();autoSide();drawA11y();render(true)">Скинути</button>`;
}
function setZoom(d) { S.a11y.z = Math.round(clamp(S.a11y.z + d * .125, 1, 1.5) * 1000) / 1000; persist(); applyA11y(); autoSide(); drawA11y(); render(true); placePop($("#a11yBtn")); }
$("#a11yBtn").innerHTML = IC.a11y;
$("#a11yBtn").onclick = e => { const p = $("#pop"), b = e.currentTarget; if (p.classList.contains("on") && p._btn === b) return closePop(); p._btn = b; drawA11y(); p.classList.add("on"); placePop(b); };
applyA11y();
/* Згортання бічного меню (на широких екранах): лишаються лише іконки */
function setSide(mini, auto) {
  document.documentElement.classList.toggle("side-mini", mini);
  const b = $("#sideBtn"); b.innerHTML = mini ? IC.chevR : IC.chevL; b.setAttribute("aria-label", mini ? "Розгорнути меню" : "Згорнути меню"); b.setAttribute("aria-expanded", String(!mini)); b.dataset.tip = mini ? "Розгорнути меню" : "Згорнути меню";
  if (!auto) try { localStorage.setItem("ii-side2", mini ? "mini" : ""); } catch (e) {}
  const { r } = route(); renderNav(r); setTimeout(redrawAfter, 260);
}
$("#sideBtn").onclick = () => setSide(!document.documentElement.classList.contains("side-mini"));
document.querySelector(".side .search").addEventListener("click", () => { if (document.documentElement.classList.contains("side-mini")) { setSide(false); setTimeout(() => $("#q").focus(), 50); } });
// Меню: збережений вибір користувача, а без нього на вузьких екранах (до 1100 px) воно згорнуте, щоб не стискати вміст
const sidePref = () => { try { return localStorage.getItem("ii-side2"); } catch (e) { return null; } };
const autoSide = () => { const w = innerWidth / Z(); if (sidePref() === null && w > 900) { document.documentElement.classList.toggle("side-mini", w < 1100); const { r } = route(); renderNav(r); } };
try { const sp = sidePref(); if (sp === null) { document.documentElement.classList.toggle("side-mini", innerWidth / Z() > 900 && innerWidth / Z() < 1100); setSide(document.documentElement.classList.contains("side-mini"), true); } else setSide(sp === "mini"); } catch (e) { setSide(false); }
addEventListener("resize", autoSide);
$("#aiLogo").innerHTML = IC.spark.replace("<svg", '<svg width="17" height="17"');
$("#aiClose").innerHTML = IC.x; $("#aiClose").onclick = aiClose;
$("#aiSend").innerHTML = IC.send;
$("#aiBtn").onclick = () => aiOpen();
$("#aiForm").addEventListener("submit", e => { e.preventDefault(); const q = $("#aiQ").value; $("#aiQ").value = ""; aiAsk(q); });
$("#aiOn").addEventListener("change", e => { S.aiOn = e.target.checked; persist(); addLog(me(), S.aiOn ? "ШІ-асистента увімкнено" : "ШІ-асистента вимкнено"); aiBtn(); aiRender(); if (S.aiOn) checkLive(); });
aiBtn();
boot(); // з бекендом: вхід і дані сервера; без нього — демо (0-api.js)
