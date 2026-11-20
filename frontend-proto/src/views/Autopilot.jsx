/* Автопілот хвилі: план, нагадування, автозакриття, автозвіт, ручний крок.
 * Уповноважений бачить його розділом вибраної хвилі в «Керуванні циклом» (#autopilot переадресовує туди).
 * Аудит, у якого «Керування циклом» немає, дивиться його окремим екраном лише для читання. */
import { useEffect, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiAutopilotCampaigns, apiAutopilot, apiAutopilotSet, apiAutopilotTick, apiAutopilotReport, apiFail, apiAdmReload, dn , fourEyesOn } from "../lib/api.js";
import { S } from "../lib/state.js";
import { render, toast, ui } from "../lib/store.js";
import { dsh, ua, plural } from "../lib/format.js";
import { Pill } from "../components/ui.jsx";
import { DatePicker } from "../components/DatePicker.jsx";
import { Loading, Failed, Empty, NeedServer } from "../components/states.jsx";
import { ModHead } from "../components/modkit.jsx";
import { TODAY } from "../lib/model.js";
const everyDays = n => +n === 1 ? "щодня" : `кожні ${n} ${plural(+n, "день", "дні", "днів")}`;

const CST = { draft: ["Чернетка", "p-mute"], open: ["Триває", "p-good"], closed: ["Завершено", "p-info"] };
const STEP = { open: "Відкриття", close: "Закриття", reminder: "Нагадування", report: "Звіт", recommendations: "Рекомендації", theme2: "Черга заходів", daily: "Щоденний крок", tick: "Крок" };
const EV = { ok: ["Виконано", "p-good"], error: ["Помилка", "p-bad"], skipped: ["Пропущено", "p-mute"], waiting: ["Чекає підтвердження", "p-mute"] };
const when = iso => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const nextDay = iso => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
function Form({ a, onSaved }) {
  const [f, setF] = useState({ enabled: a.enabled, open: a.planned_open_on || "", close: a.planned_close_on || "", pct: a.close_at_percent ?? "", rem: a.remind_every_days ?? "" }), [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v })), draft = a.status === "draft";
  // Минулі дати не обрати: відкриття від сьогодні, закриття пізніше за відкриття
  const closeMin = draft && f.open ? [nextDay(f.open), TODAY].sort()[1] : TODAY;
  const bad = !f.enabled ? "" : !f.close && !f.pct ? "Потрібна дата закриття або поріг участі."
    : draft && f.open && f.open < TODAY ? "Дата відкриття вже минула." : f.close && f.close < closeMin ? "Дата закриття має бути пізніше за відкриття."
    : f.pct !== "" && (+f.pct < 1 || +f.pct > 100) ? "Поріг участі від 1 до 100 %." : f.rem !== "" && (+f.rem < 1 || +f.rem > 60) ? "Нагадування від 1 до 60 днів." : "";
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiAutopilotSet(a.campaign_id, { enabled: f.enabled, planned_open_on: draft ? f.open || null : undefined, planned_close_on: f.close || null, close_at_percent: f.pct === "" ? null : +f.pct, remind_every_days: f.rem === "" ? null : +f.rem });
      toast("Налаштування автопілота збережено"); onSaved(r);
    } catch (e) { apiFail(e); } finally { setBusy(false); }
  };
  return <div className="ap-form">
    <label className="ap-sw"><span className="sw"><input type="checkbox" checked={f.enabled} onChange={e => set("enabled", e.target.checked)} /><span /></span><b>Автопілот</b></label>
    <div className="ap-fields">
      {draft && <div className="field"><label htmlFor="ap-open">Відкрити</label><DatePicker id="ap-open" value={f.open} min={TODAY} onChange={v => { set("open", v); if (f.close && f.close <= v) set("close", ""); }} /></div>}
      <div className="field"><label htmlFor="ap-close">Закрити не пізніше</label><DatePicker id="ap-close" value={f.close} min={closeMin} onChange={v => set("close", v)} /></div>
      <div className="field ap-num"><label htmlFor="ap-pct">Або при участі, %</label><input className="inp tnum" id="ap-pct" type="number" min="1" max="100" value={f.pct} onChange={e => set("pct", e.target.value)} /></div>
      <div className="field ap-num"><label htmlFor="ap-rem">Нагадувати, днів</label><input className="inp tnum" id="ap-rem" type="number" min="1" max="60" value={f.rem} onChange={e => set("rem", e.target.value)} /></div>
      <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !!bad}>Зберегти</button>
    </div>
    {bad && <div className="lbl" role="alert" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))", marginTop: 8 }}>{bad}</div>}
  </div>;
}

