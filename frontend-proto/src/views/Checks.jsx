/* «Перевірки» (лише уповноважений): запуск перевірки закупівель і декларацій, знахідки, розгляд, запис показників. */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, api, apiMod, apiModReset, apiCheckRuns, apiCheckFindings, apiCheckRun, apiCheckReview, apiCheckPublish, apiFail, dn, liveChecks } from "../lib/api.js";
import { S } from "../lib/state.js";
import { toast } from "../lib/store.js";
import { ua, dsh } from "../lib/format.js";
import { Pill } from "../components/ui.jsx";
import { Loading, Failed, Empty, NeedServer, NoAccess } from "../components/states.jsx";
import { ModHead } from "../components/modkit.jsx";

const KIND = { procurement: "Закупівлі", declarations: "Декларації", counterparty: "Контрагенти" };
// Коди ЄДРПОУ з поля вводу: 8 цифр, через кому, пробіл чи з нового рядка
const codes = t => [...new Set(String(t).split(/[^0-9]+/).filter(Boolean))];
const RISK = { low: ["Низький", "p-good nodot"], medium: ["Середній", "p-warn nodot"], high: ["Високий", "p-bad nodot"] };
const ST = { new: ["Нова", "p-info nodot"], reviewed: ["Розглянуто", "p-good nodot"], dismissed: ["Відхилено", "p-mute nodot"] };
const RCOL = { low: "var(--teal)", medium: "var(--amber)", high: "var(--red)" };
const month = () => new Date().toISOString().slice(0, 7);
// Звідки беруться записи: живий реєстр чи тестовий набір. Контрагенти поки лише тестові (немає договору з постачальником).
const SRC_T = { procurement: ["Prozorro", "останні завершені тендери з публічного API Prozorro"], declarations: ["Реєстр декларацій НАЗК", "список декларацій з публічного API НАЗК, без ПІБ"] };

