/* «Автопілот хвилі»: план, нагадування, автозакриття, автозвіт, ручний крок. Змінює налаштування лише адміністратор. */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiAutopilotCampaigns, apiAutopilot, apiAutopilotSet, apiAutopilotTick, apiAutopilotReport, apiFail, dn } from "../lib/api.js";
import { S } from "../lib/state.js";
import { render, toast } from "../lib/store.js";
import { dsh } from "../lib/format.js";
import { Pill } from "../components/ui.jsx";
import { DatePicker } from "../components/DatePicker.jsx";
import { Loading, Failed, Empty, NeedServer } from "../components/states.jsx";

const CST = { draft: ["Чернетка", "p-mute"], open: ["Триває", "p-good"], closed: ["Завершено", "p-info"] };
const STEP = { open: "Відкриття", close: "Закриття", reminder: "Нагадування", report: "Звіт", recommendations: "Рекомендації", theme2: "Черга заходів", daily: "Щоденний крок", tick: "Крок" };
const EV = { ok: ["Виконано", "p-good"], error: ["Помилка", "p-bad"], skipped: ["Пропущено", "p-mute"] };
const when = iso => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function Form({ a, onSaved }) {
  const [f, setF] = useState({ enabled: a.enabled, open: a.planned_open_on || "", close: a.planned_close_on || "", pct: a.close_at_percent ?? "", rem: a.remind_every_days ?? "" }), [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v })), draft = a.status === "draft";
  const miss = f.enabled && !f.close && !f.pct;
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiAutopilotSet(a.campaign_id, { enabled: f.enabled, planned_open_on: draft ? f.open || null : undefined, planned_close_on: f.close || null, close_at_percent: f.pct === "" ? null : +f.pct, remind_every_days: f.rem === "" ? null : +f.rem });
      toast("Налаштування автопілота збережено"); onSaved(r);
    } catch (e) { apiFail(e); } finally { setBusy(false); }
  };
  return <section className="card c12 rise"><div className="card-h"><h2>Налаштування</h2></div>
    <label className="a11y-row"><span>Автопілот увімкнено</span><span className="sw"><input type="checkbox" checked={f.enabled} onChange={e => set("enabled", e.target.checked)} /><span /></span></label>
    <div className="mod-grid" style={{ marginTop: 12 }}>
      {draft && <div className="field"><label htmlFor="ap-open">Відкрити</label><DatePicker id="ap-open" value={f.open} onChange={v => set("open", v)} /></div>}
      <div className="field"><label htmlFor="ap-close">Закрити не пізніше</label><DatePicker id="ap-close" value={f.close} min={f.open || undefined} onChange={v => set("close", v)} /></div>
      <div className="field"><label htmlFor="ap-pct">Закрити раніше, коли участь у кожній анкеті не менша, %</label><input className="inp" id="ap-pct" type="number" min="1" max="100" value={f.pct} onChange={e => set("pct", e.target.value)} /></div>
      <div className="field"><label htmlFor="ap-rem">Нагадувати кожні, днів</label><input className="inp" id="ap-rem" type="number" min="1" max="60" value={f.rem} onChange={e => set("rem", e.target.value)} /></div>
    </div>
    {miss && <div className="lbl" role="alert" style={{ color: "var(--red)", marginTop: 8 }}>Для автопілота потрібна дата закриття або поріг участі.</div>}
    <div className="lbl" style={{ margin: "10px 0" }}>Нагадування йдуть усім учасникам хвилі, а не тим, хто ще не пройшов: так нічого не розкривається. Раніше за дату хвиля закриється, лише якщо участь не менша за поріг k.</div>
    <button type="button" className="btn btn-primary" onClick={save} disabled={busy || miss}>Зберегти</button></section>;
}

