/* «Що змінилось для нас»: аналіз нормативного документа. Документ не зберігається, система лише підказує, що переглянути. */
import { useState, useRef } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, apiAnalyze, apiFail, apiAuth } from "../lib/api.js";
import { S, AI_ROLES, addLog, me } from "../lib/state.js";
import { fb, dsh } from "../lib/format.js";
import { Pill } from "../components/ui.jsx";
import { NeedServer } from "../components/states.jsx";
import { KpiRow, ModHead } from "../components/modkit.jsx";
import { can, go } from "../lib/nav.js";

const KIND = { checklist: "Пункти чек-листа", question: "Питання анкет", measure: "Заходи типового плану", fact: "Показники методики" };
const CK = { full: ["впроваджено повністю", "p-good nodot"], partial: ["частково", "p-warn nodot"], none: ["не впроваджено", "p-bad nodot"] };
const MAX = 10 * 1024 * 1024;

export function Normative() {
  const [file, setFile] = useState(null), [text, setText] = useState(""), [title, setTitle] = useState(""), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [kind, setKind] = useState("all"), [err, setErr] = useState(""), inp = useRef(null);
  if (!API.on) return <NeedServer t="Що змінилось для нас">Завантажте новий наказ чи редакцію закону, і система покаже, які пункти чек-листа, питання анкет, заходи й показники він зачіпає.</NeedServer>;
  const pick = f => { setErr(""); if (f && f.size > MAX) { setErr("Файл більший за 10 МБ"); return; } setFile(f || null); };
  const run = async e => {
    e.preventDefault(); setBusy(true); setErr("");
    try { setRes(await apiAnalyze(file, text, title.trim())); setKind("all"); } catch (x) { setErr(x.message || "Не вдалося проаналізувати"); apiFail(x); } finally { setBusy(false); }
  };
  const ok = file || text.trim().length >= 30, ms = res ? res.matches.filter(m => kind === "all" || m.kind === kind) : [];
  // Показники методики лише узгоджують з джерелом; переглядати треба пункти чек-листа, питання анкет і заходи
  const act = res ? res.matches.filter(m => m.kind !== "fact").length : 0;
  return <>
    <section className="card c12 rise"><ModHead ic="layers" tone="teal" title="Документ" />
      <div className="lbl" style={{ marginBottom: 12 }}>Наказ чи нова редакція закону: система покаже, які пункти чек-листа, питання анкет, заходи й показники він зачіпає.</div>
      <form onSubmit={run} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field"><label htmlFor="nm-title">Назва (необовʼязково)</label><input className="inp" id="nm-title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="drop"><input ref={inp} id="nm-file" type="file" accept=".txt,.md,.docx,.pdf" onChange={e => pick(e.target.files[0])} aria-label="Файл документа: txt, md, docx або pdf" />
          <div className="lbl" style={{ marginTop: 6 }}>{file ? `Обрано: ${file.name}` : "Файл .docx, .pdf, .txt або .md, до 10 МБ"}</div></div>
        <div className="field"><label htmlFor="nm-text">Або вставте текст документа</label><textarea className="inp" id="nm-text" rows={5} value={text} onChange={e => setText(e.target.value)} disabled={!!file} /></div>
        {err && <div className="lbl" role="alert" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>{err}</div>}
        <div className="chk-row"><button type="submit" className="btn btn-primary" disabled={!ok || busy}>{busy ? "Аналізуємо…" : "Проаналізувати"}</button>{file && <button type="button" className="btn btn-ghost" onClick={() => { setFile(null); if (inp.current) inp.current.value = ""; }}>Прибрати файл</button>}</div>
      </form></section>
    {res && S.aiOn && AI_ROLES.includes(S.role) && <AiSummary key={res.document.name + res.matches.length} res={res} />}
    {res && <KpiRow items={[{ ic: "layers", t: "Збігів", v: res.matches.length, sub: `фрагментів документа ${res.document.fragments}` },
      { ic: "flag", t: "Потребують дії", v: act, tone: act ? "amber" : "teal", sub: "пункти чек-листа, питання, заходи" }]} />}
    {res && <section className="card c12 rise" aria-live="polite"><ModHead ic="search" tone="blue" title={`Що зачіпає «${dsh(res.document.name)}»`} />
      {res.document.top_terms.length > 0 && <div className="tags" style={{ marginBottom: 10 }}>{res.document.top_terms.map(t => <Pill key={t} cls="p-mute nodot">{t}</Pill>)}</div>}
      <div className="tags" role="group" aria-label="Фільтр за видом" style={{ marginBottom: 10 }}>{[["all", `Усе (${res.matches.length})`], ...Object.entries(KIND).map(([k, n]) => [k, `${n} (${res.by_kind[k] || 0})`])].map(([k, n]) => <button key={k} type="button" className={`pill-btn ${kind === k ? "lime" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{n}</button>)}</div>
      {ms.length ? <div className="qa-list">{ms.map((m, i) => <article key={i} className="qa-item">
        <div className="tags"><Pill cls="p-info nodot">{m.kind_title}</Pill>{m.number && <Pill cls="p-mute nodot">{m.number}</Pill>}<Pill cls="p-mute nodot" tip="Схожість тексту з елементом, від 0 до 1">Схожість {fb(m.score)}</Pill>
          {m.current_status && <Pill cls={CK[m.current_status.status] ? CK[m.current_status.status][1] : "p-mute"}>Зараз: {(CK[m.current_status.status] || [m.current_status.status])[0]}{m.current_status.confirmed ? ", підтверджено" : ""}</Pill>}</div>
        <b className="txt">{dsh(m.title)}</b>
        {m.matched_terms.length > 0 && <div className="lbl txt">Спільні слова: {m.matched_terms.join(", ")}</div>}
        <div className="note-box"><b>Фрагмент документа</b><span className="txt">{dsh(m.fragment)}</span></div>
        <div className="txt">{dsh(m.action)}</div>
        {m.kind === "checklist" && can("checklist") && <div><button type="button" className="btn btn-soft" onClick={() => go("checklist")}><Ic n="arrowR" />Відкрити чек-лист</button></div>}
      </article>)}</div> : <div className="lbl">У цій групі збігів немає.</div>}
      <div className="lbl" style={{ marginTop: 10 }}>{dsh(res.note)}</div></section>}
  </>;
}

// Короткий висновок від ШІ поверх знайдених правилами збігів. Збіги шукає система; ШІ лише пише чернетку,
// що це означає для закладу. Вимикається загальним вимикачем ШІ; без моделі екран працює як раніше.
function AiSummary({ res }) {
  const [st, setSt] = useState({ wait: false, text: "", err: "", warn: [] });
  const ask = async () => {
    setSt({ wait: true, text: "", err: "", warn: [] });
    const top = res.matches.filter(m => m.kind !== "fact").slice(0, 12)
      .map(m => `- ${m.kind_title}${m.number ? " " + m.number : ""}: ${m.title}${m.current_status ? ` (зараз: ${(CK[m.current_status.status] || [m.current_status.status])[0]})` : ""}. Дія: ${m.action}`).join("\n");
    const body = { selection: `Документ «${res.document.name}». Знайдені правилами збіги:\n${top}`.slice(0, 4000), mode: "ask", unit_id: API.unitId || null,
      instruction: "Коротко, 3–4 речення: що цей документ означає для закладу і з чого почати. Спирайся лише на збіги. Нових чисел не додавай.",
      document: res.matches.map(m => m.fragment).join("\n").slice(0, 20000) };
    try {
      const r = await fetch("/api/assistant/edit", { method: "POST", headers: { "content-type": "application/json", ...apiAuth() }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.text) throw new Error(r.status === 503 ? "ШІ зараз недоступний. Список збігів нижче складено правилами й працює без нього." : "Не вдалося отримати висновок. Спробуйте ще раз.");
      setSt({ wait: false, text: dsh(j.text), err: "", warn: j.warnings || [] });
      addLog(me(), `Що змінилось: чернетка висновку ШІ до «${res.document.name}»`);
    } catch (e) { setSt({ wait: false, text: "", err: e.message, warn: [] }); }
  };
  return <section className="card c12 rise"><ModHead ic="spark" tone="teal" title="Що це означає для нас" />
    {st.text ? <>
      <div className="txt" style={{ lineHeight: 1.55 }}>{st.text}</div>
      {st.warn.length > 0 && <div className="lbl" style={{ marginTop: 6, color: "var(--amber)" }}>Перевірте: {st.warn.join("; ")}</div>}
      <div className="lbl" style={{ marginTop: 8 }}>Чернетка ШІ на основі збігів нижче. Перевірте за списком.</div>
      <div style={{ marginTop: 10 }}><button type="button" className="btn btn-ghost btn-s" onClick={ask} disabled={st.wait}><Ic n="spark" />Написати ще раз</button></div>
    </> : <>
      <div className="lbl" style={{ marginBottom: 10 }}>Система вже знайшла, що зачіпає документ. ШІ може коротко підсумувати це й підказати, з чого почати.</div>
      {st.err && <div className="lbl" role="alert" style={{ marginBottom: 8, color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>{st.err}</div>}
      <button type="button" className="btn btn-soft" onClick={ask} disabled={st.wait}><Ic n="spark" />{st.wait ? "Пишемо…" : "Підсумувати"}</button>
    </>}
  </section>;
}
