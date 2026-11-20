/* Оболонка застосунку: бічне меню, шапка, екран, оверлеї. */
import { Mark } from "./components/Mark.jsx";
import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { Ic } from "./lib/icons.jsx";
import { S, ROLE, NAV, NAV_GROUP, NAV_GROUP_T, HOME, AI_ROLES, persist, resetDemo, addLog, simpleMode, setSimpleMode, simpleRoute } from "./lib/state.js";
import { API, login, loginProxy, logout, apiErrText, retryBoot, startDemo, apiModReset, dn, RESULT_VIEWS } from "./lib/api.js";
import { NotesPop, notesState, markNotesSeen } from "./components/NotesPop.jsx";
import { COMPS, COMP, INSTITUTIONS, allItems, pendingRecs, measures, overdueDays, clamp, CYCLE } from "./lib/model.js";
import { useStore, getViewKey, render, toast, ui, openPop, closePop, closeDrawer } from "./lib/store.js";
import { route, allowed, cur, TITLES, isLogin, can } from "./lib/nav.js";
import { Drawer, Pop, Toast, hideTip, quietTips, Z } from "./components/overlays.jsx";
import { AiPanel, aiOpen, aiClose } from "./ai/assistant.jsx";
import { Overview, Explain, Trends, Compare, PeriodPop } from "./views/results.jsx";
import { Recs, Tracker, Sources, Institutions } from "./views/work.jsx";
import { Report, ExportDialog } from "./views/Report.jsx";
import { WhatIf } from "./views/WhatIf.jsx";
import { Manage, Surveys, Checklist, Audit, Survey, Me } from "./views/demo.jsx";
import { apiView } from "./views/api-views.jsx";
import { Builder } from "./views/Builder.jsx";
import { Learn } from "./views/Learn.jsx";
import { Advocate } from "./views/Insights.jsx";
import { Autopilot } from "./views/Autopilot.jsx";
import { Checks } from "./views/Checks.jsx";
import { ResultViews } from "./views/Oversight.jsx";
import { Approvals, fourEyes, useApprovals } from "./views/Transparency.jsx";
import { UrnScreen } from "./views/Urn.jsx";
// Адміністрування рідко потрібне: окремий чанк
const lazyAdm = k => { const C = lazy(() => import("./views/Admin.jsx").then(m => ({ default: m[k] }))); return () => <Suspense fallback={null}><C /></Suspense>; };
// «Що змінилось» (нормативка) рідкісний екран: окремий чанк, щоб основний не перевищував 500 кБ
const NormLazy = lazy(() => import("./views/Normative.jsx").then(m => ({ default: m.Normative }))), Normative = () => <Suspense fallback={null}><NormLazy /></Suspense>;
const People = lazyAdm("People"), Units = lazyAdm("Units"), Summary = lazyAdm("Summary"), Dicts = lazyAdm("Dicts"), Risks = lazyAdm("Risks"), InvitePage = lazyAdm("InvitePage");

const V = { people: People, units: Units, summary: Summary, dicts: Dicts, risks: Risks, urn: UrnScreen, approvals: Approvals, views: ResultViews, learn: Learn, advocate: Advocate, autopilot: Autopilot, normative: Normative, checks: Checks, overview: Overview, explain: Explain, trends: Trends, compare: Compare, whatif: WhatIf, recs: Recs, tracker: Tracker, sources: Sources, report: Report, manage: Manage, surveys: Surveys, checklist: Checklist, audit: Audit, survey: Survey, me: Me, institutions: Institutions };
const html = document.documentElement;

