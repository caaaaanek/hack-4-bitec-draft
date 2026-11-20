/* «Навчання»: флешкартки доброчесності (колоди, вивчення стосом карток з перегортанням) і охоплення навчанням.
 * Зміст карток лише з сервера (GET /learning/decks/{code}) або з демо-копії flashcards.json. */
import { useEffect, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiDecks, apiDeck, apiDeckDone, apiLearnStats, apiFail } from "../lib/api.js";
import { S } from "../lib/state.js";
import { COMP } from "../lib/model.js";
import { route, go } from "../lib/nav.js";
import { render } from "../lib/store.js";
import { fb, ua, dsh } from "../lib/format.js";
import { Pill, Ticks } from "../components/ui.jsx";
import { Loading, Failed, NeedServer } from "../components/states.jsx";
import { KpiRow, ModHead, ToneIc, More } from "../components/modkit.jsx";
import { DEMO_LEARN } from "../lib/flashcards-demo.js";

const STAT_ROLES = ["admin", "leader", "auditor", "observer"]; // статистику навчання бачать RESULT_READERS
const demoDone = {}; // демо-режим: пройдені колоди живуть до перезавантаження сторінки
const today = () => new Date().toISOString().slice(0, 10);
const TONE = { culture: "teal", system: "blue", accountability: "amber" };

// Де людина зупинилась у колоді: лише в її браузері, сервер бачить тільки факт проходження
const pKey = code => `ii-learn:${API.user ? API.user.login : "demo"}:${code}`;
export function getProg(code) { try { const v = JSON.parse(localStorage.getItem(pKey(code))); return v && Array.isArray(v.seen) ? v : { i: 0, seen: [] }; } catch (e) { return { i: 0, seen: [] }; } }
const setProg = (code, v) => { try { localStorage.setItem(pKey(code), JSON.stringify(v)); } catch (e) { /* сховище недоступне */ } };
const clearProg = code => { try { localStorage.removeItem(pKey(code)); } catch (e) { /* сховище недоступне */ } };

function useDecks() {
  if (!API.on) {
    const decks = DEMO_LEARN.decks.map(d => ({ code: d.code, title: d.title, description: d.description, component: d.component, cards: d.cards.length, required: d.required, my_completed_on: demoDone[d.code] || null, my_valid: !!demoDone[d.code] }));
    return { data: { decks, required: DEMO_LEARN.required, valid_days: DEMO_LEARN.valid_days, i_am_trained: DEMO_LEARN.required.every(c => demoDone[c]) } };
  }
  return apiMod("decks", apiDecks);
}
// Охоплення: демо показує число з docs/features.md, з сервером агрегат з порогом k
const DEMO_STATS = { demo: true, eligible: 972, trained: 717, percent: 73.8, suppressed: false, by_deck: {}, required: DEMO_LEARN.required, valid_days: DEMO_LEARN.valid_days };
const useStats = () => !STAT_ROLES.includes(S.role) ? null : API.on ? apiMod("lstats", apiLearnStats) : { data: DEMO_STATS };

// Стан колоди для людини: пройдено, у процесі (є переглянуті картки), не розпочато
function deckState(k) {
  if (k.my_valid) return { t: "Пройдено", cls: "p-good", on: k.cards, btn: "Повторити" };
  const seen = getProg(k.code).seen.length;
  if (seen) return { t: "У процесі", cls: "p-warn", on: Math.min(seen, k.cards), btn: "Продовжити" };
  return { t: k.my_completed_on ? "Строк минув" : "Не розпочато", cls: k.my_completed_on ? "p-warn" : "p-mute", on: 0, btn: "Почати" };
}

