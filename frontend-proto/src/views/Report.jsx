/* Звіт за шаблоном Додатку Г Рекомендацій НУОУ: формальний документ без кольорів і бейджів. Експорт у кількох форматах. */
import { Fragment, useEffect, useRef } from "react";
import { Ic } from "../lib/icons.jsx";
import { S, AI_ROLES, persist, addLog, me } from "../lib/state.js";
import { COMP, LEVELS, CAP, TRUST, REC_ST, M_ST, ALPHA, level, allItems, buildRecs, measures, dispSt, CYCLE, TODAY, TODAY_UA } from "../lib/model.js";
import { fb, f1, pts, ua } from "../lib/format.js";
import { render, toast, ui } from "../lib/store.js";
import { cur } from "../lib/nav.js";
import { download, copyText } from "../lib/util.js";
import { aiOpen } from "../ai/assistant.jsx";
import { respGroups } from "./panels.jsx";
import { BackToInst } from "./results.jsx";

const SEC_ABOUT = {
  culture: "Розділ оцінює роль керівництва, інтеграцію цінностей доброчесності в корпоративну культуру, ефективність освітніх заходів та рівень відкритості.",
  system: "Розділ аналізує інституційну спроможність у сфері антикорупції та доброчесності: організацію роботи антикорупційного уповноваженого, процедури й канали звернень.",
  accountability: "Розділ оцінює практичні механізми контролю та реагування: прозорість рішень, оприлюднення результатів перевірок, контроль виконання заходів.",
};
const GRP = { wg: "РГ", os: "ОС", experts: "Експерти" };