/* ---------- Маршрут: що зробити при переході ---------- */
let lastRoute = null;
export function applyRoute() {
  if (isLogin() || /^#invite\//.test(location.hash)) return; // запрошення читає boot()
  const { r, p } = route();
  if (r === "explain" && p) {
    S.focus = p; const m = cur(), it = allItems(m).find(x => x.id === p);
    if (it && it.kind !== "p" && S.mode !== "facts") S.mode = "facts";
    if (it && it.kind === "p" && S.mode === "facts") S.mode = "credited";
    const c = COMPS.includes(p) ? p : it && it.c; if (c) S.open[c] = true;
  }
  // Старі посилання #autopilot у уповноваженого ведуть на розділ автопілота в «Керуванні циклом»
  if (r === "manage" && location.hash.slice(1).split("/")[0] === "autopilot") ui.scrollTo = "ap";
  const want = "#" + r + (p ? "/" + p : ""); if (location.hash !== want) history.replaceState(null, "", want);
  hideTip();
  if (r !== lastRoute) { closePop(); if (!p) window.scrollTo(0, 0); lastRoute = r; }
  ui.side = false;
}

/* ---------- Доступність: розмір тексту й підвищений контраст ---------- */
// --uz = 1 / масштаб: вікно «Розмір тексту» не масштабується разом зі сторінкою (extra.css, .a11y-pop)
export function applyA11y() { const a = S.a11y || { z: 1, hc: false }; html.style.zoom = a.z === 1 ? "" : a.z; html.style.setProperty("--uz", a.z === 1 ? "1" : String(1 / a.z)); html.classList.toggle("hc", !!a.hc); scaleMedia(a.z); }
// CSS zoom не змінює ширину, яку бачать медіазапити. Тому межі (max-width/min-width) множимо на масштаб:
// при 150 % на екрані 1280 px сторінка верстається як для 853 px, без горизонтального скролу (WCAG 1.4.10).
function scaleMedia(z) {
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule) || !/width/.test(r.media.mediaText + (r._mq || ""))) continue;
      r._mq = r._mq || r.media.mediaText;
      const t = r._mq.replace(/(min|max)-width:\s*([\d.]+)px/g, (_, k, n) => `${k}-width: ${Math.round(+n * z * 10) / 10}px`);
      if (r.media.mediaText !== t) { while (r.media.length) r.media.deleteMedium(r.media.item(0)); t.split(",").forEach(m => r.media.appendMedium(m.trim())); }
    }
  }
}
function A11yPop() {
  const a = S.a11y;
  const setZoom = d => { S.a11y.z = Math.round(clamp(S.a11y.z + d * .125, 1, 1.5) * 1000) / 1000; persist(); applyA11y(); autoSide(); render(true); };
  return <>
    <div className="lbl" style={{ textTransform: "uppercase", letterSpacing: ".06em", fontSize: 11, marginBottom: 8 }}>Розмір тексту</div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button className="icon-btn" aria-label="Зменшити текст" onClick={() => setZoom(-1)} disabled={a.z <= 1}>−</button><b className="tnum" style={{ minWidth: 48, textAlign: "center" }}>{Math.round(a.z * 100)} %</b><button className="icon-btn" aria-label="Збільшити текст" onClick={() => setZoom(1)} disabled={a.z >= 1.5}>+</button></div>
    {can("overview") && <label className="a11y-row"><span>Простий режим: лише Огляд і Звіт</span><span className="sw"><input type="checkbox" checked={simpleMode()} onChange={e => setSimpleMode(e.target.checked)} /><span /></span></label>}
    <label className="a11y-row"><span>Підвищений контраст</span><span className="sw"><input type="checkbox" checked={!!a.hc} onChange={e => { S.a11y.hc = e.target.checked; persist(); applyA11y(); render(true); }} /><span /></span></label>
    <button className="link-btn" onClick={() => { S.a11y = { z: 1, hc: false }; persist(); applyA11y(); autoSide(); render(true); }}>Скинути</button>
  </>;
}

