/* Інсайти: «Питання перевірки» (питання аудитора до результатів) і «Сигнали» (колишній «Черговий»: що змінилось і як виправити).
 * Питання перевірки: повний екран #advocate і бічна панель «Підготуватися до перевірки» з «Огляду» та «Звіту».
 * Сигнали: у дзвіночку в шапці (NotesPop) і в блоці «Що потребує уваги» на «Огляді»; окремої вкладки немає. */
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiAdvocate, apiDigest } from "../lib/api.js";
import { S, persist } from "../lib/state.js";
import { COMPS, pendingRecs, measures, overdueDays, daysWord } from "../lib/model.js";
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
  question: "Ви оцінюєте «Підзвітність» на 58,9 бала, а факти показують 18,8. Чому система, на вашу думку, краща, ніж кажуть дані? Наприклад, «підозрілі закупівлі розібрано» лише 40%.",
  why: "Самооцінка 58,9 знижена до 43,8: факти показують 18,8 (+25).",
  evidence: [{ label: "«Підзвітність»: самооцінка", text: "58,9", path: "components.accountability.self_score" }, { label: "за фактами", text: "18,8", path: "components.accountability.facts_score" }, { label: "Підозрілі закупівлі розібрано", text: "40% (48 з 120)", path: "facts.procurement_flags_reviewed" }],
  prepare: "Пояснення розриву по кожному факту: що саме не розглянуто вчасно і чому; план, коли частка досягне наступного порогу.", link: { view: "compare", ref: "accountability" } }] };
// Демо-сигнали будуються з тих самих демо-даних, що й «Огляд» і «Трекер» (як сервер віддає керівнику):
// рекомендації без рішення і прострочені заходи. Раніше тут був приклад із документації, що суперечив демо-моделі.
function demoDigest() {
  const recs = pendingRecs(), od = measures().filter(x => overdueDays(x) > 0), items = [];
  if (recs) items.push({ id: "process:recs", category: "process", severity: "warning", title: `Рекомендації без рішення: ${recs}`, why: "Прийміть, уточніть або відхиліть рекомендації, щоб вони не лишалися без відповіді.", fix: [], link: { view: "recs" } });
  if (od.length) items.push({ id: "process:overdue", category: "process", severity: "warning", title: `Прострочено заходів: ${od.length}`, why: od.map(x => `«${x.t}»: ${overdueDays(x)} ${daysWord(overdueDays(x))}`).join("; "), fix: ["Виконайте з доказом, перенесіть строк із причиною або скасуйте з причиною."], link: { view: "tracker" } });
  return { status: items.length ? "attention" : "ok", counts: { critical: 0, warning: items.length }, items };
}

// Сервер без ?include_info=true не віддає пунктів «до відома» (і ключа info в counts), тож їх тут немає
const SEV = { critical: ["Критично", "p-bad", "red"], warning: ["Потрібна увага", "p-warn", "amber"] };

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

// Список як чек-лист підготовки: позначка, питання, тема; що підготувати й до яких чисел — у розгорнутому рядку
function QRow({ q }) {
  const done = !!S.advDone[q.id], first = q.evidence.map(e => numTarget(e.path)).find(Boolean) || linkTarget(q.link);
  return <details className={`adv-row ${done ? "done" : ""}`}>
    <summary>
      <input type="checkbox" checked={done} onChange={() => mark(q.id)} onClick={e => e.stopPropagation()} aria-label={`Відповідь на питання ${q.n} підготовлено`} />
      <span className="adv-n tnum">{q.n}</span>
      <span className="adv-q"><span className="txt">{dsh(q.question)}</span><span className="lbl">{q.severity >= HIGH && <b className="adv-hot">гостре · </b>}{dsh(q.category)}</span></span>
      <span className="chev"><Ic n="chev" /></span>
    </summary>
    <div className="adv-body">
      <div><div className="lbl" style={{ marginBottom: 4 }}>Що підготувати</div><div className="txt">{dsh(q.prepare)}</div></div>
      {q.evidence.length > 0 && <div className="tags">{q.evidence.map((e, i) => { const t = numTarget(e.path), body = <>{dsh(e.label)}: <b className="tnum">{dsh(e.text)}</b></>;
        return t ? <button key={i} type="button" className="pill p-mute nodot ev-btn" onClick={() => goTo(t)} aria-label={`До числа: ${dsh(e.label)} ${dsh(e.text)}`}>{body}<Ic n="arrowR" /></button> : <span key={i} className="pill p-mute nodot">{body}</span>; })}</div>}
      <div className="lbl txt">Чому питання: {dsh(q.why)}</div>
      {first && <div><button type="button" className="btn btn-soft btn-s" onClick={() => goTo(first)}><Ic n="arrowR" />До числа</button></div>}
    </div>
  </details>;
}