function Detail({ id }) {
  const key = "ap:" + id, r = apiMod(key, () => apiAutopilot(id)), admin = S.role === "admin";
  if (!r) return <Loading t="Автопілот" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset(key)} />;
  const a = r.data, st = CST[a.status] || CST.draft;
  const tick = async () => { try { const t = await apiAutopilotTick(); toast(t.events.length ? `Крок виконано, подій: ${t.events.length}` : "Крок виконано: нічого робити не треба"); apiModReset(key); } catch (e) { apiFail(e); } };
  const report = async () => { try { await apiAutopilotReport(id); } catch (e) { apiFail(e); } };
  return <>
    <section className="card c8 rise"><div className="card-h"><h2 className="txt">{dn(a.campaign_title)}</h2><Pill cls={st[1]}>{st[0]}</Pill><Pill cls={a.enabled ? "p-good" : "p-mute"}>{a.enabled ? "Автопілот увімкнено" : "Автопілот вимкнено"}</Pill></div>
      <div className="lbl" style={{ marginBottom: 6 }}>Що автопілот зробить далі</div>
      <div className="rows">{a.plan.map((t, i) => <div key={i} className="row"><span className="dot" style={{ background: "var(--teal)" }} /><div className="grow txt">{dsh(t)}</div></div>)}</div></section>
    <section className="card c4 rise"><div className="card-h"><h2>Дії</h2></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {admin && <button type="button" className="btn btn-soft" onClick={tick}><Ic n="bolt" />Виконати крок зараз</button>}
        {a.report_ready && S.role !== "coordinator" ? <button type="button" className="btn btn-soft" onClick={report}><Ic n="download" />Звіт за Додатком Г (Word)</button> : <div className="lbl">{a.report_ready ? "Звіт підготовлено." : "Звіт зʼявиться після закриття хвилі."}</div>}
        {!admin && <div className="lbl">Змінювати налаштування може лише уповноважений.</div>}
        <div className="lbl">Автопілот не приймає й не відхиляє рекомендації й не створює заходів: це рішення відповідальної особи.</div></div></section>
    {admin && a.status !== "closed" && <Form key={a.enabled + String(a.planned_close_on)} a={a} onSaved={v => { API.mod[key] = { data: v }; render(true); }} />}
    <section className="card c12 rise"><div className="card-h"><h2>Журнал автопілота</h2></div>
      {a.events.length ? <div className="tbl-wrap"><table><thead><tr><th>Коли</th><th>Крок</th><th>Результат</th><th>Повідомлення</th></tr></thead><tbody>
        {a.events.map((e, i) => { const s = EV[e.status] || EV.ok; return <tr key={i}><td className="tnum">{when(e.at)}</td><td>{STEP[e.step] || e.step}</td><td><Pill cls={s[1]}>{s[0]}</Pill></td><td className="txt">{dsh(e.message)}</td></tr>; })}</tbody></table></div> : <div className="lbl">Подій ще не було.</div>}</section>
  </>;
}

export function Autopilot() {
  const [sel, setSel] = useState(null);
  if (!API.on) return <NeedServer t="Автопілот хвилі">Він відкриває хвилю за планом, нагадує учасникам, закриває за датою чи порогом участі й готує звіт за Додатком Г.</NeedServer>;
  const c = apiMod("apc", apiAutopilotCampaigns);
  if (!c) return <Loading t="Автопілот" />;
  if (c.error) return <Failed e={c.error} onRetry={() => apiModReset("apc")} />;
  const list = c.data;
  if (!list.length) return <Empty t="Хвиль ще немає">Автопілот налаштовується для створеної хвилі.</Empty>;
  const id = sel || (list.find(x => x.status !== "closed") || list[0]).id;
  return <>
    <section className="c12 rise toolbar"><label className="lbl" htmlFor="ap-sel">Хвиля</label><select className="inp" id="ap-sel" value={id} onChange={e => setSel(e.target.value)}>{list.map(x => <option key={x.id} value={x.id}>{dn(x.title)}, {(CST[x.status] || [x.status])[0].toLowerCase()}</option>)}</select></section>
    <Detail key={id} id={id} />
  </>;
}