/* ---------- Згортання бічного меню ---------- */
const sidePref = () => { try { return localStorage.getItem("ii-side2"); } catch (e) { return null; } };
function setSide(mini, auto) {
  hideTip(true); quietTips(300); // кнопка після перемикання стоїть деінде: стара підказка не має висіти
  html.classList.toggle("side-mini", mini);
  if (!auto) try { localStorage.setItem("ii-side2", mini ? "mini" : ""); } catch (e) { /* немає */ }
  render(true);
}
// Без збереженого вибору на вузьких екранах (900–1100 px) меню згорнуте, щоб не стискати вміст
export function autoSide() { const w = innerWidth / Z(); if (sidePref() === null && w > 900) { html.classList.toggle("side-mini", w < 1100); render(true); } }
export function initSide() {
  const sp = sidePref();
  if (sp === null) html.classList.toggle("side-mini", innerWidth / Z() > 900 && innerWidth / Z() < 1100);
  else html.classList.toggle("side-mini", sp === "mini");
  addEventListener("resize", autoSide);
}

/* ---------- Тема ---------- */
const isDark = () => html.dataset.theme ? html.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
export function initTheme() { try { const t = localStorage.getItem("ii-theme"); if (t) html.dataset.theme = t; } catch (e) { /* немає */ } }

/* ---------- Групи меню: лише коли пунктів багато й вони з кількох груп ---------- */
function navGroups(items) {
  const by = {}; for (const it of items) (by[NAV_GROUP[it[0]] || "tools"] ||= []).push(it);
  const keys = ["res", "act", "tools"].filter(k => by[k]);
  return items.length > 5 && keys.length > 1 ? keys.map(k => [k, by[k]]) : [[null, items]];
}

