/* Робота з результатами: Рекомендації, Трекер заходів, Джерела, Заклади. */
import { useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, persist, addLog, me } from "../lib/state.js";
import { API, apiDecide, apiSendMSt, apiErrText, apiFail, apiPositions, dn } from "../lib/api.js";
import { COMPS, COMP, PRI, REC_ST, REC_NEXT, POSITIONS, BASE_MEASURES, M_ST, M_NEXT, REGISTRY, INSTITUTIONS, buildRecs, measures, overdueDays, dispSt, daysWord, verif, TODAY } from "../lib/model.js";
import { ua, plural } from "../lib/format.js";
import { render, toast, openDrawer, closeDrawer } from "../lib/store.js";
import { can } from "../lib/nav.js";
import { Pill, LvPill, TrustPill } from "../components/ui.jsx";
import { DatePicker } from "../components/DatePicker.jsx";
import { openApiQ, openMeasure, openSource, srcRows, MODE } from "./panels.jsx";
import { ReadGuide } from "./results.jsx";
// Тост прийняття: назва створеного заходу (сервер бере її з каталогу Додатку Д), внутрішні лапки „“, щоб не було ««
const newest = ms => Array.isArray(ms) && ms.length ? [...ms].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).pop().title : "";
const acceptToast = t => `Рекомендацію прийнято. Захід «${String(t).replace(/^«(.*)»$/, "$1").replace(/«/g, "„").replace(/»/g, "“")}» додано до трекера.`;

const enter = f => e => { if (e.key === "Enter") f(e); };
const Err = ({ t, hint, red }) => <span className="lbl" id="f-err" style={red || t ? { color: "color-mix(in srgb, var(--red) 60%, var(--fg))" } : undefined}>{t || hint}</span>;