// Розділ автопілота для однієї хвилі: у «Керуванні циклом» (уповноважений) і на окремому екрані (перегляд)
export function AutopilotSection({ id }) {
  const key = "ap:" + id, r = apiMod(key, () => apiAutopilot(id)), admin = S.role === "admin", ref = useRef(null);
  useEffect(() => { if (r && ui.scrollTo === "ap" && ref.current) { ui.scrollTo = null; setTimeout(() => ref.current && ref.current.scrollIntoView({ behavior: "smooth", block: "start" }), 200); } });
  if (!r) return <Loading t="Автопілот хвилі" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset(key)} />;
  const a = r.data, st = CST[a.status] || CST.draft;
  const tick = async () => { try { const t = await apiAutopilotTick(); toast(t.events.length ? `Крок виконано, подій: ${t.events.length}` : "Крок виконано: нічого робити не треба"); apiModReset(key); apiModReset("apc"); if (t.events.length && API.adm) apiAdmReload(id); } catch (e) { apiFail(e); } };
  const report = async () => { try { await apiAutopilotReport(id); } catch (e) { apiFail(e); } };
  // Точний час наступного кроку з сервера: interval_seconds 0 — лише вручну, next_tick_at null — фоновий крок не запущено
  const at = t => new Date(t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) + (new Date(t).toDateString() === new Date().toDateString() ? "" : ", " + new Date(t).toLocaleDateString("uk-UA"));
  const manual = a.interval_seconds === 0 || (a.interval_seconds != null && !a.next_tick_at);
  const nextT = a.next_tick_at ? `Наступний крок о ${at(a.next_tick_at)}` : manual ? "Автопілот кроків не робить: запускайте вручну" : null;
  const closeT = a.planned_close_on ? ua(a.planned_close_on) + (a.close_at_percent ? ` або участь ${a.close_at_percent} %` : "") : a.close_at_percent ? `участь ${a.close_at_percent} %` : "не задано";
  return <section className="card c12 rise" id="ap-sec" ref={ref}>
    <ModHead ic="bolt" tone={a.enabled ? "teal" : "mute"} title={`Автопілот: ${dn(a.campaign_title)}`}>{a.waiting_approval_id ? <Pill cls="p-warn">Чекає на підтвердження відкриття аудитом</Pill> : <Pill cls={st[1]}>{st[0]}</Pill>}{a.status !== "closed" && <Pill cls={a.enabled ? "p-good" : "p-mute"}>{a.enabled ? "Увімкнено" : "Вимкнено"}</Pill>}</ModHead>
    {a.status !== "closed" && <div className="ap-sum">
      {a.status === "draft" && <span><span className="lbl">Відкриття</span> {a.planned_open_on ? ua(a.planned_open_on) : "не задано"}</span>}
      {a.status === "closed" ? (a.closed_on && <span><span className="lbl">Закрито</span> {ua(a.closed_on)}</span>) : <span><span className="lbl">Закриття</span> {closeT}</span>}
      {a.enabled && a.status !== "closed" && nextT && <span><span className="lbl">Крок</span> {nextT}</span>}
      {a.status !== "closed" && <span><span className="lbl">Нагадування</span> {a.remind_every_days ? everyDays(a.remind_every_days) : "немає"}{a.last_reminder_on ? `, останнє ${ua(a.last_reminder_on)}` : ""}</span>}
    </div>}
    {a.status === "draft" && a.enabled && a.planned_open_on && <div className="note-box" style={{ marginTop: 12 }}>{a.waiting_approval_id
      ? <><b>Чекає на підтвердження</b><span className="lbl">Автопілот попросив відкрити хвилю. Вона відкриється, щойно внутрішній аудит підтвердить запит у «Запитах другій людині».</span></>
      : a.planned_open_on <= TODAY
      ? <><b>Чому досі чернетка</b><span className="lbl">Дата відкриття настала, але хвилю відкриває не календар, а крок автопілота. {a.next_tick_at ? `Наступний крок о ${at(a.next_tick_at)}.` : manual ? "Автоматичних кроків на сервері немає." : ""}{admin ? " Щоб не чекати, натисніть «Виконати крок зараз»." : ""}</span></>
      : <><b>Коли відкриється</b><span className="lbl">До {ua(a.planned_open_on)} хвиля лишається чернеткою. Цього дня її відкриє {manual ? "крок, запущений вручну" : "перший крок автопілота після 00:00"}{fourEyesOn() ? ", а потім відкриття має підтвердити внутрішній аудит" : ""}.</span></>}</div>}
    <div className="rows">{a.plan.map((t, i) => <div key={i} className="row"><span className="dot" style={{ background: a.enabled && a.status !== "closed" ? "var(--teal)" : "var(--muted)" }} /><div className="grow txt">{dsh(t)}</div></div>)}</div>
    <div className="ap-acts">
      {admin && a.enabled && a.status !== "closed" && <button type="button" className="btn btn-soft" onClick={tick}><Ic n="bolt" />Виконати крок зараз</button>}
      {a.report_ready && <button type="button" className="btn btn-soft" onClick={report}><Ic n="download" />Звіт за Додатком Г (Word)</button>}
      {!admin && <span className="lbl">Змінювати налаштування може лише уповноважений.</span>}
    </div>
    {admin && a.status !== "closed" && <Form key={a.enabled + String(a.planned_close_on) + String(a.planned_open_on)} a={a} onSaved={v => { API.mod[key] = { data: v }; render(true); }} />}
    <details className="more" style={{ marginTop: 12 }}><summary><span>Журнал кроків ({a.events.length})</span><Ic n="chev" /></summary><div className="more-b">
      {a.events.length ? <div className="tbl-wrap"><table><thead><tr><th>Коли</th><th>Крок</th><th>Результат</th><th>Повідомлення</th></tr></thead><tbody>
        {a.events.map((e, i) => { const s = EV[e.status] || EV.ok; return <tr key={i}><td className="tnum">{when(e.at)}</td><td>{STEP[e.step] || e.step}</td><td><Pill cls={s[1]}>{s[0]}</Pill></td><td className="txt">{dsh(e.message)}</td></tr>; })}</tbody></table></div> : <div className="lbl">Подій ще не було.</div>}
    </div></details>
  </section>;
}

// Окремий екран для аудиту (уповноважений бачить автопілот у «Керуванні циклом»)
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
    <AutopilotSection key={id} id={id} />
  </>;
}
