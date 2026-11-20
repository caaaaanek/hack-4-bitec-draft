/* Захист від колективного покарання.
 * 1) Керівник бачить лише розподіл рівнів дочірніх підрозділів без назв (GET /units/{id}/children-levels).
 * 2) Аудит і адміністратор бачать, хто відкривав результати дочірніх підрозділів (GET /admin/result-views). */
import { DatePicker } from "../components/DatePicker.jsx";
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, api, apiMod, apiModReset } from "../lib/api.js";
import { LSHORT } from "../lib/model.js";
import { plural } from "../lib/format.js";
import { Loading, Failed, Empty, NoAccess } from "../components/states.jsx";

/* --- Розподіл рівнів дочірніх підрозділів --- */
const DEMO_CHILDREN = { children_total: 3, with_data: 2, insufficient: 1, levels: { 1: 0, 2: 0, 3: 2, 4: 0, 5: 0 }, hidden: true };
const useChildren = () => API.on ? (API.unitId ? apiMod("children:" + (API.campaignId || ""), () => api(`/units/${API.unitId}/children-levels${API.campaignId ? `?campaign_id=${API.campaignId}` : ""}`)) : { status: 409 }) : { data: DEMO_CHILDREN };

export function ChildrenLevels() {
  const r = useChildren();
  if (r && (r.status === 403 || r.status === 404 || r.status === 409)) return null;
  const d = r && r.data;
  const body = !r ? <div className="lbl" role="status">Завантажуємо…</div>
    : r.error ? <div role="alert"><div className="lbl">Не вдалося завантажити: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 8 }} onClick={() => apiModReset("children:" + (API.campaignId || ""))}>Спробувати ще раз</button></div>
    : !d.children_total ? <div className="lbl">Дочірніх підрозділів немає.</div>
    : d.hidden ? <div className="lock"><Ic n="lock" /><div><b>Розподіл приховано</b><div className="lbl">Дані цієї хвилі є лише в {d.with_data} {plural(d.with_data, "підрозділі", "підрозділах", "підрозділах")} з {d.children_total}. Поки підрозділів з даними менше трьох, за розподілом можна впізнати конкретний підрозділ.</div></div></div>
    : <ChildBars d={d} />;
  return <section className="card c12 rise ch-card" aria-labelledby="chTitle">
    <div className="card-h"><h2 id="chTitle">Підрозділи за рівнями зрілості</h2></div>
    {body}
    <div className="lbl" style={{ marginTop: 10, fontSize: 12.5 }}>Лише кількість підрозділів на кожному рівні, без назв. Деталі підрозділу бачить тільки сам підрозділ, а перегляди чужих підрозділів записуються в журнал для аудиту.</div>
  </section>;
}
function ChildBars({ d }) {
  const lv = [1, 2, 3, 4, 5].map(l => +(d.levels[l] ?? d.levels[String(l)] ?? 0)), max = Math.max(1, ...lv);
  const alt = lv.map((n, i) => `рівень ${i + 1}: ${n}`).join(", ");
  return <>
    <div className="ch-bars" role="img" aria-label={`Підрозділів за рівнями: ${alt}`}>{lv.map((n, i) => <div key={i} className="ch-b"><span className="tnum">{n}</span><i className={`lv-b${i + 1}`} style={{ height: `${Math.max(4, n / max * 120)}px` }} /><small>{i + 1}</small></div>)}</div>
    <div className="lbl" style={{ marginTop: 6 }}>Усього {d.children_total}, з даними {d.with_data}{d.insufficient ? `, замало відповідей у ${d.insufficient}` : ""}. Найчастіше: рівень {lv.indexOf(Math.max(...lv)) + 1} «{LSHORT[lv.indexOf(Math.max(...lv))]}».</div>
  </>;
}

