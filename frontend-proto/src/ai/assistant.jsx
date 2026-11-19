/* ШІ-асистент: лише пояснення та чернетки. Точні числа беруться з шаблонів правил (fixed: true). */
import { useEffect, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, AI_ROLES, persist, addLog, me } from "../lib/state.js";
import { apiAuth } from "../lib/api.js";
import { COMPS, COMP, LEVELS, TRUST, SRC, ST, PRI, REC_ST, M_ST, CAP, ALPHA, level, status, allItems, buildRecs, measures, dispSt, CYCLE, TODAY } from "../lib/model.js";
import { fb, f1, pts, dsh } from "../lib/format.js";
import { whyText, flagsText, trustText } from "../lib/texts.js";
import { ui, render, toast } from "../lib/store.js";
import { cur } from "../lib/nav.js";
import { copyText } from "../lib/util.js";
import { Pill } from "../components/ui.jsx";

export const AI = { live: null, busy: false, model: "", typing: -1 };
export const modelName = m => (m || "LLM").split("/").pop();
const SUGG = ["Поясни індекс", "Що робити в першу чергу?", "Чому спрацював обмежувач?", "Підготуй чернетку опису результатів для звіту"];
const SUGG_COL = ["var(--teal-soft)", "var(--blue-soft)", "var(--lime-soft)", "var(--amber-soft)"];

