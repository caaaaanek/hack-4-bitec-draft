/* «Що, якщо»: прогноз індексу, якщо підтягнути факти, закрити пункти чек-листа або виконати заходи.
 * З бекендом рахує сервер (POST /campaigns/{id}/what-if, та сама scoring.compute, нічого не записується).
 * У демо рахує та сама модель, що й «Огляд»: зараховано = min(P, F + 25), індекс = середнє трьох компонентів.
 * Опитування не моделюються: сприйняття лишається як є. */
import { useEffect } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, api, apiErrText } from "../lib/api.js";
import { COMP, CAP, LSHORT, level, indexLevel, r1, indexOf, components, measures, dispSt, M_ST } from "../lib/model.js";
import { fb, f1, pts } from "../lib/format.js";
import { render } from "../lib/store.js";
import { cur } from "../lib/nav.js";
import { BackToInst } from "./results.jsx";

const CK = { full: "Повністю", partial: "Частково", none: "Не впроваджено" };
// Сценарій живе між перемальовуваннями екрана; скидається при зміні закладу чи хвилі
const WI = { key: "", facts: {}, checklist: {}, measures: [], res: null, levers: null, err: null, busy: false, seq: 0, timer: 0, showAll: false };
const scopeKey = () => API.on ? `${API.campaignId}:${API.unitId}` : cur().id;
const empty = () => !Object.keys(WI.facts).length && !Object.keys(WI.checklist).length && !WI.measures.length;
function resetScenario() { WI.facts = {}; WI.checklist = {}; WI.measures = []; WI.err = null; }

/* --- Сервер --- */
function serverRun(now) {
  clearTimeout(WI.timer);
  WI.timer = setTimeout(async () => {
    const seq = ++WI.seq; WI.busy = true; render(true);
    try {
      const r = await api(`/campaigns/${API.campaignId}/what-if`, { method: "POST", body: { unit_id: API.unitId || null, measure_ids: WI.measures, checklist: WI.checklist, facts: WI.facts, levers: !WI.levers } });
      if (seq !== WI.seq) return;
      WI.res = r; WI.err = null; if (!WI.levers) WI.levers = r.levers || [];
    } catch (e) {
      if (seq !== WI.seq) return;
      WI.err = apiErrText(e);
    } finally { if (seq === WI.seq) { WI.busy = false; render(true); } }
  }, now ? 0 : 350);
}

/* --- Демо: та сама модель, що й на «Огляді» --- */
function demoCalc(m, sc) {
  const fItems = m.fItems.map(f => sc.facts[f.id] == null ? f : { ...f, v: f.kind === "pct" ? sc.facts[f.id] : (sc.facts[f.id] - 1) * 25 });
  const comps = components(m.pItems, fItems), idx = indexOf(Object.fromEntries(comps.map(c => [c.id, c.cr.v])));
  return { index: idx, comps };
}
function demoResult(m) {
  const base = demoCalc(m, { facts: {} }), scen = demoCalc(m, WI);
  const touched = new Set(m.fItems.filter(f => WI.facts[f.id] != null).map(f => f.c));
  const side = (r) => { const l = indexLevel(r.index, r.comps.map(c => c.cr.v)); return { index: { score: r.index, level: { level: l, title: LSHORT[l - 1] } },
    components: r.comps.map(c => ({ code: c.id, title: COMP[c.id].n, score: c.cr.v, self_score: c.P, facts_score: c.F, cut_by_facts: c.cr.lim })) }; };
  const b = side(base), s = side(scen);
  s.components.forEach((c, i) => {
    const o = b.components[i], d = r1(c.score - o.score);
    c.explanation = !touched.has(c.code) ? "У сценарії не змінювали."
      : d ? `${c.cut_by_facts ? `Зараховано факти + ${CAP}: ${fb(c.facts_score)} + ${CAP}.` : `Самооцінка ${fb(c.self_score)} узгоджується з фактами ${fb(c.facts_score)}.`}`
      : c.cut_by_facts ? `${c.title} не зросла: стелю задають факти ${fb(c.facts_score)} + ${CAP} = ${fb(c.facts_score + CAP)}.`
      : `${c.title}: зміни на бал не вплинули. Зараховано самооцінку ${fb(c.self_score)}: факти її вже не обмежують.`;
  });
  // Важелі: кожен факт — на крок вище (частка до 100 %, рівень +1)
  const levers = m.fItems.filter(f => f.kind === "pct" ? f.v < 99.5 : f.val < 5).map(f => {
    const target = f.kind === "pct" ? 100 : f.val + 1, r = demoCalc(m, { facts: { [f.id]: target } });
    return { kind: "fact", indicator: f.id, title: f.t, component: f.c, change: f.kind === "pct" ? `${fb(f.v)}% → 100%` : `рівень ${f.val} → ${target}`, scenario: { facts: { [f.id]: target } }, index: r.index, delta_index: r1(r.index - base.index) };
  }).filter(x => x.delta_index >= 0.05).sort((a, b) => b.delta_index - a.delta_index).slice(0, 5);
  const applied = m.fItems.filter(f => WI.facts[f.id] != null).map(f => ({ kind: "fact", title: f.t, effect: true,
    note: f.kind === "pct" ? `${fb(f.v)}% → ${fb(WI.facts[f.id])}%: бал ${fb(f.v)} → ${fb(WI.facts[f.id])}.` : `рівень ${f.val} → ${WI.facts[f.id]}: бал ${fb(f.v)} → ${fb((WI.facts[f.id] - 1) * 25)}.` }));
  return { at_root: true, baseline: b, scenario: s, delta: { index: r1(scen.index - base.index) }, applied, levers,
    options: { facts: m.fItems.map(f => ({ indicator: f.id, title: f.t, component: f.c, kind: f.kind, percent: f.kind === "pct" ? f.v : null, level: f.kind === "lvl" ? f.val : null, editable: true })), checklist: [] },
    disclaimer: "Прогноз, не результат. Відповіді працівників, робочої групи й експертів не моделюються: змінюються лише факти. Справжній індекс покаже наступний цикл." };
}