function Finding({ f, onDone }) {
  const [st, setSt] = useState(f.status), [cm, setCm] = useState(f.comment || ""), [busy, setBusy] = useState(false), r = RISK[f.risk_level] || RISK.low, s = ST[f.status] || ST.new;
  const save = async () => { setBusy(true); try { await apiCheckReview(f.id, st, cm); toast("Розгляд збережено"); onDone(); } catch (e) { apiFail(e); } finally { setBusy(false); } };
  return <article className="qa-item">
    <div className="fd-h"><span className="dot" style={{ background: RCOL[f.risk_level] || RCOL.low }} /><b className="tnum">{f.record_ref}</b><span className="lbl">{KIND[f.kind] || f.kind} · ризик {r[0].toLowerCase()} · {s[0].toLowerCase()} · {f.period}</span></div>
    <div className="rows">{f.flags.map((x, i) => <div key={i} className="row" style={{ alignItems: "flex-start" }}><div className="grow"><div className="txt">{dsh(x.title)}</div>{x.law_refs && x.law_refs.length > 0 && <div className="lbl txt">{[].concat(x.law_refs).join("; ")}</div>}</div></div>)}</div>
    <div className="chk-row" style={{ flexWrap: "wrap" }}>
      <label className="lbl" htmlFor={"st" + f.id}>Статус</label><select className="inp" id={"st" + f.id} value={st} onChange={e => setSt(e.target.value)}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      <input className="inp" aria-label="Коментар до знахідки" placeholder="Коментар" maxLength={1000} value={cm} onChange={e => setCm(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      <button type="button" className="btn btn-soft" onClick={save} disabled={busy || (st === f.status && cm === (f.comment || ""))}>Зберегти</button></div>
    {f.reviewed_at && <div className="lbl">Рішення від {ua(f.reviewed_at.slice(0, 10))}</div>}
  </article>;
}

export function Checks() {
  const [lim, setLim] = useState(20);
  const [unit, setUnit] = useState(""), [period, setPeriod] = useState(month()), [kind, setKind] = useState("procurement"), [busy, setBusy] = useState(false), [src, setSrc] = useState(liveChecks() ? "live" : "test"), [cp, setCp] = useState(""), [fk, setFk] = useState(""), [fs, setFs] = useState(""), [fr, setFr] = useState("");
  if (!API.on) return <NeedServer t="Перевірки">Тут уповноважений запускає перевірку закупівель і декларацій, розглядає знахідки й записує показники.</NeedServer>;
  if (S.role !== "admin") return <NoAccess />;
  const units = apiMod("chk:units", () => api("/units")), runs = apiMod("chk:runs", apiCheckRuns);
  const fkey = "chk:f:" + [fk, fs, fr].join("|"), found = apiMod(fkey, () => apiCheckFindings({ kind: fk, status: fs, risk_level: fr }));
  const all = apiMod("chk:f:||", () => apiCheckFindings({})), allD = all && all.data;
  if (!units || !runs) return <Loading t="Перевірки" />;
  if (units.error) return <Failed e={units.error} onRetry={() => apiModReset("chk:units")} />;
  if (runs.error) return <Failed e={runs.error} onRetry={() => apiModReset("chk:runs")} />;
  const uid = unit || (units.data.find(u => !u.parent_id) || units.data[0] || {}).id, uname = id => { const u = units.data.find(x => x.id === id); return u ? dn(u.name) : "підрозділ"; };
  const okPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(period), canLive = liveChecks() && kind !== "counterparty", live = canLive && src === "live";
  const refresh = () => { for (const k of Object.keys(API.mod)) if (k.startsWith("chk:f:") || k === "chk:runs") delete API.mod[k]; apiModReset("chk:runs"); };
  const cpCodes = codes(cp), cpBad = cpCodes.filter(c => c.length !== 8);
  const run = async () => { setBusy(true); try {
    // Контрагенти: адаптер до Youcontrol чи аналога; без договору сервер відповідає моком із припущеним форматом
    const r = kind === "counterparty" ? await api("/checks/counterparty", { method: "POST", body: { unit_id: uid, period, edrpou: cpCodes } }) : await apiCheckRun(kind, uid, period, live);
    toast(`Перевірено записів: ${r.total}, знахідок: ${r.flagged}. ${live ? `Джерело: ${SRC_T[kind][0]}` : "Дані тестові"}`); refresh(); } catch (e) { apiFail(e); } finally { setBusy(false); } };
  const publish = async () => { setBusy(true); try { const r = await apiCheckPublish(uid, period); toast(`Записано показників: ${r.indicators.filter(i => i.written).length}`); } catch (e) { apiFail(e); } finally { setBusy(false); } };
  return <>
    <section className="card c12 rise"><ModHead ic="shield" tone="teal" title="Запуск" />
      <div className="mod-grid">
        <div className="field"><label htmlFor="ck-kind">Що перевіряти</label><select className="inp" id="ck-kind" value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="ck-unit">Підрозділ</label><select className="inp" id="ck-unit" value={uid || ""} onChange={e => setUnit(e.target.value)}>{units.data.map(u => <option key={u.id} value={u.id}>{dn(u.name)}</option>)}</select></div>
        <div className="field"><label htmlFor="ck-per">Період (РРРР-ММ)</label><input className="inp" id="ck-per" value={period} onChange={e => setPeriod(e.target.value)} aria-invalid={!okPeriod} /></div>
        {kind !== "counterparty" && <div className="field"><label htmlFor="ck-src">Джерело даних</label><select className="inp" id="ck-src" value={live ? "live" : "test"} disabled={!canLive} onChange={e => setSrc(e.target.value)}>{canLive && <option value="live">{SRC_T[kind][0]}</option>}<option value="test">Тестовий набір</option></select></div>}</div>
      {kind !== "counterparty" && <div className="lbl" style={{ marginTop: 8 }}>{live ? `Беремо ${SRC_T[kind][1]}.` : canLive ? "Синтетичні записи для навчання й демонстрації. Показники з них не відображають реальний стан." : "Живі запити до реєстрів на сервері вимкнено, тому перевірка йде на синтетичних записах. Показники з них не відображають реальний стан."}</div>}
      {kind === "counterparty" && <div className="field" style={{ marginTop: 10 }}><label htmlFor="ck-cp">Коди ЄДРПОУ контрагентів (8 цифр, кожен з нового рядка або через кому)</label><textarea id="ck-cp" className="inp" rows={3} value={cp} onChange={e => setCp(e.target.value)} aria-invalid={cpBad.length > 0} />
        <span className="lbl">{cpBad.length ? `Не 8 цифр: ${cpBad.slice(0, 5).join(", ")}` : `Кодів: ${cpCodes.length}. Перевіряються санкції, банкрутство, податковий борг, суди й «молода» компанія. Поки договору з постачальником немає, сервер відповідає тестовими даними з припущеним форматом.`}</span></div>}
      <div className="chk-row" style={{ marginTop: 12 }}><button type="button" className="btn btn-primary" onClick={run} disabled={busy || !okPeriod || !uid || (kind === "counterparty" && (!cpCodes.length || cpBad.length > 0))}>{busy ? "Перевіряємо…" : "Запустити перевірку"}</button>
        <button type="button" className="btn btn-soft" onClick={publish} disabled={busy || !okPeriod || !uid} data-tip="Рахує частки з усіх знахідок підрозділу за період і записує їх як факти для індексу">Записати показники</button></div>
</section>
    <section className="card c12 rise"><ModHead ic="flag" tone="amber" title="Знахідки">
      <select className="inp" aria-label="Вид" value={fk} onChange={e => { setFk(e.target.value); setLim(20); }}><option value="">Усі види</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select className="inp" aria-label="Статус" value={fs} onChange={e => { setFs(e.target.value); setLim(20); }}><option value="">Усі статуси</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      <select className="inp" aria-label="Ризик" value={fr} onChange={e => { setFr(e.target.value); setLim(20); }}><option value="">Будь-який ризик</option>{Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></ModHead>
      {allD && <div className="lbl chk-sum">Запусків {runs.data.length >= 50 ? "50+" : runs.data.length} · знахідок {allD.length >= 200 ? "200+" : allD.length}, нових {allD.filter(f => f.status === "new").length} · розглянуто {allD.filter(f => f.status !== "new").length}</div>}
      {!found ? <div className="lbl" role="status">Завантажуємо знахідки…</div> : found.error ? <Failed e={found.error} onRetry={() => apiModReset(fkey)} />
        : found.data.length ? <><div className="qa-list" aria-live="polite">{found.data.slice(0, lim).map(f => <Finding key={f.id + f.status} f={f} onDone={() => { delete API.mod[fkey]; apiModReset("chk:runs", "chk:f:||"); }} />)}</div>
          {found.data.length > lim && <button type="button" className="btn btn-soft" style={{ marginTop: 12, alignSelf: "flex-start" }} onClick={() => setLim(lim + 20)}>Показати ще {Math.min(20, found.data.length - lim)} з {found.data.length - lim}</button>}</> : <Empty t="Знахідок немає">Змініть фільтри або запустіть перевірку.</Empty>}</section>
    <details className="card c12 rise guide chk-runs"><summary className="card-h"><h2>Останні запуски</h2><span className="lbl">{runs.data.length}</span><div className="sp" /><span className="chev"><Ic n="chev" /></span></summary>
      {runs.data.length ? <div className="tbl-wrap"><table><thead><tr><th>Коли</th><th>Вид</th><th>Підрозділ</th><th>Період</th><th>Записів</th><th>Знахідок</th></tr></thead><tbody>
        {runs.data.slice(0, 10).map(r => <tr key={r.run_id}><td className="tnum">{ua(r.created_at.slice(0, 10))}</td><td>{KIND[r.kind] || r.kind}</td><td>{uname(r.unit_id)}</td><td className="tnum">{r.period}</td><td className="tnum">{r.total}</td><td className="tnum">{r.flagged}</td></tr>)}</tbody></table></div> : <div className="lbl">Запусків ще не було.</div>}</details>
  </>;
}
