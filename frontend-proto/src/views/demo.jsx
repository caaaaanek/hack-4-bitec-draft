/* Демо-екрани без бекенду: Керування циклом, Анкети, Чек-лист «чотири ока», Журнал, Опитування, Мої результати. */
import { LearnCard } from "./Learn.jsx";
import { useEffect, useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, SURVEY, SV, SQ, persist, addLog, me, logItems, fnv, saveDraft, clearDraft } from "../lib/state.js";
import { API, apiSubmitSurvey } from "../lib/api.js";
import { COMPS, COMP, FACTS, GROUPS, UNITS, UNIT_RESP, UNIT_CR, ALPHA, factValue, inst, level, indexOf, resolveUnit, CYCLE, TODAY_UA } from "../lib/model.js";
import { fb, f1, dsh } from "../lib/format.js";
import { PrivacyNote } from "./Privacy.jsx";
import { ReceiptBox } from "./Receipts.jsx";
import { UrnDemo } from "./Urn.jsx";
import { render, toast, openDrawer, closeDrawer } from "../lib/store.js";
import { Pill, LvPill, Num, LevelBar, Ticks } from "../components/ui.jsx";
import { FileDrop } from "../components/FileDrop.jsx";

const enter = f => e => { if (e.key === "Enter") f(e); };

/* Керування циклом (уповноважений-адміністратор: лише кількості) */
export function Manage() {
  const tot = GROUPS.reduce((a, g) => a + g.inv, 0), used = GROUPS.reduce((a, g) => a + g.resp, 0);
  const [k, setK] = useState(S.k), [ask, setAsk] = useState(false), rng = useRef(null);
  useEffect(() => { setK(S.k); }, [S.k]); // eslint-disable-line react-hooks/exhaustive-deps
  // Значення k фіксується, коли повзунок відпущено (подія change), а під час руху лише оновлюється число
  useEffect(() => {
    const el = rng.current; if (!el) return;
    const f = () => { S.k = +el.value; addLog(me(), `Мінімальна група: ${S.k} осіб`); persist(); render(true); toast(`Мінімальна група: ${S.k} осіб`); };
    el.addEventListener("change", f); return () => el.removeEventListener("change", f);
  }, []);
  const rows = [["2026-11", "01.11 – 20.11.2026", S.k, `${tot} / ${used}`, S.cycleOpen ? ["Триває", "p-good"] : ["Завершено", "p-mute"]], ["2026-06", "02.06 – 20.06.2026", 10, "82 / 71", ["Завершено", "p-mute"]], ["2025-12", "01.12 – 19.12.2025", 10, "80 / 66", ["Завершено", "p-mute"]], ["2025-06", "02.06 – 20.06.2025", 10, "78 / 59", ["Завершено", "p-mute"]]];
  return <>
    <section className="card c8 rise">
      <div className="card-h"><h2>Цикл {CYCLE}</h2><Pill cls={S.cycleOpen ? "p-good" : "p-mute"}>{S.cycleOpen ? "Триває" : "Завершено"}</Pill><div className="sp" /><span className="lbl">01.11 – 20.11.2026</span></div>
      <div className="lbl" style={{ marginBottom: 6 }}>Видані й використані жетони за групами</div>
      <div className="rows">{GROUPS.map((g, i) => { const hidden = g.unit && g.resp < S.k; return <div key={g.n} className="row"><div className="grow"><div className="t" style={{ display: "flex", gap: 8, alignItems: "center" }}>{g.n}{hidden && <span style={{ display: "inline-flex", width: 15, color: "var(--muted)" }} data-tip={`Менше ${S.k} відповідей: результати групи приховано, показано рівень вище`}><Ic n="lock" /></span>}</div><Ticks n={30} on={Math.round(g.resp / g.inv * 30)} cls={hidden ? "f3" : "f2"} h={14} delay={i * 60} step={10} /></div><span className="tnum" style={{ minWidth: 70, textAlign: "right" }}><b>{g.resp}</b><span className="lbl"> / {g.inv}</span></span></div>; })}</div>
    </section>
    <section className="card c4 rise">
      <div className="card-h"><h2>Налаштування</h2></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="field"><label htmlFor="kin">Мінімальна група, осіб</label><div style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="range" min="5" max="20" id="kin" ref={rng} value={k} onChange={e => setK(+e.target.value)} style={{ flex: 1 }} /><b className="tnum" id="kv" style={{ minWidth: 24 }}>{k}</b></div><span className="lbl">Групи з меншою кількістю відповідей приховано, показано рівень вище.</span></div>
        <div className="stat4" style={{ gridTemplateColumns: "1fr 1fr" }}><div><small>Жетонів видано</small><b className="tnum"><Num v={tot} d={0} /></b></div><div><small>Використано</small><b className="tnum"><Num v={used} d={0} /></b></div></div>
        <div id="closeZone">{S.cycleOpen
          ? ask ? <><div className="lbl" style={{ marginBottom: 8 }}>Після завершення відповіді більше не прийматимуться, а жетони, що лишились, стануть недійсними.</div><div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setAsk(false)}>Скасувати</button><button className="btn btn-danger" style={{ flex: 1, justifyContent: "center" }} onClick={() => { S.cycleOpen = false; addLog(me(), `Цикл ${CYCLE} завершено`); persist(); setAsk(false); render(true); }}>Завершити</button></div></>
            : <button className="btn btn-soft" style={{ width: "100%", justifyContent: "center" }} onClick={() => setAsk(true)}>Завершити цикл</button>
          : <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => { S.cycleOpen = true; addLog(me(), `Цикл ${CYCLE} відновлено`); persist(); render(true); }}>Відновити цикл</button>}</div>
      </div>
    </section>
    <section className="card c12 rise">
      <div className="card-h"><h2>Цикли оцінювання</h2></div>
      <div className="tbl-wrap"><table><thead><tr><th>Цикл</th><th>Період</th><th>Мінімальна група</th><th>Жетонів видано / використано</th><th>Статус</th></tr></thead><tbody>
        {rows.map(([c, p, kk, t, st]) => <tr key={c}><td><b>{c}</b></td><td>{p}</td><td className="tnum">{kk}</td><td className="tnum">{t}</td><td><Pill cls={st[1]}>{st[0]}</Pill></td></tr>)}
      </tbody></table></div>
    </section>
    <UrnDemo />
  </>;
}