function Coverage() {
  const st = useStats(); if (!st) return null;
  if (st.error) return <Failed e={st.error} onRetry={() => apiModReset("lstats")} />;
  const d = st.data;
  return <section className="card c12 rise"><ModHead ic="users" tone="teal" title="Охоплення навчанням">{d && d.demo ? <Pill cls="p-mute nodot">Приклад з демо-даних</Pill> : null}</ModHead>
    {!d ? <div className="lbl" role="status">Завантажуємо…</div>
      : d.suppressed ? <div className="lock"><Ic n="lock" /><div><b>Показник приховано</b><div className="lbl">У підрозділі менше {S.k} учасників. Так ми не показуємо, хто саме пройшов навчання.</div></div></div>
      : <><div className="cov-line tnum"><b>{fb(d.percent)} %</b><span className="lbl">пройшли навчання: {d.trained} з {d.eligible} учасників</span></div>
        <Ticks n={30} on={Math.round((d.percent || 0) / 100 * 30)} color="var(--teal)" h={12} />
        {Object.keys(d.by_deck).length > 0 && <More t="За колодами"><div className="rows">{d.required.map(c => <div key={c} className="row"><div className="grow txt">{deckTitle(c)}</div><b className="tnum">{d.by_deck[c] == null ? "…" : d.by_deck[c]}</b></div>)}</div></More>}</>}
  </section>;
}
const deckTitle = c => { const r = useDecks(), k = r && r.data && r.data.decks.find(x => x.code === c); return k ? dsh(k.title) : c; };

function DeckList() {
  const r = useDecks(), st = useStats();
  if (!r) return <Loading t="Навчання" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("decks")} />;
  const d = r.data, done = d.decks.filter(k => k.my_valid).length, reqDone = d.required.filter(c => (d.decks.find(k => k.code === c) || {}).my_valid).length, cov = st && st.data;
  return <>
    <section className="card c12 rise"><ModHead ic="book" tone="teal" title="Колоди"><Pill cls={d.i_am_trained ? "p-good" : "p-warn"}>{d.i_am_trained ? "Обовʼязкові пройдено" : "Обовʼязкові не пройдено"}</Pill></ModHead>
      <div className="lbl tnum" style={{ marginBottom: 14 }}>Пройдено {done} з {d.decks.length}, обовʼязкових {reqDone} з {d.required.length}. Ваш прогрес бачите лише ви.{!API.on ? " Демо: прогрес живе до перезавантаження сторінки." : ""}</div>
      <div className="deck-grid">{d.decks.map(k => { const s = deckState(k), C = COMP[k.component]; return <article key={k.code} className="deck">
        <div className="deck-h"><ToneIc ic={C ? C.ic : "book"} tone={TONE[k.component] || "teal"} /><div className="grow"><b className="txt">{dsh(k.title)}</b><div className="lbl">{k.cards} карток{k.required ? ", обовʼязкова" : ""}</div></div></div>
        <div className="lbl txt deck-d">{dsh(k.description)}</div>
        <div className="deck-bar" role="progressbar" aria-label={`Переглянуто ${s.on} з ${k.cards}`} aria-valuemin={0} aria-valuemax={k.cards} aria-valuenow={s.on}><i style={{ width: `${s.on / k.cards * 100}%` }} /></div>
        <div className="deck-f"><Pill cls={s.cls}>{s.t}{k.my_completed_on && k.my_valid ? ` ${ua(k.my_completed_on)}` : ""}</Pill><button type="button" className={`btn ${s.btn === "Повторити" ? "btn-soft" : "btn-primary"}`} onClick={() => go("learn/" + k.code)}>{s.btn}<Ic n="arrowR" /></button></div>
      </article>; })}</div></section>
    <Coverage />
  </>;
}

