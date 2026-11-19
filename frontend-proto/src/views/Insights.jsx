/* Інсайти: «Питання перевірки» (питання аудитора до результатів) і «Черговий» (що змінилось і як виправити).
 * Питання перевірки: повний екран #advocate і бічна панель «Підготуватися до перевірки» з «Огляду» та «Звіту».
 * Черговий: повний екран #watch і пункти в блоці «Що потребує уваги» на «Огляді». */
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiAdvocate, apiDigest } from "../lib/api.js";
import { S, persist } from "../lib/state.js";
import { COMPS } from "../lib/model.js";
import { can, go, cur, TITLES } from "../lib/nav.js";
import { render, openDrawer, closeDrawer } from "../lib/store.js";
import { Pill } from "../components/ui.jsx";
import { dsh } from "../lib/format.js";
import { Loading, Failed, Empty } from "../components/states.jsx";
import { KpiRow, ModHead, More } from "../components/modkit.jsx";
import { openApiQ } from "./panels.jsx";

/* Приклади з docs/features.md для режиму без сервера */
const DEMO_Q = { total_found: 1, note: "Приклад із документації (docs/features.md). З сервером питання формуються з чисел закритої хвилі.", rules: [], questions: [{
  n: 1, id: "cut_by_facts:accountability", rule_id: "cut_by_facts", severity: 100, category: "Факти проти самооцінки",
  question: "Ви оцінюєте «Підзвітність» на 58,9 балів, а факти показують 18,8. Чому система, на вашу думку, краща, ніж кажуть дані? Наприклад, «підозрілі закупівлі розібрано» лише 40%.",
  why: "Самооцінка 58,9 знижена до 43,8: факти показують 18,8 (+25).",
  evidence: [{ label: "«Підзвітність»: самооцінка", text: "58,9", path: "components.accountability.self_score" }, { label: "за фактами", text: "18,8", path: "components.accountability.facts_score" }, { label: "Підозрілі закупівлі розібрано", text: "40% (48 з 120)", path: "facts.procurement_flags_reviewed" }],
  prepare: "Пояснення розриву по кожному факту: що саме не розглянуто вчасно і чому; план, коли частка досягне наступного порогу.", link: { view: "compare", ref: "accountability" } }] };
const DEMO_D = { status: "attention", summary: "Приклад із документації (docs/features.md).", counts: { critical: 0, warning: 1, info: 0 }, items: [{
  id: "drop:culture", category: "drop", severity: "warning", title: "«Культура» знизилась між двома останніми хвилями",
  what: "Компонент змінився більше ніж на 5 балів.", why: "чек-лист: −15,6 бала; робоча група: −15,6 бала. Найбільше впало питання «Яку цінність відіграє доброчесність…» (−6,2).", fix: [], link: { view: "explain", ref: "culture" } }] };

const SEV = { critical: ["Критично", "p-bad", "red"], warning: ["Потрібна увага", "p-warn", "amber"], info: ["До відома", "p-info", "blue"] };
const STATUS = { ok: ["Усе гаразд", "p-good"], attention: ["Потрібна увага", "p-warn"], critical: ["Критично", "p-bad"] };
const CAT = { drop: ["Падіння", "down"], rise: ["Зростання", "up"], process: ["Процес", "target"], technical: ["Технічне", "plug"] };
const HIGH = 80; // вага питання, з якої воно вважається гострим (шкала правил 0-100)

/* --- Куди веде число: екран, де його видно (розклад, порівняння, динаміка), лише якщо екран доступний ролі --- */
function numTarget(path) {
  const [a, b] = String(path || "").split(".");
  let t = null;
  if (a === "components" && COMPS.includes(b)) t = { h: "explain/" + b };
  else if (a === "facts") { let f = null; try { f = cur().fItems.find(x => x.id.endsWith("-f-" + b)); } catch (e) { /* даних ще немає */ } t = { h: f ? "explain/" + f.id : "compare" }; }
  else if (a === "index") t = { h: "explain" };
  else if (a === "dynamics") t = { h: "trends" };
  else if (a === "groups") t = { h: "compare" };
  else if (a === "questions") t = API.on ? { q: b, h: "explain" } : { h: "compare" };
  else if (a === "measures") t = { h: "tracker" };
  else if (a === "recommendations") t = { h: "recs" };
  else if (a === "checklist") t = { h: "checklist" };
  else if (a === "risk_signals") t = { h: "sources" };
  return t && can(t.h.split("/")[0]) ? t : null;
}
function linkTarget(link) {
  const v = link && link.view; if (!v || !TITLES[v] || !can(v)) return null;
  return { h: v === "explain" && COMPS.includes(link.ref) ? "explain/" + link.ref : v };
}
const goTo = t => { closeDrawer(); if (t.q) { go(t.h); setTimeout(() => openApiQ(t.q), 300); } else go(t.h); };
const GoBtn = ({ link, t = linkTarget(link) }) => t ? <button type="button" className="btn btn-soft" onClick={() => goTo(t)}><Ic n="arrowR" />Відкрити: {TITLES[t.h.split("/")[0]]}</button> : null;

