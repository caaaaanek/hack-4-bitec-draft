/* «Навчання»: флешкартки доброчесності (колоди, режим вивчення) і охоплення навчанням. */
import { useEffect, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, apiMod, apiModReset, apiDecks, apiDeck, apiDeckDone, apiLearnStats, apiFail } from "../lib/api.js";
import { S } from "../lib/state.js";
import { route, go } from "../lib/nav.js";
import { render, toast } from "../lib/store.js";
import { fb, ua, dsh } from "../lib/format.js";
import { Pill, Num, Ticks } from "../components/ui.jsx";
import { Loading, Failed, NeedServer } from "../components/states.jsx";
import { ModHead } from "../components/modkit.jsx";
import { DEMO_LEARN } from "../lib/flashcards-demo.js";

const STAT_ROLES = ["admin", "coordinator", "commissioner", "leader", "auditor", "observer"];
const demoDone = {}; // демо-режим: пройдені колоди живуть до перезавантаження сторінки
const today = () => new Date().toISOString().slice(0, 10);
const COMP_N = { culture: "Культура", system: "Система", accountability: "Підзвітність" };
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

function Coverage() {
  if (!STAT_ROLES.includes(S.role)) return null;
  if (!API.on) return <section className="card c12 rise"><div className="card-h"><h2>Охоплення навчанням</h2><Pill cls="p-mute nodot">Приклад з демо-даних</Pill></div>
    <div className="big tnum"><Num v={73.8} /><span className="of">%</span></div><div className="lbl">717 з 972 учасників підрозділу пройшли всі обовʼязкові колоди за останній рік. Число з docs/features.md: його рахує сервер за історією проходження.</div></section>;
  const st = apiMod("lstats", apiLearnStats);
  if (!st) return <section className="card c12 rise" role="status"><div className="lbl">Завантажуємо охоплення навчанням…</div></section>;
  if (st.error) return <Failed e={st.error} onRetry={() => apiModReset("lstats")} />;
  const d = st.data;
  return <section className="card c12 rise"><div className="card-h"><h2>Охоплення навчанням</h2><div className="sp" /><span className="lbl">Лише узагальнені дані, без імен</span></div>
    {d.suppressed ? <div className="lock"><Ic n="lock" /><div><b>Показник приховано</b><div className="lbl">У підрозділі менше {S.k} учасників. Так ми не показуємо, хто саме пройшов навчання.</div></div></div>
      : <><div className="stat4 tnum" style={{ gridTemplateColumns: "repeat(3,1fr)" }}><div><small>Учасників</small><b>{d.eligible}</b></div><div><small>Пройшли навчання</small><b>{d.trained}</b></div><div><small>Частка</small><b>{fb(d.percent)} %</b></div></div>
        <Ticks n={30} on={Math.round((d.percent || 0) / 100 * 30)} color="var(--teal)" h={14} />
        <div className="rows" style={{ marginTop: 10 }}>{d.required.map(c => <div key={c} className="row"><div className="grow txt">{(API.mod.decks && API.mod.decks.data && (API.mod.decks.data.decks.find(x => x.code === c) || {}).title) || c}</div><b className="tnum">{d.by_deck[c] == null ? "…" : d.by_deck[c]}</b></div>)}</div></>}
    <div className="lbl" style={{ marginTop: 8 }}>Пройшов навчання: усі обовʼязкові колоди за останні {d.valid_days} днів. Групи менші за k = {S.k} не показуються.</div></section>;
}

function DeckList() {
  const r = useDecks();
  if (!r) return <Loading t="Навчання" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("decks")} />;
  const d = r.data;
  return <>
    <section className="c12 rise toolbar"><span className="lbl">Вигадані ситуації для навчання. Ваш прогрес бачите лише ви: керівник отримує лише загальну частку.{!API.on ? " Демо-режим: прогрес зберігається до перезавантаження сторінки." : ""}</span></section>
    <section className="card c4 rise" style={{ alignSelf: "start" }}><div className="lbl">Ваше навчання</div>
      <div style={{ margin: "12px 0" }}><Pill cls={d.i_am_trained ? "p-good" : "p-warn"}>{d.i_am_trained ? "Навчання пройдено" : "Навчання не завершено"}</Pill></div>
      <div className="lbl">Потрібно пройти обовʼязкові колоди: {d.required.map(c => (d.decks.find(x => x.code === c) || {}).title || c).join(", ")}. Чинність: {d.valid_days} днів.</div></section>
    <div className="c8 mod-grid rise" style={{ alignContent: "start" }}>
      {d.decks.map(k => <div key={k.code} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="tags">{k.required && <Pill cls="p-info nodot">Обовʼязкова</Pill>}<Pill cls="p-mute nodot">{COMP_N[k.component] || k.component}</Pill></div>
        <b className="txt" style={{ fontSize: 15 }}>{dsh(k.title)}</b><div className="lbl txt">{dsh(k.description)}</div>
        <div className="lbl">Карток: {k.cards}</div>
        <div style={{ flex: 1 }} />
        <div>{k.my_completed_on ? <Pill cls={k.my_valid ? "p-good" : "p-warn"}>{k.my_valid ? "Пройдено" : "Строк минув"} {ua(k.my_completed_on)}</Pill> : <Pill cls="p-mute">Не пройдено</Pill>}</div>
        <button type="button" className="btn btn-soft" style={{ justifyContent: "center" }} onClick={() => go("learn/" + k.code)}><Ic n="book" />{k.my_completed_on ? "Повторити" : "Вивчати"}</button></div>)}
    </div>
    <Coverage />
  </>;
}