function Study({ code }) {
  const key = "deck:" + code, init = getProg(code), cardRef = useRef(null);
  const [i, setI] = useState(init.i || 0), [flip, setFlip] = useState(false), [seen, setSeen] = useState(() => Object.fromEntries(init.seen.map(x => [x, true]))), [busy, setBusy] = useState(false), [fin, setFin] = useState(false);
  // turning: лічильник поворотів, 0 = картка в спокої. Поки картка обертається, прокрутку в гранях вимкнено (.turning)
  const [turning, setTurning] = useState(0);
  useEffect(() => { if (!turning) return; const t = setTimeout(() => setTurning(0), 700); return () => clearTimeout(t); }, [turning]); // запасне зняття класу
  const r = API.on ? apiMod(key, () => apiDeck(code)) : { data: DEMO_LEARN.decks.find(x => x.code === code) };
  const cards = r && r.data ? r.data.cards : [], n = cards.length, idx = Math.min(i, Math.max(0, n - 1)), c = cards[idx], last = idx === n - 1, all = n > 0 && cards.every(x => seen[x.id]);
  useEffect(() => { if (Object.keys(seen).length) setProg(code, { i: idx, seen: Object.keys(seen) }); }, [idx, seen, code]);
  const turn = () => { if (!c) return; setFlip(f => !f); setSeen(s => ({ ...s, [c.id]: true })); if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setTurning(t => t + 1); };
  const step = d => { const j = Math.max(0, Math.min(n - 1, idx + d)); if (j === idx) return; setI(j); setFlip(false); setTurning(0); };
  useEffect(() => {
    const key = e => {
      if (fin || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") { e.preventDefault(); turn(); } else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  });
  if (!r) return <Loading t="Колода" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset(key)} />;
  if (!r.data || !n) return <NeedServer t="Колоду не знайдено"><a className="link" href="#learn">До колод</a></NeedServer>;
  const title = dsh(r.data.title), tag = "#" + title;
  const finish = async () => {
    setBusy(true);
    try {
      if (API.on) { await apiDeckDone(code, cards.map(x => x.id)); apiModReset("decks", "lstats"); } else demoDone[code] = today();
      clearProg(code); setFin(true);
    } catch (e) { apiFail(e); } finally { setBusy(false); render(true); }
  };
  if (fin) return <div className="c12 fc-col rise"><section className="card fc-done" role="status">
    <span className="fc-ok"><Ic n="ok" size={28} /></span><h2>Колоду зараховано</h2><div className="lbl">«{title}»: переглянуто всі {n} карток. Відповіді не зберігаються, лише факт проходження.</div>
    <a className="btn btn-primary" href="#learn" autoFocus><Ic n="arrowL" />До колод</a></section></div>;
  const steps = c.steps.slice(0, 3).map(dsh), said = flip ? `Картка ${idx + 1} з ${n}. Що робити: ${steps.map((t, k) => `${k + 1}. ${t}`).join(" ")}` : `Картка ${idx + 1} з ${n}, ситуація: ${dsh(c.situation)}`;
  return <div className="c12 fc-col">
    <div className="fc-top rise"><a className="btn btn-ghost" href="#learn"><Ic n="arrowL" />Усі колоди</a><b className="txt">{title}</b></div>
    <div className="sr-only" aria-live="polite">{said}</div>
    <div className="fc-stack">
      <span className="fc-layer l2" aria-hidden="true" /><span className="fc-layer l1" aria-hidden="true" />
      <div ref={cardRef} className={`fc3 ${flip ? "flipped" : ""} ${turning ? "turning" : ""}`} tabIndex={0} role="group" aria-roledescription="картка" aria-label={`Картка ${idx + 1} з ${n}`}
        onClick={e => { if (!e.target.closest("button")) turn(); }} onKeyDown={e => { if (e.key === "Enter" && e.target === cardRef.current) { e.preventDefault(); turn(); } }}>
        {/* key: нова картка монтується одразу лицем, без зворотного повороту від попередньої */}
        <div key={idx} className="fc-in" onTransitionEnd={e => { if (e.target === e.currentTarget && e.propertyName === "transform") setTurning(0); }}>
          <div className="fc-face front" aria-hidden={flip}>
            <div className="fc-head"><span>Ситуація</span><span className="tnum">{idx + 1} з {n}</span></div>
            <button type="button" className="fc-flip" onClick={turn} tabIndex={flip ? -1 : 0}><Ic n="reset" />Перегорнути</button>
            <div className="fc-body"><p className="fc-q">{dsh(c.situation)}</p></div>
            <span className="fc-tag">{tag}</span>
          </div>
          <div className="fc-face back" aria-hidden={!flip}>
            <div className="fc-head"><span>Що робити</span><span className="tnum">{idx + 1} з {n}</span></div>
            <button type="button" className="fc-flip" onClick={turn} tabIndex={flip ? 0 : -1}><Ic n="reset" />Перегорнути</button>
            <div className="fc-body"><ol className="fc-steps">{steps.map((t, k) => <li key={k}>{t}</li>)}</ol></div>
            <span className="fc-tag">{tag}</span>
          </div>
        </div>
      </div>
    </div>
    <div className="fc-nav rise">
      <button type="button" className="btn btn-ghost" onClick={() => step(-1)} disabled={idx === 0}><Ic n="arrowL" />Назад</button>
      <div className="fc-dots" aria-hidden="true">{cards.map((x, k) => <i key={x.id} className={`${k === idx ? "on" : ""} ${seen[x.id] ? "seen" : ""}`} />)}</div>
      {last ? <button type="button" className="btn btn-primary" onClick={finish} disabled={!all || busy}>Зарахувати колоду</button>
        : <button type="button" className="btn btn-ghost" onClick={() => step(1)}>Далі<Ic n="arrowR" /></button>}
    </div>
    {last && !all && <div className="lbl fc-hint" role="note">Щоб зарахувати колоду, переверніть усі картки: переглянуто {Object.keys(seen).length} з {n}.</div>}
    {flip && <div className="fc-more"><More t="Чому так і закон"><div className="note-box"><b>Чому так</b><span className="txt">{dsh(c.why)}</span></div><div className="lbl txt">Закон: {dsh(c.law)}</div></More></div>}
    <div className="lbl fc-hint">Пробіл перегортає картку, стрілки ліворуч і праворуч перемикають.</div>
  </div>;
}

/* Картка «Навчання» в «Мої результати»: поточна колода, прогрес, «Продовжити» */
export function LearnCard() {
  const r = useDecks();
  if (!r) return <section className="card c12 rise" role="status"><div className="lbl">Завантажуємо навчання…</div></section>;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("decks")} />;
  const d = r.data, done = d.decks.filter(k => k.my_valid).length, reqDone = d.required.filter(c => (d.decks.find(k => k.code === c) || {}).my_valid).length, next = d.decks.find(k => k.required && !k.my_valid) || d.decks.find(k => !k.my_valid), s = next ? deckState(next) : null;
  return <section className="card c12 rise"><ModHead ic="book" tone="teal" title="Навчання"><Pill cls={d.i_am_trained ? "p-good" : "p-warn"}>{d.i_am_trained ? "Обовʼязкові пройдено" : "Обовʼязкові не пройдено"}</Pill></ModHead>
    <div className="lbl">Обовʼязкових пройдено: {reqDone} з {d.required.length} · усього колод: {done} з {d.decks.length}</div>
    <div className="deck-bar" style={{ marginTop: 8 }} role="progressbar" aria-label={`Пройдено колод ${done} з ${d.decks.length}`} aria-valuemin={0} aria-valuemax={d.decks.length} aria-valuenow={done}><i style={{ width: `${done / d.decks.length * 100}%` }} /></div>
    {next ? <div className="chk-row" style={{ marginTop: 12, flexWrap: "wrap" }}><div className="grow" style={{ minWidth: 200 }}><b className="txt">{dsh(next.title)}</b><div className="lbl">{s.on ? `Переглянуто ${s.on} з ${next.cards}` : `${next.cards} карток${next.required ? ", обовʼязкова" : ""}`}</div></div>
      <button type="button" className="btn btn-primary" onClick={() => go("learn/" + next.code)}><Ic n="book" />{s.btn}</button></div>
      : <div className="chk-row" style={{ marginTop: 12 }}><span className="lbl grow">Усі колоди пройдено.</span><a className="btn btn-soft" href="#learn">До колод</a></div>}
  </section>;
}

export function Learn() { const { p } = route(); return p ? <Study key={p} code={p} /> : <DeckList />; }
