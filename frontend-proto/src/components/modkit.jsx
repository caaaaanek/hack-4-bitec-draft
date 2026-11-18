/* Спільні елементи екранів модулів: ряд KPI-плиток, заголовок секції з іконкою в тонованому колі, «Докладніше». */
import { Ic } from "../lib/icons.jsx";
import { Num } from "./ui.jsx";

// Тон іконки й пігулки: кольори лише з токенів base.css
const TONE = { teal: ["var(--teal-soft)", "var(--teal-deep)"], amber: ["var(--amber-soft)", "var(--amber)"], red: ["var(--red-soft)", "var(--red)"], blue: ["var(--blue-soft)", "var(--blue)"], mute: ["var(--soft)", "var(--muted)"] };
export const ToneIc = ({ ic, tone = "teal" }) => <span className="comp-ic" style={{ background: TONE[tone][0], color: TONE[tone][1], flex: "none" }}><Ic n={ic} /></span>;

// items: [{ ic, t, v (число або текст), d (true: з дробовою частиною, приглушеною), sub, tone }]
export function KpiRow({ items }) {
  return <div className={`c12 kpi-row ${items.length === 3 ? "kpi-row-s" : ""}`} style={items.length !== 3 ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined}>
    {items.map(x => <section key={x.t} className="card rise kpi-tile">
      <div className="kt-h"><span className="kt-ic" style={x.tone ? { background: TONE[x.tone][0], color: TONE[x.tone][1] } : undefined}><Ic n={x.ic} /></span><span className="lbl">{x.t}</span></div>
      <div className="kt-b"><span className={`${typeof x.v === "number" ? "mid" : "kt-txt"} tnum`}>{typeof x.v === "number" && x.d ? <Num v={x.v} d={1} /> : x.v}</span>{x.sub != null && <div className="kt-s lbl">{x.sub}</div>}</div>
    </section>)}
  </div>;
}

export const ModHead = ({ ic, tone, title, children }) => <div className="card-h mod-h"><ToneIc ic={ic} tone={tone} /><h2>{title}</h2><div className="sp" />{children}</div>;

// Довгі пояснення ховаємо під розгортуваний рядок
export const More = ({ t = "Докладніше", children }) => <details className="more"><summary><span>{t}</span><Ic n="chev" /></summary><div className="more-b">{children}</div></details>;
