/* ШІ за виділеним фрагментом звіту: кнопка «Запитати ШІ» біля виділення і панель із запитом до POST /api/assistant/edit.
 * Модель лише пропонує: заміна відбувається після «Замінити», через insertText (Ctrl/⌘+Z працює). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, AI_ROLES, addLog, me } from "../lib/state.js";
import { API, apiAuth } from "../lib/api.js";
import { toast } from "../lib/store.js";

export const rtCanAi = () => S.aiOn && AI_ROLES.includes(S.role);
const QUICK = [["Скоротити", "Скороти, зберігши всі числа"], ["Офіційніше", "Переклади в офіційно-діловий стиль"], ["Простіше", "Перепиши простішою мовою для особового складу"], ["Поясни", "Поясни, що означає цей фрагмент і звідки числа?"]];

/* docRef — <article> документа; edit — режим редагування; onApplied — зберегти правки після вставки */
export function ReportAi({ docRef, edit, onApplied }) {
  const [fab, setFab] = useState(null);      // {top, left} кнопки
  const [panel, setPanel] = useState(null);  // {sel, range}
  const busy = useRef(false), panelOpen = useRef(false);
  panelOpen.current = !!panel;

  // Виділення в документі → кнопка над ним
  useEffect(() => {
    let t;
    const check = () => {
      const d = docRef.current, sel = window.getSelection();
      if (!d || !rtCanAi() || !sel || sel.isCollapsed || !sel.rangeCount) return setFab(null);
      const r = sel.getRangeAt(0);
      if (!d.contains(r.commonAncestorContainer)) return setFab(null);
      const text = sel.toString().trim();
      if (text.length < 3) return setFab(null);
      const rect = r.getBoundingClientRect();
      setFab({ top: Math.max(8, rect.top - 44), left: Math.min(window.innerWidth - 150, Math.max(8, rect.left + rect.width / 2 - 64)), sel: text.slice(0, 4000), range: r.cloneRange() });
    };
    const on = () => { if (busy.current || panelOpen.current) return; clearTimeout(t); t = setTimeout(check, 180); };
    const hide = () => setFab(null);
    document.addEventListener("selectionchange", on);
    window.addEventListener("scroll", hide, true);
    return () => { clearTimeout(t); document.removeEventListener("selectionchange", on); window.removeEventListener("scroll", hide, true); };
  }, [docRef]);

  // Режим чи шаблон змінився — закрити
  useEffect(() => { setPanel(null); setFab(null); }, [edit]);

  return <>
    {fab && !panel && <button type="button" className="rt-fab noprint" style={{ top: fab.top, left: fab.left }} onMouseDown={e => e.preventDefault()}
      onClick={() => { setPanel({ sel: fab.sel, range: fab.range }); setFab(null); }}><Ic n="spark" />Запитати ШІ</button>}
    {panel && <AiBox key={panel.sel} {...panel} edit={edit} docRef={docRef} busy={busy} onApplied={onApplied} close={() => setPanel(null)} />}
  </>;
}

