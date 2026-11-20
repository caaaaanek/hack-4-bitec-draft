/* Графіки на SVG: міні-динаміка, динаміка з межами рівнів, радар компонентів. */
import { COMPS, COMP, BOUNDS, LSHORT, level } from "../lib/model.js";
import { fb, f1 } from "../lib/format.js";
import { useWidth } from "./ui.jsx";

const Defs = () => <defs>
  <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--teal)" stopOpacity=".28" /><stop offset="1" stopColor="var(--teal)" stopOpacity="0" /></linearGradient>
  <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--teal-deep)" /><rect width="2.2" height="7" fill="rgba(255,255,255,.22)" /></pattern>
</defs>;
function smooth(p) { let d = `M${p[0][0]},${p[0][1]}`; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; } return d; }

// Міні-графік лише індексу для «Огляду»
export function MiniTrend({ rows: all, alt }) {
  const [ref, w] = useWidth(300), rows = all.filter(r => r.index != null);
  const h = 140, px = 14, T = 22, Bm = 12, n = rows.length;
  const vals = rows.map(r => r.index), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 1);
  const X = i => px + (n === 1 ? (w - 2 * px) / 2 : i * (w - 2 * px) / (n - 1)), Y = v => T + (1 - (v - lo) / span) * (h - T - Bm);
  const p = vals.map((v, i) => [X(i), Y(v)]), last = n - 1;
  const lab = (i, anchor, dx) => <text x={X(i) + dx} y={p[i][1] - 9} textAnchor={anchor} className="ax-strong lbl-halo">{f1(vals[i])}</text>;
  return <div className="chart dyn-mini" id="dynMini" role="img" aria-label={alt} ref={ref}>
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><Defs />
      {n > 1 && <path d={`${smooth(p)} L${X(last)},${h} L${X(0)},${h}Z`} className="area-fill reveal" />}
      <path d={n > 1 ? segPath(p) : ""} className="line-teal draw" style={{ strokeDasharray: 3000, "--len": 3000 }} />
      {p.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === last || i === 0 ? 4.5 : 3} fill="var(--panel)" stroke="var(--teal)" strokeWidth="2.2" className="pop" data-tip={`Індекс ${f1(vals[i])}<small>Цикл ${esc2(rows[i].cycle)}</small>`} />)}
      {lab(0, "start", -4)}{n > 1 && lab(last, "end", 4)}
    </svg></div>;
}

