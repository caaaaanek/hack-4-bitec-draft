/* Екрани результатів: Огляд, Розклад індексу, Динаміка, Порівняння. */
import { useEffect, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, persist } from "../lib/state.js";
import { COMPS, COMP, LEVELS, LSHORT, LDESC, BOUNDS, CAP, TRUST, SRC, SCOL, level, indexLevel, status, r1, wmean, clamp, measures, overdueDays, CYCLE } from "../lib/model.js";
import { fb, f1, f2, pts, esc, plural } from "../lib/format.js";
import { render, toast, openPop, closePop } from "../lib/store.js";
import { cur, go, can } from "../lib/nav.js";
import { Pill, LvPill, TrustPill, SrcDot, Num, Delta, LevelBar, useWidth } from "../components/ui.jsx";
import { MiniTrend, TrendChart, Radar } from "../components/charts.jsx";
import { DigestRows, digestTop } from "./Insights.jsx";
import { CandorCard, GamingCard } from "./Candor.jsx";
import { LeaderDocs, canBriefing } from "./Leadership.jsx";
import { ChildrenLevels } from "./Oversight.jsx";
import { API, dn, orgT } from "../lib/api.js";
import { openWhy, openTrust, openHow, openResp, openItem, openApiQ, openTrustHow, openTrackerHow, openRespHow, itemQs } from "./panels.jsx";

const enter = f => e => { if (e.key === "Enter") f(e); };
export function BackToInst() {
  if (S.role !== "observer") return null;
  return <div className="c12 crumbs rise"><a href="#institutions"><Ic n="arrowL" />{API.on ? "Усі " + orgT("plural") : "Усі заклади"}</a><span className="lbl">/</span><b>{dn(cur().name)}</b></div>;
}

/* Блок «Як читати…» на екранах «Огляд» і «Заклади» */
export function ReadGuide({ title }) {
  return <details className="card c12 rise guide" open={S.guideOpen} onToggle={e => { S.guideOpen = e.currentTarget.open; persist(); }}>
    <summary className="card-h"><h2>{title}</h2><div className="sp" /><span className="lbl guide-hint" /><span className="chev"><Ic n="chev" /></span></summary>
    <div className="legend3">
      <div><h3>Індекс доброчесності</h3><p className="lbl">Число від 0 до 100: середнє трьох компонентів (Культура, Система, Підзвітність). Кожен компонент поєднує анкети персоналу й факти з документів. Чим вище, тим краще працює система доброчесності закладу. Оцінюється система, а не окремі люди.</p></div>
      <div><h3>Рівень зрілості</h3><p className="lbl" style={{ marginBottom: 8 }}>Рівень за Моделлю зрілості НАЗК, визначається за індексом.</p>
        <div className="rows">{LSHORT.map((n, i) => <div key={n} className="row" style={{ alignItems: "flex-start", gap: 10 }}><LvPill l={i + 1} /><div className="grow lbl" style={{ fontSize: 12.5 }}><span className="tnum">{i === 0 ? "0" : fb(BOUNDS[i - 1])}–{i === 4 ? "100" : fb(BOUNDS[i])}.</span> {LDESC[i]}</div></div>)}</div></div>
      <div><h3>Достовірність</h3><p className="lbl" style={{ marginBottom: 8 }}>Наскільки можна довіряти результату. Залежить від прапорців: автоматичних перевірок даних на розбіжності й підозрілі відповіді.</p>
        <div className="rows">{["A", "B", "C", "insufficient"].map(g => <div key={g} className="row" style={{ alignItems: "flex-start", gap: 10 }}><TrustPill g={g} /><div className="grow lbl" style={{ fontSize: 12.5 }}>{TRUST[g][2]}</div></div>)}</div></div>
    </div>
    <p className="lbl" style={{ marginTop: 12 }}>Результати не порівнюють заклади й підрозділи між собою і не є підставою для колективного покарання: деталі підрозділу бачить лише сам підрозділ, а перегляди чужих підрозділів записуються в журнал.</p>
  </details>;
}

const LIST_MAX = 3; // скільки пунктів показувати в «Що потребує уваги» і «Сильні сторони» до розгортання
function Tile({ ic, title, big, sub, act, info, tip = "Як рахується і шкала рівнів" }) {
  return <section className="card rise kpi-tile" {...(act ? { role: "button", tabIndex: 0, onClick: act, onKeyDown: enter(act) } : {})}>
    <div className="kt-h"><span className="kt-ic"><Ic n={ic} /></span><span className="lbl">{title}</span>{info && <button type="button" className="kt-info" aria-label={`Підказка: ${tip}`} data-tip={tip} onClick={e => { e.stopPropagation(); info(); }}><Ic n="info" /></button>}</div>
    <div className="kt-b">{big}<div className="kt-s">{sub}</div></div>
  </section>;
}