/* --- Хто дивився дочірні підрозділи --- */
const ROLE_T = { admin: "Уповноважений", leader: "Керівник", auditor: "Внутрішній аудит", department: "Департамент", coordinator: "Технічний адміністратор" };
const WHAT = { results: "Результати хвилі", history: "Історія підрозділу", dashboard: "Огляд", compare: "Порівняння хвиль", report: "Звіт", recommendations: "Рекомендації", candor: "Картка відвертості", briefing: "Брифінг", indicators: "Факти", "risk-signals": "Сигнали ризиків" };
const DEMO_VIEWS = { by_actor: [{ actor_id: "a1", login: "auditor", role: "auditor", views: 1, units: ["Підрозділ А"] }], items: [{ at: "2026-11-16T09:12:00Z", actor_id: "a1", login: "auditor", unit_name: "Підрозділ А", endpoint: "results" }] };
const when = t => new Date(t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ResultViews() {
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [who, setWho] = useState("");
  const qs = new URLSearchParams(Object.entries({ date_from: from, date_to: to && `${to}T23:59:59`, actor_id: who }).filter(([, v]) => v)).toString(), key = "rv:" + qs;
  const r = API.on ? apiMod(key, () => api(`/admin/result-views${qs ? "?" + qs : ""}`)) : { data: DEMO_VIEWS };
  const reset = () => apiModReset(key);
  const filters = <section className="c12 rise toolbar">
    <label className="lbl dp-inline" htmlFor="ov-from">З <DatePicker id="ov-from" value={from} onChange={setFrom} /></label>
    <label className="lbl dp-inline" htmlFor="ov-to">По <DatePicker id="ov-to" value={to} onChange={setTo} /></label>
    {r && r.data && r.data.by_actor.length > 0 && <label className="lbl">Хто <select className="inp" value={who} onChange={e => setWho(e.target.value)}><option value="">Усі</option>{r.data.by_actor.map(a => <option key={a.actor_id} value={a.actor_id}>{a.login}</option>)}</select></label>}
    <div className="sp" />{(from || to || who) && <button type="button" className="btn btn-ghost" onClick={() => { setFrom(""); setTo(""); setWho(""); }}>Скинути фільтри</button>}
  </section>;
  const intro = null;
  if (!r) return <>{intro}{filters}<Loading t="Перегляди підрозділів" /></>;
  if (r.status === 403) return <>{intro}<NoAccess /></>;
  if (r.error) return <>{intro}{filters}<Failed e={r.error} onRetry={reset} /></>;
  const d = r.data;
  if (!d.items.length) return <>{intro}{filters}<Empty t="Переглядів не знайдено">{from || to || who ? "За цими фільтрами записів немає." : "Ніхто ще не відкривав результати дочірніх підрозділів."}</Empty></>;
  return <>{intro}{filters}
    <section className="card c12 rise"><div className="card-h"><h2>Хто скільки дивився</h2></div>
      <div className="rows">{d.by_actor.map(a => <div key={a.actor_id} className="row" style={{ alignItems: "flex-start" }}><div className="grow"><div className="t">{a.login || "невідомий"} <span className="lbl">· {ROLE_T[a.role] || a.role || ""}</span></div><div className="lbl rv-units">{a.units.join(", ")}</div></div><b className="tnum">{a.views}</b></div>)}</div></section>
    <section className="card c12 rise"><div className="card-h"><h2>Усі перегляди</h2><div className="sp" /><span className="lbl">Показано {d.items.length}</span></div>
      <div className="tbl-wrap"><table><thead><tr><th>Коли</th><th>Хто</th><th>Підрозділ</th><th>Що відкрито</th></tr></thead><tbody>{d.items.map((x, i) => <tr key={i}><td className="tnum">{when(x.at)}</td><td>{x.login || "невідомий"}</td><td>{x.unit_name || "підрозділ"}</td><td>{WHAT[x.endpoint] || "Інші дані"}</td></tr>)}</tbody></table></div></section>
  </>;
}
