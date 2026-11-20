/* Оверлеї: підказка (data-tip), бічна панель, поповер, сповіщення. */
import { useLayoutEffect, useEffect, useRef } from "react";
import { Ic } from "../lib/icons.jsx";
import { ui, closeDrawer, closePop } from "../lib/store.js";

/* Масштаб тексту (zoom на <html>): координати getBoundingClientRect екранні, а left/top задаються в CSS-пікселях */
export const Z = () => parseFloat(document.documentElement.style.zoom) || 1;
export const zr = r => { const z = Z(); return { left: r.left / z, right: (r.right ?? r.left + r.width) / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z }; };

/* ---------- Підказка ---------- */
const tipEl = () => document.getElementById("tip");
let tipQuiet = 0;
// Поки йде перехід бічної панелі, підказки не показуються: кнопка їде під курсором
export const quietTips = ms => { tipQuiet = Date.now() + ms; };
export function showTip(r, html, pos) {
  const tip = tipEl(); if (!tip || Date.now() < tipQuiet) return;
  r = zr(r); const vw = window.innerWidth / Z(), vh = window.innerHeight / Z();
  tip.innerHTML = html; tip.style.left = "0px"; tip.style.top = "0px";
  const w = tip.offsetWidth, h = tip.offsetHeight, m = 8, gap = 10;
  // data-tip-pos="right": праворуч від елемента, по центру по вертикалі (кнопка згорнутого меню не закриває заголовок)
  const right = pos === "right";
  const x = right ? Math.min(r.right + gap, vw - w - m) : Math.min(Math.max(r.left + r.width / 2 - w / 2, m), vw - w - m);
  const y = right ? Math.min(Math.max(r.top + (r.bottom - r.top) / 2 - h / 2, m), vh - h - m) : r.top - h - gap >= m ? r.top - h - gap : Math.min(r.bottom + gap, vh - h - m);
  tip.style.left = x + "px"; tip.style.top = y + "px"; tip.classList.add("on");
}
// now: сховати без згасання (інакше напівпрозора підказка ще кілька кадрів висить на старому місці)
export function hideTip(now) { const t = tipEl(); if (!t) return; if (now) { t.style.transition = "none"; t.classList.remove("on"); void t.offsetWidth; t.style.transition = ""; } else t.classList.remove("on"); }
export function installTips() {
  document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (!el || !el.dataset.tip) return; if (ui.pop && ui.pop.anchor === el) return; showTip(el.getBoundingClientRect(), el.dataset.tip, el.dataset.tipPos); });
  document.addEventListener("mouseout", e => { if (e.target.closest && e.target.closest("[data-tip]")) hideTip(); });
  // Елементи з data-tip-pos показують підказку й при фокусі з клавіатури
  document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-tip-pos]"); if (el && el.dataset.tip && el.matches(":focus-visible")) showTip(el.getBoundingClientRect(), el.dataset.tip, el.dataset.tipPos); });
  document.addEventListener("focusout", e => { if (e.target.closest && e.target.closest("[data-tip-pos]")) hideTip(); });
}

/* ---------- Бічна панель ---------- */
export function Drawer() {
  const d = ui.drawer, last = useRef(null), body = useRef(null);
  if (d) last.current = d;
  const shown = d || last.current;
  useLayoutEffect(() => {
    if (!d || !body.current) return;
    [...body.current.children].forEach((c, i) => { c.style.animationDelay = (80 + i * 60) + "ms"; });
    const t = setTimeout(() => { const f = body.current && (body.current.querySelector("textarea, input, select") || document.getElementById("dTitle")); if (f) f.focus({ preventScroll: true }); }, 350);
    return () => clearTimeout(t);
  }, [d && d.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Модальна панель: фон не прокручується (сам фон стає inert в App.jsx);
  // після закриття фокус повертається туди, звідки панель відкрили
  const opener = useRef(null), open = !!d;
  useEffect(() => {
    if (open) { opener.current = document.activeElement; document.documentElement.classList.add("dlg-open"); return; }
    document.documentElement.classList.remove("dlg-open");
    const o = opener.current; opener.current = null;
    if (o && o.isConnected && typeof o.focus === "function") o.focus({ preventScroll: true });
  }, [open]);
  const Body = shown && shown.body;
  return <aside className={`drawer ${d ? "on" : ""}`} id="drawer" role="dialog" aria-modal="true" aria-labelledby="dTitle" inert={d ? undefined : ""}>
    <div className="drawer-h"><h3 id="dTitle" tabIndex={-1}>{shown ? shown.title : ""}</h3><button className="icon-btn" id="dClose" aria-label="Закрити" onClick={closeDrawer}><Ic n="x" /></button></div>
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
// mode "stay": місце рахується один раз при відкритті, у пікселях екрана. Так вікно доступності
// не стрибає, коли змінюється масштаб сторінки (сам масштаб для нього скасовано в CSS через --uz).
function placeStay(p, anchor) {
  if (!p || !anchor) return;
  p.style.width = ""; const r = anchor.getBoundingClientRect(), w = Math.round(p.getBoundingClientRect().width);
  p.style.left = Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8))) + "px"; p.style.top = Math.round(r.bottom + 6) + "px";
}
export function Pop({ children, mode, cls = "", label = "Вибір" }) {
  const ref = useRef(null), placed = useRef(null), pop = ui.pop;
  useLayoutEffect(() => {
    if (!pop) { placed.current = null; return; }
    if (mode !== "stay") { placePop(ref.current, pop.anchor, mode); return; }
    if (placed.current !== pop) { placed.current = pop; placeStay(ref.current, pop.anchor); }
  });
  useEffect(() => {
    const f = e => { const p = ref.current; if (ui.pop && p && !p.contains(e.target) && !(ui.pop.anchor && ui.pop.anchor.contains(e.target))) closePop(); };
    document.addEventListener("click", f, true); return () => document.removeEventListener("click", f, true);
  }, []);
  return <div className={`popover ${cls} ${pop ? "on" : ""}`} id="pop" role="dialog" aria-label={label} ref={ref}>{pop ? children : null}</div>;
}

export function Toast() {
  const t = ui.toast, last = useRef("");
  if (t) last.current = t.t;
  return <div className={`toast ${t ? "on" : ""}`} id="toast" role="status" aria-live="polite" aria-atomic="true">{t ? t.t : last.current}</div>;
}