// Динаміка: індекс + лінії компонентів, межі рівнів зрілості, події між циклами
// Лінія з розривами: сегменти лише між сусідніми точками з даними
const segPath = pts => { const out = []; let cur = []; for (const q of pts) { if (q[1] == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(q); } if (cur.length) out.push(cur); return out.map(sg => sg.length > 1 ? smooth(sg) : `M${sg[0][0]},${sg[0][1]}`).join(" "); };
export function TrendChart({ rows, lines, events, showIdx = true }) {
  const [ref, w] = useWidth(600);
  const wide = w > 520, h = 300, L = 40, Rr = wide ? 104 : 30, T = 26, B = 46;
  const n = rows.length, IP = 22, X = i => L + IP + (n === 1 ? (w - L - Rr - 2 * IP) / 2 : i * (w - L - Rr - 2 * IP) / (n - 1)), Y = v => T + (1 - v / 100) * (h - T - B);
  const p = rows.map((r, i) => [X(i), r.index == null ? null : Y(r.index)]), gap = p.some(q => q[1] == null);
  // Підписи значень: по одному на кожну видиму лінію в кожному циклі, розсунуті по вертикалі, щоб не накладались
  const labs = rows.map(() => []);
  if (showIdx) rows.forEach((r, i) => { if (r.index != null) labs[i].push({ y: Y(r.index), t: f1(r.index), c: "var(--fg)" }); });
  lines.forEach(c => rows.forEach((r, i) => { if (r.cr[c] != null) labs[i].push({ y: Y(r.cr[c]), t: fb(r.cr[c]), c: COMP[c].c }); }));
  const GAP = 14;
  const labels = labs.map((L0, i) => {
    // стопка підписів над групою точок (зверху найбільше значення); якщо зверху немає місця, то під групою
    if (!L0.length) return null;
    const s = [...L0].sort((a, b) => a.y - b.y), top = s[0].y, bot = s[s.length - 1].y, k = s.length;
    const above = top - 10 - (k - 1) * GAP >= 14;
    s.forEach((l, j) => { l.ly = above ? top - 10 - (k - 1 - j) * GAP : bot + 18 + j * GAP; });
    const anchor = n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle", dx = anchor === "end" ? -6 : anchor === "start" ? 6 : 0;
    return s.map((l, j) => <text key={`${i}-${j}`} x={X(i) + dx} y={l.ly + 4} textAnchor={anchor} className="ax-strong lbl-halo" style={{ fill: l.c }}>{l.t}</text>);
  });
  return <div className="chart" id="trend" ref={ref}>
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Динаміка індексу доброчесності"><Defs />
      {[0, 25, 50, 75, 100].map(v => <g key={v}><line x1={L} x2={w - Rr} y1={Y(v)} y2={Y(v)} className="grid-l" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" className="ax">{v}</text></g>)}
      {BOUNDS.map(v => <line key={v} x1={L} x2={w - Rr + 4} y1={Y(v)} y2={Y(v)} className="lv-bound" />)}
      {[0, ...BOUNDS].map((lo, i) => { const hi = [...BOUNDS, 100][i], y1 = Y(hi), y2 = Y(lo); return <g key={i} data-tip={`Рівень зрілості ${i + 1}: ${LSHORT[i]}<small>Індекс від ${fb(lo)} до ${fb(hi)}</small>`}><rect x={w - Rr + 8} y={y1 + 1} width="4" height={y2 - y1 - 2} rx="2" className={`lv-band lv-b${i + 1}`} /><text x={w - Rr + 18} y={(y1 + y2) / 2 + 4} className="ax">{wide ? `${i + 1} ${LSHORT[i]}` : i + 1}</text></g>; })}
      <text x={L - 8} y={T - 12} textAnchor="end" className="ax">0–100</text>{wide && <text x={w - Rr + 8} y={T - 12} className="ax">Рівень зрілості</text>}
      {n > 1 && showIdx && !gap && <path d={`${smooth(p)} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)}Z`} className="area-fill reveal" />}
      {showIdx && <><path d={n > 1 ? segPath(p) : ""} className="line-teal draw" style={{ strokeDasharray: 3000, "--len": 3000 }} />
        {p.map(([x, y], i) => y == null ? null : <circle key={i} cx={x} cy={y} r="5" fill="var(--panel)" stroke="var(--teal)" strokeWidth="2.5" className="pop" style={{ animationDelay: `${500 + i * 120}ms` }} data-tip={`Індекс ${f1(rows[i].index)} · рівень ${level(rows[i].index)}<small>Цикл ${esc2(rows[i].cycle)}</small>`} />)}</>}
      {lines.map(c => { const q = rows.map((r, i) => [X(i), r.cr[c] == null ? null : Y(r.cr[c])]); return <g key={c}><path d={n > 1 ? segPath(q) : ""} fill="none" stroke={COMP[c].c} strokeWidth="2" strokeDasharray="6 5" className="draw" style={{ "--len": 3000 }} />{q.map(([x, y], i) => y == null ? null : <rect key={i} x={x - 4} y={y - 4} width="8" height="8" rx="2" fill={COMP[c].c} className="pop" data-tip={`${COMP[c].n}: ${fb(rows[i].cr[c])}<small>Цикл ${esc2(rows[i].cycle)}</small>`} />)}</g>; })}
      {labels}
      {rows.map((r, i) => <text key={i} x={X(i)} y={h - B + 6} textAnchor="middle" className="ax" style={{ dominantBaseline: "hanging" }}>{r.cycle}</text>)}
      {events.map((e, k) => { const i = rows.findIndex(r => r.cycle === e.after); if (i < 0 || i >= n - 1) return null; const x = (X(i) + X(i + 1)) / 2, y = h - B + 21; return <g key={k} className="pop" data-tip={`${esc2(e.t)}<small>Після циклу ${esc2(e.after)}</small>`}><line x1={x} x2={x} y1={T} y2={h - B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 4" opacity=".6" /><text x={x + 12} y={y + 4} className="ax">{wide ? (k === 0 ? "заходи" : "") : ""}</text><rect x={x - 6} y={y - 6} width="12" height="12" fill="var(--panel)" stroke="var(--fg)" strokeWidth="1.6" transform={`rotate(45 ${x} ${y})`} /></g>; })}
    </svg></div>;
}
const esc2 = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Радар компонентів (кілька шарів: зараховано, факти, сприйняття, попередній цикл)
export function Radar({ series, id }) {
  const [ref, cw] = useWidth(320);
  const w = Math.min(cw, 360), h = w * 0.86, cx = w / 2, cy = h / 2 + 10, rad = Math.min(w, h) / 2 - 40, n = COMPS.length;
  const P = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * rad * v / 100, cy + Math.sin(a) * rad * v / 100]; };
  return <div className="chart" id={id} ref={ref}>
    <svg width={w} height={h + 14} viewBox={`0 0 ${w} ${h + 14}`} style={{ margin: "0 auto", maxWidth: "100%" }}>
      {[...BOUNDS, 100].map(v => <polygon key={v} className="radar-grid" points={COMPS.map((_, i) => P(i, v).join(",")).join(" ")} />)}
      {COMPS.map((c, i) => { const [ex, ey] = P(i, 100), [lx, ly] = P(i, 124); return <g key={c}><line className="radar-ax" x1={cx} y1={cy} x2={ex} y2={ey} /><text x={lx} y={ly} textAnchor="middle" className="ax">{COMP[c].n}</text><text x={lx} y={ly + 15} textAnchor="middle" className="ax-strong">{fb(series[0].v[i])}</text></g>; })}
      {series.map(s => <polygon key={s.cls} className={`${s.cls} pop`} style={{ animationDelay: `${s.delay || 0}ms` }} points={s.v.map((v, i) => P(i, v).join(",")).join(" ")} />)}
    </svg></div>;
}