export function Report() {
  const m = cur(), recs = m.id === ALPHA ? buildRecs(m) : [], ms = m.id === ALPHA ? measures() : [], gs = respGroups(m);
  const g = k => gs.filter(x => k === "wg" ? x.n === "Робоча група" : k === "ex" ? x.n === "Експерти" : x.n !== "Робоча група" && x.n !== "Експерти").reduce((a, x) => a + x.resp, 0);
  const lvT = v => `${level(v)}. ${LEVELS[level(v) - 1]}`;
  const best = [...m.components].filter(c => !c.cr.lim).sort((a, b) => b.cr.v - a.cr.v), low = [...m.components].sort((a, b) => a.cr.v - b.cr.v).filter(c => c.cr.v < 65 || c.cr.lim);
  const weakItems = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
  const props = recs.filter(r => r.st !== "rejected");
  const lowList = [...low.map(c => `${COMP[c.id].n}: ${c.cr.lim ? "самооцінку не підтверджують факти" : `зараховано ${fb(c.cr.v)}`}.`), ...weakItems.map(x => `${x.t}: ${fb(x.v)} з 100.`)].slice(0, 4);
  return <>
    <BackToInst />
    <div className="c12 rise toolbar"><span className="lbl">Форма звіту відповідає Додатку Г Рекомендацій НУОУ.</span><div className="sp" />
      {S.aiOn && AI_ROLES.includes(S.role) && <button className="btn btn-soft" onClick={() => aiOpen("Підготуй чернетку опису результатів для звіту")}><Ic n="spark" />Чернетка опису</button>}
      <button className="btn btn-primary" onClick={() => { ui.exp = true; render(true); }}><Ic n="download" />Експорт</button>
    </div>
    <article className="paper doc c12 rise">
      <div className="doc-approve">ЗАТВЕРДЖУЮ<br />Голова робочої групи<br /><span className="doc-blank">військове звання</span><br /><span className="doc-blank">Імʼя ПРІЗВИЩЕ</span><br />«___» ____________ 2026 року</div>
      <h2 className="doc-title">ЗВІТ</h2>
      <p className="doc-sub">про результати опитувань з визначення поточного рівня зрілості доброчесності<br />{m.name}</p>
      <p className="doc-meta">Цикл оцінювання {CYCLE}. Дані станом на {TODAY_UA}. Синтетичні дані для демонстрації.</p>
      <p>На підставі наказу керівника закладу {m.name} від «___» ____________ 2026 року № ___ «Про організацію роботи з трансформації функціонування закладу на засадах прозорості та доброчесності» проведено роботу з визначення поточного рівня зрілості доброчесності за Моделлю зрілості НАЗК.</p>
      <p>Проведено анонімне опитування трьох категорій респондентів:</p>
      <p>І категорія: члени робочої групи (далі РГ), відповіли {g("wg")} осіб.<br />ІІ категорія: особовий склад закладу (далі ОС), відповіли {g("os")} осіб.<br />ІІІ категорія: зовнішні експерти, відповіли {g("ex")} осіб.</p>
      <p><b>Мета опитування:</b></p>
      <ul>
        <li>визначення фактичного рівня зрілості системи доброчесності за кожним ключовим напрямом;</li>
        <li>ідентифікація найслабших місць у робочих процесах і визначення сильних сторін;</li>
        <li>формування базового показника («точки відліку») для відстеження подальшого розвитку;</li>
        <li>забезпечення керівництва обʼєктивними даними для планування заходів.</li></ul>
      <p><b>Методика дослідження:</b></p>
      <p>Онлайн-опитування на платформі з одноразовими анонімними жетонами. Результати групи показуються, лише якщо відповіли щонайменше {S.k} осіб. Відповіді переведено в бали від 0 до 100. Сприйняття за кожним напрямом зіставлено з фактами контрольного чек-листа та даних обліку. Якщо сприйняття перевищує факти більш ніж на {CAP} пунктів, зараховується значення «факти + {CAP}». Індекс доброчесності є середнім трьох напрямів, рівень зрілості визначається межами 12,5 / 37,5 / 62,5 / 87,5.</p>
      <p><b>Основна частина:</b></p>
      <p>Аналіз проведено за трьома розділами Моделі зрілості НАЗК: «Культура», «Система» та «Підзвітність».</p>
      {m.components.map((c, ci) => <Fragment key={c.id}>
        <h3>Розділ {ci + 1}. {COMP[c.id].n}</h3>
        <p>{SEC_ABOUT[c.id]}</p>
        <p className="doc-cap">Таблиця {ci * 2 + 1}. Сприйняття за питаннями анкет</p>
        <table className="doc-t"><thead><tr><th>№</th><th>Питання</th><th>Категорія</th><th>Вага, %</th><th>Середній бал</th><th>Рівень зрілості (за моделлю НАЗК)</th></tr></thead><tbody>
          {m.pItems.filter(x => x.c === c.id).map((x, i) => <tr key={x.id}><td>{ci + 1}.{i + 1}</td><td>{x.t}</td><td>{GRP[x.src]}</td><td className="tnum">{x.w}</td><td className="tnum">{fb(x.v)}</td><td>{lvT(x.v)}</td></tr>)}</tbody></table>
        <p className="doc-cap">Таблиця {ci * 2 + 2}. Факти: контрольний чек-лист і дані обліку</p>
        <table className="doc-t"><thead><tr><th>№</th><th>Показник</th><th>Дані</th><th>Вага, %</th><th>Бал</th></tr></thead><tbody>
          {m.fItems.filter(x => x.c === c.id).map((x, i) => <tr key={x.id}><td>{ci + 1}.{i + 1}</td><td>{x.t}</td><td>{x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`}</td><td className="tnum">{x.w}</td><td className="tnum">{fb(x.v)}</td></tr>)}</tbody></table>
        <p>За розділом «{COMP[c.id].n}» сприйняття становить {fb(c.P)}, факти {fb(c.F)}, зараховано {fb(c.cr.v)} з 100, що відповідає рівню зрілості {lvT(c.cr.v)}.{c.cr.lim ? ` ${c.cr.reason}` : ""} {c.P - c.F > 10 ? "Самооцінка помітно вища за підтверджені факти, тож висновки потребують підтвердження документами." : c.F - c.P > 10 ? "Факти вищі за сприйняття: наявні процедури варто краще доносити до особового складу." : "Сприйняття й факти в цілому узгоджуються."}</p>
      </Fragment>)}
      <h3>Розділ 4. Достовірність результатів</h3>
      <p>Достовірність {m.trust === "insufficient" ? "не оцінюється" : m.trust}: {TRUST[m.trust][1].toLowerCase()}. {m.raised.length ? `Спрацювало автоматичних перевірок: ${m.raised.length}.` : "Жодна автоматична перевірка не спрацювала."}</p>
      {m.raised.length > 0 && <ol>{m.raised.map(f => <li key={f.id}>{f.t} ({f.w === "major" ? "серйозна" : "незначна"}). {f.ex}</li>)}</ol>}
      <h3>Висновок</h3>
      <p>На основі аналізу відповідей респондентів за критеріями розділів «Культура», «Система» та «Підзвітність» Моделі зрілості НАЗК <b>загальний рівень зрілості доброчесності у {m.name} можна оцінити як «{LEVELS[m.level - 1]}»</b> (рівень {m.level} з 5; індекс доброчесності {f1(m.index)} з 100; {m.delta == null ? "дані про попередній цикл недоступні" : `${m.delta > 0 ? `на ${pts(m.delta)} вище` : m.delta < 0 ? `на ${pts(m.delta)} нижче` : "без змін"} порівняно з попереднім циклом`}).</p>
      <p><i>Довідково:</i> {m.fItems.filter(x => x.kind === "pct").map(x => `${x.t.toLowerCase()}: ${x.val[0]} з ${x.val[1]}`).join("; ")}.</p>
      <p><b>Найбільш ефективні напрями:</b></p>
      <ol>{best.slice(0, 2).map(c => <li key={c.id}>{COMP[c.id].n}: зараховано {fb(c.cr.v)}, рівень {lvT(c.cr.v)}.</li>)}</ol>
      <p><b>Напрями, що потребують більшої уваги:</b></p>
      <ol>{lowList.map(t => <li key={t}>{t}</li>)}</ol>
      <p><b>Пропозиції:</b></p>
      {props.length ? <ol>{props.map(r => <li key={r.id}>{r.t} ({COMP[r.c].n}; {REC_ST[r.st][0].toLowerCase()}).</li>)}</ol> : <ol>{weakItems.map(x => <li key={x.id}>Розробити заходи щодо показника «{x.t}».</li>)}</ol>}
      {S.notes.length > 0 && m.id === ALPHA && <><p><b>Опис результатів</b> (чернетку підготовлено асистентом, затверджено керівником):</p>{S.notes.map((n, i) => <div key={i} className="note-ai"><p>{n.t}</p><div className="noprint" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span className="lbl">{n.who} · {n.at}</span>{S.role === "leader" && <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12, marginLeft: "auto" }} onClick={() => { S.notes.splice(i, 1); persist(); render(true); }}>Прибрати</button>}</div></div>)}</>}
      {ms.length > 0 && <><p className="doc-cap">Таблиця 7. Заходи плану трансформації</p><table className="doc-t"><thead><tr><th>№</th><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Стан</th></tr></thead><tbody>{ms.map((x, i) => <tr key={x.id}><td>{i + 1}</td><td>{x.t}</td><td>{x.who}</td><td className="tnum">{ua(x.due)}</td><td>{M_ST[dispSt(x)][0]}</td></tr>)}</tbody></table></>}
      <p className="doc-note">Усі бали, рівні й перевірки розраховано явними правилами методики v1.0. Окремих відповідей, імен і порівнянь підрозділів у звіті немає.</p>
      <div className="doc-sign"><span>Секретар робочої групи</span><span className="doc-blank">підпис</span><span className="doc-blank">Імʼя ПРІЗВИЩЕ</span></div>
    </article>
  </>;
}

/* Експорт: одна кнопка, формат обирається у вікні */
const OPTS = [["print", "print", "PDF або друк", "Звіт у форматі документа. У вікні друку оберіть «Зберегти як PDF»."], ["html", "file", "Документ HTML", "Відкривається в будь-якому браузері, можна відкрити в Word."], ["csv", "table", "Таблиця CSV", "Усі питання й показники з балами. Для Excel."], ["json", "file", "Дані JSON", "Для інших систем і бекенду."], ["copy", "copy", "Копіювати CSV", "У буфер обміну, щоб вставити в таблицю."]];
export function ExportDialog() {
  const ref = useRef(null), open = ui.exp;
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); else if (!open && d.open) d.close(); }, [open]);
  const close = () => { ui.exp = false; render(true); };
  const run = k => { close(); if (k === "print") { addLog(me(), "Експорт звіту (PDF / друк)"); return setTimeout(() => window.print(), 50); } if (k === "copy") return copyOut("csv"); copyOut(k, true); };
  return <dialog className="modal" id="exp" aria-label="Експорт звіту" ref={ref} onClose={() => { if (ui.exp) close(); }}>
    {open && <form method="dialog" className="exp-box" onSubmit={e => { e.preventDefault(); close(); }}><div className="card-h"><h2>Експорт звіту</h2><div className="sp" /><button className="icon-btn" value="x" aria-label="Закрити"><Ic n="x" /></button></div>
      <div className="lbl" style={{ marginBottom: 10 }}>{cur().name} · цикл {CYCLE}</div>
      <div className="exp-list">{OPTS.map(([k, ic, t, ds]) => <button key={k} type="button" className="exp-opt" onClick={() => run(k)}><span className="comp-ic" style={{ background: "var(--soft)" }}><Ic n={ic} /></span><span><b>{t}</b><span className="lbl">{ds}</span></span></button>)}</div></form>}
  </dialog>;
}
function copyOut(kind, dl) {
  const m = cur(); let txt;
  if (kind === "html") { const doc = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Звіт ${CYCLE}</title><style>body{font:14pt/1.5 "Times New Roman",Times,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#000}table{border-collapse:collapse;width:100%;margin:6px 0 12px}td,th{border:1px solid #000;padding:4px 6px;font-size:12pt;text-align:left;vertical-align:top}th{font-weight:bold}.doc-approve{margin-left:auto;width:300px}.doc-title{text-align:center;font-size:16pt;margin:24px 0 4px}.doc-sub{text-align:center;font-weight:bold}.doc-meta,.doc-note{font-size:11pt}.doc-cap{text-align:right;font-style:italic;margin-bottom:2px}.doc-sign{display:flex;justify-content:space-between;margin-top:36px}.doc-blank{display:inline-block;min-width:140px;border-top:1px solid #000;font-size:10pt;text-align:center}.noprint,svg,button{display:none}p{text-align:justify}</style></head><body>${document.querySelector(".paper").innerHTML}</body></html>`; return download(`integrity-report-${m.id}-${CYCLE}.html`, doc, "text/html"); }
  if (kind === "csv") txt = ["id;component;kind;label;source;weight;value", ...allItems(m).map(x => [x.id, x.c, x.src ? "perception" : "fact", `"${x.t.replace(/"/g, '""')}"`, x.src || x.kind, x.w, fb(x.v)].join(";")), ...m.components.map(c => [c.id, c.id, "component", COMP[c.id].n, "credited", "33.3", fb(c.cr.v)].join(";")), ["index", "", "index", "Індекс доброчесності", "", "100", fb(m.index)].join(";")].join("\n");
  else txt = JSON.stringify({ institution: m.name, cycle: CYCLE, asOf: TODAY, index: m.index, level: m.level, trust: m.trust, delta: m.delta,
    components: Object.fromEntries(m.components.map(c => [c.id, { perception: c.P, facts: c.F, credited: c.cr.v, limited: c.cr.lim }])),
    flags: m.raised.map(f => ({ id: f.id, weight: f.w, title: f.t })), measures: m.id === ALPHA ? measures() : [] }, null, 2);
  if (dl) return download(`integrity-${m.id}-${CYCLE}.${kind}`, (kind === "csv" ? "﻿" : "") + txt, kind === "csv" ? "text/csv" : "application/json");
  copyText(txt, () => { toast(kind.toUpperCase() + " скопійовано"); addLog(me(), `Експорт звіту (${kind.toUpperCase()})`); });
}