/* --- «Питання перевірки» --- */
function useAdv() {
  if (!API.on) return { data: DEMO_Q };
  if (!API.campaignId) return API.empty ? { none: true } : null;
  return apiMod("adv", () => apiAdvocate(API.campaignId, 30));
}
function advState(r) {
  if (!r) return <Loading t="Питання аудитора" />;
  if (r.none || r.status === 409) return <Empty t="Ще немає закритої хвилі">Питання аудитора формуються за результатами закритої хвилі.</Empty>;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("adv")} />;
  return null;
}
const mark = id => { S.advDone[id] = !S.advDone[id]; persist(); render(true); };

function QItem({ q, compact }) {
  const first = q.evidence.map(e => numTarget(e.path)).find(Boolean) || linkTarget(q.link), done = !!S.advDone[q.id];
  return <article className={`qa-item ${done ? "done" : ""}`}>
    <div className="tags"><Pill cls="p-mute nodot">{q.n}</Pill><Pill cls="p-info nodot">{dsh(q.category)}</Pill><Pill cls={`${q.severity >= HIGH ? "p-bad" : "p-warn"} nodot`} tip="Вага правила: що вище, то неприємніше питання">Вага {q.severity}</Pill></div>
    <div className="txt" style={{ fontSize: compact ? 14 : 15, fontWeight: 600 }}>{dsh(q.question)}</div>
    {q.evidence.length > 0 && <div className="tags">{q.evidence.map((e, i) => { const t = numTarget(e.path), body = <>{dsh(e.label)}: <b className="tnum">{dsh(e.text)}</b></>;
      return t ? <button key={i} type="button" className="pill p-mute nodot ev-btn" onClick={() => goTo(t)} aria-label={`До числа: ${dsh(e.label)} ${dsh(e.text)}`}>{body}<Ic n="arrowR" /></button> : <span key={i} className="pill p-mute nodot">{body}</span>; })}</div>}
    {compact ? <More><div className="lbl txt">Чому питання: {dsh(q.why)}</div><div className="note-box"><b>Що підготувати</b><span className="txt">{dsh(q.prepare)}</span></div></More>
      : <><div className="note-box"><b>Що підготувати</b><span className="txt">{dsh(q.prepare)}</span></div><More><div className="lbl txt">Чому питання: {dsh(q.why)}</div></More></>}
    <div className="chk-row" style={{ flexWrap: "wrap" }}>{first && <button type="button" className="btn btn-soft" onClick={() => goTo(first)}><Ic n="arrowR" />До числа</button>}
      <label className="chk-row lbl" style={{ marginLeft: "auto" }}><input type="checkbox" checked={done} onChange={() => mark(q.id)} />Відповідь підготовлено</label></div>
  </article>;
}

export function Advocate() {
  const r = useAdv(), st = advState(r); if (st) return st;
  const d = r.data, n = d.questions.length, high = d.questions.filter(q => q.severity >= HIGH).length, ready = d.questions.filter(q => S.advDone[q.id]).length;
  return <>
    <KpiRow items={[{ ic: "scale", t: "Питань", v: n, sub: d.total_found > n ? `знайдено ${d.total_found}` : null },
      { ic: "alert", t: "Високої ваги", v: high, tone: high ? "red" : undefined, sub: `вага ${HIGH} і вище` },
      { ic: "check", t: "Підготовлено", v: `${ready} з ${n}`, tone: n && ready === n ? "teal" : undefined }]} />
    <section className="card c12 rise"><ModHead ic="scale" tone="amber" title="Питання до результатів"><span className="lbl" aria-live="polite">Без відповіді: {n - ready}</span></ModHead>
      <div className="lbl" style={{ marginBottom: 12 }}>Що спитає зовнішній аудитор. Питання про систему доброчесності, не про людей.</div>
      {n ? <div className="qa-list">{d.questions.map(q => <QItem key={q.id} q={q} />)}</div> : <div className="lbl">Правила не знайшли слабких місць у цій хвилі.</div>}
      <div style={{ marginTop: 12 }}><More><div className="lbl txt">{dsh(d.note)} Позначка «Відповідь підготовлено» зберігається лише у вашому браузері, сервер її не отримує. Кожен перегляд питань записується в журнал дій{can("audit") ? <> (<a className="link" href="#audit">Журнал</a>)</> : ""}.</div></More></div>
    </section>
    {d.rules && d.rules.length > 0 && <details className="card c12 rise guide"><summary className="card-h mod-h"><h2>Правила, за якими формуються питання</h2><div className="sp" /><span className="chev"><Ic n="chev" /></span></summary>
      <div className="rows">{d.rules.map(x => <div key={x.id} className="row"><div className="grow txt">{dsh(x.description)}</div></div>)}</div></details>}
  </>;
}