function Study({ code }) {
  const key = "deck:" + code, init = getProg(code), [i, setI] = useState(init.i || 0), [flip, setFlip] = useState(false), [seen, setSeen] = useState(() => Object.fromEntries(init.seen.map(x => [x, true]))), [busy, setBusy] = useState(false);
  useEffect(() => { if (Object.keys(seen).length) setProg(code, { i, seen: Object.keys(seen) }); }, [i, seen, code]);
  const r = API.on ? apiMod(key, () => apiDeck(code)) : { data: DEMO_LEARN.decks.find(x => x.code === code) };
  const cards = r && r.data ? r.data.cards : [], c = cards[i], last = i === cards.length - 1, all = cards.length > 0 && cards.every(x => seen[x.id]);
  const turn = () => { if (!c) return; setFlip(f => !f); setSeen(s => ({ ...s, [c.id]: true })); };
  const step = d => { setI(x => Math.max(0, Math.min(cards.length - 1, x + d))); setFlip(false); };
  useEffect(() => {
    const key = e => {
      if (/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") { e.preventDefault(); turn(); } else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  });
  if (!r) return <Loading t="Колода" />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset(key)} />;
  if (!r.data) return <NeedServer t="Колоду не знайдено" />;
  const finish = async () => {
    setBusy(true);
    try {
      if (API.on) { await apiDeckDone(code, cards.map(x => x.id)); apiModReset("decks", "lstats"); } else { demoDone[code] = today(); }
      clearProg(code);
      toast("Колоду зараховано"); go("learn");
    } catch (e) { apiFail(e); setBusy(false); } finally { render(true); }
  };
  const n = Object.keys(seen).length;
  return <>
    <section className="c12 rise toolbar"><a className="btn btn-ghost" href="#learn"><Ic n="arrowL" />Усі колоди</a><b className="txt">{dsh(r.data.title)}</b><div className="sp" /><span className="lbl tnum" aria-live="polite">Картка {i + 1} з {cards.length} · переглянуто {n}</span></section>
    <section className="card c12 rise">
      <Ticks n={cards.length} on={n} color="var(--teal)" h={14} step={0} />
      <div className="fc" style={{ marginTop: 12 }} role="button" tabIndex={0} aria-pressed={flip} aria-label={flip ? "Картка перевернута: показано кроки. Натисніть, щоб повернути" : "Натисніть, щоб побачити перші кроки"} onClick={turn} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); turn(); } }}>
        <span className="lbl">{flip ? "Що робити" : "Ситуація"}</span>
        {!flip ? <div className="fc-q">{dsh(c.situation)}</div> : <>
          <div><b>Перші кроки</b><ol>{c.steps.map((t, k) => <li key={k} className="txt">{dsh(t)}</li>)}</ol></div>
          <div className="note-box"><b>Чому так</b><span className="txt">{dsh(c.why)}</span></div>
          <div className="lbl txt">Закон: {dsh(c.law)}</div></>}
      </div>
      <div className="fc-nav" style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={() => step(-1)} disabled={i === 0}><Ic n="arrowL" />Назад</button>
        <button type="button" className="btn btn-soft" onClick={turn}>{flip ? "Показати ситуацію" : "Перевернути"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => step(1)} disabled={last}>Далі<Ic n="arrowR" /></button>
        <div className="sp" />
        <button type="button" className="btn btn-primary" onClick={finish} disabled={!all || busy} data-tip={all ? undefined : "Щоб зарахувати колоду, переверніть усі картки"}>Зарахувати колоду</button>
      </div>
      <div className="lbl" style={{ marginTop: 10 }}>Клавіатура: Пробіл перевертає картку, стрілки ліворуч і праворуч перемикають. Відповіді на картки не зберігаються, лише факт проходження.</div>
    </section>
  </>;
}

/* Картка «Навчання» в «Мої результати»: поточна колода, прогрес, «Продовжити» */
export function LearnCard() {
  const r = useDecks();
  if (!r) return <section className="card c12 rise" role="status"><div className="lbl">Завантажуємо навчання…</div></section>;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("decks")} />;
  const d = r.data, done = d.decks.filter(k => k.my_valid).length, next = d.decks.find(k => k.required && !k.my_valid) || d.decks.find(k => !k.my_valid), pr = next ? getProg(next.code) : null;
  return <section className="card c12 rise"><ModHead ic="book" tone="teal" title="Навчання"><Pill cls={d.i_am_trained ? "p-good" : "p-warn"}>{d.i_am_trained ? "Навчання пройдено" : "Навчання не завершено"}</Pill></ModHead>
    <div className="lbl">Пройдено колод: {done} з {d.decks.length}</div>
    <Ticks n={d.decks.length} on={done} color="var(--teal)" h={10} step={0} />
    {next ? <div className="chk-row" style={{ marginTop: 12, flexWrap: "wrap" }}><div className="grow" style={{ minWidth: 200 }}><b className="txt">{dsh(next.title)}</b><div className="lbl">{pr.seen.length ? `Переглянуто ${pr.seen.length} з ${next.cards}` : `${next.cards} карток${next.required ? ", обовʼязкова" : ""}`}</div></div>
      <button type="button" className="btn btn-primary" onClick={() => go("learn/" + next.code)}><Ic n="book" />{pr.seen.length ? "Продовжити" : "Почати"}</button></div>
      : <div className="chk-row" style={{ marginTop: 12 }}><span className="lbl grow">Усі колоди пройдено.</span><a className="btn btn-soft" href="#learn">До колод</a></div>}
  </section>;
}

export function Learn() { const { p } = route(); return p ? <Study key={p} code={p} /> : <DeckList />; }