/* Анкети (Департамент) */
export function Surveys() {
  return <>{S.qs.map((q, i) => <section key={q.id} className="card c6 rise">
    <div className="comp-top"><span className="comp-ic" style={{ background: "var(--lime-soft)", color: "var(--teal-deep)" }}><Ic n="survey" /></span><b>{q.t}</b><div className="sp" style={{ flex: 1 }} /><Pill cls={q.st === "published" ? "p-good" : "p-warn"}>{q.st === "published" ? "Опубліковано" : "Чернетка"}</Pill></div>
    <div className="stat4 tnum" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 14 }}><div><small>Група</small><b style={{ fontSize: 14 }}>{q.grp}</b></div><div><small>Версія</small><b>{q.ver}</b></div><div><small>Питань</small><b>{q.n}</b></div></div>
    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}><span className="lbl">Оновлено {q.upd}</span><div className="sp" style={{ flex: 1 }} />
      <button className="btn btn-soft" onClick={() => openQ(i)}><Ic n="eye" />Переглянути</button>
      {q.st === "published" ? <button className="btn btn-ghost" onClick={() => newVer(i)}><Ic n="plus" />Нова версія</button> : <button className="btn btn-primary" onClick={() => publishQ(i)}><Ic n="ok" />Опублікувати в цикл {CYCLE}</button>}</div>
  </section>)}</>;
}
function openQ(i) {
  const q = S.qs[i];
  openDrawer(q.t, () => <>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Pill cls="p-mute nodot">Версія {q.ver}</Pill><Pill cls="p-mute nodot">{q.grp}</Pill></div>
    {q.id === "q-os" || q.id.startsWith("q-os")
      ? SURVEY.sections.map(s => <div key={s.id}><div className="lbl" style={{ marginBottom: 6 }}>Розділ «{s.t}» · {s.about}</div><div className="rows">{s.q.map(([id, t, o], j) => <div key={id} className="row" style={{ alignItems: "flex-start" }}><span className="lbl tnum">{j + 1}</span><div className="grow">{t}<div className="s">{o.length} варіанти відповіді, рівні 1–5</div></div></div>)}</div></div>)
      : <div className="lbl">Перелік питань цієї анкети підключається з Рекомендацій НУОУ (Додаток В). У прототипі показано повністю анкету особового складу.</div>}
  </>);
}
function newVer(i) { const q = S.qs[i]; S.qs.splice(i + 1, 0, { ...q, id: q.id + "-v" + (q.ver + 1), ver: q.ver + 1, st: "draft", upd: TODAY_UA }); addLog(me(), `Створено чернетку «${q.t}», версія ${q.ver + 1}`); persist(); render(true); toast("Створено чернетку нової версії"); }
function publishQ(i) { const q = S.qs[i]; S.qs.forEach(x => { if (x.t === q.t && x !== q && x.st === "published") x.st = "archived"; }); q.st = "published"; q.upd = TODAY_UA; S.qs = S.qs.filter(x => x.st !== "archived"); addLog(me(), `Опубліковано «${q.t}», версія ${q.ver}, у цикл ${CYCLE}`); persist(); render(true); toast("Анкету опубліковано в цикл"); }

