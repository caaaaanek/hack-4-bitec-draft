/* Короткі пояснення до індексу з сервера: рівень, що переважає, по групах (Додаток Г)
 * і стійкість ваг джерел (кожна вага ±10 %). Лише з бекендом: у демо таких даних немає. */
import { API, api, apiMod, apiModReset, CATEGORY_SRC } from "../lib/api.js";
import { LSHORT } from "../lib/model.js";
import { fb, dsh } from "../lib/format.js";
import { LvPill } from "../components/ui.jsx";

const GROUP_T = { staff: "Особовий склад", working_group: "Робоча група", expert: "Експерти" };
const SRC_T = { staff: "особового складу", working_group: "робочої групи", expert: "експертів", checklist: "чек-листа" };

export function useSensitivity() {
  if (!API.on || !API.campaignId) return null;
  const q = API.unitId ? `?unit_id=${API.unitId}` : "";
  return apiMod("sens", () => api(`/campaigns/${API.campaignId}/sensitivity${q}`));
}

export function ModalLevels() {
  const ml = API.on && API.res && API.res.index && API.res.index.modal_levels;
  if (!ml || !Object.keys(ml).length) return null;
  return <div className="ix-extra">
    <div className="lbl" style={{ marginBottom: 6 }}>Рівень, що переважає у відповідях груп</div>
    <div className="rows">{Object.entries(ml).map(([g, l]) => <div key={g} className="row"><div className="grow">{GROUP_T[g] || (CATEGORY_SRC[g] && CATEGORY_SRC[g][1]) || g}</div>{l ? <LvPill l={l} /> : <span className="lbl">приховано (замала група)</span>}</div>)}</div>
    <div className="lbl" style={{ fontSize: 12.5, marginTop: 6 }}>Так рахує Додаток Г: варіант відповіді, який обрали найчастіше. Індекс поруч рахується із середнього бала, тому рівні можуть трохи відрізнятися.</div>
  </div>;
}

export function WeightStability() {
  const r = useSensitivity();
  if (!r) return null;
  if (!r.data) {
    if (r.status === 404 || r.status === 409 || r.status === 403) return null;
    return <div className="ix-extra" role="alert"><div className="lbl">Не вдалося перевірити стійкість ваг: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 6 }} onClick={() => apiModReset("sens")}>Спробувати ще раз</button></div>;
  }
  const d = r.data, worst = [...(d.rows || [])].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  return <div className="ix-extra">
    <div className="lbl" style={{ marginBottom: 6 }}>Стійкість ваг джерел</div>
    <div>{d.level_stable ? "Стійко" : "Чутливо"}: якщо змінити вагу будь-якого джерела на ±10 %, індекс зсувається щонайбільше на {fb(d.max_abs_delta)} бала{d.level_stable ? `, рівень лишається ${(d.level && d.level.level) || ""} «${LSHORT[((d.level && d.level.level) || 1) - 1]}»` : ", і рівень може змінитися"}.</div>
    {worst && <div className="lbl" style={{ fontSize: 12.5, marginTop: 4 }}>Найбільше впливає вага {SRC_T[worst.source] || dsh(worst.source)}.</div>}
  </div>;
}

export function IndexExtras() {
  if (!API.on) return null;
  return <><ModalLevels /><WeightStability /></>;
}