function aiCtx() {
  const m = cur();
  return {
    institution: m.name, cycle: CYCLE, asOf: TODAY, index: m.index, previousIndex: m.prevIndex, delta: m.delta,
    level: `${m.level} – ${LEVELS[m.level - 1]}`, trust: `${TRUST[m.trust][0]} – ${TRUST[m.trust][1]}`, summary: m.summary,
    components: m.components.map(c => ({ name: COMP[c.id].n, perception: c.P, facts: c.F, credited: c.cr.v, limitedByFacts: c.cr.lim, rule: c.cr.lim ? c.cr.reason : null })),
    perceptionItems: m.pItems.map(x => ({ name: x.t, component: COMP[x.c].n, source: SRC[x.src][0], weight: x.w, value: x.v })),
    factItems: m.fItems.map(x => ({ name: x.t, component: COMP[x.c].n, data: x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`, weight: x.w, value: x.v })),
    flags: m.raised.map(f => ({ title: f.t, weight: f.w === "major" ? "серйозний" : "незначний", explanation: f.ex })),
    recommendations: m.id === ALPHA ? buildRecs(m).map(r => ({ title: r.t, component: COMP[r.c].n, priority: PRI[r.pri][0], status: REC_ST[r.st][0], why: r.why, basedOn: r.evidence.map(e => `${e.t}: ${e.v}`) })) : [],
    measures: m.id === ALPHA ? measures().map(x => ({ title: x.t, responsible: x.who, due: x.due, status: M_ST[dispSt(x)][0] })) : [],
    anonymityThreshold: S.k, responses: m.responses,
  };
}
export function aiTemplate(q) {
  const s = q.toLowerCase(), m = cur(), recs = m.id === ALPHA ? buildRecs(m) : [];
  const comps = m.components.map(c => `${COMP[c.id].n} ${fb(c.cr.v)}`);
  if (/чому така достовірн|прапор|достовірн/.test(s)) return { t: trustText(m), src: [`Достовірність ${TRUST[m.trust][0]}`, ...m.flags.map(f => `${f.id}: ${f.raised ? "так" : "ні"}`)], fixed: true };
  if (/чому такий індекс/.test(s)) return { t: `${whyText(m, true)}\n\n${flagsText(m)}`, src: ["Методика v1.0", `Індекс ${f1(m.index)}`, `Достовірність ${TRUST[m.trust][0]}`, ...m.raised.map(f => f.id)], fixed: true };
  if (/звіт|чернетк|опис/.test(s)) {
    const sorted = [...m.components].sort((a, b) => b.cr.v - a.cr.v), low = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
    const t = `За результатами циклу ${CYCLE} ${m.name} перебуває на рівні зрілості ${m.level} «${LEVELS[m.level - 1]}»: індекс доброчесності ${f1(m.index)} з 100, ${m.delta == null ? "дані про попередній цикл зараз недоступні" : (m.delta >= 0 ? "на " + pts(m.delta) + " вище" : "на " + pts(m.delta) + " нижче") + ", ніж у попередньому циклі"}.

Найвищий результат має компонент «${COMP[sorted[0].id].n}» (${fb(sorted[0].cr.v)}), найнижчий – «${COMP[sorted[2].id].n}» (${fb(sorted[2].cr.v)}).${m.limited ? ` Для компонента «${COMP[m.limited.id].n}» самооцінку не підтверджують факти: сприйняття ${fb(m.limited.P)} проти фактів ${fb(m.limited.F)}, тому зараховано ${fb(m.limited.cr.v)}.` : ""}

Першочергової уваги потребують: ${low.map(x => `«${x.t}» (${fb(x.v)})`).join(", ")}. Достовірність результату: ${TRUST[m.trust][0]}, ${TRUST[m.trust][1].toLowerCase()}${m.raised.length ? `; прапорці: ${m.raised.map(f => f.t.toLowerCase()).join("; ")}` : ""}.`;
    return { t, draft: true, src: ["Методика v1.0", `Індекс ${f1(m.index)}`, ...low.map(x => `${x.id} ${fb(x.v)}`)] };
  }
  if (/перш|пріоритет|що робити|почати/.test(s)) {
    const open = recs.filter(r => r.st === "proposed" || r.st === "clarified").slice(0, 3);
    const t = open.length ? `Правила системи пропонують ${recs.length} рекомендацій. Без рішення зараз ${open.length}; першими варто розглянути:\n${open.map(r => `• ${r.t} (${COMP[r.c].n}, пріоритет ${PRI[r.pri][0].toLowerCase()}). Підстава: ${r.evidence.map(e => `${e.t.toLowerCase()} – ${e.v}`).join("; ")}.`).join("\n")}\n\nРішення про прийняття, строк і відповідальну посаду ухвалює керівник на екрані «Рекомендації».` : "Усі рекомендації вже мають рішення. Наступні зʼявляться після нового циклу оцінювання.";
    return { t, src: open.map(r => `Правило: ${r.id}`) };
  }
  if (/анонім|аноним|поріг|\bk\b/.test(s)) return { t: `Результати групи показуються лише тоді, коли в ній щонайменше ${S.k} відповідей. Менші групи приховано, а учасник бачить дані рівня вище. Анкети проходять за одноразовими жетонами, не повʼязаними з відповідями; адміністратор бачить лише кількість. Асистент отримує тільки узагальнені показники після цього порогу.`, src: [`k = ${S.k}`, "Одноразові жетони"] };
  if (/обмеж|\+ ?25|методик|ваг|формул|рахує/.test(s)) {
    const l = m.limited;
    return { t: `Індекс – середнє трьох компонентів з однаковою вагою (по 33,3 %). Кожен компонент має сприйняття (анкети РГ, ОС і експертів, зважене середнє питань) і факти (чек-лист і дані обліку).\nПравило обмежувача: зараховано = min(сприйняття; факти + ${CAP}).${l ? `\nЗараз воно спрацювало для «${COMP[l.id].n}»: ${l.cr.reason}` : "\nЗараз обмежувач не спрацював у жодному компоненті."}\nРівень зрілості визначають межі 12,5 / 37,5 / 62,5 / 87,5.`, src: ["Методика v1.0", "Розклад індексу"] };
  }
  const item = allItems(m).find(x => s.includes(x.t.toLowerCase().slice(0, 18)));
  const comp = COMPS.find(c => s.includes(COMP[c].n.toLowerCase().slice(0, 6)));
  if (item) return { t: `«${item.t}»: ${fb(item.v)} зі 100 (${ST[status(item.v)][0].toLowerCase()}). Це ${item.src ? SRC[item.src][0].toLowerCase() : "факт"} з вагою ${item.w} % у компоненті «${COMP[item.c].n}».${item.kind === "pct" ? ` Дані: ${item.val[0]} з ${item.val[1]}.` : item.kind === "lvl" ? ` Рівень ${item.val} з 5 за анкетою чек-листа.` : ""}`, src: [item.id, `${fb(item.v)} зі 100`] };
  if (comp) { const c = m.byId[comp]; return { t: `«${COMP[comp].n}»: зараховано ${fb(c.cr.v)} (рівень зрілості ${level(c.cr.v)}). Сприйняття ${fb(c.P)}, факти ${fb(c.F)}.${c.cr.lim ? " " + c.cr.reason : " Обмежувач не спрацював: сприйняття не перевищує факти більш ніж на 25 пунктів."}`, src: [`${COMP[comp].n} ${fb(c.cr.v)}`, "Методика v1.0"] }; }
  if (/індекс|загал|рівень|стан/.test(s)) return { t: whyText(m), src: ["Методика v1.0", ...comps] };
  return { t: "Можу пояснити індекс, будь-який компонент чи показник, методику й обмежувач, захист анонімності, підказати, з чого почати, або підготувати чернетку опису для звіту. Рішення щодо оцінок і заходів ухвалюють правила системи та посадові особи.", src: [] };
}

function checkLive() {
  if (AI.live !== null) return;
  fetch("/api/assistant").then(r => r.ok ? r.json() : { live: false }).then(j => { AI.live = !!j.live; AI.model = j.model || ""; render(true); }).catch(() => { AI.live = false; render(true); });
}
export async function aiAsk(q) {
  q = (q || "").trim(); if (!q || AI.busy || !S.aiOn) return;
  const history = S.chat.slice(-4).map(m => ({ role: m.r === "u" ? "user" : "assistant", content: m.t }));
  S.chat.push({ r: "u", t: q }); AI.busy = true; render(true);
  const local = aiTemplate(q); let msg = null;
  if (AI.live && !local.fixed) {
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json", ...apiAuth() }, body: JSON.stringify({ question: q, context: aiCtx(), history }) });
      const j = await r.json();
      if (r.ok && j.text) msg = { r: "a", t: dsh(j.text), src: local.src, draft: local.draft || /звіт|чернетк|опис/i.test(q), live: true, model: j.model };
    } catch (e) { /* відповідь із шаблону */ }
  } else await new Promise(res => setTimeout(res, 650));
  if (!msg) msg = { r: "a", ...local, live: false };
  S.chat.push(msg); AI.busy = false; AI.typing = S.chat.length - 1;
  addLog(me(), `Запит до ШІ-асистента (${msg.live ? modelName(msg.model) : "шаблон"}, лише агреговані дані)`);
  render(true);
}
function aiAccept(i) {
  const m = S.chat[i]; m.accepted = true;
  S.notes.push({ t: m.t, who: me(), at: new Date().toISOString().slice(0, 16).replace("T", " ") });
  addLog(me(), "Чернетку ШІ затверджено й додано до звіту"); persist(); toast("Додано до звіту");
  render(true);
}
let focusNext = false;
export function aiOpen(q) {
  if (!AI_ROLES.includes(S.role)) return;
  ui.ai = true; render(true); checkLive();
  if (q) aiAsk(q); else focusNext = true;
}
export function aiClose() { if (!ui.ai) return; ui.ai = false; render(true); }

// Текст останньої відповіді зʼявляється поступово, по кілька слів
function Typed({ t, log }) {
  const words = t.split(/(\s+)/), [n, setN] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches ? words.length : 0);
  useEffect(() => {
    if (n >= words.length) { AI.typing = -1; return; }
    const id = setTimeout(() => setN(n + 3), 28); return () => clearTimeout(id);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; });
  return <>{words.slice(0, n + 3).join("")}</>;
}
function Msg({ m, i, log }) {
  if (m.r === "u") return <div className="m u">{m.t}</div>;
  const canAccept = S.role === "leader" && m.draft;
  return <div className="m a"><div className="m-h"><Pill cls="p-info nodot">Чернетка ШІ</Pill><span className="lbl">{m.live ? modelName(m.model) : "Шаблон правил"}</span></div>
    <div className="m-t" data-i={i}>{AI.typing === i ? <Typed t={m.t} log={log} /> : m.t}</div>
    {m.src && m.src.length > 0 && <div className="src">{m.src.map((x, k) => <span key={k}>{x}</span>)}</div>}
    <div className="m-act"><button type="button" onClick={() => copyText(m.t, () => toast("Скопійовано"))}><Ic n="copy" />Копіювати</button>{canAccept && (m.accepted ? <button type="button" disabled><Ic n="ok" />Додано до звіту</button> : <button type="button" className="ok" onClick={() => aiAccept(i)}><Ic n="ok" />Затвердити у звіт</button>)}</div></div>;
}
export function AiPanel() {
  const on = ui.ai, log = useRef(null), inp = useRef(null), [q, setQ] = useState("");
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; });
  useEffect(() => { if (on && focusNext) { focusNext = false; const t = setTimeout(() => S.aiOn && inp.current && inp.current.focus(), 350); return () => clearTimeout(t); } }, [on]);
  const mode = !S.aiOn ? [<i key="i" style={{ background: "var(--faint)" }} />, "Вимкнено · розрахунки працюють без ШІ"]
    : AI.live ? [<i key="i" style={{ background: "var(--teal)" }} />, `${modelName(AI.model)} · відповіді є лише чернетками`]
    : [<i key="i" style={{ background: "var(--amber)" }} />, "Демо-режим · відповіді з шаблонів правил"];
  return <aside className={`drawer ${on ? "on" : ""}`} id="ai" aria-hidden={!on} aria-label="ШІ-асистент">
    <div className="drawer-h"><span className="logo" id="aiLogo"><Ic n="spark" size={17} /></span><h3>Асистент</h3>
      <label className="sw" title="Увімкнути / вимкнути ШІ"><input type="checkbox" id="aiOn" checked={!!S.aiOn} onChange={e => { S.aiOn = e.target.checked; persist(); addLog(me(), S.aiOn ? "ШІ-асистента увімкнено" : "ШІ-асистента вимкнено"); render(true); if (S.aiOn) checkLive(); }} /><span /></label>
      <button className="icon-btn" id="aiClose" aria-label="Закрити" onClick={aiClose}><Ic n="x" /></button></div>
    <div className="ai-mode" id="aiMode">{mode}</div>
    <div className="ai-log" id="aiLog" aria-live="polite" ref={log}>
      {!S.aiOn ? <div className="ai-off"><Ic n="lock" /><b style={{ color: "var(--fg)" }}>Асистент вимкнено</b><span>Індекс, рекомендації та звіти працюють як і раніше: їх розраховують правила системи.</span></div>
        : !S.chat.length ? <div className="ai-hello"><div className="ai-orb"><Ic n="spark" /></div><b style={{ fontSize: 17 }}>Поясню результати й підготую чернетки</b><span className="lbl">Рішення ухвалюють правила та посадові особи</span>
          <div className="chips">{SUGG.map((s, i) => <button key={s} type="button" className="chip-q" style={{ background: SUGG_COL[i], animationDelay: `${150 + i * 70}ms` }} onClick={() => aiAsk(s)}>{s}</button>)}</div></div>
        : <>{S.chat.map((m, i) => <Msg key={i} m={m} i={i} log={log} />)}{AI.busy && <div className="typing"><span /><span /><span /></div>}</>}
    </div>
    <form className="ai-in" id="aiForm" onSubmit={e => { e.preventDefault(); const v = q; setQ(""); aiAsk(v); }}><input id="aiQ" placeholder="Запитайте про результати" autoComplete="off" maxLength={1000} ref={inp} disabled={!S.aiOn} value={q} onChange={e => setQ(e.target.value)} /><button className="icon-btn send" aria-label="Надіслати" id="aiSend" disabled={!S.aiOn}><Ic n="send" /></button></form>
  </aside>;
}