/* Компактна динаміка індексу на «Огляді»: лише лінія індексу, повний екран на #trends */
function DynCard({ m }) {
  const sr = m.series.filter(r => r.index != null), a = sr[0] || m.series[0], b = sr[sr.length - 1] || a, d = r1((b.index ?? 0) - (a.index ?? 0));
  const txt = m.noHistory ? "Зміна невідома" : d > 0 ? `Зріс на ${pts(d)}` : d < 0 ? `Знизився на ${pts(d)}` : "Не змінився";
  const alt = `Індекс за цикли від ${a.cycle} до ${b.cycle}: з ${f1(a.index)} до ${f1(b.index)}. ${txt} за період.`;
  return <>
    <div className="card-h"><h2>Динаміка індексу</h2><div className="sp" /><a className="pill-btn" href="#trends" aria-label="Детальніше: відкрити екран «Динаміка»"><Ic n="arrowR" />Детальніше</a></div>
    <MiniTrend rows={m.series} alt={alt} />
    <div className="dyn-sum"><span className="lbl">{a.cycle}: <b className="tnum">{f1(a.index)}</b></span><span className={`dyn-d ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{txt}</span><span className="lbl">{b.cycle}: <b className="tnum">{f1(b.index)}</b></span></div>
  </>;
}

/* Огляд */
export function Overview() {
  const m = cur(), ms = measures(), od = ms.filter(x => overdueDays(x) > 0).length, prev = m.series[m.series.length - 2];
  const attn = S.attnAll ? m.attention : m.attention.slice(0, LIST_MAX), strong = S.strAll ? m.strengths : m.strengths.slice(0, LIST_MAX), dg = digestTop();
  return <>
    <BackToInst />
    <div className="c12 kpi-row">
      <Tile ic="gauge" title="Індекс доброчесності" big={<span className="mid tnum"><Num v={m.index} /></span>} act={openWhy} info={openHow}
        sub={<><span>Рівень зрілості: {m.level ? <b className={`lv-txt lv-t${m.level}`}><i />{LSHORT[m.level - 1]}</b> : <span className="lbl">немає даних</span>}</span><br /><Delta d={m.delta} /></>} />
      <Tile ic="shield" title="Достовірність" big={<span className={`mid tr-txt tr-${m.trust}`}>{m.trust === "insufficient" ? "?" : m.trust}</span>} act={openTrust} info={openTrustHow} tip="Як визначається достовірність"
        sub={<><b className={`tr-txt tr-${m.trust}`}><i />{TRUST[m.trust][1]}</b><br /><span className="lbl">Прапорці: {m.raised.length}</span></>} />
      {S.role === "observer" || !can("tracker")
        ? <Tile ic="users" title="Відповідей у циклі" big={<span className="mid tnum">{m.responses}</span>} sub={<span className="lbl">Мінімальна група: {S.k} {plural(S.k, "особа", "особи", "осіб")}</span>} act={openResp} info={openRespHow} tip="Що таке мінімальна група" />
        : <Tile ic="target" title="Заходи в трекері" big={<span className="mid tnum">{ms.length}</span>} sub={od ? <span style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))", fontWeight: 600 }}>З них {od} прострочено</span> : <span className="lbl">Прострочених немає</span>} act={() => go("tracker")} info={openTrackerHow} tip="Як працює трекер заходів" />}
    </div>
    <section className="card c8 rise" id="attn">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Що потребує уваги</h2><div className="sp" />{canBriefing() && <div className="attn-docs"><LeaderDocs /></div>}</div>
      {m.attention.length ? <div className="rows">{attn.map((a, i) => <a key={i} className="row click" href={`#explain/${a.c}`} onClick={a.q ? e => { e.preventDefault(); openApiQ(a.q); } : undefined} data-tip={a.hint}><span className="dot" style={{ background: SCOL[status(a.v)] }} /><div className="grow"><div className="t">{a.t}</div></div>{!String(a.t).startsWith(COMP[a.c].n) && <Pill cls="p-mute nodot">{COMP[a.c].n}</Pill>}<b className="tnum">{fb(a.v)}</b></a>)}</div> : dg.length ? null : <div className="lbl">Зауважень немає: нічого не потребує уваги.</div>}
      <DigestRows items={dg} />
      {m.attention.length > LIST_MAX && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => { S.attnAll = !S.attnAll; render(true); }}>{S.attnAll ? "Згорнути" : `Показати всі (${m.attention.length})`}</button>}
    </section>
    <div className="c4 ov-side">
      <section className="card rise dyn-card"><DynCard m={m} /></section>
      <section className="card rise str-card">
        <div className="card-h"><h2>Сильні сторони</h2></div>
        {m.strengths.length ? <div className="rows">{strong.map((a, i) => <a key={i} className="row click" href={a.c ? "#explain/" + a.c : "#trends"} data-tip={a.hint}><span className="dot" style={{ background: "var(--teal)" }} /><div className="grow"><div className="t">{a.t}</div></div><b className="tnum">{a.unit ? "+" : ""}{fb(a.v)}</b></a>)}</div> : <div className="lbl">Поки що немає даних про сильні сторони.</div>}
        {m.strengths.length > LIST_MAX && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => { S.strAll = !S.strAll; render(true); }}>{S.strAll ? "Згорнути" : `Показати всі (${m.strengths.length})`}</button>}
      </section>
    </div>
    <CandorCard />
    <div className="c12 comp-row">{m.components.map((c, ci) => {
      const C = COMP[c.id], d = m.noHistory || c.cr.v == null || prev.cr[c.id] == null ? null : r1(c.cr.v - prev.cr[c.id]), lv = c.cr.v == null ? null : level(c.cr.v);
      return <a key={c.id} className="card rise comp-card" href={`#explain/${c.id}`}>
        <div className="comp-top"><span className="comp-ic" style={{ background: C.s, color: C.c }}><Ic n={C.ic} /></span><b>{C.n}</b><div className="sp" style={{ flex: 1 }} />{lv ? <LvPill l={lv} /> : <span className="lbl">немає даних</span>}</div>
        {c.cr.lim && <div className="comp-lim"><Pill cls="p-warn">Знижено: факти не підтверджують</Pill></div>}
        <div className="comp-val">
          <div><div className="mid tnum"><Num v={c.cr.v} /></div><div style={{ marginTop: 6 }}><Delta d={d} /></div></div>
          <div className="pf">{[["Самооцінка", c.P, "var(--blue)", "С"], ["Підтверджено фактами", c.F, "var(--amber)", "Ф"], ["Зараховано в індекс", c.cr.v, C.c, "З"]].map(([n, v, col, ltr], j) => <div key={n} data-tip={`${n}: ${fb(v)}`} aria-label={`${n}: ${fb(v)}`} role="img"><i className="bar-a" style={{ height: Math.max(4, v * .6), background: col, animationDelay: `${300 + ci * 100 + j * 80}ms` }} /><small aria-hidden="true">{ltr}</small></div>)}</div>
        </div>
      </a>;
    })}</div>
    <GamingCard />
    <section className="card c8 rise lv-card">
      <div className="card-h"><h2>Рівень зрілості</h2><div className="sp" /><button type="button" className="pill-btn" onClick={openHow}><Ic n="help" />Як рахується</button></div>
      <LevelBar v={m.index} />
      <div className="lbl" style={{ margin: "20px 0 8px" }}>Компоненти на тій самій шкалі</div>
      <div className="lv-comps">{m.components.map(c => { const v = c.cr.v, l = level(v); return <a key={c.id} className="lv-comp" href={`#explain/${c.id}`}><b>{COMP[c.id].n}</b><div className="lvc-track">{[12.5, 25, 25, 25, 12.5].map((w, i) => <span key={i} className={`lv-b${i + 1} ${i + 1 === l ? "here" : ""}`} style={{ flex: w }} />)}<i style={{ left: `${v}%` }} data-tip={`${COMP[c.id].n}: ${fb(v)}`} /></div><span className="tnum">{fb(v)}</span><LvPill l={l} /></a>; })}</div>
    </section>
    <section className="card c4 rise radar-card">
      <div className="card-h"><h2>Радар компонентів</h2></div>
      <div className="radar-body"><div className="radar-main"><Radar id="radar" series={[{ cls: "r-st", v: COMPS.map(c => m.byId[c].cr.v), delay: 150 }, { cls: "r-prev", v: COMPS.map(c => prev.cr[c]), delay: 0 }]} />
        <div className="legend lg-lines" style={{ justifyContent: "center" }}><span><i className="ar" style={{ background: "color-mix(in srgb,var(--teal) 30%,transparent)", borderColor: "var(--teal)" }} />Цикл {CYCLE}</span><span><i className="ln dash" style={{ borderColor: "var(--faint)" }} />Цикл {prev.cycle}</span></div>
        <div className="lbl" style={{ textAlign: "center", marginTop: 6 }}>Зараховані значення компонентів, 0–100.</div></div>
        <div className="radar-side"><table><thead><tr><th>Компонент</th><th>Самооцінка</th><th>Підтверджено фактами</th><th>Зараховано в індекс</th></tr></thead><tbody>{m.components.map(c => <tr key={c.id}><td><b>{COMP[c.id].n}</b></td><td className="tnum">{fb(c.P)}</td><td className="tnum">{fb(c.F)}</td><td className="tnum"><b>{fb(c.cr.v)}</b></td></tr>)}</tbody></table><div className="lbl" style={{ marginTop: 8 }}>Зараховано в індекс: самооцінка, але не більше ніж «факти + {CAP}».</div></div></div>
    </section>
    <ReadGuide title="Як читати цей екран" />
  </>;
}

