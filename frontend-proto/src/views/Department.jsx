/* Департамент з бекендом: заклади по одному, лише перегляд, без індексу й рейтингу (GET /department/institutions). */
import { Ic } from "../lib/icons.jsx";
import { API, api, apiEnsure, apiRetry, apiSelectInst, dn } from "../lib/api.js";
import { ua } from "../lib/format.js";
import { Loading, Failed, Empty } from "../components/states.jsx";

export function DeptInstitutions() {
  if (!apiEnsure("dept", () => api("/department/institutions"))) return <Loading t="Заклади" />;
  const d = API.dept;
  if (d.error) return <Failed e={d.error} onRetry={apiRetry} />;
  if (!d.length) return <Empty t="Закладів немає">Заклади з'являться, коли в системі буде хоча б один кореневий підрозділ.</Empty>;
  const list = [...d].sort((a, b) => dn(a.name).localeCompare(dn(b.name), "uk"));
  return <>
    {list.map(x => <section key={x.unit_id} className={`card c6 rise inst ${API.deptUnit === x.unit_id ? "on" : ""}`}>
      <div className="comp-top"><span className="comp-ic" style={{ background: "var(--lime-soft)", color: "var(--teal-deep)" }}><Ic n="building" /></span><b>{dn(x.name)}</b></div>
      <dl className="inst-kv" style={{ marginTop: 14 }}><dt>Закритих хвиль</dt><dd className="tnum">{x.closed_waves}</dd><dt>Відкритих хвиль</dt><dd className="tnum">{x.open_waves}</dd><dt>Остання закрита</dt><dd className="tnum">{x.last_closed_on ? ua(x.last_closed_on) : "ще немає"}</dd></dl>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>{x.closed_waves ? <button type="button" className="btn btn-soft" onClick={() => apiSelectInst(x.unit_id)}>Відкрити огляд <Ic n="arrowR" /></button> : <span className="lbl">Результатів ще немає</span>}</div>
    </section>)}
    <section className="card c12 rise"><div className="lock"><Ic n="shield" /><div><b>Кожен заклад окремо</b><div className="lbl">Департамент бачить заклади по одному і лише переглядає результати: без рішень і без рейтингу. На картках немає індексу, список упорядковано за назвою, а кожен заклад порівнюється лише сам із собою на своєму огляді.</div></div></div></section>
  </>;
}
// Екрани результатів, поки заклад не обрано
export const ChooseInst = () => <Empty t="Оберіть заклад">Департамент дивиться результати кожного закладу окремо.<br /><br /><a className="btn btn-soft" href="#institutions"><Ic n="building" />До списку закладів</a></Empty>;
