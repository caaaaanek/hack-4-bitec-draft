/* Екран «Звіт»: шаблони (report-templates.jsx), масштаб, ручне редагування, ШІ за виділенням (ReportAi.jsx), експорт.
 * Шаблон рендериться в прихований блок, а в документ копіюється його HTML (або збережені правки).
 * Так React не чіпає вміст contentEditable і правки не конфліктують із перемальовуванням. */
import { PrepBtn } from "./Insights.jsx";
import { LeaderDocs } from "./Leadership.jsx";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, persist, addLog, me } from "../lib/state.js";
import { API, api, apiFail } from "../lib/api.js";
import { COMP, ALPHA, allItems, measures, CYCLE, TODAY } from "../lib/model.js";
import { fb } from "../lib/format.js";
import { render, toast, ui, useStore } from "../lib/store.js";
import { cur } from "../lib/nav.js";
import { download, copyText } from "../lib/util.js";
import { aiOpen } from "../ai/assistant.jsx";
import { BackToInst } from "./results.jsx";
import { RT_TPL, RT_RENDER } from "./report-templates.jsx";
import { ReportAi, rtCanAi } from "./ReportAi.jsx";

const ZMIN = 50, ZMAX = 200;
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* сховище недоступне */ } return null; };
// Стан інструментів звіту живе між перемальовуваннями екрана
export const RT = { tpl: RT_TPL[ls("ii-rt-tpl")] ? ls("ii-rt-tpl") : "appendix_g", zoom: Math.min(ZMAX, Math.max(ZMIN, +ls("ii-rt-zoom") || 100)), edit: false };
const rtKey = () => `ii-rt-edit:${API.on ? API.unitId || "api" : cur().id}:${CYCLE}:${RT.tpl}`;
let resetArm = 0;