/* Рекомендації */
export function Recs() {
  const [more, setMore] = useState(false);
  const all = buildRecs(), f = S.recF, list0 = all.filter(r => (f.st === "all" || r.st === f.st) && (f.c === "all" || r.c === f.c));
  // З сервера: місце (rank) і група; рекомендації після перших п'яти згорнуті, доки не натиснути «Показати ще»
  const ranked = list0.some(r => r.rank != null), sorted = ranked ? [...list0].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)) : list0;
  const hidden = ranked && !more ? sorted.filter(r => r.collapsed) : [], list = sorted.filter(r => !hidden.includes(r));
  return <>
    <section className="c12 rise toolbar"><span className="lbl">Рекомендація це пропозиція системи, рішення приймає керівник.</span><div className="sp" />
      <select className="inp" aria-label="Статус" value={f.st} onChange={e => { S.recF.st = e.target.value; persist(); render(true); }}><option value="all">Усі статуси</option>{Object.entries(REC_ST).map(([k, [n]]) => <option key={k} value={k}>{n}</option>)}</select>
      <select className="inp" aria-label="Компонент" value={f.c} onChange={e => { S.recF.c = e.target.value; persist(); render(true); }}><option value="all">Усі компоненти</option>{COMPS.map(c => <option key={c} value={c}>{COMP[c].n}</option>)}</select>
      <span className="lbl tnum">Показано {list.length} з {all.length}</span></section>
    <div className="c12 recs">{list.length ? list.map((r, i) => <article key={r.id} className="rec card rise" style={{ animationDelay: `${i * 60}ms` }} id={r.id}>
      <span className="pri" style={{ background: PRI[r.pri][1], color: PRI[r.pri][2] }} data-tip={`Пріоритет: ${PRI[r.pri][0].toLowerCase()}`}><Ic n={r.pri === "high" ? "alert" : "flag"} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="lbl rec-meta">{r.rank != null && <span className="tnum" data-tip="Місце в списку за важливістю">№ {r.rank} · </span>}{r.groupT || COMP[r.c].n} · <span className={r.pri === "high" ? "rec-hi" : ""}>пріоритет {PRI[r.pri][0].toLowerCase()}</span>{r.st !== "proposed" && <> · <Pill cls={REC_ST[r.st][1]}>{REC_ST[r.st][0]}</Pill></>}</div>
        <h3>{r.t}</h3>
        {r.covers && r.covers.length > 0 && <div className="lbl" style={{ marginTop: 4 }}>Обʼєднує ще {r.covers.length} {plural(r.covers.length, "схожу пропозицію", "схожі пропозиції", "схожих пропозицій")}</div>}
        <div className="lbl" style={{ margin: "10px 0 4px" }}>Чому система це пропонує</div><div>{r.why}</div>
        {r.evidence.length > 0 && <div className="lbl" style={{ margin: "12px 0 4px" }}>На підставі</div>}
        {r.evidence.length > 0 && <div className="ev">{r.evidence.map((e, j) => <a key={j} href={`#explain/${e.id}`} className="ev-i" title={e.q ? "Відкрити питання" : "Відкрити в розкладі"} onClick={e.q ? ev => { ev.preventDefault(); openApiQ(e.q); } : undefined}><span>{!e.item && <span className="ev-flag"><Ic n="alert" /></span>}{e.t}: <b>{e.v}</b></span><span className="lbl" aria-hidden="true"><Ic n="arrowR" /></span></a>)}</div>}
        <details className="acts"><summary>Запропоновані дії ({r.acts.length})</summary><ol>{r.acts.map(a => <li key={a}>{a}</li>)}</ol></details>
        {r.note.reason && <div className="note-box" style={{ marginTop: 10 }}><b>Причина відхилення</b><span>{r.note.reason}</span></div>}
        {r.note.comment && <div className="note-box" style={{ marginTop: 10 }}><b>Коментар до уточнення</b><span>{r.note.comment}</span></div>}
      </div>
      <div className="rec-actions">{r.st === "accepted" ? <a className="btn btn-soft" href="#tracker"><Ic n="target" />Подивитися захід у трекері</a> : REC_NEXT[r.st].map(n => n === "accepted"
        ? <button key={n} className="btn btn-primary" onClick={() => acceptRec(r.id)}><Ic n="ok" />Прийняти</button>
        : n === "clarified" ? <button key={n} className="btn btn-soft" onClick={() => noteRec(r.id, "clarified")}>Уточнити</button>
        : <button key={n} className="btn btn-ghost" onClick={() => noteRec(r.id, "rejected")}>Відхилити</button>)}</div>
    </article>) : <section className="card"><div className="empty"><b>За цими фільтрами рекомендацій немає</b><br />Змініть статус або компонент. Нові рекомендації зʼявляються після кожного циклу оцінювання.</div></section>}</div>
    {hidden.length > 0 && <div className="c12" style={{ display: "flex", justifyContent: "center" }}><button type="button" className="btn btn-soft" onClick={() => setMore(true)}><Ic n="chev" />Показати ще {hidden.length} {plural(hidden.length, "рекомендацію", "рекомендації", "рекомендацій")}</button></div>}
  </>;
}
function acceptRec(id) {
  const r = buildRecs().find(x => x.id === id); if (!r) return;
  openDrawer("Прийняти рекомендацію", () => {
    const ap = API.on ? apiPositions() : null, POS = ap && ap.length ? ap : POSITIONS, [who, setWho] = useState(POS[0]), [due, setDue] = useState("2027-02-28"), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
    const ok = () => {
      if (!due || due < TODAY) return setErr("Оберіть строк не раніше за сьогодні.");
      if (API.on) { setBusy(true); apiDecide(id, "accepted", "", { owner: POS.includes(who) ? who : POS[0], due_date: due }).then(x => { closeDrawer(); toast(acceptToast(newest(x && x.measures) || r.t)); }, e => { setErr(apiErrText(e)); setBusy(false); }); return; }
      const mid = "m-" + (BASE_MEASURES.length + S.dec.added.length + 1);
      S.dec.rec[id] = { status: "accepted" };
      S.dec.added.push({ id: mid, recId: id, rec: r.t, t: r.t, who, due, st: "accepted", ind: r.items[0] });
      addLog(me(), `Рекомендацію «${r.t}» прийнято, створено захід ${mid}`); persist(); closeDrawer(); render(true);
      toast(acceptToast(r.t));
    };
    return <>
      <div><div className="lbl">{COMP[r.c].n}</div><div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{r.t}</div></div>
      <div className="field"><label htmlFor="f-who">Відповідальна посада</label><select id="f-who" className="inp" value={POS.includes(who) ? who : POS[0]} onChange={e => setWho(e.target.value)}>{POS.map(w => <option key={w}>{w}</option>)}</select></div>
      <div className="field"><label htmlFor="f-due">Строк виконання</label><DatePicker id="f-due" value={due} min={TODAY} onChange={setDue} /><span className="err lbl" id="f-err">{err}</span></div>
      <div className="note-box"><span className="lbl">Після прийняття в трекері зʼявиться захід із цією посадою й строком. Посада і строк зберігаються в заході разом із рішенням.</span></div>
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={closeDrawer}>Скасувати</button><button className="btn btn-primary" id="f-ok" style={{ flex: 2, justifyContent: "center" }} disabled={busy} onClick={ok}><Ic n="ok" />Прийняти й створити захід</button></div>
    </>;
  });
}
function noteRec(id, kind) {
  const r = buildRecs().find(x => x.id === id); if (!r) return; const rej = kind === "rejected";
  openDrawer(rej ? "Відхилити рекомендацію" : "Уточнити рекомендацію", () => {
    const [t, setT] = useState(""), [err, setErr] = useState(""), ta = useRef(null);
    const ok = () => {
      const v = t.trim();
      if (!v) { setErr(rej ? "Вкажіть причину відхилення." : "Напишіть, що саме потрібно уточнити."); ta.current.focus(); return; }
      if (API.on) { apiDecide(id, rej ? "rejected" : "clarify", v).then(() => { closeDrawer(); toast(rej ? "Рекомендацію відхилено. Причину збережено." : "Рекомендацію позначено як «Уточнено». Коментар збережено."); }, e => setErr(apiErrText(e))); return; }
      S.dec.rec[id] = rej ? { status: "rejected", reason: v } : { status: "clarified", comment: v };
      addLog(me(), `Рекомендацію «${r.t}» ${rej ? "відхилено" : "позначено «Уточнено»"}: ${v}`); persist(); closeDrawer(); render(true);
      toast(rej ? "Рекомендацію відхилено. Причину збережено." : "Рекомендацію позначено як «Уточнено». Коментар збережено.");
    };
    return <>
      <div style={{ fontWeight: 600 }}>{r.t}</div>
      <div className="field"><label htmlFor="f-why">{rej ? "Причина відхилення" : "Короткий коментар"}</label><textarea className="inp" id="f-why" rows="4" style={{ resize: "vertical" }} ref={ta} value={t} onChange={e => setT(e.target.value)} /><Err t={err} hint={rej ? "Причина обов’язкова: вона допоможе наступним оцінюванням." : "Що потрібно уточнити, перш ніж ухвалити рішення."} /></div>
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={closeDrawer}>Скасувати</button><button className={`btn ${rej ? "btn-danger" : "btn-primary"}`} id="f-ok" style={{ flex: 2, justifyContent: "center" }} onClick={ok}>{rej ? "Відхилити" : "Надіслати уточнення"}</button></div>
    </>;
  });
}