/* Динаміка: картка з вибором періоду й ліній */
const trendRange = m => { const t = S.trend, n = m.series.length - 1, a = clamp(Math.min(t.from, t.to), 0, n), b = clamp(Math.max(t.from, t.to), 0, n); return [a, b]; };
function toggleLine(c) {
  const t = S.trend;
  if (c === "index") t.noIdx = !t.noIdx; else t.lines = t.lines.includes(c) ? t.lines.filter(x => x !== c) : [...t.lines, c];
  if (t.noIdx && !t.lines.length) { t.noIdx = false; toast("Має лишитися хоча б одна лінія"); }
  persist(); render(true);
}
function TrendCard({ m }) {
  const t = S.trend, [from, to] = trendRange(m), rows = m.series.slice(from, to + 1), ri = rows.filter(r => r.index != null), d = ri.length > 1 ? r1(ri[ri.length - 1].index - ri[0].index) : 0;
  const evs = m.events.filter(e => rows.slice(0, -1).some(r => r.cycle === e.after));
  const chip = (k, n, c, on) => <button key={k} className={`chip ${on ? "on" : ""}`} style={{ "--c": c }} aria-pressed={on} onClick={() => toggleLine(k)}><i className={k === "index" ? "solid" : undefined} />{n}</button>;
  return <>
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Динаміка індексу</h2><div className="sp" />
      <button type="button" className="pill-btn" aria-haspopup="dialog" onClick={e => { pickA = null; openPop("period", e.currentTarget); }}><Ic n="cal" />{rows[0].cycle} – {rows[rows.length - 1].cycle}</button>
      <button className="pill-btn" onClick={() => { S.trTable = !S.trTable; render(true); }}>{S.trTable ? <><Ic n="trend" />Діаграма</> : <><Ic n="table" />Таблиця</>}</button></div>
    {!S.trTable && <div className="chips-row"><span className="lbl">Лінії:</span>{chip("index", "Індекс", "var(--teal-deep)", !t.noIdx)}{COMPS.map(c => chip(c, COMP[c].n, COMP[c].c, t.lines.includes(c)))}</div>}
    {S.trTable
      ? <div className="tbl-wrap"><table><thead><tr><th>Цикл</th><th>Індекс</th><th>Рівень</th>{COMPS.map(c => <th key={c}>{COMP[c].n}</th>)}<th>Події після циклу</th></tr></thead><tbody>{rows.map(r => <tr key={r.cycle}><td><b>{r.cycle}</b></td><td className="tnum"><b>{f1(r.index)}</b></td><td><LvPill l={r === m.series[m.series.length - 1] ? m.level : indexLevel(r.index, COMPS.map(c => r.cr[c]))} /></td>{COMPS.map(c => <td key={c} className="tnum">{fb(r.cr[c])}</td>)}<td className="lbl">{m.events.filter(e => e.after === r.cycle && r !== rows[rows.length - 1]).map(e => e.t).join("; ") || "–"}</td></tr>)}</tbody></table></div>
      : <TrendChart rows={rows} lines={t.lines} events={m.events} showIdx={!t.noIdx} />}
    <div className="lbl" style={{ marginTop: 8, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}><span className="ev-ic"><Ic n="diamond" /></span>Виконані заходи між циклами: {evs.reduce((a, e) => a + (e.n || 1), 0)}. {d > 0 ? `За період індекс зріс на ${pts(d)}.` : d < 0 ? `За період індекс знизився на ${pts(d)}.` : "За період індекс не змінився."}</div>
  </>;
}
// Вибір періоду: календар місяців, у яких були цикли (клік на початок, потім на кінець)
const MON = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
let pickA = null;
export function PeriodPop() {
  const [, setN] = useState(0), redraw = () => setN(n => n + 1);
  const m = cur(), sr = m.series, [from, to] = trendRange(m), years = [...new Set(sr.map(r => r.cycle.slice(0, 4)))];
  const lo = pickA ?? from, hi = pickA != null ? pickA : to;
  const pick = k => {
    if (pickA == null) { pickA = k; return redraw(); }
    const a = Math.min(pickA, k), b = Math.max(pickA, k); pickA = null;
    if (a === b) { toast("Оберіть два різні цикли"); return redraw(); }
    S.trend.from = a; S.trend.to = b; persist(); closePop(); render(true);
  };
  const set = (a, b) => { S.trend.from = a; S.trend.to = b; persist(); closePop(); render(true); };
  return <>
    <div className="lbl" style={{ textTransform: "uppercase", letterSpacing: ".06em", fontSize: 11 }}>Оберіть період</div>
    <div style={{ fontSize: 17, fontWeight: 600, margin: "2px 0 10px" }}>{pickA != null ? `${sr[pickA].cycle} – …` : `${sr[from].cycle} – ${sr[to].cycle}`}</div>
    {years.map(y => <div key={y}><div className="mp-y">{y}</div><div className="mp">{MON.map((mn, i) => { const cy = `${y}-${String(i + 1).padStart(2, "0")}`, k = sr.findIndex(r => r.cycle === cy); if (k < 0) return <span key={i} className="off">{mn}</span>; const end = k === lo || k === hi, mid = k > lo && k < hi; return <button key={i} className={end ? "end" : mid ? "mid" : ""} onClick={() => pick(k)} data-tip={`Цикл ${cy}`}>{mn}</button>; })}</div></div>)}
    <div className="lbl" style={{ marginTop: 8 }}>Активні місяці це цикли оцінювання.</div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}><button className="link-btn" onClick={() => set(0, sr.length - 1)}>Увесь період</button><button className="link-btn" onClick={() => set(Math.max(0, sr.length - 2), sr.length - 1)}>Останні два цикли</button></div>
  </>;
}