/* ---------- Пошук ---------- */
function searchHits(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const has = t => t.toLowerCase().includes(q), out = [];
  NAV.filter(n => n[3].includes(S.role) && allowed(n[0]) && has(n[1])).forEach(n => out.push({ k: "Екран", t: n[1], go: () => { location.hash = n[0]; } }));
  if (allowed("explain")) {
    COMPS.filter(c => has(COMP[c].n)).forEach(c => out.push({ k: "Компонент", t: COMP[c].n, go: () => { location.hash = "explain/" + c; } }));
    try { allItems(cur()).filter(x => has(x.t)).forEach(x => out.push({ k: x.kind === "p" ? (API.on ? "Джерело" : "Питання") : "Показник", t: x.t, go: () => { location.hash = "explain/" + x.id; } })); } catch (e) { /* даних ще немає */ }
  }
  if (allowed("institutions") && !API.on) INSTITUTIONS().filter(m => !(S.insts.archived || []).includes(m.id) && (has(m.name) || (m.edrpou || "").includes(q))).forEach(m => out.push({ k: "Заклад", t: m.name, go: () => { S.inst = m.id; persist(); location.hash = "overview"; render(); } }));
  return out.slice(0, 8);
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const Hl = ({ t, q }) => { const i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? t : <>{t.slice(0, i)}<mark>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>; };
function SearchPop({ q, hits, sel, pick }) {
  return hits.length ? <div className="qs" role="listbox" aria-label="Результати пошуку">{hits.map((h, i) => <button key={i} type="button" role="option" aria-selected={i === sel} className={`qs-i ${i === sel ? "on" : ""}`} onMouseDown={e => { e.preventDefault(); pick(i); }}><span className="qs-t"><Hl t={h.t} q={q.trim()} /></span><span className="lbl">{h.k}</span></button>)}</div>
    : <div className="lbl" style={{ padding: "6px 4px" }}>Нічого не знайдено</div>;
}

/* ---------- Вхід (режим API) ---------- */
// Демо-облікові записи за моделлю з 7 ролей (логіни створює backend/app/seed/seed.py)
const DEMO_ROLES = [
  ["Респондент", "Проходить анкету: особовий склад або зовнішній експерт", ["staff01", "expert1"]],
  ["Член робочої групи", "Анкета 1 і внесення чек-листа з документами", ["wg1"]],
  ["Уповноважений", "Хвилі, учасники, підтвердження нових людей", ["admin"]],
  ["Керівник", "Результати, рекомендації, заходи, звіт", ["leader", "leader_a"]],
  ["Внутрішній аудит", "Підтвердження чек-листа й відкриття хвилі, журнал", ["auditor"]],
  ["Департамент", "Анкети, огляд закладів", ["department"]],
  ["Технічний адміністратор", "Люди й підрозділи", ["coordinator"]],
];
function Login() {
  const [u, setU] = useState(""), [p, setP] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), lu = useRef(null), lp = useRef(null), a = API.cfg.auth;
  useEffect(() => { const t = setTimeout(() => lu.current && lu.current.focus(), 50); return () => clearTimeout(t); }, []);
  const submit = async e => { e.preventDefault(); setBusy(true); setErr(""); try { await login(u.trim(), p); } catch (er) { setErr(apiErrText(er)); setBusy(false); } };
  return <div className="login-wrap c12">
    <section className="card rise login-card">
      <div className="brand" style={{ padding: "0 0 6px" }}><span className="logo brand-mark"><Mark /></span>Integra</div>
      <h2 style={{ margin: "6px 0 2px", fontSize: 22 }}>Вхід</h2>
      {API.loginMsg && <div className="note-box" style={{ margin: "8px 0" }}><span>{API.loginMsg}</span></div>}
      {a.password && <form id="lf" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }} onSubmit={submit}>
        <div className="field"><label htmlFor="lu">Логін</label><input className="inp" id="lu" autoComplete="username" required ref={lu} value={u} onChange={e => setU(e.target.value)} /></div>
        <div className="field"><label htmlFor="lp">Пароль</label><input className="inp" id="lp" type="password" autoComplete="current-password" required ref={lp} value={p} onChange={e => setP(e.target.value)} /></div>
        <span className="lbl" id="lerr" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>{err}</span>
        <button className="btn btn-primary" type="submit" style={{ justifyContent: "center" }} disabled={busy}>Увійти <Ic n="arrowR" /></button>
      </form>}
      {a.proxy && <button className="btn btn-soft" id="lproxy" style={{ justifyContent: "center", marginTop: 10 }} onClick={loginProxy}>Увійти через систему організації</button>}
    </section>
    {a.password && <section className="card rise login-card">
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Демо-облікові записи</h2>
      <div className="rows">{DEMO_ROLES.map(([r, t, ls]) => <div key={r} className="row demo-role"><div className="grow"><b>{r}</b><div className="lbl">{t}</div></div>
        <div className="demo-logins">{ls.map(l => <a key={l} href="#" data-tip="Підставити логін" onClick={e => { e.preventDefault(); setU(l); lp.current && lp.current.focus(); }}>{l}</a>)}</div></div>)}</div>
    </section>}
  </div>;
}

/* ---------- Сервер недоступний ---------- */
function ServerDown() {
  return <div className="c12" style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}><section className="card rise login-card" role="alert">
    <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Сервер недоступний</h2>
    <p className="lbl" style={{ margin: "6px 0 12px" }}>Не вдалося зʼєднатися з сервером. Перевірте мережу й повторіть спробу. Дані не змінено.</p>
    <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} onClick={retryBoot}>Повторити</button>
    <button type="button" className="btn btn-ghost" style={{ justifyContent: "center", marginTop: 8 }} onClick={startDemo}>Відкрити демо-режим із синтетичними даними</button>
  </section></div>;
}

/* ---------- Екран ---------- */
function View({ r, vk }) {
  const ref = useRef(null);
  // Поява карток по черзі: лише при новому монтуванні екрана
  useLayoutEffect(() => {
    const v = ref.current; if (!v) return;
    [...v.querySelectorAll(":scope > .rise, :scope > .survey > .rise, :scope > .recs > .rise")].forEach((el, i) => { el.style.animationDelay = (Math.min(i, 10) * 60) + "ms"; });
  }, [r, vk]);
  let body;
  if (API.booting) body = null;
  else if (API.down) body = <ServerDown />;
  else if (isLogin()) body = API.invite ? <InvitePage /> : <Login />;
  else { const av = apiView(r); const C = V[r]; body = av ?? (C ? <C /> : null); }
  return <main className="view" id="view" ref={ref} key={`${r}:${vk}`}>{body}</main>;
}

