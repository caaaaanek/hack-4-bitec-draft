/* Власний вибір дати (замість <input type="date">). Вікно в body, щоб бічна панель його не обрізала. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ic } from "../lib/icons.jsx";
import { TODAY } from "../lib/model.js";

const DP_MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const DP_WD = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];
// Сітка місяця (m: 0-11): порожні клітинки перед 1-м числом (тиждень з понеділка), далі дні
function dpGrid(y, m) {
  const shift = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), cells = [];
  for (let i = 0; i < shift; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}
const dpIso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dpFmt = iso => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

export function DatePicker({ id, value, min, onChange }) {
  const [open, setOpen] = useState(null); // { y, m }
  const fld = useRef(null), pop = useRef(null), wrap = useRef(null);
  const close = focus => { setOpen(null); if (focus && fld.current) fld.current.focus(); };
  const toggle = () => { if (open) return close(); const [y, m] = (value || TODAY).split("-").map(Number); setOpen({ y, m: m - 1 }); };
  // fixed: вікно не обрізається прокруткою бічної панелі; відкривається вгору, якщо знизу немає місця
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    const r = wrap.current.getBoundingClientRect(), p = pop.current, pw = p.offsetWidth, ph = 340, z = parseFloat(document.documentElement.style.zoom) || 1;
    const vw = innerWidth / z, vh = innerHeight / z, rb = r.bottom / z, rt = r.top / z;
    p.style.left = Math.max(8, Math.min(r.left / z, vw - pw - 8)) + "px";
    p.style.top = (rb + 6 + ph > vh && rt - 6 - ph > 0 ? rt - 6 - ph : rb + 6) + "px";
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const click = e => { if (!wrap.current.contains(e.target) && !(pop.current && pop.current.contains(e.target))) close(); };
    // Escape закриває лише вікно дати, а не бічну панель
    const key = e => { if (e.key === "Escape") { e.stopImmediatePropagation(); close(true); } };
    const scroll = e => { if (!(e.target.closest && e.target.closest(".dp-pop"))) close(); };
    const resize = () => close();
    document.addEventListener("click", click); document.addEventListener("keydown", key, true); document.addEventListener("scroll", scroll, true); addEventListener("resize", resize);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key, true); document.removeEventListener("scroll", scroll, true); removeEventListener("resize", resize); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = step => setOpen(o => { let m = o.m + step, y = o.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });
  const pick = iso => { onChange(iso); close(true); };
  return <div className="dp" id={id} ref={wrap}>
    <button type="button" className="inp dp-field" aria-haspopup="dialog" aria-expanded={!!open} ref={fld} onClick={toggle}><span className="dp-txt">{value ? dpFmt(value) : "ДД.ММ.РРРР"}</span><span className="dp-ic"><Ic n="cal" /></span></button>
    {open && createPortal(<div className="dp-pop" role="dialog" ref={pop}>
      <div className="dp-head"><button type="button" className="dp-nav" aria-label="Попередній місяць" onClick={() => nav(-1)}>‹</button><b className="dp-title">{DP_MONTHS[open.m]} {open.y}</b><button type="button" className="dp-nav" aria-label="Наступний місяць" onClick={() => nav(1)}>›</button></div>
      <div className="dp-wd">{DP_WD.map(w => <span key={w}>{w}</span>)}</div>
      <div className="dp-grid">{dpGrid(open.y, open.m).map((d, i) => { if (d === null) return <span key={"e" + i} />; const iso = dpIso(open.y, open.m, d); return <button key={iso} type="button" className={`dp-day${iso === value ? " is-sel" : ""}${iso === TODAY ? " is-today" : ""}`} disabled={!!(min && iso < min)} onClick={() => pick(iso)}>{d}</button>; })}</div>
      <div className="dp-foot"><button type="button" className="dp-today" disabled={!!(min && TODAY < min)} onClick={() => pick(TODAY)}>Сьогодні</button></div>
    </div>, document.body)}
  </div>;
}