/* Чек-лист: чотири ока — один вносить, інший підтверджує */
const valText = (f, val) => f.kind === "pct" ? `${val[0]} з ${val[1]}` : `Рівень ${val} з 5`;
export function Checklist() {
  const ed = S.role === "checklist_editor", m = inst(ALPHA);
  const pend = Object.keys(S.fpend).length, ret = FACTS.filter(f => S.fpend[f.id] && S.fpend[f.id].ret).length;
  return <>
    <section className="card c4 rise kpi-tile"><div className="kt-h"><span className="kt-ic"><Ic n="ok" /></span><span className="lbl">Підтверджено</span></div><div className="kt-b"><span className="mid tnum">{FACTS.length - pend}</span><div className="kt-s lbl">з {FACTS.length} показників фактів</div></div></section>
    <section className="card c4 rise kpi-tile"><div className="kt-h"><span className="kt-ic"><Ic n="history" /></span><span className="lbl">Очікують підтвердження</span></div><div className="kt-b"><span className="mid tnum" style={{ color: pend - ret ? "var(--amber)" : "inherit" }}>{pend - ret}</span><div className="kt-s lbl">До індексу не потрапляють</div></div></section>
    <section className="card c4 rise kpi-tile"><div className="kt-h"><span className="kt-ic"><Ic n="reset" /></span><span className="lbl">Повернуто на уточнення</span></div><div className="kt-b"><span className="mid tnum" style={{ color: ret ? "var(--red)" : "inherit" }}>{ret}</span><div className="kt-s lbl">{ed ? "Виправте й внесіть знову" : "Чекають на виконавця"}</div></div></section>
    <section className="card c12 rise">
      <div className="card-h"><h2>Показники фактів</h2><div className="sp" /><span className="lbl">{ed ? "Ви вносите дані. Підтверджує інший працівник." : "Ви підтверджуєте дані, які вніс інший працівник."}</span></div>
      <div className="tbl-wrap"><table><thead><tr><th>Показник</th><th>Компонент</th><th>Підтверджене значення</th><th>Джерело і дата</th><th>Стан</th><th></th></tr></thead><tbody>
        {FACTS.map(f => {
          const conf = S.facts[f.id], p = S.fpend[f.id], val = conf ? conf.val : f.base, meta = conf ? [conf.at, conf.by] : (f.id === "sy-f1" ? ["12.11.2026", "Уповноважений"] : ["10.11.2026", "Вносить дані чек-листа"]);
          return <tr key={f.id}><td style={{ minWidth: 240 }}><b style={{ fontWeight: 600 }}>{f.t}</b></td><td><Pill cls="p-mute nodot">{COMP[f.c].n}</Pill></td>
            <td className="tnum" style={{ whiteSpace: "nowrap" }}>{valText(f, val)}<div className="lbl">{fb(factValue(f, val))} зі 100</div></td>
            <td className="lbl" style={{ minWidth: 160 }}>{(conf && conf.src) || f.from}<br />{meta[0]} · {meta[1]}<Docs list={(p && p.files) || (conf && conf.files)} warn={!!p} /></td>
            <td style={{ minWidth: 170 }}>{p ? (p.ret ? <><Pill cls="p-bad">Повернуто</Pill><div className="lbl" style={{ marginTop: 4 }}>{p.ret}</div></> : <><Pill cls="p-warn">Очікує підтвердження</Pill><div className="lbl tnum" style={{ marginTop: 4 }}>Нове: {valText(f, p.val)} ({fb(factValue(f, p.val))})</div></>) : <Pill cls="p-good">Підтверджено</Pill>}</td>
            <td style={{ whiteSpace: "nowrap" }}>{ed ? <button className="btn btn-soft" style={{ padding: "6px 12px" }} onClick={() => editFact(f.id)}><Ic n="edit" />Внести</button> : p && !p.ret ? <><button className="btn btn-primary" style={{ padding: "6px 12px" }} onClick={() => approveFact(f.id)}><Ic n="ok" />Підтвердити</button> <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={() => returnFact(f.id)}>Повернути</button></> : null}</td></tr>;
        })}
      </tbody></table></div>
    </section>
    <section className="card c12 rise"><div className="lock"><Ic n="shield" /><div><b>До індексу потрапляють лише підтверджені значення.</b><div className="lbl">Поточний індекс закладу {f1(m.index)}. Після підтвердження система одразу перераховує компонент, правило «факти + 25» і прапорці. Кожна дія записується в журнал.</div></div></div></section>
  </>;
}
function editFact(id) {
  const f = FACTS.find(x => x.id === id), p = S.fpend[id], conf = S.facts[id], val = p ? p.val : conf ? conf.val : f.base;
  openDrawer("Внести дані чек-листа", () => {
    const [lvl, setLvl] = useState(f.kind === "pct" ? null : val), [num, setNum] = useState(f.kind === "pct" ? val[0] : 0), [den, setDen] = useState(f.kind === "pct" ? val[1] : 1);
    const [src, setSrc] = useState((conf && conf.src) || f.from), [err, setErr] = useState(""), [files, setFiles] = useState((p && p.files) || []);
    const ok = async () => {
      let v = lvl;
      if (f.kind === "pct") { const n = +num, d = +den; if (!(d > 0) || n < 0 || n > d || !Number.isInteger(n) || !Number.isInteger(d)) return setErr("Кількість має бути цілим числом від 0 до загальної кількості."); v = [n, d]; }
      const docs = await Promise.all(files.map(demoDoc));
      S.fpend[id] = { val: v, src: src.trim() || f.from, at: TODAY_UA, by: me(), files: docs };
      addLog(me(), `Чек-лист: внесено «${f.t}» = ${valText(f, v)}${docs.length ? `, документів: ${docs.length}` : ""}`); persist(); closeDrawer(); render(true); toast("Надіслано на підтвердження");
    };
    return <>
      <div><div className="lbl">{COMP[f.c].n}</div><div style={{ fontWeight: 600, marginTop: 4 }}>{f.t}</div></div>
      {f.kind === "pct"
        ? <div style={{ display: "flex", gap: 10 }}><div className="field" style={{ flex: 1 }}><label htmlFor="f-num">Кількість</label><input className="inp tnum" type="number" min="0" id="f-num" value={num} onChange={e => setNum(e.target.value)} /></div><div className="field" style={{ flex: 1 }}><label htmlFor="f-den">З них усього</label><input className="inp tnum" type="number" min="1" id="f-den" value={den} onChange={e => setDen(e.target.value)} /></div></div>
        : <div className="field"><label>Рівень за анкетою чек-листа</label><div className="seg" id="f-lvl">{[1, 2, 3, 4, 5].map(l => <button key={l} type="button" className={l === lvl ? "on" : ""} onClick={() => setLvl(l)}>{l}</button>)}</div><span className="lbl">Рівень переводиться у шкалу 0-100: рівень 1 це 0, рівень 5 це 100.</span></div>}
      <div className="field"><label>Документи-підтвердження</label><FileDrop files={files} onChange={setFiles} maxBytes={DEMO_MAX} maxFiles={10} hint="Наказ, протокол, скан, фото; у демо до 1 МБ." /></div>
      <div className="field"><label htmlFor="f-src">Джерело (документ, реєстр)</label><input className="inp" id="f-src" value={src} onChange={e => setSrc(e.target.value)} /></div>
      <span className="lbl" id="f-err" style={err ? { color: "color-mix(in srgb, var(--red) 60%, var(--fg))" } : undefined}>{err}</span>
      <button className="btn btn-primary" id="f-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="send" />Надіслати на підтвердження</button>
    </>;
  });
}
/* Документи в демо: зберігаються в браузері (localStorage), тому лише невеликі, до 1 МБ */
const DEMO_MAX = 1048576;
const demoDoc = f => !(f instanceof Blob) ? Promise.resolve(f) : new Promise(res => { const r = new FileReader(); r.onload = () => res({ name: f.name, size: f.size, data: r.result }); r.onerror = () => res({ name: f.name, size: f.size }); r.readAsDataURL(f); });
function Docs({ list, warn }) {
  if (!list || !list.length) return <div className={`ck-nodoc ${warn ? "warn" : ""}`}>Документа немає</div>;
  return <div className="ck-docs">{list.map((d, i) => <a key={i} className="link" href={d.data || "#"} download={d.name} onClick={d.data ? undefined : e => e.preventDefault()}><Ic n="file" size={14} />{d.name}</a>)}</div>;
}
function approveFact(id) {
  const f = FACTS.find(x => x.id === id), p = S.fpend[id], before = inst(ALPHA).index;
  S.facts[id] = { val: p.val, src: p.src, at: TODAY_UA, by: p.by, files: p.files }; delete S.fpend[id];
  const after = inst(ALPHA).index;
  addLog(me(), `Чек-лист: підтверджено «${f.t}» = ${valText(f, p.val)}${after !== before ? `; індекс ${f1(before)} → ${f1(after)}` : ""}`); persist(); render(true);
  toast(after !== before ? `Підтверджено. Індекс перераховано: ${f1(before)} → ${f1(after)}` : "Підтверджено. Індекс не змінився.");
}
function returnFact(id) {
  const f = FACTS.find(x => x.id === id);
  openDrawer("Повернути на уточнення", () => {
    const [t, setT] = useState(""), ta = useRef(null);
    const ok = () => { const v = t.trim(); if (!v) { ta.current.focus(); return; } S.fpend[id].ret = v; addLog(me(), `Чек-лист: «${f.t}» повернуто: ${v}`); persist(); closeDrawer(); render(true); toast("Повернуто виконавцю"); };
    return <><div style={{ fontWeight: 600 }}>{f.t}</div><div className="field"><label htmlFor="f-why">Що потрібно виправити</label><textarea className="inp" id="f-why" rows="3" ref={ta} value={t} onChange={e => setT(e.target.value)} /></div><button className="btn btn-danger" id="f-no" style={{ justifyContent: "center" }} onClick={ok}>Повернути</button></>;
  });
}