export function Advocate() {
  const r = useAdv(), st = advState(r); if (st) return st;
  const d = r.data, n = d.questions.length, ready = d.questions.filter(q => S.advDone[q.id]).length;
  return <>
    <section className="card c12 rise">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Що спитає аудитор</h2><div className="sp" />
        {n > 0 && <div className="adv-prog" aria-live="polite"><span className="tnum"><b>{ready}</b> з {n} підготовлено</span><div className="dist-bar"><i style={{ width: `${ready / n * 100}%`, background: "var(--teal)" }} /></div></div>}</div>
      {n ? <div className="adv-list">{d.questions.map(q => <QRow key={q.id} q={q} />)}</div> : <div className="lbl">Правила не знайшли слабких місць у цій хвилі.</div>}
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
const useDigest = () => API.on ? apiMod("digest", apiDigest) : { data: demoDigest() };
const sevPill = s => { const x = SEV[s] || SEV.warning; return <Pill cls={x[1]}>{x[0]}</Pill>; };
const FixList = ({ fix }) => fix && fix.length ? <ol className="fix-l">{fix.slice(0, 3).map((t, i) => <li key={i} className="txt">{dsh(t)}</li>)}</ol> : null;

/* Пункти чергового в блоці «Що потребує уваги» на «Огляді»: лише критичні й попередження, до трьох */
// Сигнали, що потребують дії (критичні й попередження). «До відома» не показуємо ніде.
// Окремої вкладки немає: сигнали видно в дзвіночку в шапці й у «Що потребує уваги» на «Огляді».
// Сервер віддає кожній ролі лише те, що вона може виправити; Департаменту нічого (items: []), тож сигналів у нього немає
export const SIG_ROLES = ["leader", "auditor", "admin"];
export function signals() {
  if (!SIG_ROLES.includes(S.role)) return null;
  const r = useDigest();
  // Лише те, що ця роль може виправити: сигнал з посиланням на недоступний їй екран не показуємо
  return r && r.data ? (r.data.items || []).filter(x => x.severity !== "info" && (!x.link || !x.link.view || linkTarget(x.link))) : null;
}
// Збій завантаження сигналів (не «сигналів немає»): дзвіночок показує помилку з повтором
export function sigError() { if (!SIG_ROLES.includes(S.role) || !API.on) return null; const r = useDigest(); return r && r.error ? r.error : null; }
export const sigRetry = () => apiModReset("digest");
export function sigGo(x) { const t = linkTarget(x.link); if (t) goTo(t); }
export const sigTarget = x => linkTarget(x.link);
export function digestTop() { return (signals() || []).slice(0, 3); }
export function DigestRows({ items }) {
  if (!items.length) return null;
  return <div className="dg">
    {items.map(x => <details key={x.id} className="dg-i">
      <summary><span className="dot" style={{ background: x.severity === "critical" ? "var(--red)" : "var(--amber)" }} /><span className="grow txt">{dsh(x.title)}</span>{sevPill(x.severity)}<Ic n="chev" /></summary>
      <div className="dg-b">{x.fix && x.fix.length ? <><b>Як виправити</b><FixList fix={x.fix} /></> : <span className="lbl txt">{dsh(x.why)}</span>}<div>{linkTarget(x.link) ? <GoBtn link={x.link} /> : !(x.link && x.link.view) ? <span className="lbl">Окремого екрана немає: це налаштовується під час розгортання.</span> : null}</div></div>
    </details>)}
  </div>;
}