function AiBox({ sel, range, edit, docRef, busy, close, onApplied }) {
  const ref = useRef(null), ta = useRef(null);
  const [st, setSt] = useState({ wait: false, err: null, res: null });
  const [pos, setPos] = useState({ left: 8, top: 120, width: 420 });

  // Позиція під виділенням (або над ним, якщо внизу немає місця)
  useLayoutEffect(() => {
    const rect = range.getBoundingClientRect(), w = Math.min(420, window.innerWidth - 16);
    const h = ref.current ? ref.current.offsetHeight : 260, below = rect.bottom + 10;
    setPos({ width: w, left: Math.min(window.innerWidth - w - 8, Math.max(8, rect.left)), top: below + h < window.innerHeight ? below : Math.max(8, (rect.top || 120) - h - 10) });
  }, [range, st]);
  useEffect(() => { ta.current && ta.current.focus({ preventScroll: true }); }, []);
  // Клік поза панеллю, Escape, перехід на інший екран — закрити
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const key = e => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key); window.addEventListener("hashchange", close);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); window.removeEventListener("hashchange", close); busy.current = false; };
  }, [close, busy]);

  async function ask(q) {
    q = String(q || "").trim(); if (!q || busy.current) return;
    busy.current = true; setSt({ wait: true, err: null, res: null });
    const body = { selection: sel, instruction: q.slice(0, 500), document: (docRef.current?.innerText || "").slice(0, 20000), mode: edit ? "auto" : "ask", unit_id: API.unitId || null };
    try {
      if (!API.on) throw new Error("Редагування з ШІ працює лише з бекендом. Текст можна правити вручну.");
      let r;
      try { r = await fetch("/api/assistant/edit", { method: "POST", headers: { "content-type": "application/json", ...apiAuth() }, body: JSON.stringify(body) }); }
      catch (e) { throw new Error("Немає звʼязку із сервером"); }
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(r.status === 503 ? "Модель на сервері не підключена. Без неї текст можна правити вручну."
        : r.status === 404 || r.status === 405 ? "Редагування з ШІ працює лише з бекендом."
        : r.status === 401 || r.status === 403 ? "Увійдіть як керівник або аудитор, щоб запитати ШІ."
        : (j && (j.message || (typeof j.detail === "string" && j.detail))) || "Модель не відповіла. Спробуйте ще раз");
      if (!j || !j.text) throw new Error("Модель повернула порожню відповідь");
      setSt({ wait: false, err: null, res: j });
    } catch (e) { setSt({ wait: false, err: e.message, res: null }); }
    finally { busy.current = false; }
  }

  function apply(after) {
    const j = st.res, d = docRef.current; if (!j || !d || !edit) return;
    d.focus({ preventScroll: true });
    const s = window.getSelection(), r = range.cloneRange();
    if (after) r.collapse(false);
    s.removeAllRanges(); s.addRange(r);
    const text = after ? " " + j.text : j.text;
    // insertText зберігає історію: Ctrl/⌘+Z повертає попередній текст
    if (!document.execCommand("insertText", false, text)) { r.deleteContents(); r.insertNode(document.createTextNode(text)); }
    onApplied(); addLog(me(), `Звіт: ${after ? "вставлено відповідь" : "замінено фрагмент"} за пропозицією ШІ`);
    close(); toast(after ? "Вставлено. Скасувати: Ctrl/⌘+Z" : "Замінено. Скасувати: Ctrl/⌘+Z");
  }

  const quick = QUICK.filter((_, i) => edit || i === 3), j = st.res;
  const warn = j && (j.warnings || []).map((w, i) => <div key={i} className="rt-warn"><Ic n="alert" />{w}</div>);
  return <div ref={ref} className="rt-ai noprint" role="dialog" aria-label="Запит до ШІ щодо фрагмента" style={pos}>
    <div className="rt-ai-h"><b><Ic n="spark" />ШІ для фрагмента</b><div className="sp" /><button type="button" className="icon-btn" onClick={close} aria-label="Закрити"><Ic n="x" /></button></div>
    <blockquote className="rt-quote">{sel.length > 220 ? sel.slice(0, 220) + "…" : sel}</blockquote>
    <div className="rt-chips">{quick.map(([t, q]) => <button key={t} type="button" className="pill-btn" disabled={st.wait} onClick={() => ask(q)}>{t}</button>)}</div>
    <form className="rt-ask" onSubmit={e => { e.preventDefault(); ask(ta.current.value); }}>
      <textarea ref={ta} className="inp" rows={2} maxLength={500} aria-label="Запит до ШІ" placeholder={edit ? "Що зробити з фрагментом або що пояснити?" : "Що пояснити? (щоб змінювати текст, увімкніть «Редагувати»)"}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
      <button className="btn btn-primary" aria-label="Надіслати" disabled={st.wait}><Ic n="send" /></button>
    </form>
    {st.wait && <div className="rt-wait"><Ic n="spark" />Модель думає…</div>}
    {st.err && <div className="rt-err">{st.err}</div>}
    {j && (j.action === "replace" && edit ? <>
      <div className="lbl">Пропозиція{j.note ? `: ${j.note}` : ""}</div>
      <div className="rt-diff"><del>{sel}</del><ins>{j.text}</ins></div>{warn}
      <div className="rt-act"><button type="button" className="btn btn-primary" onClick={() => apply(false)}><Ic n="ok" />Замінити</button><button type="button" className="btn btn-ghost" onClick={close}>Скасувати</button></div>
      <div className="lbl">Не те? Уточніть у полі вище, наприклад «коротше» чи «без другого речення».</div>
    </> : <>
      <div className="rt-answer" style={{ whiteSpace: "pre-line" }}>{j.text}</div>{warn}
      <div className="rt-act">{edit && <button type="button" className="btn btn-soft" onClick={() => apply(true)}><Ic n="plus" />Вставити після фрагмента</button>}<button type="button" className="btn btn-ghost" onClick={close}>Закрити</button></div>
    </>)}
  </div>;
}