/* Журнал */
let chainMsg = null;
export function Audit() {
  const all = logItems(), q = (S.logQ || "").trim().toLowerCase(), who = S.logWho || "all";
  const shown = all.map((x, i) => ({ ...x, n: i + 1 })).filter(x => (who === "all" || x.who === who) && (!q || (x.a + " " + x.who + " " + x.t + " " + x.h).toLowerCase().includes(q))).reverse();
  // однакові записи підряд (наприклад, кілька перевірок) показуються одним рядком з лічильником
  const groups = []; shown.forEach(x => { const g = groups[groups.length - 1]; if (g && g[0].a === x.a && g[0].who === x.who) g.push(x); else groups.push([x]); });
  const actors = [...new Set(all.map(x => x.who))].sort();
  useEffect(() => () => { chainMsg = null; }, []);
  const verify = () => { let prev = "0", ok = true; logItems().forEach(x => { const h = fnv(prev + x.t + x.who + x.a); if (h !== x.h) ok = false; prev = h; }); addLog(me(), "Перевірка цілісності журналу"); const n = logItems().length; chainMsg = ok ? [`Перевірено ${n} записів, розривів немає`, "p-good"] : ["Ланцюг порушено", "p-bad"]; render(true); toast(ok ? "Ланцюг цілісний. Сама перевірка теж записана в журнал." : "Ланцюг порушено"); };
  return <section className="card c12 rise">
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Журнал дій</h2><div className="sp" /><span id="chainSt"><Pill cls={chainMsg ? chainMsg[1] : "p-good"}>{chainMsg ? chainMsg[0] : "Ланцюг цілісний"}</Pill></span><button className="btn btn-soft" onClick={verify}><Ic n="shield" />Перевірити цілісність</button></div>
    <div className="toolbar" style={{ marginBottom: 8 }}><label className="search inst-search"><span><Ic n="search" /></span><input id="logQ" placeholder="Дія, роль, дата або хеш" value={S.logQ || ""} onChange={e => { S.logQ = e.target.value; render(true); }} /></label>
      <select className="inp" aria-label="Хто" value={who} onChange={e => { S.logWho = e.target.value; render(true); }}><option value="all">Усі ролі</option>{actors.map(a => <option key={a}>{a}</option>)}</select>
      <span className="lbl tnum">Показано {shown.length} з {all.length}</span></div>
    {groups.length ? <div className="tl">{groups.map((g, i) => { const x = g[0], open = () => openLog(x.n, g.length > 1 ? g[g.length - 1].n : undefined); return <div key={x.n} className="tl-i rise click" role="button" tabIndex={0} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }} onClick={open} onKeyDown={enter(open)}><span className="nd" /><div><div style={{ fontWeight: 500 }}>{x.a}{g.length > 1 && <> <span className="pill p-mute nodot">×{g.length}</span></>}</div><div className="lbl">{x.who} · {g.length > 1 ? `${g[g.length - 1].t} – ${x.t}` : x.t}</div></div><span className="hash">{x.h}</span></div>; })}</div> : <div className="empty">Записів за цим запитом немає.</div>}
  </section>;
}
// Подробиці запису: що, хто, коли, номер у ланцюгу, хеш попереднього, перевірка саме цього запису
function openLog(n, n2) {
  const all = logItems(), x = all[n - 1], prev = n > 1 ? all[n - 2].h : "0", ok = fnv(prev + x.t + x.who + x.a) === x.h;
  openDrawer("Запис журналу", () => <>
    <div><div className="lbl">Запис № {n} з {all.length}</div><div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{x.a}</div></div>
    {n2 && <div className="note-box"><span className="lbl">Таких записів підряд: {n - n2 + 1} (№ {n2}–{n}). Показано останній.</span></div>}
    <dl className="inst-kv" style={{ gridTemplateColumns: "auto 1fr" }}><dt>Хто</dt><dd>{x.who}</dd><dt>Коли</dt><dd className="tnum">{x.t}</dd><dt>Хеш запису</dt><dd><span className="hash">{x.h}</span></dd><dt>Хеш попереднього</dt><dd><span className="hash">{prev}</span></dd></dl>
    <div><Pill cls={ok ? "p-good" : "p-bad"}>{ok ? "Запис не змінювали" : "Запис змінено після створення"}</Pill></div>
    <div className="lbl">Хеш рахується з попереднього хешу, часу, ролі й опису дії. Якщо змінити будь-що в цьому чи попередніх записах, хеші далі по ланцюгу не зійдуться. Імен і відповідей респондентів у журналі немає, лише ролі.</div>
  </>);
}