/* Трекер */
function setMSt(id, st) {
  const x = measures().find(m => m.id === id); if (!x || !M_NEXT[x.st].includes(st)) return;
  if (API.on) {
    // Повернення виконаного заходу в роботу — лише з причиною (сервер пише її в журнал дій).
    if (st !== "done" && ["done", "confirmed", "notconfirmed"].includes(x.st)) return openDrawer("Повернути захід у роботу", () => {
      const [t, setT] = useState(""), [err, setErr] = useState("");
      const ok = () => { const v = t.trim(); if (v.length < 3) return setErr("Вкажіть причину."); apiSendMSt(id, st, undefined, v).then(() => { closeDrawer(); toast(`Статус заходу змінено на «${M_ST[st][0]}».`); }, apiFail); };
      return <>
        <div style={{ fontWeight: 600 }}>{x.t}</div>
        <div className="field"><label htmlFor="f-why">Причина</label><textarea className="inp" id="f-why" rows="4" value={t} onChange={e => setT(e.target.value)} /><Err t={err} hint="Чому виконаний захід повертається в роботу: причина потрапить у журнал дій." /></div>
        <button className="btn btn-primary" id="f-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="ok" />Повернути</button>
      </>;
    });
    if (st !== "done") return apiSendMSt(id, st).then(() => toast(`Статус заходу змінено на «${M_ST[st][0]}».`), apiFail);
    return openDrawer("Позначити захід виконаним", () => {
      const [t, setT] = useState(""), [err, setErr] = useState("");
      const ok = () => { const v = t.trim(); if (v.length < 3) return setErr("Опишіть доказ."); apiSendMSt(id, st, v).then(() => { closeDrawer(); toast(`Статус заходу змінено на «${M_ST[st][0]}».`); }, apiFail); };
      return <>
        <div style={{ fontWeight: 600 }}>{x.t}</div>
        <div className="field"><label htmlFor="f-ev">Доказ виконання</label><textarea className="inp" id="f-ev" rows="4" value={t} onChange={e => setT(e.target.value)} /><Err t={err} hint="Документ, наказ, звіт або посилання на нього. Без доказу захід не позначити виконаним." /></div>
        <button className="btn btn-primary" id="f-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="ok" />Зберегти</button>
      </>;
    });
  }
  S.dec.mst[id] = st; addLog(me(), `Захід «${x.t}»: статус «${M_ST[st][0]}»`); persist(); render(true); toast(`Статус заходу змінено на «${M_ST[st][0]}».`);
}
export function Tracker() {
  // Хвиля: з сервером заходи всіх хвиль, за замовчуванням показуємо поточну
  const f = S.trF, waves = API.on ? [...new Set(measures().map(x => x.wave).filter(Boolean))] : [], wv = f.wave && (f.wave === "all" || waves.includes(f.wave)) ? f.wave : waves.includes(API.campaignId) ? API.campaignId : "all";
  const all = measures().filter(x => wv === "all" || x.wave === wv), edit = S.role === "leader";
  const list = all.filter(x => (f.st === "all" || dispSt(x) === f.st || (f.st === "overdue" && overdueDays(x) > 0)) && (f.who === "all" || x.who === f.who));
  const [drag, setDrag] = useState(null), [over, setOver] = useState(null);
  const conf = all.filter(x => x.st === "confirmed").length, chk = all.filter(x => x.st === "done" && x.vf && x.vf[1] === "p-warn").length, wait = all.filter(x => x.st === "done").length - chk, rev = all.filter(x => x.st === "notconfirmed").length;
  const open = (e, id) => { if (!e.target.closest("button")) openMeasure(id); };
  const actCell = x => x.st === "confirmed" ? <span className="lbl">Змінює наступне оцінювання</span> : edit ? <div className="mv">{M_NEXT[x.st].map(s => <button key={s} className="btn btn-ghost" onClick={() => setMSt(x.id, s)}><Ic n="arrowR" />{M_ST[s][0]}</button>)}</div> : <span className="lbl">–</span>;
  // Дошка: перетягування картки в дозволений стовпець (ті самі переходи, що й кнопки на картці)
  const cols = ["accepted", "inprogress", "done", "confirmed", "notconfirmed", ...(list.some(x => x.st === "cancelled") ? ["cancelled"] : [])];
  const canDrop = st => drag && (M_NEXT[drag.st] || []).includes(st);
  const board = <section className={`c12 board rise ${drag ? "dnd" : ""}`}>{cols.map(st => { const cards = list.filter(x => x.st === st); return <div key={st} className={`col-b ${canDrop(st) ? "can-drop" : ""} ${over === st && canDrop(st) ? "drop-over" : ""}`} data-st={st}
    onDragOver={e => { if (!canDrop(st)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== st) setOver(st); }}
    onDrop={e => { if (!canDrop(st)) return; e.preventDefault(); const id = drag.id; setDrag(null); setOver(null); setMSt(id, st); }}>
    <div className="col-h"><Pill cls={M_ST[st][1]}>{M_ST[st][0]}</Pill><span className="lbl tnum">{cards.length}</span></div>
    {cards.length ? cards.map(x => { const dd = overdueDays(x), mv = edit && M_NEXT[x.st].length; return <div key={x.id} className={`b-card tr-click ${drag && drag.id === x.id ? "dragging" : ""}`} tabIndex={0} draggable={mv ? "true" : undefined}
      onDragStart={mv ? e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", x.id); setDrag({ id: x.id, st: x.st }); } : undefined} onDragEnd={() => { setDrag(null); setOver(null); }}
      onClick={e => open(e, x.id)} onKeyDown={enter(e => open(e, x.id))}>
      <b>{x.t}</b><span className="lbl">{x.who}</span>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}><span className="lbl tnum" style={dd ? { color: "color-mix(in srgb, var(--red) 60%, var(--fg))", fontWeight: 600 } : undefined}>Строк: {ua(x.due)}</span>{dd > 0 && <Pill cls="p-bad nodot">+{dd} {daysWord(dd)}</Pill>}</div>
      {mv ? <div className="seg sm">{M_NEXT[x.st].map(s => <button key={s} onClick={() => setMSt(x.id, s)}><Ic n="arrowR" />{M_ST[s][0]}</button>)}</div> : null}
    </div>; }) : <div className="lbl" style={{ padding: 8 }}>Порожньо</div>}
  </div>; })}</section>;
  return <>
    <section className="c12 rise toolbar"><div className="sp" />
      <div className="seg" role="group" aria-label="Вигляд">{[["table", "Таблиця"], ["board", "Дошка"]].map(([k, n]) => <button key={k} className={S.trackView === k ? "on" : ""} onClick={() => { S.trackView = k; persist(); render(true); }}>{n}</button>)}</div>
      {waves.length > 1 && <select className="inp" aria-label="Хвиля" value={wv} onChange={e => { S.trF.wave = e.target.value; persist(); render(true); }}><option value="all">Усі хвилі</option>{waves.map(w => <option key={w} value={w}>{dn(API.waveT && API.waveT[w] || "Попередня хвиля")}</option>)}</select>}
      <select className="inp" aria-label="Статус" value={f.st} onChange={e => { S.trF.st = e.target.value; persist(); render(true); }}><option value="all">Усі статуси</option>{Object.entries(M_ST).map(([k, [n]]) => <option key={k} value={k}>{n}</option>)}</select>
      <select className="inp" aria-label="Відповідальна посада" value={f.who} onChange={e => { S.trF.who = e.target.value; persist(); render(true); }}><option value="all">Усі посади</option>{[...new Set(all.map(x => x.who))].sort().map(w => <option key={w}>{w}</option>)}</select>
      <span className="lbl tnum">Показано {list.length} з {all.length}</span></section>
    {!list.length ? <section className="card c12"><div className="empty"><b>За цими фільтрами заходів немає</b><br />Змініть статус або посаду. Нові заходи зʼявляються, коли керівник приймає рекомендацію.<br /><br />{can("recs") && <a className="btn btn-soft" href="#recs">Перейти до рекомендацій</a>}</div></section>
      : S.trackView === "board" ? board
      : <section className="card c12 rise"><div className="tbl-wrap"><table className="tbl-stack"><thead><tr><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Статус</th><th>Верифікація</th><th>Змінити статус</th></tr></thead><tbody>
        {list.map(x => { const dd = overdueDays(x); return <tr key={x.id} className="tr-click" tabIndex={0} onClick={e => open(e, x.id)} onKeyDown={e => { if (e.key === "Enter" && !e.target.closest("button")) openMeasure(x.id); }}>
          <td style={{ minWidth: 220 }}><b style={{ fontWeight: 600 }}>{x.t}</b><div className="lbl">З рекомендації: {x.rec}</div>{x.ext && <div className="lbl">{x.ext.t}{x.ext.docs.length ? ` · документів: ${x.ext.docs.length}` : ""}</div>}</td><td style={{ minWidth: 160 }} data-l="Відповідальна посада">{x.who}</td>
          <td className="tnum" style={{ whiteSpace: "nowrap" }} data-l="Строк">{dd ? <><span style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))", fontWeight: 600 }}>{ua(x.due)}</span><div className="lbl" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>прострочено на {dd} {daysWord(dd)}</div></> : ua(x.due)}</td>
          <td data-l="Статус"><Pill cls={M_ST[x.st][1]}>{M_ST[x.st][0]}</Pill></td><td data-l="Верифікація"><Pill cls={verif(x)[1] + " nodot"}>{verif(x)[0]}</Pill></td><td data-l="Змінити статус">{actCell(x)}</td></tr>; })}
      </tbody></table></div></section>}
    <section className="card c12 rise vf">
      <h2>Верифікація наступним оцінюванням</h2><button type="button" className="kt-info" aria-label="Як працює верифікація" data-tip="Чи спрацював виконаний захід, видно після наступного циклу: якщо повʼязаний показник зріс, захід підтверджено."><Ic n="info" /></button>
      <div className="sp" />
      <div className="vf-s tnum"><span><b>{conf}</b>Підтверджено</span><span><b>{wait}</b>Очікують оцінювання</span>{chk > 0 && <span><b>{chk}</b>Перевірити дані</span>}<span><b>{rev}</b>Потребують перегляду</span></div>
    </section>
  </>;
}