export function Report() {
  useStore();
  const m = cur(), docRef = useRef(null), zoomRef = useRef(null), stageRef = useRef(null);
  const key = rtKey(), saved = ls(key);
  const Tpl = RT_RENDER[RT.tpl], genRef = useRef(null), shown = useRef(null), frozen = useRef(null);
  if (!RT.edit) frozen.current = null;
  // Після кожного рендеру: що показати в документі. Під час редагування — знімок на момент входу в режим.
  useLayoutEffect(() => {
    const d = docRef.current, g = genRef.current; if (!d || !g) return;
    if (RT.edit && frozen.current == null) frozen.current = ls(rtKey()) ?? g.innerHTML;
    const want = RT.edit ? frozen.current : ls(rtKey()) ?? g.innerHTML;
    if (shown.current !== want) { d.innerHTML = want; shown.current = want; }
  });

  const save = useCallback(() => { const d = docRef.current; if (d && RT.edit) ls(rtKey(), d.innerHTML); }, []);
  const timer = useRef(0);
  const saveSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(save, 400); };
  // Вихід з екрана або зміна закладу — зберегти й вийти з режиму редагування
  useEffect(() => () => { clearTimeout(timer.current); if (RT.edit) { save(); RT.edit = false; } }, [save]);

  const setZoom = z => {
    RT.zoom = Math.round(Math.min(ZMAX, Math.max(ZMIN, z)));
    if (zoomRef.current) zoomRef.current.style.zoom = RT.zoom / 100;
    ls("ii-rt-zoom", String(RT.zoom)); render(true);
  };
  // Жести: Ctrl/⌘ + коліщатко (і щипок тачпада), щипок двома пальцями, Safari gesture*
  useEffect(() => {
    const st = stageRef.current; if (!st) return;
    const wheel = e => {
      if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
      if (e.deltaMode || Math.abs(e.deltaY) >= 50) setZoom(Math.round(RT.zoom / 10) * 10 + (e.deltaY > 0 ? -10 : 10));
      else setZoom(RT.zoom * Math.exp(-e.deltaY * 0.01));
    };
    let base = 0, start = 100, gz = 100;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const ts = e => { if (e.touches.length === 2) { base = dist(e.touches); start = RT.zoom; } };
    const tm = e => { if (e.touches.length === 2 && base) { e.preventDefault(); setZoom(start * dist(e.touches) / base); } };
    const te = e => { if (e.touches.length < 2) base = 0; };
    const gs = e => { e.preventDefault(); gz = RT.zoom; }, gc = e => { e.preventDefault(); setZoom(gz * e.scale); };
    st.addEventListener("wheel", wheel, { passive: false }); st.addEventListener("touchstart", ts, { passive: true }); st.addEventListener("touchmove", tm, { passive: false }); st.addEventListener("touchend", te);
    st.addEventListener("gesturestart", gs); st.addEventListener("gesturechange", gc);
    return () => { st.removeEventListener("wheel", wheel); st.removeEventListener("touchstart", ts); st.removeEventListener("touchmove", tm); st.removeEventListener("touchend", te); st.removeEventListener("gesturestart", gs); st.removeEventListener("gesturechange", gc); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTpl = k => { save(); RT.tpl = k; ls("ii-rt-tpl", k); frozen.current = null; render(true); };
  const toggleEdit = () => {
    if (RT.edit) { clearTimeout(timer.current); save(); }
    RT.edit = !RT.edit; frozen.current = null; render(true);
    if (RT.edit) setTimeout(() => docRef.current && docRef.current.focus({ preventScroll: true }), 0);
  };
  const resetEdits = () => {
    if (Date.now() - resetArm >= 3000) { resetArm = Date.now(); return toast("Натисніть ще раз, щоб скинути всі правки"); }
    resetArm = 0; clearTimeout(timer.current); ls(key, null); RT.edit = false; frozen.current = null;
    addLog(me(), `Скинуто ручні правки звіту (${RT_TPL[RT.tpl][0]})`); render(true); toast("Правки скинуто");
  };
  // «Прибрати» в нотатці асистента (кнопка всередині HTML документа)
  const onDocClick = e => {
    const b = e.target.closest("[data-rm-note]"); if (!b || RT.edit) return;
    S.notes.splice(+b.dataset.rmNote, 1); persist(); render(true);
  };

  return <>
    <BackToInst />
    <div className="c12 rise toolbar rt-bar">
      <label className="rt-tpl" data-tip={RT_TPL[RT.tpl][1]}><span className="lbl">Шаблон</span>
        <select className="inp" value={RT.tpl} onChange={e => setTpl(e.target.value)} aria-label="Шаблон звіту">{Object.entries(RT_TPL).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}</select></label>
      <LeaderDocs />
      <PrepBtn />
      <div className="sp" />
      <div className="rt-zoomctl" role="group" aria-label="Масштаб">
        <button type="button" className="icon-btn" onClick={() => setZoom(RT.zoom - 10)} aria-label="Зменшити">−</button>
        <input type="range" min={ZMIN} max={ZMAX} step={5} value={RT.zoom} onChange={e => setZoom(+e.target.value)} aria-label="Масштаб, %" />
        <button type="button" className="icon-btn" onClick={() => setZoom(RT.zoom + 10)} aria-label="Збільшити">+</button>
        <button type="button" className="rt-pct" onClick={() => setZoom(100)} data-tip="Скинути до 100%">{RT.zoom}%</button>
      </div>
      <button type="button" className={`btn ${RT.edit ? "btn-primary" : "btn-soft"}`} onClick={toggleEdit} aria-pressed={RT.edit}><Ic n="edit" />{RT.edit ? "Готово" : "Редагувати"}</button>
      {saved != null && <button type="button" className="btn btn-ghost" onClick={resetEdits} data-tip="Повернути текст, згенерований із даних"><Ic n="reset" />Скинути правки</button>}
      {rtCanAi() && RT.tpl === "appendix_g" && <button type="button" className="btn btn-soft" onClick={() => aiOpen("Підготуй чернетку опису результатів для звіту")}><Ic n="spark" />Чернетка опису</button>}
      <button type="button" className="btn btn-primary" onClick={() => { ui.exp = true; render(true); }}><Ic n="download" />Експорт</button>
    </div>
    {RT.edit ? <div className="c12 rt-hint noprint"><Ic n="edit" /><span>Режим редагування: пишіть прямо в документі, правки зберігаються в цьому браузері.{rtCanAi() ? " Виділіть фрагмент, щоб попросити ШІ переписати його або пояснити." : ""}</span></div>
      : saved != null ? <div className="c12 rt-hint noprint"><Ic n="info" /><span>Документ містить ручні правки. Числа в них не оновлюються разом із даними.</span></div> : null}
    <div className="c12 rt-stage" ref={stageRef}>
      <div className="rt-zoom" ref={zoomRef} style={{ zoom: RT.zoom / 100 }}>
        <article ref={docRef} className={`paper doc rise rt-doc${RT.edit ? " rt-editing" : ""}`} contentEditable={RT.edit} spellCheck={RT.edit} suppressContentEditableWarning
          onInput={saveSoon} onClick={onDocClick} />
      </div>
    </div>
    <div ref={genRef} hidden aria-hidden="true"><Tpl m={m} /></div>
    <ReportAi docRef={docRef} edit={RT.edit} onApplied={save} />
  </>;
}

/* Експорт: одна кнопка, формат обирається у вікні */
const OPTS = [["print", "print", "PDF або друк", "Звіт у форматі документа. У вікні друку оберіть «Зберегти як PDF»."], ["html", "file", "Документ HTML", "Відкривається в будь-якому браузері, можна відкрити в Word."], ["csv", "table", "Таблиця CSV", "Усі питання й показники з балами. Для Excel."], ["json", "file", "Дані JSON", "Для інших систем і бекенду."], ["copy", "copy", "Копіювати CSV", "У буфер обміну, щоб вставити в таблицю."]];
export function ExportDialog() {
  const ref = useRef(null), open = ui.exp;
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); else if (!open && d.open) d.close(); }, [open]);
  const close = () => { ui.exp = false; render(true); };
  const srv = API.on && API.campaignId ? [["docx", "file", `Word: ${RT_TPL[RT.tpl][0]}`, "Документ із сервера за шаблоном, без ручних правок."], ["xlsx", "table", "Excel", "Усі таблиці звіту з сервера, незалежно від шаблону."]] : [];
  const run = k => { close(); if (k === "docx" || k === "xlsx") return serverExport(k); if (k === "print") { addLog(me(), "Експорт звіту (PDF / друк)"); return setTimeout(() => window.print(), 50); } if (k === "copy") return copyOut("csv"); copyOut(k, true); };
  return <dialog className="modal" id="exp" aria-label="Експорт звіту" ref={ref} onClose={() => { if (ui.exp) close(); }}>
    {open && <form method="dialog" className="exp-box" onSubmit={e => { e.preventDefault(); close(); }}><div className="card-h"><h2>Експорт звіту</h2><div className="sp" /><button className="icon-btn" value="x" aria-label="Закрити"><Ic n="x" /></button></div>
      <div className="lbl" style={{ marginBottom: 10 }}>{cur().name} · цикл {CYCLE}</div>
      <div className="exp-list">{[...srv, ...OPTS].map(([k, ic, t, ds]) => <button key={k} type="button" className="exp-opt" onClick={() => run(k)}><span className="comp-ic" style={{ background: "var(--soft)" }}><Ic n={ic} /></span><span><b>{t}</b><span className="lbl">{ds}</span></span></button>)}</div></form>}
  </dialog>;
}
// Ім'я файлу: заклад і цикл без службового ідентифікатора («alpha») і суфікса «(2)»
const expName = () => `integra-${String(cur().name || "звіт").replace(/[\\/:*?"<>|«»]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60)}-${String(CYCLE).replace(/ \(\d+\)$/, "")}`;
function copyOut(kind, dl) {
  const m = cur(); let txt;
  if (kind === "html") { const doc = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>${RT_TPL[RT.tpl][0]} ${CYCLE}</title><style>body{font:14pt/1.5 "Times New Roman",Times,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#000}table{border-collapse:collapse;width:100%;margin:6px 0 12px}td,th{border:1px solid #000;padding:4px 6px;font-size:12pt;text-align:left;vertical-align:top}th{font-weight:bold}.doc-approve{margin-left:auto;width:300px}.doc-title{text-align:center;font-size:16pt;margin:24px 0 4px}.doc-sub{text-align:center;font-weight:bold}.doc-meta,.doc-note{font-size:11pt}.doc-cap{text-align:right;font-style:italic;margin-bottom:2px}.doc-sign{display:flex;justify-content:space-between;margin-top:36px}.doc-blank{display:inline-block;min-width:140px;border-top:1px solid #000;font-size:10pt;text-align:center}.noprint,svg,button{display:none}p{text-align:justify}</style></head><body>${(document.querySelector(".rt-doc") || document.querySelector(".paper")).innerHTML}</body></html>`; return download(`${expName()}.html`, doc, "text/html"); }
  if (kind === "csv") txt = ["Код;Компонент;Вид;Назва;Джерело;Вага;Значення", ...allItems(m).map(x => [x.id, (COMP[x.c] || {}).n || x.c, x.src ? "самооцінка" : "факт", `"${x.t.replace(/"/g, '""')}"`, x.src || x.kind, x.w, fb(x.v)].join(";")), ...m.components.map(c => [c.id, COMP[c.id].n, "компонент", COMP[c.id].n, "зараховано", "33,3", fb(c.cr.v)].join(";")), ["index", "", "індекс", "Індекс доброчесності", "", "100", fb(m.index)].join(";")].join("\n");
  else txt = JSON.stringify({ institution: m.name, cycle: CYCLE, asOf: TODAY, index: m.index, level: m.level, trust: m.trust, delta: m.delta,
    components: Object.fromEntries(m.components.map(c => [c.id, { perception: c.P, facts: c.F, credited: c.cr.v, limited: c.cr.lim }])),
    flags: m.raised.map(f => ({ id: f.id, weight: f.w, title: f.t })), measures: m.id === ALPHA ? measures() : [] }, null, 2);
  if (dl) return download(`${expName()}.${kind}`, (kind === "csv" ? "﻿" : "") + txt, kind === "csv" ? "text/csv" : "application/json");
  copyText(txt, () => { toast(kind.toUpperCase() + " скопійовано"); addLog(me(), `Експорт звіту (${kind.toUpperCase()})`); });
}

/* Word за шаблоном і Excel із сервера: GET /campaigns/{id}/report?format=&template=&unit_id= */
async function serverExport(fmt) {
  try {
    // Шаблон змінює лише Word; Excel завжди з повними даними, тож без шаблону (і без «-brief» у назві файлу)
    const q = new URLSearchParams({ format: fmt }); if (fmt === "docx") q.set("template", RT.tpl); if (API.unitId) q.set("unit_id", API.unitId);
    const r = await api(`/campaigns/${API.campaignId}/report?${q}`, { raw: true });
    const name = (/filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "") || [])[1] || `integra-report.${fmt}`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast("Завантажено: " + name);
  } catch (e) { apiFail(e); }
}