/* Опитування за жетоном */
const answered = () => SQ().filter(q => S.survey.a[q.id] != null).length;
function pick(id, i) { S.survey.a[id] = i; saveDraft(S.survey.a); render(true); }
function submitSurvey() {
  if (answered() < SQ().length) { S.survey.miss = true; render(true); return; }
  if (API.on) return apiSubmitSurvey();
  S.survey = { phase: "done", sec: 0, a: {}, miss: false }; S.tokenUsed = true; UNIT_RESP[S.unit] = (UNIT_RESP[S.unit] || 0) + 1;
  clearDraft();
  addLog("Система", "Отримано анонімну відповідь, жетон погашено"); persist(); render();
}
// Підказка до питання: рядки «• …» показуємо списком (твердження непрямого питання), решту абзацом
function QHelp({ t }) {
  const lines = String(t).split("\n").map(x => x.trim()).filter(Boolean), items = lines.filter(x => x.startsWith("•")), rest = lines.filter(x => !x.startsWith("•"));
  return <div className="q-help">{rest.map((x, i) => <p key={i} className="lbl">{dsh(x)}</p>)}{items.length > 0 && <ul>{items.map((x, i) => <li key={i}>{dsh(x.replace(/^•\s*/, ""))}</li>)}</ul>}</div>;
}
export function Survey() {
  const sv = S.survey, N = SQ().length;
  // Подяка лишається, поки людина на екрані; коли вона йде з нього (або відкриває пункт меню заново), анкета починається спочатку
  const thanked = useRef(false);
  if (sv.phase === "done") thanked.current = true;
  useEffect(() => () => { if (thanked.current && S.survey.phase === "done") S.survey.phase = "intro"; }, []);
  if ((API.on ? API.surveyUsed : S.tokenUsed) && sv.phase !== "done") return <div className="survey c12"><section className="card rise" style={{ padding: 32, textAlign: "center" }}><div className="done-ic" style={{ background: "var(--soft)", color: "var(--muted)" }}><Ic n="lock" /></div>
    <h2 style={{ margin: "18px 0 6px", fontSize: 22, fontWeight: 600 }}>Цю анкету вже заповнено</h2><p className="lbl" style={{ maxWidth: 480, margin: "0 auto 20px" }}>Повторно відповісти за цим посиланням не можна: так ми захищаємо анонімність і не допускаємо подвоєних відповідей. Дякуємо за участь.</p>
    {!API.anon && <a className="btn btn-primary" href="#me">Мої результати <Ic n="arrowR" /></a>}</section></div>;
  if (sv.phase === "intro") return <div className="survey c12"><section className="card rise" style={{ padding: 28 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}><span className="comp-ic" style={{ background: "var(--lime-soft)", color: "var(--teal-deep)" }}><Ic n="shield" /></span><span className="lbl">{SV().cat} · {API.on ? (API.anon ? "одноразове посилання" : "за обліковим записом") : "жетон demo"}</span></div>
    <h2 style={{ margin: "6px 0 18px", fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>{SV().title}</h2>
    <div className="guar">
      <div><Ic n="lock" /><b>Без імен</b><span className="lbl">Ваші відповіді не повʼязані з вами і не містять імен.</span></div>
      <div><Ic n="eye" /><b>Лише кількість</b><span className="lbl">Адміністратор бачить лише кількість відповідей, а не те, що ви відповіли.</span></div>
      <div><Ic n="users" /><b>Від {S.k} осіб</b><span className="lbl">Результати показують лише для груп не менше {S.k} осіб.</span></div>
    </div>
    <PrivacyNote />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, flexWrap: "wrap", gap: 12 }}><span className="lbl">{answered() ? `Збережені раніше відповіді на цьому пристрої буде підставлено (${answered()} з ${N}).` : "Відповіді зберігаються на цьому пристрої, поки ви заповнюєте."}</span><button className="btn btn-primary" onClick={() => { S.survey.phase = "form"; render(); }}>Розумію, почати <Ic n="arrowR" /></button></div>
  </section></div>;
  if (sv.phase === "done") return <div className="survey c12"><section className="card rise" style={{ padding: 36, textAlign: "center" }}><div className="done-ic"><Ic n="ok" /></div>
    <h2 style={{ margin: "18px 0 6px", fontSize: 24, fontWeight: 600 }}>Дякуємо. Ваші відповіді збережено анонімно.</h2>
    <p className="lbl" style={{ maxWidth: 520, margin: "0 auto 20px" }}>Що далі: коли відповість достатньо людей (не менше {S.k}), {API.anon ? "узагальнені результати підрозділу стануть доступні керівництву й учасникам" : "ви зможете побачити узагальнені результати свого підрозділу"}. Окремих відповідей і імен там не буде.</p>
    {sv.receipt && <ReceiptBox r={sv.receipt} />}
    {!API.anon && <a className="btn btn-primary" href="#me">Переглянути результати підрозділу <Ic n="arrowR" /></a>}</section></div>;
  const sec = SV().sections[sv.sec], SC = COMP[sec.id] || { s: "var(--soft)", c: "var(--muted)", ic: "survey" }, last = sv.sec === SV().sections.length - 1, miss = SQ().filter(q => sv.a[q.id] == null);
  const goMiss = q => { S.survey.sec = q.si; S.survey.miss = false; render(true); setTimeout(() => { const el = document.getElementById("q-" + q.id); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); };
  return <div className="survey c12">
    <div className="sv-top"><span className="lbl">Розділ {sv.sec + 1} з {SV().sections.length}</span><div className="qprog" style={{ flex: 1 }}>{SQ().map(q => <span key={q.id} className={`${q.si === sv.sec ? "cur" : ""} ${sv.a[q.id] != null ? "done" : ""}`} />)}</div><span className="lbl tnum">Відповіли на {answered()} з {N}</span><button className="icon-btn" aria-label="Закрити" onClick={() => { S.survey.phase = "intro"; render(); toast("Відповіді лишаються на цьому пристрої. Їх ще не надіслано."); }}><Ic n="x" /></button></div>
    <div className="qcard" key={sv.sec}>
      <div className="sv-sec-h"><span className="comp-ic" style={{ background: SC.s, color: SC.c }}><Ic n={SC.ic} /></span><div><b>{sec.t}</b><div className="lbl">{sec.about}</div></div></div>
      {sec.q.map(([id, t, o, help], qi) => <fieldset key={id} className="card qf" id={`q-${id}`}><legend>{qi + 1}. {t}</legend>{help ? <QHelp t={help} /> : null}<div className="opts">{o.map((x, i) => <button key={i} type="button" className={`opt ${sv.a[id] === i ? "on" : ""}`} aria-pressed={sv.a[id] === i} onClick={() => pick(id, i)}><span className="rb" /><span>{x}</span></button>)}</div></fieldset>)}
      {sv.miss && last && miss.length > 0 && <div className="note-box" style={{ marginTop: 12 }}><b>Залишилось відповісти на {miss.length} {miss.length === 1 ? "питання" : miss.length < 5 ? "питання" : "питань"}</b><span className="lbl">Натисніть на питання, щоб перейти до нього.</span>{miss.map(q => <a key={q.id} className="link" href="#survey" onClick={e => { e.preventDefault(); goMiss(q); }}>Розділ «{SV().sections[q.si].t}», питання {q.qi + 1}</a>)}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 10 }}>
        <button className="btn btn-ghost" disabled={sv.sec === 0} onClick={() => { S.survey.sec--; S.survey.miss = false; render(); window.scrollTo(0, 0); }}><Ic n="arrowL" />Назад</button>
        {last ? <button className="btn btn-primary" onClick={submitSurvey}><Ic n="send" />Надіслати</button> : <button className="btn btn-primary" onClick={() => { S.survey.sec++; render(); window.scrollTo(0, 0); }}>Далі <Ic n="arrowR" /></button>}
      </div>
    </div></div>;
}

/* Мої результати */
export function Me() {
  const r = resolveUnit(S.unit), cr = UNIT_CR[r.unit.id] || Object.fromEntries(inst(ALPHA).components.map(c => [c.id, c.cr.v])), idx = indexOf(cr), lv = level(idx);
  return <>
    <section className="c12 rise toolbar"><div className="sp" />
      <label className="lbl">Мій підрозділ <select className="inp" value={S.unit} onChange={e => { S.unit = e.target.value; persist(); render(true); }}>{UNITS.filter(u => u.parent && u.id !== "unit-v").map(u => <option key={u.id} value={u.id}>{u.n}</option>)}</select></label></section>
    <LearnCard />
    {r.hidden && <section className="card c12 rise"><div className="lock"><Ic n="lock" /><div><b>{r.req.n}: результати приховано</b><div className="lbl">Недостатньо відповідей, щоб показати результати цієї групи ({UNIT_RESP[r.req.id]} з потрібних {S.k}). Нижче дані підрозділу «{r.unit.n}». Це рівень вище, а не ваш підрозділ. Так захищено анонімність учасників.</div></div></div></section>}
    <section className="card c5 rise">
      <div className="lbl">{r.unit.n}: відповіли {r.resp} осіб (потрібно не менше {S.k})</div>
      <div className="big tnum" style={{ marginTop: 12 }}><Num v={idx} /><span className="of">з 100</span></div>
      <div style={{ margin: "10px 0 14px" }}><LvPill l={lv} /></div>
      <LevelBar v={idx} />
      <div className="lbl" style={{ marginTop: 12 }}>Що це: індекс доброчесності від 0 до 100, середнє трьох компонентів. Шкала рівнів від 1 до 5.</div>
    </section>
    <section className="card c7 rise">
      <div className="card-h"><h2>Три компоненти</h2></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{COMPS.map((c, i) => <div key={c}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="comp-ic" style={{ background: COMP[c].s, color: COMP[c].c }}><Ic n={COMP[c].ic} /></span><b>{COMP[c].n}</b></span><span style={{ display: "flex", gap: 8, alignItems: "center" }}><b className="tnum">{fb(cr[c])} з 100</b><LvPill l={level(cr[c])} /></span></div>
        <Ticks n={20} on={Math.round(cr[c] / 5)} color={COMP[c].c} delay={i * 120} /></div>)}</div>
      <div className="lbl" style={{ marginTop: 14 }}>Значення компонента від 0 до 100: чим більше, тим системніше працює напрям.</div>
    </section>
    <section className="card c6 rise"><div className="card-h"><h2>Що зроблено з минулого циклу</h2></div>
      <div className="rows">{["Спростили процедуру звернень: тепер подати звернення можна за кілька хвилин.", "Провели два практичних заняття з прикладами з роботи закладу.", "Оприлюднили підсумки минулої перевірки разом із кроками, що робитимуть далі."].map(t => <div key={t} className="row" style={{ alignItems: "flex-start" }}><span className="comp-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)", width: 28, height: 28 }}><Ic n="ok" /></span><div className="grow">{t}</div></div>)}</div></section>
    <section className="card c6 rise"><div className="card-h"><h2>Що буде далі</h2></div>
      <div className="rows">{["Опублікуємо короткий посібник про те, куди й як повідомляти про проблеми.", "У наступному циклі окремо запитаємо, чи стало зрозуміліше, що відбувається після звернення."].map(t => <div key={t} className="row" style={{ alignItems: "flex-start" }}><span className="comp-ic" style={{ background: "var(--amber-soft)", color: "var(--amber)", width: 28, height: 28 }}><Ic n="arrowR" /></span><div className="grow">{t}</div></div>)}</div></section>
  </>;
}