function AdvDrawer() {
  const r = useAdv(), st = advState(r); if (st) return st;
  const qs = r.data.questions;
  return <>
    <div className="lbl">Найгостріші питання аудитора до результатів хвилі. «До числа» відкриває екран, де видно це значення.</div>
    {qs.length ? <div className="qa-list">{qs.slice(0, 10).map(q => <QItem key={q.id} q={q} compact />)}</div> : <div className="lbl">Правила не знайшли слабких місць у цій хвилі.</div>}
    <a className="btn btn-soft" href="#advocate" onClick={closeDrawer} style={{ justifyContent: "center" }}><Ic n="arrowR" />Усі питання{qs.length > 10 ? ` (${qs.length})` : ""}</a>
  </>;
}
export const openAdvocate = () => openDrawer("Підготуватися до перевірки", () => <AdvDrawer />);
export const PrepBtn = () => can("advocate") ? <button type="button" className="btn btn-primary" onClick={openAdvocate}><Ic n="scale" />Підготуватися до перевірки</button> : null;

/* --- «Черговий» --- */
const useDigest = () => API.on ? apiMod("digest", apiDigest) : { data: DEMO_D };
const sevPill = s => { const x = SEV[s] || SEV.info; return <Pill cls={x[1]}>{x[0]}</Pill>; };
const FixList = ({ fix }) => fix && fix.length ? <ol className="fix-l">{fix.slice(0, 3).map((t, i) => <li key={i} className="txt">{dsh(t)}</li>)}</ol> : null;

export function Watch() {
  const r = useDigest();
  if (!r) return <Loading t="Черговий" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("digest")} />;
  const d = r.data, cat = S.digestCat || "all", items = d.items.filter(x => cat === "all" || x.category === cat), st = STATUS[d.status] || STATUS.attention, c = d.counts || {};
  const setCat = v => { S.digestCat = v; render(true); };
  return <>
    <KpiRow items={[{ ic: "alert", t: "Критичних", v: c.critical || 0, tone: c.critical ? "red" : undefined }, { ic: "flag", t: "Попереджень", v: c.warning || 0, tone: c.warning ? "amber" : undefined }, { ic: "info", t: "До відома", v: c.info || 0, tone: "blue" }]} />
    <section className="card c12 rise"><ModHead ic="eye" tone="teal" title="Стан"><Pill cls={st[1]}>{st[0]}</Pill></ModHead>
      <div className="txt" aria-live="polite">{dsh(d.summary)}</div>
      <div className="tags" role="group" aria-label="Фільтр за видом" style={{ marginTop: 12 }}>{[["all", "Усе"], ...Object.entries(CAT).map(([k, v]) => [k, v[0]])].map(([k, n]) => <button key={k} type="button" className={`pill-btn ${cat === k ? "lime" : ""}`} aria-pressed={cat === k} onClick={() => setCat(k)}>{n}</button>)}</div>
      <div style={{ marginTop: 10 }}><More><div className="lbl">Правила перевіряють стан без ШІ: що впало, чому і як виправити. Показано лише те, що належить вашій ролі.</div></More></div></section>
    {items.length ? items.map(x => { const s = SEV[x.severity] || SEV.info, k = CAT[x.category] || ["", "info"]; return <section key={x.id} className="card c12 rise">
      <ModHead ic={k[1]} tone={s[2]} title={dsh(x.title)}>{k[0] && <Pill cls="p-mute nodot">{k[0]}</Pill>}{sevPill(x.severity)}</ModHead>
      <div className="txt">{dsh(x.what)}</div>
      {x.fix && x.fix.length > 0 && <div className="note-box" style={{ marginTop: 10 }}><b>Як виправити</b><FixList fix={x.fix} /></div>}
      <div className="chk-row" style={{ marginTop: 10, flexWrap: "wrap", alignItems: "flex-start" }}><GoBtn link={x.link} /><More t="Чому"><div className="lbl txt">{dsh(x.why)}</div></More></div></section>; })
      : <Empty t={d.items.length ? "У цій групі нічого немає" : "Відхилень не знайдено"}>{d.items.length ? "Оберіть іншу групу." : "За правилами чергового все гаразд."}</Empty>}
  </>;
}

/* Пункти чергового в блоці «Що потребує уваги» на «Огляді»: лише критичні й попередження, до трьох */
export function digestTop() {
  if (!can("watch")) return [];
  const r = useDigest();
  return r && r.data ? r.data.items.filter(x => x.severity !== "info").slice(0, 3) : [];
}
export function DigestRows({ items }) {
  if (!items.length) return null;
  return <div className="dg">
    {items.map(x => <details key={x.id} className="dg-i">
      <summary><span className="dot" style={{ background: x.severity === "critical" ? "var(--red)" : "var(--amber)" }} /><span className="grow txt">{dsh(x.title)}</span>{sevPill(x.severity)}<Ic n="chev" /></summary>
      <div className="dg-b">{x.fix && x.fix.length ? <><b>Як виправити</b><FixList fix={x.fix} /></> : <span className="lbl txt">{dsh(x.why)}</span>}<div><GoBtn link={x.link} /></div></div>
    </details>)}
    <a className="link-btn" href="#watch" style={{ marginTop: 6, display: "inline-block" }}>Усі пункти чергового</a>
  </div>;
}