function Badge({ r }) {
  const recs = pendingRecs(), ms = measures(), od = ms.filter(x => overdueDays(x) > 0).length, pend = Object.values(S.fpend).filter(p => !p.ret).length;
  const ap = r === "approvals" ? useApprovals() : null;
  if (r === "approvals") { const k = ap && ap.data ? ap.data.filter(x => x.can_decide).length : 0; return k ? <span className="badge" aria-label={`Чекають на вас: ${k}`}>{k}</span> : null; }
  const n = r === "recs" ? recs : r === "tracker" ? (od ? `${ms.length} · ${od}!` : ms.length) : r === "checklist" && S.role === "checklist_approver" ? pend : 0;
  return n ? <span className={`badge ${r === "tracker" && !od ? "mute" : ""}`}>{n}</span> : null;
}

// Департамент із кількома закладами: екрани результатів недоступні, доки заклад не обрано (з одним закладом він відкривається сам)
const needInst = nr => S.role === "observer" && API.on && !API.deptUnit && (RESULT_VIEWS.includes(nr) || nr === "advocate") && Array.isArray(API.dept) && API.dept.filter(x => x.closed_waves).length > 1;
export default function App() {
  useStore();
  const login = isLogin(), anon = API.on && API.anon, { r } = API.booting || login ? { r: null } : route(), vk = getViewKey();
  const mini = html.classList.contains("side-mini"), u = API.user;
  const [q, setQ] = useState(""), [sel, setSel] = useState(0), qRef = useRef(null), box = useRef(null);
  const hits = searchHits(q), ns = notesState();
  const navAll = NAV.filter(n => n[3].includes(S.role) && (n[0] !== "approvals" || fourEyes()) && (n[0] !== "urn" || S.role === "auditor")), simple = simpleMode() && navAll.some(n => n[0] === "overview") && navAll.some(n => !simpleRoute(n[0]));
  const navG = navGroups(simple ? navAll.filter(n => simpleRoute(n[0])) : navAll);
  html.dataset.role = S.role;
  useEffect(() => {
    const key = e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) { e.preventDefault(); qRef.current && qRef.current.focus(); }
      if (e.key === "Escape") { const back = ui.pop && ui.pop.kind === "notes" && ui.pop.anchor; closeDrawer(); aiClose(); closePop(); if (ui.side) { ui.side = false; render(true); const mb = document.getElementById("menuBtn"); if (mb) mb.focus(); } if (back) back.focus(); }
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);
  const showSearch = v => { if (v.trim()) { if (!ui.pop || ui.pop.kind !== "search") { ui.pop = { kind: "search", anchor: box.current }; } render(true); } else closePop(); };
  const pick = i => { const h = hits[i]; if (!h) return; setQ(""); qRef.current && qRef.current.blur(); closePop(); h.go(); };
  const qKey = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!hits.length) return; e.preventDefault(); setSel((sel + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length); return; }
    if (e.key === "Escape") { setQ(""); closePop(); e.target.blur(); return; }
    if (e.key !== "Enter") return; e.preventDefault();
    if (hits.length) pick(sel); else if (q.trim()) toast("Нічого не знайдено");
  };
  const scrimOn = !!ui.drawer || ui.ai || ui.side;
  const pk = ui.pop && ui.pop.kind;
  const profile = el => { hideTip(); openPop("profile", el); };
  const toggleTheme = () => { html.dataset.theme = isDark() ? "light" : "dark"; try { localStorage.setItem("ii-theme", html.dataset.theme); } catch (e) { /* немає */ } render(true); };
  return <>
    <div className={`app ${login ? "login" : ""} ${anon ? "anon" : ""}`} inert={ui.drawer || ui.ai ? "" : undefined}>
      <aside className={`side ${ui.side ? "on" : ""}`} id="side">
        <div className="brand"><span className="logo brand-mark" id="logo"><Mark /></span><span className="brand-t">Integra</span>
          <button type="button" className="side-btn" id="sideBtn" aria-label={mini ? "Розгорнути меню" : "Згорнути меню"} aria-expanded={!mini} data-tip={mini ? "Розгорнути меню" : "Згорнути меню"} data-tip-pos={mini ? "right" : undefined} onClick={() => setSide(!mini)}><Ic n={mini ? "chevR" : "chevL"} /></button></div>
        <label className="search" ref={box} onClick={() => { if (html.classList.contains("side-mini")) { setSide(false); setTimeout(() => qRef.current && qRef.current.focus(), 50); } }}>
          <span id="ic-search"><Ic n="search" size={17} /></span>
          <input id="q" placeholder="Пошук" aria-label="Пошук по сторінках і показниках" ref={qRef} value={q} onChange={e => { setQ(e.target.value); setSel(0); showSearch(e.target.value); }} onFocus={() => showSearch(q)} onKeyDown={qKey} />
          <span className="kbd" id="kbd" data-tip={`Швидкий пошук: ${isMac ? "⌘K" : "Ctrl+K"} або «/»`}>{isMac ? "⌘K" : "Ctrl K"}</span></label>
        {!(navG.length > 1) && <div className="nav-label">Меню</div>}
        <nav className="nav" id="nav" aria-label="Меню">{!login && navG.map(([g, items]) => {
          const links = items.map(([nr, n, ic]) => { const off = needInst(nr); return <a key={nr} href={`#${nr}`} data-r={nr} className={nr === r ? "on" : off ? "nav-off" : ""} aria-current={nr === r ? "page" : undefined} aria-label={n} aria-disabled={off || undefined} data-tip={off ? "Спершу оберіть заклад" : mini ? n : undefined}
            onClick={e => { if (off) { e.preventDefault(); return; } if ("#" + nr === location.hash.split("/")[0]) { e.preventDefault(); ui.side = false; render(); } }}><Ic n={ic} /><span>{n}</span><Badge r={nr} /></a>; });
          return g ? <div key={g} className="nav-grp" role="group" aria-labelledby={`ng-${g}`}><div className="nav-g" id={`ng-${g}`}>{NAV_GROUP_T[g]}</div>{links}</div> : links;
        })}{!login && simple && <button type="button" className="link-btn nav-all" onClick={() => setSimpleMode(false)}>Простий режим: показати все меню</button>}</nav>
        {/* Хто увійшов і «Вийти» з бекендом показує лише меню аватара вгорі; тут лишився вибір ролі для демо */}
        {!API.down && !API.on && <div className="side-foot"><div className="role-card"><>
          <small>Демо: роль</small>
          <select id="role" aria-label="Роль для демо" value={S.role} onChange={e => { S.role = e.target.value; addLog(ROLE[S.role][0], "Вхід у систему"); persist(); ui.ai = false; ui.drawer = null; location.hash = HOME[S.role]; render(); toast("Роль: " + ROLE[S.role][0]); }}>{Object.entries(ROLE).map(([k, [n]]) => <option key={k} value={k}>{n}</option>)}</select>
          <button className="btn btn-ghost" id="resetBtn" type="button" onClick={resetDemo}><Ic n="reset" />Скинути демо-дані</button>
          <small>Усі дані синтетичні. Зміна ролі веде на її головний екран.</small></></div></div>}
      </aside>
      <div className="main">
        <header className="top">
          <button className="icon-btn menu-btn" id="menuBtn" aria-label="Меню" onClick={() => { ui.side = true; render(true); }}><Ic n="menu" /></button>
          <h1 id="title">{API.down ? "Сервер недоступний" : login ? (API.invite ? "Запрошення" : "Вхід") : r ? TITLES[r] : ""}</h1>
          <div className="sp" />
          <span className="synthetic hide-m">Синтетичні дані</span>
          <span className="hide-m" id="cycleBtn" data-tip="Хвиля оцінювання, результати якої зараз на екрані."><Ic n="cal" />{API.on && API.waveTitle ? dn(API.waveTitle) : `Цикл ${CYCLE}`}</span>
          <button className={`pill-btn ai-btn ${S.aiOn ? "" : "off"}`} id="aiBtn" hidden={!AI_ROLES.includes(S.role)} aria-label="Асистент" onClick={() => aiOpen()}><Ic n="spark" /><span className="hide-m">Асистент</span></button>
          {ns && <button type="button" className="icon-btn" id="notesBtn" aria-label={ns.fresh ? `Сповіщення: нових ${ns.fresh}` : "Сповіщення"} aria-haspopup="dialog" data-tip="Сповіщення" style={{ position: "relative" }} onClick={e => { hideTip(); apiModReset("notes"); markNotesSeen(); openPop("notes", e.currentTarget); }}><Ic n="bell" />{ns.fresh > 0 && <span className="badge" style={{ position: "absolute", top: -4, right: -4 }}>{ns.fresh}</span>}</button>}
          <span className="sr-only" role="status" aria-live="polite">{ns && ns.fresh ? `Нових сповіщень: ${ns.fresh}` : ""}</span>
          <button className="icon-btn" id="a11yBtn" aria-label="Доступність: розмір тексту й контраст" aria-haspopup="dialog" data-tip="Доступність" onClick={e => openPop("a11y", e.currentTarget)}><Ic n="a11y" /></button>
          <button className="icon-btn" id="themeBtn" aria-label="Тема" onClick={toggleTheme}><Ic n={isDark() ? "sun" : "moon"} /></button>
          <div className="avatar" id="avatar" role="button" tabIndex={0} aria-label="Профіль і вихід" data-tip={ROLE[S.role][0]} onClick={e => profile(e.currentTarget)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); profile(e.currentTarget); } }}>{ROLE[S.role][1]}</div>
        </header>
        <View r={login ? "login" : r} vk={vk} />
      </div>
    </div>
    <div className={`scrim ${scrimOn ? "on" : ""}`} id="scrim" onClick={() => { ui.drawer = null; ui.ai = false; ui.side = false; render(true); }} />
    <Drawer />
    <AiPanel />
    <div className="tip" id="tip" />
    <Pop mode={pk === "search" ? "under" : pk === "a11y" ? "stay" : undefined} cls={pk === "notes" ? "notes-pop" : pk === "a11y" ? "a11y-pop" : ""} label={pk === "notes" ? "Сповіщення" : pk === "a11y" ? "Доступність" : "Вибір"}>
      {pk === "period" && <PeriodPop />}
      {pk === "a11y" && <A11yPop />}
      {pk === "notes" && ns && <NotesPop ns={ns} />}
      {pk === "search" && <SearchPop q={q} hits={hits} sel={sel} pick={pick} />}
      {pk === "profile" && <><div className="only-m prof-m"><button type="button" className="btn btn-soft" onClick={e => { const a = document.getElementById("avatar"); closePop(); openPop("a11y", a); }}><Ic n="a11y" />Доступність</button><button type="button" className="btn btn-soft" onClick={toggleTheme}><Ic n={isDark() ? "sun" : "moon"} />{isDark() ? "Світла тема" : "Темна тема"}</button></div>{u && <div className="lbl" style={{ fontSize: 12 }}>Ви увійшли як</div>}<div style={{ fontWeight: 600 }}>{u ? dn(u.display_name) : ROLE[S.role][0]}</div><div className="lbl" style={{ margin: "2px 0 12px" }}>{ROLE[S.role][0]}{u ? ` · ${u.login}` : ""}</div>{u ? <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => { closePop(); logout(); }}><Ic n="arrowL" />Вийти</button> : <div className="lbl">Демо-режим: вихід не потрібен.</div>}</>}
    </Pop>
    <ExportDialog />
    <Builder />
    <Toast />
  </>;
}
