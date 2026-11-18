/* Оверлеї: підказка (data-tip), бічна панель, поповер, сповіщення. */
import { useLayoutEffect, useEffect, useRef } from "react";
import { Ic } from "../lib/icons.jsx";
import { ui, closeDrawer, closePop } from "../lib/store.js";

/* Масштаб тексту (zoom на <html>): координати getBoundingClientRect екранні, а left/top задаються в CSS-пікселях */
export const Z = () => parseFloat(document.documentElement.style.zoom) || 1;
export const zr = r => { const z = Z(); return { left: r.left / z, right: (r.right ?? r.left + r.width) / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z }; };

/* ---------- Підказка ---------- */
const tipEl = () => document.getElementById("tip");
export function showTip(r, html) {
  const tip = tipEl(); if (!tip) return;
  r = zr(r); const vw = window.innerWidth / Z(), vh = window.innerHeight / Z();
  tip.innerHTML = html; tip.style.left = "0px"; tip.style.top = "0px";
  const w = tip.offsetWidth, h = tip.offsetHeight, m = 8, gap = 10;
  const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, m), vw - w - m);
  const y = r.top - h - gap >= m ? r.top - h - gap : Math.min(r.bottom + gap, vh - h - m);
  tip.style.left = x + "px"; tip.style.top = y + "px"; tip.classList.add("on");
}
export function hideTip() { const t = tipEl(); if (t) t.classList.remove("on"); }
export function installTips() {
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (!el || !el.dataset.tip) return; if (ui.pop && ui.pop.anchor === el) return; showTip(el.getBoundingClientRect(), el.dataset.tip); });
  document.addEventListener("mouseout", e => { if (e.target.closest && e.target.closest("[data-tip]")) hideTip(); });
}

/* ---------- Бічна панель ---------- */
export function Drawer() {
  const d = ui.drawer, last = useRef(null), body = useRef(null);
  if (d) last.current = d;
  const shown = d || last.current;
  useLayoutEffect(() => {
    if (!d || !body.current) return;
    [...body.current.children].forEach((c, i) => { c.style.animationDelay = (80 + i * 60) + "ms"; });
    const t = setTimeout(() => { const f = body.current && body.current.querySelector("textarea, input, select"); if (f) f.focus(); }, 350);
    return () => clearTimeout(t);
  }, [d && d.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const Body = shown && shown.body;
  return <aside className={`drawer ${d ? "on" : ""}`} id="drawer" aria-hidden={!d}>
    <div className="drawer-h"><h3 id="dTitle">{shown ? shown.title : ""}</h3><button className="icon-btn" id="dClose" aria-label="Закрити" onClick={closeDrawer}><Ic n="x" /></button></div>
    <div className="drawer-b" id="dBody" ref={body}>{Body ? <Body key={shown.n} /> : null}</div>
  </aside>;
}

/* ---------- Поповер ---------- */
export function placePop(p, anchor, mode) {
  if (!p || !anchor) return;
  const r = zr(anchor.getBoundingClientRect()), vw = innerWidth / Z();
  if (mode === "under") { const w = Math.max(r.width, 320); p.style.width = w + "px"; p.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px"; p.style.top = (r.bottom + 6) + "px"; return; }
  p.style.width = ""; const w = p.offsetWidth;
  p.style.left = Math.max(8, Math.min(r.right - w, vw - w - 8)) + "px"; p.style.top = (r.bottom + 6) + "px";
}
export function Pop({ children, mode }) {
  const ref = useRef(null), pop = ui.pop;
  useLayoutEffect(() => { if (pop) placePop(ref.current, pop.anchor, mode); });
  useEffect(() => {
    const f = e => { const p = ref.current; if (ui.pop && p && !p.contains(e.target) && !(ui.pop.anchor && ui.pop.anchor.contains(e.target))) closePop(); };
    document.addEventListener("click", f, true); return () => document.removeEventListener("click", f, true);
  }, []);
  return <div className={`popover ${pop ? "on" : ""}`} id="pop" role="dialog" aria-label="Вибір" ref={ref}>{pop ? children : null}</div>;
}

export function Toast() {
  const t = ui.toast, last = useRef("");
  if (t) last.current = t.t;
  return <div className={`toast ${t ? "on" : ""}`} id="toast">{t ? t.t : last.current}</div>;
}