/* Джерела */
// Лише те, що реально працює в системі. Mitra — інтеграція з темою 2; режим залежить від того, чи вона підключена
const mitraOn = () => API.on && (API.ms || []).some(x => x.ext);
const INTEG = () => [
  ["Модуль опитувань", "auto", "Зібрати самооцінку працівників без ідентифікації", "Одноразові коди доступу й QR, агрегація на сервері", "survey", 0],
  ["Чек-лист закладу", "manual", "Підтвердити самооцінку фактами", "Робоча група вносить, внутрішній аудит підтверджує з документом", "check", 1],
  ["Модуль «Перевірки»", "auto", "Декларації, конфлікти інтересів і закупівлі", "Правила над відкритими даними НАЗК і Prozorro", "shield", 2],
  ["Флешкартки доброчесності", "auto", "Рахувати охоплення навчанням", "Частка тих, хто пройшов обовʼязкові колоди, без імен", "book", 6],
  ["Журнал звернень", "manual", "Скільки звернень розглянуто в строк", "Вносить уповноважений", "file", 5],
  ["Mitra", mitraOn() ? "auto" : "manual", "Звіти про виконання заходів", "Прийняті заходи йдуть у Mitra, звідти повертаються стан і звіт виконавця", "target", 7],
];
export function Sources() {
  return <>
    <section className="card c12 rise"><div className="card-h"><h2>Джерела даних за метриками</h2></div>
      <div className="tbl-wrap"><table className="tbl-stack"><thead><tr><th>Метрика</th><th>Джерело</th><th>Режим</th><th>Вік даних</th><th>Пояснення</th></tr></thead><tbody>
        {srcRows().map(([a, b, mo, age, ex], i) => <tr key={a} className="tr-click" tabIndex={0} onClick={() => openSource(i)} onKeyDown={enter(() => openSource(i))}><td><b style={{ fontWeight: 600 }}>{a}</b></td><td data-l="Джерело">{b}</td><td data-l="Режим"><Pill cls={MODE[mo][1]}>{MODE[mo][0]}</Pill></td><td className="lbl" style={{ minWidth: 150 }} data-l="Вік даних">{age}</td><td className="lbl blk" style={{ minWidth: 260 }}>{ex}</td></tr>)}
      </tbody></table></div></section>
    <section className="c12 rise"><div className="card-h" style={{ margin: "6px 0 0" }}><h2>Карта інтеграцій</h2></div></section>
    {INTEG().map(([n, mo, why, how, ic, src]) => { const go = () => openSource(src); return <section key={n} className={`card c4 rise integ ${mo}`} role="button" tabIndex={0} onClick={go} onKeyDown={enter(go)}><div className="comp-top"><span className="comp-ic" style={{ background: "var(--soft)" }}><Ic n={ic} /></span><b>{n}</b><div className="sp" style={{ flex: 1 }} /><Pill cls={MODE[mo][1]}>{MODE[mo][0]}</Pill></div>
      <div style={{ marginTop: 12 }}><span className="lbl">Навіщо</span><div>{why}</div></div><div style={{ marginTop: 8 }}><span className="lbl">Метод</span><div>{how}</div></div></section>; })}
  </>;
}

