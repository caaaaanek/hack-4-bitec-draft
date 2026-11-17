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
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, context: aiCtx(), history }) });
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
const allowed = r => NAV.some(n => n[0] === r && n[3].includes(S.role));
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
const TITLES = { overview: () => S.role === "observer" ? "Огляд закладу" : "Огляд закладу", explain: () => "Розклад індексу", trends: () => "Динаміка", compare: () => "Порівняння: сприйняття і факти", recs: () => "Рекомендації", tracker: () => "Трекер заходів", sources: () => "Джерела", report: () => "Звіт", manage: () => "Керування циклом", surveys: () => "Анкети", checklist: () => "Чек-лист", audit: () => "Журнал", survey: () => "Анонімне опитування", me: () => "Мої результати", institutions: () => "Заклади" };
let lastRoute = null;
function render(soft) {
  const { r, p } = route();
  if (r === "explain" && p) { S.focus = p; const m = cur(); const it = allItems(m).find(x => x.id === p); if (it && it.kind !== "p" && S.mode !== "facts") S.mode = "facts"; if (it && it.kind === "p" && S.mode === "facts") S.mode = "credited"; const c = COMPS.includes(p) ? p : it && it.c; if (c) S.open[c] = true; }
  const want = "#" + r + (p ? "/" + p : ""); if (location.hash !== want) history.replaceState(null, "", want);
  renderNav(r); hideTip(); if (r !== lastRoute) closePop();
  $("#title").textContent = TITLES[r]();
  const v = $("#view");
  v.innerHTML = V[r]();
  if (!soft) [...v.querySelectorAll(":scope > .rise, :scope > .survey > .rise, :scope > .recs > .rise")].forEach((el, i) => el.style.animationDelay = (Math.min(i, 10) * 60) + "ms");
  else { v.querySelectorAll(".rise, .qcard, .bar-a, .pop, .draw, .reveal").forEach(el => el.style.animation = "none"); v.querySelectorAll(".cu").forEach(el => el.classList.remove("cu")); }
  countUp(v);
  V[r].after && V[r].after();
  if (soft) v.querySelectorAll(".pop, .draw, .reveal, .bar-a").forEach(el => el.style.animation = "none");
  if (r !== lastRoute) { if (!p) window.scrollTo(0, 0); lastRoute = r; }
  $("#side").classList.remove("on");
}
window.addEventListener("hashchange", () => render());
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const { r } = route(); V[r].after && V[r].after(); }, 150); });

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
const setAvatar = () => { $("#avatar").textContent = ROLE[S.role][1]; $("#avatar").dataset.tip = ROLE[S.role][0]; };
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
$("#q").addEventListener("keydown", e => {
  if (e.key !== "Enter") return; const q = e.target.value.trim().toLowerCase(); if (!q) return;
  if (allowed("explain")) { const hit = allItems(cur()).find(x => x.t.toLowerCase().includes(q)); if (hit) { location.hash = "explain/" + hit.id; return; } }
  const nav = NAV.find(n => n[1].toLowerCase().includes(q) && n[3].includes(S.role)); if (nav) location.hash = nav[0]; else toast("Нічого не знайдено");
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
function applyA11y() { const a = S.a11y || { z: 1, hc: false }; document.documentElement.style.zoom = a.z === 1 ? "" : a.z; document.documentElement.classList.toggle("hc", !!a.hc); }
function drawA11y() {
  const a = S.a11y;
  $("#pop").innerHTML = `<div class="lbl" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin-bottom:8px">Розмір тексту</div>
    <div style="display:flex;align-items:center;gap:10px"><button class="icon-btn" aria-label="Зменшити текст" onclick="setZoom(-1)" ${a.z <= 1 ? "disabled" : ""}>−</button><b class="tnum" style="min-width:48px;text-align:center">${Math.round(a.z * 100)} %</b><button class="icon-btn" aria-label="Збільшити текст" onclick="setZoom(1)" ${a.z >= 1.5 ? "disabled" : ""}>+</button></div>
    <label class="a11y-row"><span>Підвищений контраст</span><span class="sw"><input type="checkbox" ${a.hc ? "checked" : ""} onchange="S.a11y.hc=this.checked;persist();applyA11y()"><span></span></span></label>
    <button class="link-btn" onclick="S.a11y={z:1,hc:false};persist();applyA11y();drawA11y();render(true)">Скинути</button>`;
}
function setZoom(d) { S.a11y.z = Math.round(clamp(S.a11y.z + d * .125, 1, 1.5) * 1000) / 1000; persist(); applyA11y(); drawA11y(); render(true); placePop($("#a11yBtn")); }
$("#a11yBtn").innerHTML = IC.a11y;
$("#a11yBtn").onclick = e => { const p = $("#pop"), b = e.currentTarget; if (p.classList.contains("on") && p._btn === b) return closePop(); p._btn = b; drawA11y(); p.classList.add("on"); placePop(b); };
applyA11y();
/* Згортання бічного меню (на широких екранах): лишаються лише іконки */
function setSide(mini) {
  document.documentElement.classList.toggle("side-mini", mini);
  const b = $("#sideBtn"); b.innerHTML = mini ? IC.chevR : IC.chevL; b.setAttribute("aria-label", mini ? "Розгорнути меню" : "Згорнути меню"); b.setAttribute("aria-expanded", String(!mini)); b.dataset.tip = mini ? "Розгорнути меню" : "Згорнути меню";
  try { localStorage.setItem("ii-side", mini ? "mini" : ""); } catch (e) {}
  const { r } = route(); renderNav(r); setTimeout(() => V[r] && V[r].after && V[r].after(), 260);
}
$("#sideBtn").onclick = () => setSide(!document.documentElement.classList.contains("side-mini"));
document.querySelector(".side .search").addEventListener("click", () => { if (document.documentElement.classList.contains("side-mini")) { setSide(false); setTimeout(() => $("#q").focus(), 50); } });
try { setSide(localStorage.getItem("ii-side") === "mini"); } catch (e) { setSide(false); }
$("#aiLogo").innerHTML = IC.spark.replace("<svg", '<svg width="17" height="17"');
$("#aiClose").innerHTML = IC.x; $("#aiClose").onclick = aiClose;
$("#aiSend").innerHTML = IC.send;
$("#aiBtn").onclick = () => aiOpen();
$("#aiForm").addEventListener("submit", e => { e.preventDefault(); const q = $("#aiQ").value; $("#aiQ").value = ""; aiAsk(q); });
$("#aiOn").addEventListener("change", e => { S.aiOn = e.target.checked; persist(); addLog(me(), S.aiOn ? "ШІ-асистента увімкнено" : "ШІ-асистента вимкнено"); aiBtn(); aiRender(); if (S.aiOn) checkLive(); });
aiBtn();
render();