/* --- Зміни сценарію --- */
const change = fn => { fn(); if (API.on) { serverRun(); render(true); } else render(true); };
const setFact = (id, v) => change(() => { WI.facts = { ...WI.facts, [id]: v }; });
const dropFact = id => change(() => { const f = { ...WI.facts }; delete f[id]; WI.facts = f; });
const setCk = (n, v) => change(() => { const c = { ...WI.checklist }; if (v) c[n] = v; else delete c[n]; WI.checklist = c; });
const toggleMs = id => change(() => { WI.measures = WI.measures.includes(id) ? WI.measures.filter(x => x !== id) : [...WI.measures, id]; });
const addLever = l => change(() => { WI.facts = { ...WI.facts, ...(l.scenario.facts || {}) }; WI.checklist = { ...WI.checklist, ...(l.scenario.checklist || {}) }; });
const leverOn = l => Object.entries(l.scenario.facts || {}).every(([k, v]) => WI.facts[k] === v) && Object.entries(l.scenario.checklist || {}).every(([k, v]) => WI.checklist[k] === v);

export function WhatIf() {
  const m = cur(), key = scopeKey();
  if (WI.key !== key) { WI.key = key; resetScenario(); WI.res = null; WI.levers = null; WI.seq++; WI.busy = false; }
  useEffect(() => { if (API.on && !WI.res && !WI.busy && !WI.err) serverRun(true); });

  if (API.on && !WI.res) return <><BackToInst /><section className="card c12 rise"><div className="empty">{WI.err ? <><b>Не вдалося порахувати сценарій</b><br />{WI.err}<br /><br /><button className="btn btn-soft" onClick={() => { WI.err = null; serverRun(true); }}>Спробувати ще раз</button></> : <><b>Що, якщо</b><br />Рахуємо прогноз…</>}</div></section></>;

  const res = API.on ? WI.res : demoResult(m);
  const levers = API.on ? WI.levers || [] : res.levers;
  const b = res.baseline, s = res.scenario, d = res.delta.index ?? 0;
  const facts = res.options.facts || [], ck = res.options.checklist || [];
  const ms = API.on ? measures().filter(x => !["done", "confirmed", "cancelled"].includes(x.st)) : [];
  const ckOpen = ck.filter(i => !(i.score === 100 && i.confirmed) || WI.checklist[i.number]);
  const ckShown = WI.showAll ? ckOpen : ckOpen.slice(0, 8);
  // Рівень готовий у відповіді (сервер: зі слабкою ланкою); клієнтський level() лише запасний
  const lvOf = x => (x.index.level && x.index.level.level) || level(x.index.score), lB = lvOf(b), lS = lvOf(s);

  return <>
    <BackToInst />
    <section className="card c12 rise wi-head">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Прогноз індексу</h2>
        <button type="button" className="kt-info" aria-label="Як рахується" data-tip={`Та сама методика, що й для справжнього індексу: зараховано в індекс = min(самооцінка; факти + ${CAP}), індекс = середнє трьох компонентів. Відповіді анкет не змінюються.`}><Ic n="info" /></button>
        <div className="sp" />{WI.busy && <span className="lbl wi-busy">Рахуємо…</span>}
        {!empty() && <button type="button" className="btn btn-ghost" onClick={() => change(resetScenario)}><Ic n="reset" />Скинути сценарій</button>}</div>
      <div className="wi-sum">
        <div className="wi-idx"><span className="lbl">Зараз</span><b className="tnum">{f1(b.index.score)}</b><span className="lbl">рівень {lB}, {LSHORT[lB - 1]}</span></div>
        <Ic n="send" />
        <div className={`wi-idx ${d > 0 ? "up" : d < 0 ? "down" : ""}`}><span className="lbl">За сценарієм</span><b className="tnum">{f1(s.index.score)}</b><span className="lbl">рівень {lS}, {LSHORT[lS - 1]}{lS !== lB ? " · новий рівень" : ""}</span></div>
        <div className={`wi-d ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{d > 0 ? "+" : d < 0 ? "−" : ""}{d ? pts(d) : "Без змін"}</div>
      </div>
      <div className="wi-comps">{s.components.map((c, i) => { const o = b.components[i], cd = r1(c.score - o.score); return <div key={c.code} className="wi-comp">
        <span className="comp-ic" style={{ background: COMP[c.code].s, color: COMP[c.code].c }}><Ic n={COMP[c.code].ic} /></span>
        <div className="grow"><b>{c.title}</b> <span className="tnum">{fb(o.score)} → <b>{fb(c.score)}</b></span>{cd ? <span className={`wi-cd ${cd > 0 ? "up" : "down"}`}>{cd > 0 ? "+" : "−"}{fb(Math.abs(cd))}</span> : null}
          <div className="lbl">{c.explanation}</div></div></div>; })}</div>
      <div className="wi-note lbl"><Ic n="info" />{res.disclaimer}</div>
    </section>

    {levers.length > 0 && <section className="card c12 rise">
      <div className="card-h"><h2>Що зрушить індекс найбільше</h2><div className="sp" /><span className="lbl wi-hide-s">кожен крок окремо, від поточного стану</span></div>
      <div className="rows">{levers.map((l, i) => { const on = leverOn(l); return <div key={i} className="row wi-lever">
        <span className="wi-plus tnum">+{fb(l.delta_index)}</span>
        <div className="grow"><b className="wi-clamp" style={{ fontWeight: 600 }}>{l.title}</b><div className="lbl">{COMP[l.component] ? COMP[l.component].n + " · " : ""}{l.change}{l.measure && l.measure.title ? ` · захід Додатку Д: ${l.measure.title}` : ""}</div></div>
        <button type="button" className={`btn ${on ? "btn-ghost" : "btn-soft"}`} disabled={on} onClick={() => addLever(l)}>{on ? <><Ic n="ok" />У сценарії</> : <><Ic n="plus" />Додати</>}</button></div>; })}</div>
    </section>}

    {/* Ліворуч факти й заходи, праворуч довгий чек-лист: колонки однієї висоти без порожнечі */}
    <div className={`${API.on && (ck.length > 0 || res.options.checklist_note) ? "c7" : "c12"} wi-side`}>
      <section className="card rise">
      <div className="card-h"><h2>Факти</h2><div className="sp" /><span className="lbl">потягніть, щоб задати ціль</span></div>
      <div className="wi-facts">{facts.map(f => <FactRow key={f.indicator} f={f} />)}</div>
    </section>
      {ms.length > 0 && <section className="card rise">
        <div className="card-h"><h2>Заходи</h2><div className="sp" /><span className="lbl">якщо виконати</span></div>
        <div className="rows">{ms.map(x => { const a = (res.applied || []).find(z => z.kind === "measure" && z.id === x.id); return <label key={x.id} className="row wi-ms">
          <input type="checkbox" checked={WI.measures.includes(x.id)} onChange={() => toggleMs(x.id)} />
          <div className="grow"><span>{x.t}</span><div className="lbl">{M_ST[dispSt(x)][0]}{a ? ` · ${a.note}` : ""}</div></div></label>; })}</div>
      </section>}
    </div>
    {API.on && (ck.length > 0 || res.options.checklist_note) && <div className="c5 wi-side">
      {(ck.length > 0 || res.options.checklist_note) && <section className="card rise">
        <div className="card-h"><h2>Чек-лист</h2><div className="sp" /><span className="lbl">{ck.length - ckOpen.length} з {ck.length} уже закрито</span></div>
        {res.options.checklist_note ? <div className="lbl">{res.options.checklist_note}</div> : <div className="rows">{ckShown.map(i => <div key={i.number} className="row wi-ck">
          <div className="grow"><span className="wi-clamp" data-tip={i.text.length > 140 ? i.text.replace(/&/g, "&amp;").replace(/</g, "&lt;") : undefined}>{i.text}</span><div className="lbl">{COMP[i.component] ? COMP[i.component].n + " · " : ""}зараз: {CK[i.status] || "не заповнено"}{i.confirmed ? "" : ", не підтверджено"}</div></div>
          <select className="inp" value={WI.checklist[i.number] || ""} onChange={e => setCk(i.number, e.target.value)} aria-label={`Пункт ${i.number} у сценарії`}>
            <option value="">Як є</option>{Object.entries(CK).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>)}
          {ckOpen.length > 8 && <button type="button" className="pill-btn" onClick={() => { WI.showAll = !WI.showAll; render(true); }}>{WI.showAll ? "Згорнути" : `Показати всі ${ckOpen.length}`}</button>}</div>}
      </section>}
    </div>}

    {(res.applied || []).length > 0 && <section className="card c12 rise">
      <div className="card-h"><h2>Що враховано в сценарії</h2></div>
      <div className="rows">{res.applied.map((a, i) => <div key={i} className="row" style={{ alignItems: "flex-start" }}>
        <span className={`wi-dot ${a.effect ? "on" : ""}`}><Ic n={a.effect ? "ok" : "flat"} /></span>
        <div className="grow" style={{ fontSize: 13 }}><b style={{ fontWeight: 600 }}>{a.title || (a.number ? `Пункт ${a.number}` : "")}</b><div className="lbl">{a.note}</div></div></div>)}</div>
    </section>}
  </>;
}

function FactRow({ f }) {
  const lvl = f.kind === "lvl", set = WI.facts[f.indicator], val = set ?? (lvl ? f.level : f.percent);
  const th = f.thresholds || [];
  const comp = COMP[f.component];
  if (!f.editable || val == null) return <div className="wi-fact off"><div className="wi-ft"><b>{f.title}</b><span className="lbl">{comp ? comp.n + " · " : ""}{f.status === "suppressed" || f.status === "hidden" ? "приховано (замала група), змінювати не можна" : "немає даних"}</span></div></div>;
  return <div className={`wi-fact${set != null ? " set" : ""}`}>
    <div className="wi-ft"><b>{f.title}</b><span className="lbl">{comp ? comp.n + " · " : ""}зараз {lvl ? `рівень ${f.level}` : `${fb(f.percent)}%`}{!lvl && f.level ? `, рівень ${f.level}` : ""}</span></div>
    <div className="wi-ctl">
      {lvl ? <select className="inp" value={val} onChange={e => +e.target.value === f.level ? dropFact(f.indicator) : setFact(f.indicator, +e.target.value)} aria-label={`${f.title}: рівень`}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Рівень {n}</option>)}</select>
        : <div className="wi-range">
          <input type="range" min={0} max={100} step={1} value={Math.round(val)} onChange={e => setFact(f.indicator, +e.target.value)} aria-label={`${f.title}: ціль, %`} />
          {th.map(t => <i key={t} className="wi-th" style={{ left: `${t}%` }} data-tip={`Поріг ${t}%: наступний рівень`} />)}
          <span className="wi-cur" style={{ left: `${f.percent}%` }} data-tip={`Зараз ${fb(f.percent)}%`} />
        </div>}
      <b className="tnum wi-v">{lvl ? "" : `${fb(val)}%`}</b>
      {set != null && <button type="button" className="icon-btn" onClick={() => dropFact(f.indicator)} aria-label="Повернути як є" data-tip="Повернути як є"><Ic n="x" /></button>}
    </div>
  </div>;
}
