/* Інсайти: «Адвокат диявола» (питання аудитора до результатів) і «Черговий» (що змінилось і як виправити). */
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiAdvocate, apiDigest } from "../lib/api.js";
import { S, persist } from "../lib/state.js";
import { COMPS } from "../lib/model.js";
import { can, go, TITLES } from "../lib/nav.js";
import { render } from "../lib/store.js";
import { Pill } from "../components/ui.jsx";
import { dsh } from "../lib/format.js";
import { Loading, Failed, Empty } from "../components/states.jsx";

/* Приклади з docs/features.md для режиму без сервера */
const DEMO_Q = { total_found: 1, note: "Приклад із документації (docs/features.md). З сервером питання формуються з чисел закритої хвилі.", rules: [], questions: [{
  n: 1, id: "cut_by_facts:accountability", rule_id: "cut_by_facts", severity: 100, category: "Факти проти самооцінки",
  question: "Ви оцінюєте «Підзвітність» на 58,9 балів, а факти показують 18,8. Чому система, на вашу думку, краща, ніж кажуть дані? Наприклад, «підозрілі закупівлі розібрано» лише 40%.",
  why: "Самооцінка 58,9 знижена до 43,8: факти показують 18,8 (+25).",
  evidence: [{ label: "«Підзвітність»: самооцінка", text: "58,9", path: "components.accountability.self_score" }, { label: "за фактами", text: "18,8", path: "components.accountability.facts_score" }, { label: "Підозрілі закупівлі розібрано", text: "40% (48 з 120)", path: "facts.procurement_flags_reviewed" }],
  prepare: "Пояснення розриву по кожному факту: що саме не розглянуто вчасно і чому; план, коли частка досягне наступного порогу.", link: { view: "compare", ref: "accountability" } }] };
const DEMO_D = { status: "attention", summary: "Приклад із документації (docs/features.md).", counts: { critical: 0, warning: 1, info: 0 }, note: "", items: [{
  id: "drop:culture", category: "drop", severity: "warning", title: "«Культура» знизилась між двома останніми хвилями",
  what: "Компонент змінився більше ніж на 5 балів.", why: "чек-лист: −15,6 бала; робоча група: −15,6 бала. Найбільше впало питання «Яку цінність відіграє доброчесність…» (−6,2).", fix: [], link: { view: "explain", ref: "culture" } }] };

const SEV = { critical: ["Критично", "p-bad"], warning: ["Потрібна увага", "p-warn"], info: ["До відома", "p-info"] };
const STATUS = { ok: ["Усе гаразд", "p-good"], attention: ["Потрібна увага", "p-warn"], critical: ["Критично", "p-bad"] };
const CAT = { drop: "Падіння", rise: "Зростання", process: "Процес", technical: "Технічне" };

// Куди веде посилання сервера: лише на екрани, доступні ролі
function target(link) {
  const v = link && link.view; if (!v || !TITLES[v] || !can(v)) return null;
  return { href: v === "explain" && COMPS.includes(link.ref) ? "explain/" + link.ref : v, t: TITLES[v] };
}
const GoBtn = ({ link }) => { const t = target(link); return t ? <button type="button" className="btn btn-soft" onClick={() => go(t.href)}><Ic n="arrowR" />Відкрити: {t.t}</button> : null; };

/* --- «Адвокат диявола» --- */
export function Advocate() {
  const mark = id => { S.advDone[id] = !S.advDone[id]; persist(); render(true); };
  let r;
  if (!API.on) r = { data: DEMO_Q };
  else if (!API.campaignId) return API.empty ? <Empty t="Ще немає закритої хвилі">Питання аудитора формуються за результатами закритої хвилі.</Empty> : <Loading t="Адвокат диявола" />;
  else r = apiMod("adv", () => apiAdvocate(API.campaignId, 30));
  if (!r) return <Loading t="Питання аудитора" />;
  if (r.error) return r.status === 409 ? <Empty t="Хвиля ще не закрита">Питання формуються за закритою хвилею.</Empty> : <Failed e={r.error} onRetry={() => apiModReset("adv")} />;
  const d = r.data, left = d.questions.filter(q => !S.advDone[q.id]).length;
  return <>
    <section className="c12 rise toolbar"><span className="lbl">Що саме спитає зовнішній аудитор. Питання про систему доброчесності, не про людей. Той самий вхід дає ті самі питання.</span></section>
    <section className="card c12 rise"><div className="card-h"><h2>Питання до результатів</h2><div className="sp" /><span className="lbl" aria-live="polite">Без відповіді: {left} з {d.questions.length}{d.total_found > d.questions.length ? `, усього знайдено ${d.total_found}` : ""}</span></div>
      {d.questions.length ? <div className="qa-list">{d.questions.map(q => <article key={q.id} className={`qa-item ${S.advDone[q.id] ? "done" : ""}`}>
        <div className="tags"><Pill cls="p-mute nodot">{q.n}</Pill><Pill cls="p-info nodot">{dsh(q.category)}</Pill><Pill cls="p-warn nodot" tip="Вага правила: що вище, то неприємніше питання">Вага {q.severity}</Pill></div>
        <div className="txt" style={{ fontSize: 15, fontWeight: 600 }}>{dsh(q.question)}</div>
        <div className="lbl txt">Чому питання: {dsh(q.why)}</div>
        {q.evidence.length > 0 && <div className="tags">{q.evidence.map((e, i) => <span key={i} className="pill p-mute nodot">{dsh(e.label)}: <b className="tnum">{dsh(e.text)}</b></span>)}</div>}
        <div className="note-box"><b>Що підготувати</b><span className="txt">{dsh(q.prepare)}</span></div>
        <div className="chk-row"><GoBtn link={q.link} />
          <label className="chk-row lbl" style={{ marginLeft: "auto" }}><input type="checkbox" checked={!!S.advDone[q.id]} onChange={() => mark(q.id)} />Відповідь підготовлено</label></div>
      </article>)}</div> : <div className="lbl">Правила не знайшли слабких місць у цій хвилі.</div>}
      <div className="lbl" style={{ marginTop: 10 }}>{dsh(d.note)} Позначка «Відповідь підготовлено» зберігається лише у вашому браузері, сервер її не отримує. Кожен перегляд питань записується в журнал дій{can("audit") ? <> (<a className="link" href="#audit">Журнал</a>)</> : ""}.</div>
    </section>
    {d.rules && d.rules.length > 0 && <details className="card c12 rise guide"><summary className="card-h"><h2>Правила, за якими формуються питання</h2><div className="sp" /><span className="chev"><Ic n="chev" /></span></summary>
      <div className="rows">{d.rules.map(x => <div key={x.id} className="row"><div className="grow txt">{dsh(x.description)}</div></div>)}</div></details>}
  </>;
}