/* Заклади (спостерігач) */
export function Institutions() {
  const q = S.instQ.trim().toLowerCase(), arch = S.insts.archived;
  const all = INSTITUTIONS().filter(m => !q || m.name.toLowerCase().includes(q) || (m.edrpou || "").includes(q));
  // Порядок за кодом ЄДРПОУ, а не за назвою чи рівнем: випадковий збіг порядку з рівнями читався б як рейтинг
  const list = all.filter(m => S.instArch ? arch.includes(m.id) : !arch.includes(m.id)).sort((a, b) => String(a.edrpou || "").localeCompare(String(b.edrpou || ""))), nArch = INSTITUTIONS().filter(m => arch.includes(m.id)).length;
  const menu = m => <button type="button" className="icon-btn inst-more" aria-label="Керування закладом" data-tip="Перейменувати або архівувати" onClick={e => { e.preventDefault(); e.stopPropagation(); openInstMenu(m.id); }}><Ic n="dots" /></button>;
  return <>
    <section className="c12 rise toolbar"><label className="search inst-search"><span><Ic n="search" /></span><input id="instQ" placeholder="Назва або код ЄДРПОУ" value={S.instQ} onChange={e => { S.instQ = e.target.value; render(true); }} /></label>
      <div className="seg" role="group" aria-label="Які заклади"><button className={S.instArch ? "" : "on"} onClick={() => { S.instArch = false; persist(); render(true); }}>Активні</button><button className={S.instArch ? "on" : ""} onClick={() => { S.instArch = true; persist(); render(true); }}>Архів{nArch ? ` (${nArch})` : ""}</button></div>
      <div className="sp" /><button className="btn btn-primary" onClick={openAddInst}><Ic n="plus" />Додати заклад</button></section>
    {list.length ? list.map(m => m.empty
      ? <section key={m.id} className="card c6 rise inst"><div className="comp-top"><span className="comp-ic" style={{ background: "var(--soft)" }}><Ic n="building" /></span><b>{m.name}</b><div className="sp" style={{ flex: 1 }} />{menu(m)}</div>
        <div className="lbl tnum" style={{ marginTop: 6 }}>ЄДРПОУ {m.edrpou}</div>
        <div className="note-box" style={{ marginTop: 14 }}><b>Оцінювання ще не проводилось</b><span className="lbl">Уповноважений закладу відкриє цикл і видасть жетони. Після першого циклу тут зʼявиться індекс.</span></div></section>
      : <a key={m.id} className="card c6 rise inst" href="#overview" onClick={() => { S.inst = m.id; addLog(me(), `Переглянуто огляд закладу ${m.edrpou}`); persist(); }}>
        <div className="comp-top"><span className="comp-ic" style={{ background: "var(--lime-soft)", color: "var(--teal-deep)" }}><Ic n="building" /></span><b>{m.name}</b><div className="sp" style={{ flex: 1 }} />{menu(m)}</div>
        <div className="lbl tnum" style={{ marginTop: 6 }}>ЄДРПОУ {m.edrpou}</div>
        <dl className="inst-kv" style={{ marginTop: 14 }}><dt>Рівень зрілості</dt><dd><LvPill l={m.level} /></dd><dt>Достовірність</dt><dd><TrustPill g={m.trust} /></dd><dt>Останній цикл</dt><dd className="tnum">{m.series[m.series.length - 1].cycle}</dd></dl>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><span className="link">Відкрити огляд <Ic n="arrowR" /></span></div>
      </a>)
      : <section className="card c12"><div className="empty"><b>{q ? "Нічого не знайдено" : S.instArch ? "В архіві порожньо" : "Закладів немає"}</b><br />{q ? "Змініть запит або додайте заклад за кодом ЄДРПОУ." : ""}</div></section>}
    <section className="card c12 rise"><div className="lock"><Ic n="shield" /><div><b>Заклади не порівнюються між собою</b><div className="lbl">На картках немає індексу й рейтингу, список упорядковано за кодом ЄДРПОУ. Індекс і його зміну видно лише на огляді конкретного закладу, і порівнюється заклад тільки сам із собою.</div></div></div></section>
    <ReadGuide title="Як читати картки" />
  </>;
}
function openInstMenu(id) {
  const m = INSTITUTIONS().find(x => x.id === id); if (!m) return; const ar = S.insts.archived.includes(id);
  openDrawer("Керування закладом", () => {
    const [v, setV] = useState(m.name), [err, setErr] = useState("");
    const save = () => { const t = v.trim(); if (!t) return setErr("Назва не може бути порожньою."); S.insts.renamed[id] = t; addLog(me(), `Заклад ${m.edrpou}: назву змінено на «${t}»`); persist(); closeDrawer(); render(true); toast("Назву збережено"); };
    const arch = () => { S.insts.archived = ar ? S.insts.archived.filter(x => x !== id) : [...S.insts.archived, id]; addLog(me(), `Заклад ${m.edrpou}: ${ar ? "повернуто з архіву" : "перенесено в архів"}`); persist(); closeDrawer(); render(true); toast(ar ? "Заклад повернуто з архіву" : "Заклад перенесено в архів"); };
    return <>
      <div><div className="lbl tnum">ЄДРПОУ {m.edrpou}</div><div style={{ fontWeight: 600, marginTop: 4 }}>{m.name}</div></div>
      <div className="field"><label htmlFor="f-name">Назва в системі</label><input className="inp" id="f-name" value={v} maxLength={160} onChange={e => setV(e.target.value)} /><Err t={err} hint="Офіційна назва береться з реєстру. Тут можна задати скорочену." /></div>
      <button className="btn btn-primary" id="f-ok" style={{ justifyContent: "center" }} onClick={save}><Ic n="ok" />Зберегти назву</button>
      <div className="note-box"><b>{ar ? "Повернути з архіву" : "Архівувати"}</b><span className="lbl">{ar ? "Заклад знову зʼявиться в списку активних." : "Заклад зникне зі списку активних. Дані й історія циклів зберігаються, їх можна повернути."}</span>
        <button className="btn btn-ghost" id="f-arch" style={{ justifyContent: "center" }} onClick={arch}>{ar ? "Повернути з архіву" : "Перенести в архів"}</button></div>
    </>;
  });
}
function openAddInst() {
  const have = new Set(INSTITUTIONS().map(m => m.edrpou));
  openDrawer("Додати заклад", () => {
    const [q, setQ] = useState(""), [picked, setPicked] = useState([]);
    const ql = q.trim().toLowerCase(), res = REGISTRY.filter(([c, n]) => !ql || c.includes(ql) || n.toLowerCase().includes(ql));
    const add = () => {
      if (!picked.length) return toast("Оберіть хоча б один заклад");
      picked.forEach(c => { const [, n] = REGISTRY.find(r => r[0] === c); S.insts.extra.push({ id: "e" + c, name: n, edrpou: c }); addLog(me(), `Додано заклад ${c} з реєстру`); });
      persist(); closeDrawer(); render(true); toast(`Додано закладів: ${picked.length}`);
    };
    return <>
      <div className="field"><label htmlFor="f-q">Пошук у реєстрі</label><input className="inp" id="f-q" placeholder="Код ЄДРПОУ (8 цифр) або частина назви" inputMode="search" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="rows" id="reg">{res.length ? res.map(([c, n]) => <label key={c} className="row reg-row"><input type="checkbox" value={c} disabled={have.has(c)} checked={have.has(c) || picked.includes(c)} onChange={e => setPicked(p => e.target.checked ? [...p, c] : p.filter(x => x !== c))} /><div className="grow"><div className="t">{n}</div><div className="s tnum">ЄДРПОУ {c}</div></div>{have.has(c) && <Pill cls="p-mute nodot">Вже в системі</Pill>}</label>) : <div className="lbl">У реєстрі нічого не знайдено.</div>}</div>
      <button className="btn btn-primary" id="f-add" style={{ justifyContent: "center" }} onClick={add}><Ic n="ok" />Додати вибрані</button>
      <div className="note-box"><span className="lbl">Демо використовує синтетичний реєстр. У робочій версії пошук іде через бекенд у Єдиний державний реєстр (відкриті дані Мінʼюсту): назва й статус підтягуються автоматично, вручну нічого вводити не треба. Можна завантажити одразу всі заклади зі списку Міністерства оборони або файлом CSV з кодами.</span></div>
    </>;
  });
}
