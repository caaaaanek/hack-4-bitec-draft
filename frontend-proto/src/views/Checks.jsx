/* «Перевірки» (лише уповноважений): запуск перевірки закупівель і декларацій, знахідки, розгляд, запис показників. */
import { useState } from "react";
import { API, api, apiMod, apiModReset, apiCheckRuns, apiCheckFindings, apiCheckRun, apiCheckReview, apiCheckPublish, apiFail, dn } from "../lib/api.js";
import { S } from "../lib/state.js";
import { toast } from "../lib/store.js";
import { ua, dsh } from "../lib/format.js";
import { Pill } from "../components/ui.jsx";
import { Loading, Failed, Empty, NeedServer, NoAccess } from "../components/states.jsx";
import { KpiRow, ModHead, More } from "../components/modkit.jsx";

const KIND = { procurement: "Закупівлі", declarations: "Декларації" };
const RISK = { low: ["Низький", "p-good nodot"], medium: ["Середній", "p-warn nodot"], high: ["Високий", "p-bad nodot"] };
const ST = { new: ["Нова", "p-info nodot"], reviewed: ["Розглянуто", "p-good nodot"], dismissed: ["Відхилено", "p-mute nodot"] };
const month = () => new Date().toISOString().slice(0, 7);

function Finding({ f, onDone }) {
  const [st, setSt] = useState(f.status), [cm, setCm] = useState(f.comment || ""), [busy, setBusy] = useState(false), r = RISK[f.risk_level] || RISK.low, s = ST[f.status] || ST.new;
  const save = async () => { setBusy(true); try { await apiCheckReview(f.id, st, cm); toast("Розгляд збережено"); onDone(); } catch (e) { apiFail(e); } finally { setBusy(false); } };
  return <article className="qa-item">
    <div className="tags"><Pill cls="p-mute nodot">{KIND[f.kind] || f.kind}</Pill><Pill cls={r[1]}>Ризик: {r[0].toLowerCase()}</Pill><Pill cls={s[1]}>{s[0]}</Pill><span className="lbl tnum">{f.period}</span></div>
    <div className="txt">Запис: <b className="tnum">{f.record_ref}</b></div>
    <div className="rows">{f.flags.map((x, i) => <div key={i} className="row" style={{ alignItems: "flex-start" }}><div className="grow"><div className="txt">{dsh(x.title)}</div>{x.law_refs && x.law_refs.length > 0 && <div className="lbl txt">{[].concat(x.law_refs).join("; ")}</div>}</div></div>)}</div>
    <div className="chk-row" style={{ flexWrap: "wrap" }}>
      <label className="lbl" htmlFor={"st" + f.id}>Статус</label><select className="inp" id={"st" + f.id} value={st} onChange={e => setSt(e.target.value)}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      <input className="inp" aria-label="Коментар до знахідки" placeholder="Коментар" maxLength={1000} value={cm} onChange={e => setCm(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      <button type="button" className="btn btn-soft" onClick={save} disabled={busy || (st === f.status && cm === (f.comment || ""))}>Зберегти</button></div>
    {f.reviewed_at && <div className="lbl">Розглянуто {ua(f.reviewed_at.slice(0, 10))}</div>}
  </article>;
}

export function Checks() {
  const [unit, setUnit] = useState(""), [period, setPeriod] = useState(month()), [kind, setKind] = useState("procurement"), [busy, setBusy] = useState(false), [fk, setFk] = useState(""), [fs, setFs] = useState(""), [fr, setFr] = useState("");
  if (!API.on) return <NeedServer t="Перевірки">Тут уповноважений запускає перевірку закупівель і декларацій, розглядає знахідки й записує показники.</NeedServer>;
  if (S.role !== "admin") return <NoAccess />;
  const units = apiMod("chk:units", () => api("/admin/units")), runs = apiMod("chk:runs", apiCheckRuns);
  const fkey = "chk:f:" + [fk, fs, fr].join("|"), found = apiMod(fkey, () => apiCheckFindings({ kind: fk, status: fs, risk_level: fr }));
  const all = apiMod("chk:f:||", () => apiCheckFindings({})), allD = all && all.data;
  if (!units || !runs) return <Loading t="Перевірки" />;
  if (units.error) return <Failed e={units.error} onRetry={() => apiModReset("chk:units")} />;
  if (runs.error) return <Failed e={runs.error} onRetry={() => apiModReset("chk:runs")} />;
  const uid = unit || (units.data.find(u => !u.parent_id) || units.data[0] || {}).id, uname = id => { const u = units.data.find(x => x.id === id); return u ? dn(u.name) : "підрозділ"; };
  const okPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const refresh = () => { for (const k of Object.keys(API.mod)) if (k.startsWith("chk:f:") || k === "chk:runs") delete API.mod[k]; apiModReset("chk:runs"); };
  const run = async () => { setBusy(true); try { const r = await apiCheckRun(kind, uid, period); toast(`Перевірено записів: ${r.total}, знахідок: ${r.flagged}`); refresh(); } catch (e) { apiFail(e); } finally { setBusy(false); } };
  const publish = async () => { setBusy(true); try { const r = await apiCheckPublish(uid, period); toast(`Записано показників: ${r.indicators.filter(i => i.written).length}`); } catch (e) { apiFail(e); } finally { setBusy(false); } };
  return <>
    <KpiRow items={[{ ic: "history", t: "Запусків", v: runs.data.length, sub: runs.data.length >= 50 ? "показано останні 50" : null },
      { ic: "flag", t: "Знахідок", v: allD ? allD.length : "…", tone: allD && allD.some(f => f.status === "new") ? "amber" : undefined, sub: allD ? `${allD.length >= 200 ? "показано 200, " : ""}нових ${allD.filter(f => f.status === "new").length}` : null },
      { ic: "check", t: "Розглянуто", v: allD ? allD.filter(f => f.status !== "new").length : "…", tone: "teal", sub: allD && allD.length >= 200 ? "серед показаних" : null }]} />
    <section className="card c12 rise"><ModHead ic="shield" tone="teal" title="Запуск" />
      <div className="lbl" style={{ marginBottom: 10 }}>Перевірка за правилами без ШІ, лише публічні ідентифікатори записів.</div>
      <div className="mod-grid">
        <div className="field"><label htmlFor="ck-kind">Що перевіряти</label><select className="inp" id="ck-kind" value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="ck-unit">Підрозділ</label><select className="inp" id="ck-unit" value={uid || ""} onChange={e => setUnit(e.target.value)}>{units.data.map(u => <option key={u.id} value={u.id}>{dn(u.name)}</option>)}</select></div>
        <div className="field"><label htmlFor="ck-per">Період (РРРР-ММ)</label><input className="inp" id="ck-per" value={period} onChange={e => setPeriod(e.target.value)} aria-invalid={!okPeriod} /></div></div>
      <div className="chk-row" style={{ marginTop: 12 }}><button type="button" className="btn btn-primary" onClick={run} disabled={busy || !okPeriod || !uid}>Запустити перевірку</button>
        <button type="button" className="btn btn-soft" onClick={publish} disabled={busy || !okPeriod || !uid} data-tip="Рахує частки з усіх знахідок підрозділу за період і записує їх як факти для індексу">Записати показники</button></div></section>
    <section className="card c12 rise"><ModHead ic="history" tone="blue" title="Останні запуски" />
      {runs.data.length ? <div className="tbl-wrap"><table><thead><tr><th>Коли</th><th>Вид</th><th>Підрозділ</th><th>Період</th><th>Записів</th><th>Знахідок</th></tr></thead><tbody>
        {runs.data.slice(0, 8).map(r => <tr key={r.run_id}><td className="tnum">{ua(r.created_at.slice(0, 10))}</td><td>{KIND[r.kind] || r.kind}</td><td>{uname(r.unit_id)}</td><td className="tnum">{r.period}</td><td className="tnum">{r.total}</td><td className="tnum">{r.flagged}</td></tr>)}</tbody></table></div> : <div className="lbl">Запусків ще не було.</div>}</section>
    <section className="card c12 rise"><ModHead ic="flag" tone="amber" title="Знахідки">
      <select className="inp" aria-label="Вид" value={fk} onChange={e => setFk(e.target.value)}><option value="">Усі види</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select className="inp" aria-label="Статус" value={fs} onChange={e => setFs(e.target.value)}><option value="">Усі статуси</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
      <select className="inp" aria-label="Ризик" value={fr} onChange={e => setFr(e.target.value)}><option value="">Будь-який ризик</option>{Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></ModHead>
      {!found ? <div className="lbl" role="status">Завантажуємо знахідки…</div> : found.error ? <Failed e={found.error} onRetry={() => apiModReset(fkey)} />
        : found.data.length ? <div className="qa-list" aria-live="polite">{found.data.map(f => <Finding key={f.id + f.status} f={f} onDone={() => { delete API.mod[fkey]; apiModReset("chk:runs", "chk:f:||"); }} />)}</div> : <Empty t="Знахідок немає">Змініть фільтри або запустіть перевірку.</Empty>}</section>
  </>;
}
