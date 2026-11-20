/* Конструктор анкети (Департамент, режим API): розділи, питання, варіанти й бали. Повноекранне вікно #bld. */
import { useEffect, useReducer, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { api, apiFail, apiErrText, apiSurveysReload, QCAT, fieldErrText } from "../lib/api.js";
import { ui, toast } from "../lib/store.js";
import { plural } from "../lib/format.js";

const BLD_COMP = [["culture", "Культура"], ["system", "Система"], ["accountability", "Підзвітність"], ["overall", "Загальна самооцінка"]];
const BLD_TYPE = [["single_choice", "Один варіант"], ["multiple_choice", "Кілька варіантів"], ["scale", "Шкала"]];
const Up = () => <Ic n="chev" style={{ transform: "rotate(180deg)" }} />;
const bldNewQ = n => ({ code: "q" + Date.now().toString(36) + n, text: "", help_text: "", type: "single_choice", required: true, weight: 1, scale_min: null, scale_max: null, options: [{ text: "", score: 1 }, { text: "", score: 0 }] });
export const bldNewSec = () => ({ title: "", component: "culture", questions: [bldNewQ(0)] });
const pl = (n, a, b, c) => `${n} ${plural(n, a, b, c)}`;
const comma = v => String(v ?? "").replace(".", ",");

export function bldFromServer(q) {
  return {
    q: { id: q.id, code: q.code, version: q.version, status: q.status, title: q.title, description: q.description || "", kind: q.kind, target_category: q.target_category },
    sections: q.sections.map(s => ({ title: s.title, component: s.component, questions: s.questions.map(x => ({ code: x.code, text: x.text, help_text: x.help_text || "", type: x.type, required: x.required, weight: x.weight, scale_min: x.scale_min, scale_max: x.scale_max, options: x.options.map(o => ({ text: o.text, score: o.score })) })) })),
    dirty: false, issues: null, busy: false,
  };
}
// Структура для PUT: для шкали варіантів немає, для вибору шкали немає
const payload = B => ({ sections: B.sections.map(s => ({ title: s.title.trim(), component: s.component, questions: s.questions.map(x => ({ code: x.code, text: x.text.trim(), help_text: x.help_text.trim(), type: x.type, required: x.required, weight: Number(x.weight) || 0, scale_min: x.type === "scale" ? Number(x.scale_min) : null, scale_max: x.type === "scale" ? Number(x.scale_max) : null, options: x.type === "scale" ? [] : x.options.map(o => ({ text: o.text.trim(), score: Number(o.score) || 0 })) })) })) });
const issuePath = p => { const m = String(p || "").match(/sections\[(\d+)\](?:\.questions\[(\d+)\])?/); return m ? `Розділ ${+m[1] + 1}${m[2] != null ? `, питання ${+m[2] + 1}` : ""}: ` : ""; };
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

export function Builder() {
  const open = ui.bld;
  return open ? <BuilderBody key={open.n} init={open} /> : null;
}
function BuilderBody({ init }) {
  const [B] = useState(() => init.b || bldFromServer(init.q)), [, redraw] = useReducer(x => x + 1, 0), body = useRef(null);
  const touch = () => { B.dirty = true; B.issues = null; B.bad = null; redraw(); };
  const close = force => {
    if (B.dirty && !force) { B.confirmClose = true; return redraw(); }
    ui.bld = null; apiSurveysReload();
  };
  useEffect(() => {
    document.body.classList.add("bld-open");
    const esc = e => { if (e.key === "Escape" && !e.target.closest(".combo")) close(); };
    document.addEventListener("keydown", esc);
    return () => { document.body.classList.remove("bld-open"); document.removeEventListener("keydown", esc); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async silent => {
    B.busy = true; redraw();
    try {
      await api(`/questionnaires/${B.q.id}`, { method: "PATCH", body: { title: B.q.title.trim() || "Без назви", description: B.q.description, kind: B.q.kind, target_category: B.q.target_category } });
      await api(`/questionnaires/${B.q.id}/structure`, { method: "PUT", body: payload(B) });
      B.dirty = false; B.busy = false; redraw(); if (!silent) toast("Чернетку збережено"); return true;
    } catch (err) { B.busy = false; B.bad = new Set((err.errors || []).map(i => String(i.path || ""))); redraw(); toast(fieldErrText(err.errors) || apiErrText(err)); return false; }
  };
  const validate = async () => {
    try { B.issues = await api(`/questionnaires/${B.q.id}/validate`); redraw(); if (body.current) body.current.scrollTop = 0; return B.issues; } catch (err) { apiFail(err); return null; }
  };
  const publish = async () => {
    if (B.busy) return;
    if (B.dirty && !(await save(true))) return;
    B.busy = true; redraw();
    try {
      const issues = await validate(); if (!issues || issues.length) { if (issues && issues.length) toast("Не можна опублікувати: виправте позначені місця"); return; }
      await api(`/questionnaires/${B.q.id}/publish`, { method: "POST" }); toast("Анкету опубліковано"); close(true);
    } catch (err) {
      // Причини сервера показуємо в тому самому списку зауважень, що й перевірка, а не загальним «Не вдалося»
      if (err.errors && err.errors.length) { B.issues = err.errors; toast("Не можна опублікувати: виправте позначені місця"); } else toast(apiErrText(err));
    } finally { B.busy = false; redraw(); }
  };
  // Зміна поля: введення тексту не скидає перевірку повністю, лише позначає незбережені зміни
  const set = (obj, k, v) => { obj[k] = v; if (!B.dirty) { B.dirty = true; B.issues = null; } if (B.bad) B.bad = null; redraw(); };
  const setType = (q, v) => { q.type = v; if (v === "scale") { q.scale_min = q.scale_min ?? 1; q.scale_max = q.scale_max ?? 5; } else if (q.options.length < 2) q.options = [{ text: "", score: 1 }, { text: "", score: 0 }]; touch(); };
  const m = B.q, nq = B.sections.reduce((a, s) => a + s.questions.length, 0);
  const bad = p => !!(B.bad && B.bad.has(p)); // поля з помилкою перевірки сервера

  const Q = (x, s, qi, last) => <div key={x.code} className="bld-q"><div className="bld-q-h"><span className="bld-qn">{qi + 1}</span>
      <div className="bld-move"><button type="button" className="icon-btn sm" disabled={qi === 0} aria-label="Питання вище" onClick={() => { move(s.questions, qi, -1); touch(); }}><Up /></button><button type="button" className="icon-btn sm" disabled={last} aria-label="Питання нижче" onClick={() => { move(s.questions, qi, 1); touch(); }}><Ic n="chev" /></button><button type="button" className="icon-btn sm" aria-label="Видалити питання" data-tip="Видалити питання" onClick={() => { s.questions.splice(qi, 1); touch(); }}><Ic n="x" /></button></div></div>
    <div className="field"><label>Текст питання</label><textarea className="inp" rows="2" placeholder="Сформулюйте питання" aria-invalid={bad(`sections.${B.sections.indexOf(s)}.questions.${qi}.text`) || undefined} value={x.text} onChange={e => set(x, "text", e.target.value)} /></div>
    <div className="bld-row">
      <div className="field"><label>Тип відповіді</label><select className="inp" value={x.type} onChange={e => setType(x, e.target.value)}>{BLD_TYPE.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
      <div className="field bld-w"><label>Вага</label><input className="inp tnum" inputMode="decimal" value={comma(x.weight)} onChange={e => set(x, "weight", e.target.value.replace(",", "."))} /></div>
      <label className="chk-row bld-req"><input type="checkbox" checked={x.required} onChange={e => set(x, "required", e.target.checked)} /><span>Обов'язкове</span></label>
    </div>
    {x.type === "scale"
      ? <div className="bld-row"><div className="field bld-w"><label>Від</label><input className="inp tnum" type="number" value={x.scale_min ?? ""} onChange={e => set(x, "scale_min", e.target.value === "" ? null : +e.target.value)} /></div><div className="field bld-w"><label>До</label><input className="inp tnum" type="number" value={x.scale_max ?? ""} onChange={e => set(x, "scale_max", e.target.value === "" ? null : +e.target.value)} /></div><span className="lbl bld-hint">Респондент обирає число в цих межах.</span></div>
      : <div className="bld-opts"><div className="lbl">Варіанти відповіді і бали</div>
        {x.options.map((o, oi) => <div key={oi} className="bld-opt"><input className="inp" placeholder="Текст варіанта відповіді" aria-label="Текст варіанта" value={o.text} onChange={e => set(o, "text", e.target.value)} /><label className="bld-score" data-tip="Бал варіанта, число. Наприклад 1, 0,5 або 0"><span className="lbl">Бал</span><input className="inp tnum" inputMode="decimal" aria-label="Бал" value={comma(o.score)} onChange={e => set(o, "score", e.target.value.replace(",", "."))} /></label><button type="button" className="icon-btn sm" aria-label="Видалити варіант" data-tip="Видалити варіант" onClick={() => { x.options.splice(oi, 1); touch(); }}><Ic n="x" /></button></div>)}
        <button type="button" className="btn btn-ghost bld-add" onClick={() => { x.options.push({ text: "", score: 0 }); touch(); }}><Ic n="plus" />Додати варіант</button></div>}
    <details className="bld-more"><summary>Підказка до питання</summary><textarea className="inp" rows="2" placeholder="Необов'язково: пояснення, що мається на увазі" value={x.help_text} onChange={e => set(x, "help_text", e.target.value)} /></details>
  </div>;

  return <div className="bld" id="bld" role="dialog" aria-modal="true" aria-label="Конструктор анкети">
    <div className="bld-top"><div className="bld-top-in"><button type="button" className="icon-btn" aria-label="Закрити конструктор" onClick={() => close()}><Ic n="x" /></button>
      <div className="bld-title"><b>{m.title || "Нова анкета"}</b><span className="lbl">Версія {m.version} · {pl(B.sections.length, "розділ", "розділи", "розділів")}, {pl(nq, "питання", "питання", "питань")} {B.dirty ? "· є незбережені зміни" : "· збережено"}</span></div>
      <div className="bld-actions"><button type="button" className="btn btn-ghost" disabled={B.busy} onClick={async () => { if (B.dirty && !(await save(true))) return; validate(); }}><Ic n="check" />Перевірити</button><button type="button" className="btn btn-soft" disabled={B.busy || !B.dirty} onClick={() => save()}>Зберегти</button><button type="button" className="btn btn-primary" disabled={B.busy} onClick={publish}><Ic n="ok" />Опублікувати</button></div></div></div>
    <div className="bld-body" ref={body}><div className="bld-wrap">
      {B.confirmClose && <div className="bld-note warn"><b>Є незбережені зміни.</b> Закрити без збереження?<div className="bld-note-act"><button type="button" className="btn btn-ghost" onClick={() => { B.confirmClose = false; redraw(); }}>Лишитись</button><button type="button" className="btn btn-danger" onClick={() => close(true)}>Закрити без збереження</button></div></div>}
      {B.issues && (B.issues.length ? <div className="bld-note warn"><b>Перед публікацією виправте:</b><ul>{B.issues.map((i, k) => <li key={k}>{issuePath(i.path)}{i.message}</li>)}</ul></div> : <div className="bld-note ok"><b>Усе гаразд.</b> Анкету можна публікувати.</div>)}
      <section className="card bld-meta"><div className="bld-row"><div className="field bld-grow"><label>Назва анкети</label><input className="inp" value={m.title} onChange={e => set(m, "title", e.target.value)} /></div></div>
        <div className="field"><label>Опис</label><textarea className="inp" rows="2" placeholder="Необов'язково: для кого й навіщо ця анкета" value={m.description} onChange={e => set(m, "description", e.target.value)} /></div>
        <div className="bld-row"><div className="field"><label>Для кого</label><select className="inp" value={m.target_category} onChange={e => set(m, "target_category", e.target.value)}>{Object.entries(QCAT).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
          <div className="field"><label>Вид</label><select className="inp" value={m.kind} onChange={e => set(m, "kind", e.target.value)}><option value="survey">Анкета зрілості</option><option value="checklist">Чек-лист</option></select></div></div></section>
      {B.sections.map((s, si) => <section key={si} className="bld-sec"><div className="bld-sec-h"><span className="pv-num">{si + 1}</span>
          <div className="field bld-grow"><label>Назва розділу</label><input className="inp" placeholder="Наприклад, Культура" aria-invalid={bad(`sections.${si}.title`) || undefined} value={s.title} onChange={e => set(s, "title", e.target.value)} /></div>
          <div className="field bld-comp"><label>Компонент індексу</label><select className="inp" value={s.component} onChange={e => set(s, "component", e.target.value)}>{BLD_COMP.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
          <div className="bld-move"><button type="button" className="icon-btn sm" disabled={si === 0} aria-label="Розділ вище" onClick={() => { move(B.sections, si, -1); touch(); }}><Up /></button><button type="button" className="icon-btn sm" disabled={si === B.sections.length - 1} aria-label="Розділ нижче" onClick={() => { move(B.sections, si, 1); touch(); }}><Ic n="chev" /></button><button type="button" className="icon-btn sm" aria-label="Видалити розділ" data-tip="Видалити розділ" onClick={() => { B.sections.splice(si, 1); touch(); }}><Ic n="x" /></button></div></div>
        {s.questions.map((x, qi) => Q(x, s, qi, qi === s.questions.length - 1))}
        <button type="button" className="btn btn-soft bld-add" onClick={() => { s.questions.push(bldNewQ(s.questions.length)); touch(); }}><Ic n="plus" />Додати питання</button></section>)}
      <button type="button" className="btn btn-soft bld-add bld-add-s" onClick={() => { B.sections.push(bldNewSec()); touch(); }}><Ic n="plus" />Додати розділ</button>
    </div></div>
  </div>;
}