/* --- «Черговий» --- */
function useDigest() { return API.on ? apiMod("digest", apiDigest) : { data: DEMO_D }; }

export function Watch() {
  const r = useDigest();
  if (!r) return <Loading t="Черговий" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("digest")} />;
  const d = r.data, cat = S.digestCat || "all", items = d.items.filter(x => cat === "all" || x.category === cat), st = STATUS[d.status] || STATUS.attention;
  const setCat = c => { S.digestCat = c; render(true); };
  return <>
    <section className="c12 rise toolbar"><span className="lbl">Правила перевіряють стан без ШІ: що впало, чому і як виправити. Показано лише те, що належить вашій ролі.</span></section>
    <section className="card c12 rise"><div className="card-h"><h2>Стан</h2><Pill cls={st[1]}>{st[0]}</Pill><div className="sp" />
      <div className="tags" role="group" aria-label="Фільтр за видом">{[["all", "Усе"], ...Object.entries(CAT)].map(([c, n]) => <button key={c} type="button" className={`pill-btn ${cat === c ? "lime" : ""}`} aria-pressed={cat === c} onClick={() => setCat(c)}>{n}</button>)}</div></div>
      <div className="txt" aria-live="polite">{dsh(d.summary)}</div></section>
    {items.length ? items.map(x => { const s = SEV[x.severity] || SEV.info; return <section key={x.id} className={`card c12 rise sev ${x.severity}`}>
      <div className="card-h"><h2 className="txt">{dsh(x.title)}</h2><div className="sp" /><Pill cls="p-mute nodot">{CAT[x.category] || x.category}</Pill><Pill cls={s[1]}>{s[0]}</Pill></div>
      <div className="txt">{dsh(x.what)}</div><div className="lbl txt" style={{ margin: "6px 0" }}>Чому: {dsh(x.why)}</div>
      {x.fix && x.fix.length > 0 && <div className="note-box"><b>Як виправити</b><ol style={{ margin: 0, paddingLeft: 20 }}>{x.fix.map((t, i) => <li key={i} className="txt">{dsh(t)}</li>)}</ol></div>}
      <div style={{ marginTop: 10 }}><GoBtn link={x.link} /></div></section>; })
      : <Empty t={d.items.length ? "У цій групі нічого немає" : "Відхилень не знайдено"}>{d.items.length ? "Оберіть іншу групу." : "За правилами чергового все гаразд."}</Empty>}
  </>;
}

/* Короткий блок у «Огляді»: найважливіші пункти чергового під «Що потребує уваги» */
export function DigestStrip() {
  if (!API.on || !["leader", "auditor"].includes(S.role)) return null;
  const r = apiMod("digest", apiDigest);
  if (!r || r.error || !r.data.items.length) return null;
  const top = r.data.items.slice(0, 3);
  return <div className="digest-strip" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
    <div className="card-h"><h2>Від чергового</h2><div className="sp" /><a className="pill-btn" href="#watch"><Ic n="arrowR" />Усі</a></div>
    <div className="rows">{top.map(x => <a key={x.id} className="row click" href="#watch"><span className="dot" style={{ background: x.severity === "critical" ? "var(--red)" : x.severity === "warning" ? "var(--amber)" : "var(--blue)" }} /><div className="grow txt">{dsh(x.title)}</div><Pill cls="p-mute nodot">{CAT[x.category] || x.category}</Pill></a>)}</div>
  </div>;
}