/* Розклад індексу */
const MODES = { perception: "Самооцінка", facts: "Підтверджено фактами", credited: "Зараховано в індекс" };
function tree(m, mode) {
  return m.components.map(c => {
    const val = mode === "perception" ? c.P : mode === "facts" ? c.F : c.cr.v, lim = mode === "credited" && c.cr.lim;
    const k = mode === "credited" && c.P > 0 && c.cr.v != null ? c.cr.v / c.P : 1;
    const items = (mode === "facts" ? m.fItems : m.pItems).filter(x => x.c === c.id).map(x => { const v = x.v * k; return { ...x, vv: v, contrib: v / 3 * x.w / 100, lim }; });
    return { ...c, val, lim, contrib: val / 3, items };
  });
}
const LEG = ["wg", "os", "experts", "facts"];
const edgeP = (x1, y1, x2, y2) => { const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
const mixC = c => `color-mix(in srgb, ${c} 16%, var(--panel))`;
/* Граф: індекс → компоненти → джерела (анкети) чи показники фактів. Товщина ребра це внесок в індекс. */
function TreeGraph({ T, sum, hl, maxC, fallback }) {
  const [ref, w] = useWidth(1000);
  if (w && w < 620) return <div ref={ref} className="tg">{fallback}</div>;
  // Граф займає до 1040 px і стоїть по центру картки, а не тулиться до лівого краю
  const W = Math.max(w || 1000, 620), rowH = 60, gap = 24, top = 24, rL = 22, rC = 30, rR = 38, cw = Math.min(W, 1040), off = Math.round((W - cw) / 2);
  const xR = off + 60, xC = off + Math.round(cw * .3), xL = off + Math.round(cw * .58), chars = Math.max(14, Math.floor((Math.min(W, xL + 420) - xL - rL - 24) / 7.6));
  const ew = r => 1.5 + r * r * 9; // товщина ребра: квадрат частки, щоб різницю було видно
  const tipE = (n, v) => `${n}<small>Внесок в індекс: ${f2(v)}</small>`;
  // Кожен компонент займає однакову смугу (він дає рівно третину індексу), навіть якщо показників у ньому менше.
  // Розмір вузла-листка залежить від його ваги всередині компонента.
  const band = Math.max(1, ...T.map(c => c.items.length)) * rowH, rOf = x => Math.round(15 + 13 * Math.sqrt((x.w || 0) / 100));
  let y = top;
  const G = T.map(c => {
    const n = c.items.length, step = n ? band / n : band;
    const items = c.items.map((x, i) => ({ ...x, y: y + step * (i + .5), r: rOf(x) }));
    const cy = y + band / 2; y += band + gap;
    return { ...c, items, y: cy };
  });
  const H = y - gap + top, yR = (G[0].y + G[G.length - 1].y) / 2, cut = t => t.length > chars ? t.slice(0, chars - 1) + "…" : t;
  const used = new Set(T.flatMap(c => c.items.map(x => x.kind === "p" ? x.src : "facts")));
  const leafSub = x => { const n = itemQs(x).length; return [x.kind === "p" ? (n ? `${n} ${plural(n, "питання", "питання", "питань")}` : null) : x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`, `вага ${fb(x.w)} %`, `внесок ${f2(x.contrib)}`].filter(Boolean).join(" · "); };
  return <div ref={ref} className="tg">
    <div className="tg-legend lbl">{LEG.filter(k => used.has(k)).map(k => <span key={k}><i style={{ background: SRC[k][1] }} />{SRC[k][0]}</span>)}<span className="tg-w"><i />Товщина лінії: внесок в індекс. Наведіть на лінію, щоб побачити число</span></div>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Розклад індексу ${fb(sum)}: ${G.map(c => `${COMP[c.id].n} ${fb(c.val)}`).join(", ")}`}>
      {G.map(c => <g key={c.id}>
        <g className="tg-eg" data-tip={tipE(COMP[c.id].n, c.contrib)}><path d={edgeP(xR + rR, yR, xC - rC, c.y)} className="tg-e" style={{ stroke: COMP[c.id].c, strokeWidth: ew(c.contrib / 34) }} /><path d={edgeP(xR + rR, yR, xC - rC, c.y)} className="tg-eh" /></g>
        {c.items.map(x => <g key={x.id} className="tg-eg" data-tip={tipE(x.t, x.contrib)}><path d={edgeP(xC + rC, c.y, xL - x.r, x.y)} className="tg-e" style={{ stroke: COMP[c.id].c, strokeWidth: ew(maxC ? x.contrib / maxC : 0) }} /><path d={edgeP(xC + rC, c.y, xL - x.r, x.y)} className="tg-eh" /></g>)}
      </g>)}
      <g className="tg-n"><title>{`Індекс доброчесності: ${fb(sum)}. Середнє трьох компонентів.`}</title>
        <circle cx={xR} cy={yR} r={rR} style={{ fill: "var(--lime-soft)", stroke: "var(--teal-deep)" }} />
        <text x={xR} y={yR + 6} className="tg-v" style={{ fontSize: sum == null ? 13 : 17 }}>{sum == null ? "—" : fb(sum)}</text>
        <text x={xR} y={yR - rR - 24} className="tg-t">Індекс</text><text x={xR} y={yR - rR - 9} className="tg-t">доброчесності</text></g>
      {G.map(c => <g key={c.id} className="tg-n tg-c" id={`n-${c.id}`} data-tip={`${COMP[c.id].n}: ${fb(c.val)}<small>Внесок в індекс: ${f2(c.contrib)}. ${c.items.length} ${plural(c.items.length, "показник", "показники", "показників")}, разом третина індексу.${c.lim ? `<br>${esc(c.cr.reason)}` : ""}</small>`}>
        {hl === c.id && <circle cx={xC} cy={c.y} r={rC + 6} className="tg-hl" />}
        <circle cx={xC} cy={c.y} r={rC} style={{ fill: COMP[c.id].s, stroke: c.lim ? "var(--amber)" : COMP[c.id].c, strokeDasharray: c.lim ? "5 3" : undefined }} />
        <text x={xC} y={c.y + 5} className="tg-v" style={{ fontSize: 14 }}>{fb(c.val)}</text>
        <text x={xC} y={c.y + rC + 17} className="tg-t">{COMP[c.id].n}</text>
        {c.lim && <text x={xC} y={c.y + rC + 33} className="tg-lim">Знижено фактами</text>}</g>)}
      {G.flatMap(c => c.items.map(x => { const col = SRC[x.kind === "p" ? x.src : "facts"][1], act = () => openItem(x.id);
        return <g key={x.id} id={`n-${x.id}`} className="tg-leaf" role="button" tabIndex={0} aria-label={`${x.t}: ${fb(x.vv)}. ${leafSub(x)}`} onClick={act} onKeyDown={enter(act)}><title>{x.t}</title>
          <rect x={xL - x.r - 4} y={x.y - Math.max(x.r, 20) - 4} width={x.r * 2 + 20 + Math.max(cut(x.t).length * 7.4, leafSub(x).length * 6.2)} height={Math.max(x.r, 20) * 2 + 8} rx={x.r + 4} className="tg-hit" />
          {hl === x.id && <circle cx={xL} cy={x.y} r={x.r + 5} className="tg-hl" />}
          <circle cx={xL} cy={x.y} r={x.r} style={{ fill: mixC(col), stroke: col }} />
          <text x={xL} y={x.y + 4} className="tg-v" style={{ fontSize: x.r > 24 ? 13 : 12 }}>{fb(x.vv)}</text>
          <text x={xL + x.r + 12} y={x.y - 3} className="tg-l">{cut(x.t)}</text>
          <text x={xL + x.r + 12} y={x.y + 15} className="tg-s">{leafSub(x)}</text></g>; }))}
    </svg>
  </div>;
}
export function Explain() {
  const m = cur(), mode = S.mode, T = tree(m, mode), sum = T.some(c => c.val == null) ? null : r1(T.reduce((a, c) => a + c.contrib, 0)), hl = S.focus; // компонент без даних: індексу немає, нулем не підміняємо
  const maxC = Math.max(0, ...T.flatMap(c => c.items.map(x => x.contrib)));
  useEffect(() => { if (S.focus) { const el = document.getElementById("n-" + S.focus); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 200); S.focus = null; } });
  const shut = S.tblShut || (S.tblShut = {}), tog = id => { shut[id] = !shut[id]; render(true); };
  const table = <div className="tbl-wrap"><table className="ex-tbl"><thead><tr><th>Вузол</th><th>Рівень</th><th>Вага, %</th><th>Значення</th><th>Внесок, пункти</th><th>Джерело</th></tr></thead><tbody>
    <tr><td><b>Індекс доброчесності</b></td><td>1</td><td className="tnum">100</td><td className="tnum">{sum == null ? "—" : fb(sum)}</td><td className="tnum">{sum == null ? "—" : f2(T.reduce((a, c) => a + c.contrib, 0))}</td><td /></tr>
    {T.map(c => [<tr key={c.id} id={S.exTable ? `n-${c.id}` : undefined} className={`ex-grp ${shut[c.id] ? "shut" : ""}`} onClick={() => tog(c.id)} data-tip={c.lim ? esc(c.cr.reason) : undefined}>
        <td><span className="ex-gt"><button type="button" className="ex-tog" aria-expanded={!shut[c.id]} aria-label={`${shut[c.id] ? "Розгорнути" : "Згорнути"}: ${COMP[c.id].n}`} onClick={e => { e.stopPropagation(); tog(c.id); }}><Ic n="chev" /></button><b>{COMP[c.id].n}</b>{c.lim && <> <Pill cls="p-warn nodot">Знижено фактами</Pill></>}{shut[c.id] && <span className="lbl">· {c.items.length}</span>}</span></td>
        <td>2</td><td className="tnum">33,3</td><td className="tnum">{fb(c.val)}</td><td className="tnum">{f2(c.contrib)}</td><td /></tr>,
      ...(shut[c.id] ? [] : c.items.map(x => <tr key={x.id} id={S.exTable ? `n-${x.id}` : undefined} className={`ex-item ${hl === x.id ? "hl" : ""}`} onClick={() => openItem(x.id)}><td style={{ paddingLeft: 44 }}>{x.t}</td><td>3</td><td className="tnum">{x.w}</td><td className="tnum">{fb(x.vv)}</td><td className="tnum">{f2(x.contrib)}</td><td>{x.src ? SRC[x.src][0] : "Факти"}</td></tr>))])}
  </tbody></table></div>;
  return <>
    <BackToInst />
    <section className="c12 rise toolbar"><div className="sp" />
      <button className="btn btn-ghost" onClick={openHow}><Ic n="help" />Як це рахується</button>
      <div className="seg" role="group" aria-label="Що показувати">{Object.entries(MODES).map(([k, n]) => <button key={k} className={mode === k ? "on" : ""} aria-pressed={mode === k} onClick={() => { S.mode = k; persist(); render(true); }}>{n}</button>)}</div>
      <button className="btn btn-ghost" onClick={() => { S.exTable = !S.exTable; render(true); }}>{S.exTable ? <><Ic n="tree" />Показати як граф</> : <><Ic n="table" />Показати як таблицю</>}</button></section>
    <section className="card c12 rise">
      {S.exTable ? table : <TreeGraph T={T} sum={sum} hl={hl} maxC={maxC} fallback={table} />}
    </section>
  </>;
}

/* Динаміка */
export function Trends() {
  const m = cur(), sr = m.series;
  const a = sr[Math.min(S.cmp.a, sr.length - 1)], b = sr[Math.min(S.cmp.b, sr.length - 1)];
  const cmpRows = [["Індекс доброчесності", a.index, b.index], ...COMPS.map(c => [COMP[c].n, a.cr[c], b.cr[c]])];
  const opt = sr.map((r, i) => <option key={i} value={i}>{r.cycle}</option>);
  const f = sr[0], l = sr[sr.length - 1], has = c => l.cr[c] != null && f.cr[c] != null, p = COMPS.filter(c => has(c) && l.cr[c] > f.cr[c]), n = COMPS.filter(c => has(c) && l.cr[c] < f.cr[c]);
  return <>
    <BackToInst />
    {m.noHistory && <section className="card c12 rise"><div className="note-box"><b>Попередні цикли недоступні</b><span className="lbl">Сервер не віддав історію оцінювань, тому показано лише поточний цикл. Оновіть сторінку пізніше.</span></div></section>}
    <section className="card c12 rise"><TrendCard m={m} /></section>
    <section className="card c7 rise">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Порівняти два цикли</h2><div className="sp" />
        <label className="lbl">Було <select className="inp" value={S.cmp.a} onChange={e => { S.cmp.a = +e.target.value; persist(); render(true); }}>{opt}</select></label>
        <label className="lbl">Стало <select className="inp" value={S.cmp.b} onChange={e => { S.cmp.b = +e.target.value; persist(); render(true); }}>{opt}</select></label></div>
      {a === b ? <div className="empty">Оберіть два різні цикли, щоб побачити, що змінилося.</div> : <div className="tbl-wrap"><table><thead><tr><th>Показник</th><th>Було</th><th>Стало</th><th>Зміна</th></tr></thead><tbody>{cmpRows.map(([nm, x, y]) => <tr key={nm}><td><b>{nm}</b></td><td className="tnum">{fb(x)}</td><td className="tnum">{fb(y)}</td><td>{x == null || y == null ? <span className="lbl">Зміна невідома</span> : <Delta d={r1(y - x)} />}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="card c5 rise">
      <div className="card-h"><h2>Висновок за весь період</h2></div>
      <div className="rows">
        <div className="row" style={{ alignItems: "center" }}><span className="comp-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)", width: 28, height: 28 }}><Ic n="up" /></span><div className="grow">{p.length ? `Позитивна динаміка: ${p.map(c => `${COMP[c].n} (${pts(l.cr[c] - f.cr[c])})`).join(", ")}.` : "Позитивної динаміки за період немає."}</div></div>
        <div className="row" style={{ alignItems: "center" }}><span className="comp-ic" style={{ background: n.length ? "var(--red-soft)" : "var(--soft)", color: n.length ? "var(--red)" : "var(--muted)", width: 28, height: 28 }}><Ic n={n.length ? "down" : "flat"} /></span><div className="grow">{n.length ? `Потребує уваги: ${n.map(c => `${COMP[c].n} (−${pts(f.cr[c] - l.cr[c])})`).join(", ")}.` : "Негативної динаміки за компонентами немає."}</div></div>
        {m.events.map((e, i) => <div key={i} className="row"><span className="ev-ic ev-c"><Ic n="diamond" /></span><div className="grow"><div className="t">{e.t}</div><div className="s">Після циклу {e.after}</div></div></div>)}
      </div>
    </section>
    {["leader", "observer", "auditor"].includes(S.role) && <ChildrenLevels />}
  </>;
}

/* Порівняння: сприйняття за групами проти фактів */
const IB_GRP = { staff: "·ОС", working_group: "·РГ", expert: "·ЕК", checklist: "·ЧЛ" };
const MARKS = [["wg", "Робоча група"], ["os", "Особовий склад"], ["experts", "Експерти"]];
function Ring({ f }) {
  const r = 18, C = 2 * Math.PI * r, sh = f.val[1] ? f.val[0] / f.val[1] * 100 : f.v, off = C * (1 - sh / 100);
  const [o, setO] = useState(C);
  useEffect(() => { let a, b; a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setO(off)); }); return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); }; }, [off]);
  return <svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r={r} fill="none" stroke="var(--line)" strokeWidth="5" /><circle cx="23" cy="23" r={r} fill="none" stroke={SCOL[status(f.v)]} strokeWidth="5" strokeLinecap="round" strokeDasharray={C} style={{ strokeDashoffset: o, transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 1s" }} className="kring" /></svg>;
}
export function Compare() {
  const m = cur(), srcAvg = (c, src) => { const a = m.pItems.filter(x => x.c === c && x.src === src); return a.length ? wmean(a) : null; };
  const pctFacts = m.fItems.filter(x => x.kind === "pct"), old = S.cmpCycle >= 0 && m.series[S.cmpCycle];
  const Mk = ({ s }) => <i className={`mk ${s}`} />;
  return <>
    <BackToInst />
    <section className="card c12 rise">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Самооцінка проти фактів</h2><button type="button" className="kt-info" aria-label="Як читати" data-tip={`Точки показують середню оцінку кожної групи, риска це факти. Праворуч різниця «самооцінка мінус факти». Червоним позначено розрив понад ${CAP} пунктів: тоді самооцінку знижують до «факти + ${CAP}».`}><Ic n="info" /></button><div className="sp" /><div className="legend">{MARKS.map(([s, n]) => <span key={s}><Mk s={s} />{n}</span>)}<span><Mk s="f" />Факти</span></div></div>
      {m.components.map((c, i) => {
        const vals = MARKS.map(([s]) => [s, srcAvg(c.id, s)]).filter(([, v]) => v != null), all = [...vals.map(x => x[1]), c.F];
        const lo = Math.min(...all), hi = Math.max(...all), gap = r1(c.P - c.F), open = () => go(`explain/${c.id}`);
        return <div key={c.id} className="db" style={{ cursor: "pointer" }} role="link" tabIndex={0} aria-label={`${COMP[c.id].n}: розклад індексу`} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
          <span className="t"><b>{COMP[c.id].n}</b><br /><span className="lbl">Самооцінка {fb(c.P)} · факти {fb(c.F)}</span></span>
          <div className="track"><div className={`gap ${gap > CAP ? "bad" : ""}`} style={{ left: `${lo}%`, width: `${hi - lo}%`, animationDelay: `${i * 80}ms` }} />
            {vals.map(([s, v], j) => <span key={s} className={`m mk ${s}`} style={{ left: `${v}%`, animationDelay: `${200 + i * 80 + j * 60}ms` }} data-tip={`${SRC[s][0]}: ${fb(v)}`} />)}
            <span className="m mk f" style={{ left: `${c.F}%`, animationDelay: `${400 + i * 80}ms` }} data-tip={`Факти: ${fb(c.F)}`} /></div>
          <b className="tnum" style={{ textAlign: "right", color: gap > CAP ? "color-mix(in srgb, var(--red) 60%, var(--fg))" : "var(--fg)" }} data-tip="Самооцінка мінус факти">{gap > 0 ? "+" : ""}{fb(gap)}</b></div>;
      })}
      <div className="db-axis lbl tnum"><span /><div><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><span /></div>
    </section>
    <section className="card c5 rise cmp-radar">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Профіль компонентів</h2><div className="sp" /><label className="lbl">Цикл {CYCLE} порівняти з <select className="inp" value={S.cmpCycle} onChange={e => { S.cmpCycle = +e.target.value; persist(); render(true); }}><option value="-1">без порівняння</option>{m.series.slice(0, -1).map((r, i) => <option key={i} value={i}>{r.cycle}</option>)}</select></label></div>
      <Radar id="cmpRadar" series={[{ cls: "r-st", v: COMPS.map(c => m.byId[c].cr.v), delay: 300 }, ...(old ? [{ cls: "r-prev", v: COMPS.map(c => old.cr[c]), delay: 0 }] : []), { cls: "r-f", v: COMPS.map(c => m.byId[c].F), delay: 150 }, { cls: "r-p", v: COMPS.map(c => m.byId[c].P), delay: 0 }]} />
      <div className="legend lg-lines" style={{ justifyContent: "center", marginTop: 8 }}><span data-tip="Що думають люди: середнє за анкетами"><i className="ln" style={{ borderColor: "var(--blue)" }} />Самооцінка</span><span data-tip="Що підтверджують документи й облік"><i className="ln dash" style={{ borderColor: "var(--fg)" }} />Факти</span><span data-tip={`Що пішло в індекс: самооцінка, але не більше ніж факти + ${CAP}`}><i className="ar" style={{ background: "color-mix(in srgb,var(--teal) 30%,transparent)", borderColor: "var(--teal)" }} />Зараховано {CYCLE}</span>{old && <span><i className="ln dash" style={{ borderColor: "var(--faint)" }} />Зараховано {old.cycle}</span>}</div>
      <div className="lbl" style={{ textAlign: "center", marginTop: 6 }}>Що далі від центру, то вище значення (0–100).</div>
    </section>
    <section className="card c7 rise cmp-facts">
      <div className="card-h"><h2>Обʼєктивні показники</h2><div className="sp" />{can("sources") && <a className="pill-btn" href="#sources"><Ic n="plug" />Джерела</a>}</div>
      <div className="kpis">{pctFacts.map(f => { const sh = f.val[1] ? f.val[0] / f.val[1] * 100 : f.v, sc = Math.abs(sh - f.v) >= 0.5; return <a key={f.id} className="kpi" href={`#explain/${f.id}`} style={{ textDecoration: "none", color: "inherit" }}><span className="kpi-t">{f.t}</span><div className="ring"><Ring f={f} /><span className="mid tnum" style={{ fontSize: 24 }}><Num v={sh} d={sc ? 1 : 0} /><span className="dec">%</span></span></div><span className="lbl tnum">{f.val[0]} з {f.val[1]}{sc && <><br /><span data-tip={f.rule ? esc(f.rule) : undefined}>Бал методики: <b>{fb(f.v)}</b></span></>}<br />{COMP[f.c].n}{f.per && <><br /><span style={{ whiteSpace: "nowrap" }} data-tip="Факти рахуються лише цілими завершеними кварталами">{f.per}</span></>}</span></a>; })}</div>
    </section>
    <section className="card c12 rise cmp-trust">
      <div className="card-h"><h2>Достовірність</h2><div className="sp" /><TrustPill g={m.trust} /></div>
      <div className="rows">{m.raised.length ? m.raised.map(f => <div key={f.id} className="row click" role="button" tabIndex={0} onClick={openTrust} onKeyDown={enter(openTrust)} style={{ alignItems: "flex-start" }}><span className={`flag-ic ${f.w}`}><Ic n={f.w === "major" ? "alert" : "flag"} /></span><div className="grow" style={{ fontSize: 13.5, lineHeight: 1.5 }} data-tip={String(f.ex || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}><b style={{ fontWeight: 600 }}>{f.t}</b></div></div>) : <div className="lbl">Жоден прапорець не спрацював.</div>}</div>
    </section>
    <section className="card c12 rise">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Питання анкет за групами</h2><div className="sp" /><div className="legend"><span className="lbl">Бал:</span><span><i style={{ background: "var(--teal)" }} />65 і вище</span><span><i style={{ background: "var(--amber)" }} />40–65</span><span><i style={{ background: "var(--red)" }} />нижче 40</span><span className="lbl" style={{ marginLeft: 6 }}>Група:</span>{MARKS.map(([s, n]) => <span key={s}><Mk s={s} />{n}</span>)}</div></div>
      <div className="lbl" style={{ margin: "-4px 0 12px" }}>Середній бал питання від 0 до 100. Під стовпчиком компонент і джерело; наведіть, щоб побачити питання.</div>
      <div className="ibars" style={{ gridTemplateColumns: `repeat(${m.pItems.length},minmax(0,1fr))` }}>{m.pItems.map((x, i) => { const col = SCOL[status(x.v)]; return <a key={x.id} className="ibar" href={`#explain/${x.id}`} style={{ textDecoration: "none", color: "inherit" }} data-tip={`${escT(x.t)}<small>${SRC[x.src][0]} · ${COMP[x.c].n}</small>`}><div className="v tnum">{fb(x.v)}</div><div className="b" style={{ height: Math.max(8, x.v * 1.5), background: col, opacity: 0.45 + x.v / 100 * 0.55, animationDelay: `${i * 50}ms` }} /><div className="n"><Mk s={x.src} /><span className="tnum">{{ culture: "К", system: "С", accountability: "П" }[x.c]}{IB_GRP[x.id.split("-").pop()] || x.id.slice(-1)}</span></div></a>; })}</div>
    </section>
  </>;
}
const escT = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
