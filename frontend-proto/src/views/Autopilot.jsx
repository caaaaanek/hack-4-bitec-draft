/* Автопілот хвилі: план, нагадування, автозакриття, автозвіт, ручний крок.
 * Уповноважений бачить його розділом вибраної хвилі в «Керуванні циклом» (#autopilot переадресовує туди).
 * Координатор і аудитор, у яких «Керування циклом» немає, дивляться його окремим екраном лише для читання. */
import { useEffect, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiAutopilotCampaigns, apiAutopilot, apiAutopilotSet, apiAutopilotTick, apiAutopilotReport, apiFail, dn } from "../lib/api.js";
import { S } from "../lib/state.js";
import { render, toast, ui } from "../lib/store.js";
import { dsh, ua } from "../lib/format.js";
import { Pill } from "../components/ui.jsx";
import { DatePicker } from "../components/DatePicker.jsx";
import { Loading, Failed, Empty, NeedServer } from "../components/states.jsx";
import { KpiRow, ModHead, More } from "../components/modkit.jsx";

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
  return <div className="ap-form">
    <label className="a11y-row"><span>Автопілот увімкнено</span><span className="sw"><input type="checkbox" checked={f.enabled} onChange={e => set("enabled", e.target.checked)} /><span /></span></label>
    <div className="mod-grid" style={{ marginTop: 12 }}>
      {draft && <div className="field"><label htmlFor="ap-open">Відкрити</label><DatePicker id="ap-open" value={f.open} onChange={v => set("open", v)} /></div>}
      <div className="field"><label htmlFor="ap-close">Закрити не пізніше</label><DatePicker id="ap-close" value={f.close} min={f.open || undefined} onChange={v => set("close", v)} /></div>
      <div className="field"><label htmlFor="ap-pct">Закрити раніше при участі, %</label><input className="inp" id="ap-pct" type="number" min="1" max="100" value={f.pct} onChange={e => set("pct", e.target.value)} /></div>
      <div className="field"><label htmlFor="ap-rem">Нагадувати кожні, днів</label><input className="inp" id="ap-rem" type="number" min="1" max="60" value={f.rem} onChange={e => set("rem", e.target.value)} /></div>
    </div>
    {miss && <div className="lbl" role="alert" style={{ color: "var(--red)", marginTop: 8 }}>Для автопілота потрібна дата закриття або поріг участі.</div>}
    <div className="chk-row" style={{ marginTop: 12, flexWrap: "wrap" }}><button type="button" className="btn btn-primary" onClick={save} disabled={busy || miss}>Зберегти</button>
      <More><div className="lbl">Нагадування йдуть усім учасникам хвилі, а не тим, хто ще не пройшов: так нічого не розкривається. Раніше за дату хвиля закриється, лише якщо в кожній анкеті участь не менша за поріг і за k.</div></More></div>
  </div>;
}

// Розділ автопілота для однієї хвилі: у «Керуванні циклом» (уповноважений) і на окремому екрані (перегляд)
export function AutopilotSection({ id, kpi }) {
  const key = "ap:" + id, r = apiMod(key, () => apiAutopilot(id)), admin = S.role === "admin", ref = useRef(null);
  useEffect(() => { if (r && ui.scrollTo === "ap" && ref.current) { ui.scrollTo = null; setTimeout(() => ref.current && ref.current.scrollIntoView({ behavior: "smooth", block: "start" }), 200); } });
  if (!r) return <Loading t="Автопілот хвилі" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset(key)} />;
  const a = r.data, st = CST[a.status] || CST.draft;
  const tick = async () => { try { const t = await apiAutopilotTick(); toast(t.events.length ? `Крок виконано, подій: ${t.events.length}` : "Крок виконано: нічого робити не треба"); apiModReset(key); } catch (e) { apiFail(e); } };
  const report = async () => { try { await apiAutopilotReport(id); } catch (e) { apiFail(e); } };
  return <>
    {kpi && <KpiRow items={[{ ic: "bolt", t: "Стан", v: a.enabled ? "Увімкнено" : "Вимкнено", tone: a.enabled ? "teal" : "mute", sub: st[0] },
      { ic: "cal", t: "Закриття", v: a.planned_close_on ? ua(a.planned_close_on) : a.close_at_percent ? `${a.close_at_percent}%` : "не задано", sub: a.planned_close_on && a.close_at_percent ? `або участь ${a.close_at_percent}%` : null },
      { ic: "bell", t: "Нагадування", v: a.remind_every_days ? `кожні ${a.remind_every_days} дн.` : "немає", sub: a.last_reminder_on ? `останнє ${ua(a.last_reminder_on)}` : null }]} />}
    <section className="card c12 rise" id="ap-sec" ref={ref}>
      <ModHead ic="bolt" tone={a.enabled ? "teal" : "mute"} title={`Автопілот: ${dn(a.campaign_title)}`}><Pill cls={st[1]}>{st[0]}</Pill><Pill cls={a.enabled ? "p-good" : "p-mute"}>{a.enabled ? "Увімкнено" : "Вимкнено"}</Pill></ModHead>
      <div className="ap-grid">
        <div><div className="lbl" style={{ marginBottom: 6 }}>Що зробить далі</div>
          <div className="rows">{a.plan.map((t, i) => <div key={i} className="row"><span className="dot" style={{ background: "var(--teal)" }} /><div className="grow txt">{dsh(t)}</div></div>)}</div></div>
        <div className="ap-acts">
          {admin && <button type="button" className="btn btn-soft" onClick={tick}><Ic n="bolt" />Виконати крок зараз</button>}
          {a.report_ready && S.role !== "coordinator" ? <button type="button" className="btn btn-soft" onClick={report}><Ic n="download" />Звіт за Додатком Г (Word)</button> : <div className="lbl">{a.report_ready ? "Звіт підготовлено." : a.status === "closed" ? "Автопілот готує звіт лише для хвиль, які закрив сам. Звіт за Додатком Г є на екрані «Звіт»." : "Звіт зʼявиться після закриття хвилі."}</div>}
          <div className="lbl">{admin ? "Рекомендації автопілот не приймає й заходів не створює: це рішення відповідальної особи." : "Змінювати налаштування може лише уповноважений."}</div></div>
      </div>
      {admin && a.status !== "closed" && <Form key={a.enabled + String(a.planned_close_on)} a={a} onSaved={v => { API.mod[key] = { data: v }; render(true); }} />}
      <details className="more" style={{ marginTop: 12 }}><summary><span>Журнал кроків ({a.events.length})</span><Ic n="chev" /></summary><div className="more-b">
        {a.events.length ? <div className="tbl-wrap"><table><thead><tr><th>Коли</th><th>Крок</th><th>Результат</th><th>Повідомлення</th></tr></thead><tbody>
          {a.events.map((e, i) => { const s = EV[e.status] || EV.ok; return <tr key={i}><td className="tnum">{when(e.at)}</td><td>{STEP[e.step] || e.step}</td><td><Pill cls={s[1]}>{s[0]}</Pill></td><td className="txt">{dsh(e.message)}</td></tr>; })}</tbody></table></div> : <div className="lbl">Подій ще не було.</div>}
      </div></details>
    </section>
  </>;
}

// Окремий екран для координатора й аудитора
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
    <AutopilotSection key={id} id={id} kpi />
  </>;
}
