/* Дрібні спільні елементи: мітки, числа з анімацією, зміна, шкала рівнів. */
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { Ic } from "../lib/icons.jsx";
import { LSHORT, LDESC, TRUST, SRC, level } from "../lib/model.js";
import { fb, f1, pts, esc } from "../lib/format.js";

export const Pill = ({ cls = "", children, tip }) => <span className={`pill ${cls}`} data-tip={tip}>{children}</span>;
export const LvPill = ({ l }) => <span className={`pill lv lv${l} nodot`} data-tip={`Рівень зрілості ${l} з 5: ${LSHORT[l - 1]}<small>${LDESC[l - 1]}</small>`}><b>{l}</b>{LSHORT[l - 1]}</span>;
export const TrustPill = ({ g }) => <span className={`pill ${TRUST[g][3]} nodot`} data-tip={esc(TRUST[g][2])}>{g === "insufficient" ? null : <b>{g}</b>}{TRUST[g][1]}</span>;
export const SrcDot = ({ s }) => <span className={`src-dot ${SRC[s][2]}`} style={{ "--c": SRC[s][1] }} />;

const split = (v, d) => { const s = d ? f1(v) : fb(v); const [a, b] = s.split(","); return [a, b ? "," + b : ""]; };
// Число з плавним «набіганням» під час появи (як countUp у першій версії)
export function Num({ v, d = 1 }) {
  if (v == null) return <span className="lbl nodata">немає даних</span>;
  return <NumA v={v} d={d} />;
}
function NumA({ v, d }) {
  const [shown, setShown] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches ? v : 0);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) { setShown(v); return; }
    first.current = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(v); return; }
    const t0 = performance.now(), dur = 1100; let raf;
    const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); setShown(v * e); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  const [a, b] = split(shown, d);
  return <span className="cu">{a}<span className="dec">{b}</span></span>;
}

export function Delta({ d, suf = "" }) {
  if (d == null) return <span className="delta flat" data-tip="Не вдалося отримати попередні цикли. Оновіть сторінку пізніше."><i><Ic n="flat" /></i><span>Зміна невідома</span></span>;
  const up = d > 0, dn = d < 0;
  return <span className={`delta ${up ? "up" : dn ? "down" : "flat"}`}><i><Ic n={up ? "up" : dn ? "down" : "flat"} /></i><span>{up ? "Зросло на " : dn ? "Знизилось на " : ""}<b>{up || dn ? pts(d) : "Без змін"}</b>{suf ? " " + suf : ""}</span></span>;
}

// Шкала рівнів зрілості (нерівні межі 12,5 / 37,5 / 62,5 / 87,5) з позначкою індексу
export function LevelBar({ v }) {
  const spans = [[0, 12.5], [12.5, 37.5], [37.5, 62.5], [62.5, 87.5], [87.5, 100]], lv = level(v);
  return <div className="lvscale" role="img" aria-label={`Індекс ${f1(v)}: рівень ${lv} з 5, ${LSHORT[lv - 1]}`}>
    <div className="lvs-mark" style={{ left: `${v}%`, transform: `translateX(${v < 8 ? "-6px" : v > 92 ? "calc(-100% + 6px)" : "-50%"})`, alignItems: v < 8 ? "flex-start" : v > 92 ? "flex-end" : "center" }}><b className="tnum">{f1(v)}</b><i /></div>
    <div className="lvs-bar">{spans.map(([lo, hi], i) => <span key={i} className={`lv-b${i + 1} ${i + 1 === lv ? "here" : ""}`} style={{ flex: hi - lo }} data-tip={`Рівень ${i + 1}: ${LSHORT[i]}<small>Індекс від ${fb(lo)} до ${fb(hi)}</small>`} />)}</div>
    <div className="lvs-lbl">{spans.map(([lo, hi], i) => <div key={i} style={{ flex: hi - lo }} className={i + 1 === lv ? "here" : ""}><b>{i + 1}</b><span>{LSHORT[i]}</span><small className="tnum">{fb(lo)}–{fb(hi)}</small></div>)}</div>
  </div>;
}

export function CapBars({ c }) {
  const bar = (n, v, col) => <div className="cap-row"><span className="lbl">{n}</span><div className="dist-bar"><i style={{ width: `${v}%`, background: col }} /></div><b className="tnum">{fb(v)}</b></div>;
  return <div className="cap">{bar("Самооцінка", c.P, "var(--blue)")}{bar("Підтверджено фактами", c.F, "var(--amber)")}{bar("Зараховано", c.cr.v, "var(--teal)")}</div>;
}

// Смужка з 20/30 поділок (заповнення компонентів і жетонів)
export function Ticks({ n, on, color, cls = "f2", h = 18, delay = 0, step = 20 }) {
  return <div className="ticks" style={{ height: h, marginTop: h === 14 ? 6 : 10 }}>{Array.from({ length: n }, (_, j) => <span key={j} className={`${j < on ? cls : ""} bar-a`} style={{ animationDelay: `${delay + j * step}ms`, ...(j < on && color ? { background: color } : {}) }} />)}</div>;
}

export const CompIc = ({ c, style }) => <span className="comp-ic" style={{ background: c.s, color: c.c, ...style }}><Ic n={c.ic} /></span>;

// Ширина контейнера для графіків (перемальовування при зміні розміру)
export function useWidth(fallback) {
  const ref = useRef(null), [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth);
    let t; const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => setW(el.clientWidth), 150); });
    ro.observe(el); return () => { ro.disconnect(); clearTimeout(t); };
  }, []);
  return [ref, w || fallback, !!w];
}
