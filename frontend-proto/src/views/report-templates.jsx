/* Шаблони звіту: Додаток Г, довідка керівнику, стан Плану заходів, динаміка між циклами.
 * Усі будуються з тих самих даних (cur(), buildRecs(), measures()); нових розрахунків немає.
 * Компоненти «чисті», без обробників: Report.jsx перетворює їх на HTML документа, який можна редагувати. */
import { Fragment } from "react";
import { S } from "../lib/state.js";
import { API } from "../lib/api.js";
import { COMPS, COMP, LEVELS, CAP, TRUST, REC_ST, M_ST, PRI, ALPHA, level, allItems, buildRecs, measures, dispSt, overdueDays, daysWord, verif, r1, CYCLE, TODAY_UA, factText } from "../lib/model.js";
import { fb, f1, pts, ua, plural } from "../lib/format.js";
import { respGroups } from "./panels.jsx";

export const RT_TPL = {
  appendix_g: ["Звіт за Додатком Г", "Повний звіт про результати опитувань за формою Додатку Г Рекомендацій НУОУ."],
  brief: ["Довідка керівнику", "Одна-дві сторінки: індекс, компоненти, що знизило оцінку, рішення, які треба ухвалити."],
  measures: ["Стан виконання Плану заходів", "Заходи: відповідальні, строки, прострочення, перевірка наступним оцінюванням."],
  dynamics: ["Динаміка між циклами", "Індекс і компоненти за циклами, що змінилося порівняно з попереднім циклом."],
};
const lvT = v => `${level(v)}. ${LEVELS[level(v) - 1]}`;
const dl = d => d > 0 ? `+${fb(d)}` : d < 0 ? `−${fb(-d)}` : "0";
const deltaPhrase = m => m.delta == null ? "Дані про попередній цикл зараз недоступні." : `${m.delta > 0 ? `Це на ${pts(m.delta)} вище` : m.delta < 0 ? `Це на ${pts(m.delta)} нижче` : "Без змін"} порівняно з попереднім циклом.`;

function Head({ m, title, sub }) {
  return <>
    <div className="doc-approve">ЗАТВЕРДЖУЮ<br />Голова робочої групи<br /><span className="doc-blank">військове звання</span><br /><span className="doc-blank">Імʼя ПРІЗВИЩЕ</span><br />«___» ____________ 2026 року</div>
    <h2 className="doc-title">{title}</h2>
    <p className="doc-sub">{sub}<br />{m.name}</p>
    <p className="doc-meta">Цикл оцінювання {CYCLE}. Дані станом на {TODAY_UA}.{API.on ? "" : " Синтетичні дані для демонстрації."}</p>
  </>;
}
const Foot = ({ who = "Підготував" }) => <>
  <p className="doc-note">Усі бали, рівні й перевірки розраховано явними правилами методики. Окремих відповідей, імен і порівнянь підрозділів у документі немає.</p>
  <div className="doc-sign"><span>{who}</span><span className="doc-blank">підпис</span><span className="doc-blank">Імʼя ПРІЗВИЩЕ</span></div>
</>;

/* Додаток Г */
const SEC_ABOUT = {
  culture: "Розділ оцінює роль керівництва, інтеграцію цінностей доброчесності в корпоративну культуру, ефективність освітніх заходів та рівень відкритості.",
  system: "Розділ аналізує інституційну спроможність у сфері антикорупції та доброчесності: організацію роботи антикорупційного уповноваженого, процедури й канали звернень.",
  accountability: "Розділ оцінює практичні механізми контролю та реагування: прозорість рішень, оприлюднення результатів перевірок, контроль виконання заходів.",
};
const GRP = { wg: "РГ", os: "ОС", experts: "Експерти" };
function ReportG({ m }) {
  const recs = m.id === ALPHA ? buildRecs(m) : [], ms = m.id === ALPHA ? measures() : [], gs = respGroups(m);
  const g = k => gs.filter(x => k === "wg" ? x.n === "Робоча група" : k === "ex" ? x.n === "Експерти" : x.n !== "Робоча група" && x.n !== "Експерти").reduce((a, x) => a + x.resp, 0);
  // «Найефективніші» відносно: вище середнього або найбільший приріст; без жодного компонента на рівні 4+ списку немає. З «уваги» прибираємо те, що вже в «найефективніших»
  const ok = m.components.filter(c => !c.cr.lim && c.cr.v != null), avg = ok.reduce((a, c) => a + c.cr.v, 0) / (ok.length || 1);
  const pv = m.series.length > 1 ? m.series[m.series.length - 2].cr || {} : {}, gr = c => pv[c.id] == null ? 0 : c.cr.v - pv[c.id];
  const topG = ok.reduce((b, c) => gr(c) > 0 && (!b || gr(c) > gr(b)) ? c : b, null), hasHigh = ok.some(c => level(c.cr.v) >= 4);
  const best = hasHigh ? ok.filter(c => c.cr.v > avg || c === topG).sort((a, b) => b.cr.v - a.cr.v) : [];
  const low = [...m.components].sort((a, b) => a.cr.v - b.cr.v).filter(c => (c.cr.v < 65 || c.cr.lim) && !best.includes(c));
  const weakItems = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
  const props = recs.filter(r => r.st !== "rejected");
  const lowList = [...low.map(c => `${COMP[c.id].n}: ${c.cr.lim ? "самооцінку не підтверджують факти" : `зараховано ${fb(c.cr.v)}`}.`), ...weakItems.map(x => `${x.t}: ${factText(x)}.`)].slice(0, 4);
  return <>
    <Head m={m} title="ЗВІТ" sub="про результати опитувань з визначення поточного рівня зрілості доброчесності" />
    <p>На підставі наказу керівника закладу {m.name} від «___» ____________ 2026 року № ___ «Про організацію роботи з трансформації функціонування закладу на засадах прозорості та доброчесності» проведено роботу з визначення поточного рівня зрілості доброчесності за Моделлю зрілості НАЗК.</p>
    <p>Проведено анонімне опитування трьох категорій респондентів:</p>
    <p>І категорія: члени робочої групи (далі РГ), відповіли {g("wg")} {plural(g("wg"), "особа", "особи", "осіб")}.<br />ІІ категорія: особовий склад закладу (далі ОС), відповіли {g("os")} {plural(g("os"), "особа", "особи", "осіб")}.<br />ІІІ категорія: зовнішні експерти, відповіли {g("ex")} {plural(g("ex"), "особа", "особи", "осіб")}.</p>
    <p><b>Мета опитування:</b></p>
    <ul>
      <li>визначення фактичного рівня зрілості системи доброчесності за кожним ключовим напрямом;</li>
      <li>ідентифікація найслабших місць у робочих процесах і визначення сильних сторін;</li>
      <li>формування базового показника («точки відліку») для відстеження подальшого розвитку;</li>
      <li>забезпечення керівництва обʼєктивними даними для планування заходів.</li></ul>
    <p><b>Методика дослідження:</b></p>
    <p>Онлайн-опитування на платформі з одноразовими анонімними жетонами. Результати групи показуються, лише якщо відповіли щонайменше {S.k} осіб. Відповіді переведено в бали від 0 до 100. Самооцінку за кожним напрямом зіставлено з фактами контрольного чек-листа та даних обліку. Якщо самооцінка перевищує факти більш ніж на {CAP} пунктів, зараховується значення «факти + {CAP}». Індекс доброчесності є середнім трьох напрямів, рівень зрілості визначається межами 12,5 / 37,5 / 62,5 / 87,5.</p>
    <p><b>Основна частина:</b></p>
    <p>Аналіз проведено за трьома розділами Моделі зрілості НАЗК: «Культура», «Система» та «Підзвітність».</p>
    {m.components.map((c, ci) => <Fragment key={c.id}>
      <h3>Розділ {ci + 1}. {COMP[c.id].n}</h3>
      <p>{SEC_ABOUT[c.id]}</p>
      <p className="doc-cap">Таблиця {ci * 2 + 1}. Самооцінка за питаннями анкет</p>
      <table className="doc-t"><thead><tr><th>№</th><th>Питання</th><th>Категорія</th><th>Вага, %</th><th>Середній бал</th><th>Рівень зрілості (за моделлю НАЗК)</th></tr></thead><tbody>
        {m.pItems.filter(x => x.c === c.id).map((x, i) => <tr key={x.id}><td>{ci + 1}.{i + 1}</td><td>{x.t}</td><td>{GRP[x.src]}</td><td className="tnum">{x.w}</td><td className="tnum">{fb(x.v)}</td><td>{lvT(x.v)}</td></tr>)}</tbody></table>
      <p className="doc-cap">Таблиця {ci * 2 + 2}. Факти: контрольний чек-лист і дані обліку</p>
      <table className="doc-t"><thead><tr><th>№</th><th>Показник</th><th>Дані</th><th>Вага, %</th><th>Бал</th></tr></thead><tbody>
        {m.fItems.filter(x => x.c === c.id).map((x, i) => <tr key={x.id}><td>{ci + 1}.{i + 1}</td><td>{x.t}</td><td>{x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`}</td><td className="tnum">{x.w}</td><td className="tnum">{fb(x.v)}</td></tr>)}</tbody></table>
      <p>За розділом «{COMP[c.id].n}» самооцінка становить {fb(c.P)}, факти {fb(c.F)}, зараховано {fb(c.cr.v)} з 100, що відповідає рівню зрілості {lvT(c.cr.v)}.{c.cr.lim ? ` ${c.cr.reason}` : ""} {c.P - c.F > 10 ? "Самооцінка помітно вища за підтверджені факти, тож висновки потребують підтвердження документами." : c.F - c.P > 10 ? "Факти вищі за самооцінку: наявні процедури варто краще доносити до особового складу." : "Самооцінка й факти в цілому узгоджуються."}</p>
    </Fragment>)}
    <h3>Розділ 4. Достовірність результатів</h3>
    <p>Достовірність {m.trust === "insufficient" ? "не оцінюється" : m.trust}: {TRUST[m.trust][1].toLowerCase()}. {m.raised.length ? `Спрацювало автоматичних перевірок: ${m.raised.length}.` : "Жодна автоматична перевірка не спрацювала."}</p>
    {m.raised.length > 0 && <ol>{m.raised.map(f => <li key={f.id}>{f.t} ({f.w === "major" ? "серйозна" : "незначна"}). {f.ex}</li>)}</ol>}
    <h3>Висновок</h3>
    <p>На основі аналізу відповідей респондентів за критеріями розділів «Культура», «Система» та «Підзвітність» Моделі зрілості НАЗК <b>загальний рівень зрілості доброчесності у {m.name} {m.level ? <>можна оцінити як «{LEVELS[m.level - 1]}»</> : "не вдалося оцінити: замало даних"}</b> ({m.level ? `рівень ${m.level} з 5; ` : ""}індекс доброчесності {m.index == null ? "не пораховано" : `${f1(m.index)} з 100`}; {m.delta == null ? "дані про попередній цикл недоступні" : `${m.delta > 0 ? `на ${pts(m.delta)} вище` : m.delta < 0 ? `на ${pts(m.delta)} нижче` : "без змін"} порівняно з попереднім циклом`}).</p>
    <p><i>Довідково:</i> {m.fItems.filter(x => x.kind === "pct").map(x => `${x.t.toLowerCase()}: ${factText(x)}`).join("; ")}.</p>
    <p><b>Найбільш ефективні напрями:</b></p>
    {best.length ? <ol>{best.slice(0, 2).map(c => <li key={c.id}>{COMP[c.id].n}: зараховано {fb(c.cr.v)}, рівень {lvT(c.cr.v)}.</li>)}</ol> : <p>Компонентів на рівні 4 і вище немає.</p>}
    <p><b>Напрями, що потребують більшої уваги:</b></p>
    <ol>{lowList.map(t => <li key={t}>{t}</li>)}</ol>
    <p><b>Пропозиції:</b></p>
    {props.length ? <ol>{props.map(r => <li key={r.id}>{r.t} ({COMP[r.c].n}; {REC_ST[r.st][0].toLowerCase()}).</li>)}</ol> : <ol>{weakItems.map(x => <li key={x.id}>Розробити заходи щодо показника «{x.t}».</li>)}</ol>}
    {S.notes.length > 0 && m.id === ALPHA && <><p><b>Опис результатів</b> (чернетку підготовлено асистентом, затверджено керівником):</p>{S.notes.map((n, i) => <div key={i} className="note-ai"><p>{n.t}</p><div className="noprint" contentEditable={false} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span className="lbl">{n.who} · {n.at}</span>{S.role === "leader" && <button type="button" className="btn btn-ghost" data-rm-note={i} style={{ padding: "4px 10px", fontSize: 12, marginLeft: "auto" }}>Прибрати</button>}</div></div>)}</>}
    {ms.length > 0 && <><p className="doc-cap">Таблиця 7. Заходи плану трансформації</p><table className="doc-t"><thead><tr><th>№</th><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Стан</th></tr></thead><tbody>{ms.map((x, i) => <tr key={x.id}><td>{i + 1}</td><td>{x.t}</td><td>{x.who}</td><td className="tnum">{ua(x.due)}</td><td>{M_ST[dispSt(x)][0]}</td></tr>)}</tbody></table></>}
    <Foot who="Секретар робочої групи" />
  </>;
}

/* Довідка керівнику */
function ReportBrief({ m }) {
  const recs = m.id === ALPHA ? buildRecs(m) : [], ms = m.id === ALPHA ? measures() : [];
  const pending = recs.filter(r => r.st === "proposed" || r.st === "clarified");
  const weak = [...allItems(m)].sort((a, b) => a.v - b.v).slice(0, 3);
  const overdue = ms.filter(x => dispSt(x) === "overdue"), done = ms.filter(x => ["done", "confirmed"].includes(x.st));
  const lowered = [...m.components.filter(c => c.cr.lim).map(c => `${COMP[c.id].n}: ${c.cr.reason}`), ...m.raised.filter(f => !(f.id === "tf-gap" && m.limited)).map(f => `${f.t} (${f.w === "major" ? "серйозна" : "незначна"} перевірка).`), ...weak.map(x => `${x.t}: ${fb(x.v)} з 100.`)].slice(0, 6);
  return <>
    <Head m={m} title="ДОВІДКА" sub="про поточний рівень зрілості доброчесності (для керівника закладу)" />
    <h3>1. Головне</h3>
    <p>{m.index == null ? "Індекс доброчесності за цей цикл не пораховано: замало даних." : <>Індекс доброчесності <b>{f1(m.index)} з 100</b>, рівень зрілості {m.level} «{LEVELS[m.level - 1]}».</>} {deltaPhrase(m)} Достовірність {m.trust === "insufficient" ? "не оцінюється" : m.trust}: {TRUST[m.trust][1].toLowerCase()}.</p>
    <p className="doc-cap">Таблиця 1. Компоненти індексу</p>
    <table className="doc-t"><thead><tr><th>Компонент</th><th>Самооцінка</th><th>Підтверджено фактами</th><th>Зараховано в індекс</th><th>Рівень</th></tr></thead><tbody>
      {m.components.map(c => <tr key={c.id}><td>{COMP[c.id].n}</td><td className="tnum">{fb(c.P)}</td><td className="tnum">{fb(c.F)}</td><td className="tnum">{fb(c.cr.v)}</td><td>{lvT(c.cr.v)}</td></tr>)}</tbody></table>
    <h3>2. Що знизило оцінку</h3>
    <ol>{lowered.map((t, i) => <li key={i}>{t}</li>)}</ol>
    <h3>3. Потрібне рішення керівника</h3>
    {pending.length ? <>
      <p className="doc-cap">Таблиця 2. Рекомендації без рішення</p>
      <table className="doc-t"><thead><tr><th>№</th><th>Рекомендація</th><th>Компонент</th><th>Пріоритет</th></tr></thead><tbody>{pending.slice(0, 6).map((r, i) => <tr key={r.id}><td>{i + 1}</td><td>{r.t}</td><td>{COMP[r.c].n}</td><td>{PRI[r.pri][0]}</td></tr>)}</tbody></table>
      {pending.length > 6 && <p>Ще {pending.length - 6} рекомендацій нижчого пріоритету – на екрані «Рекомендації».</p>}
    </> : <p>Усі рекомендації вже мають рішення.</p>}
    {ms.length > 0 && <><h3>4. План заходів</h3><p>Виконано {done.length} з {ms.length} заходів, прострочено {overdue.length}.{overdue.length ? ` Прострочені: ${overdue.map(x => `«${x.t}» (${x.who})`).join("; ")}.` : ""}</p></>}
    <Foot />
  </>;
}

/* Стан Плану заходів */
function ReportMeasures({ m }) {
  const ms = m.id === ALPHA ? measures() : [];
  if (!ms.length) return <><Head m={m} title="ЗВІТ" sub="про стан виконання Плану заходів" /><p>Заходів для цього закладу ще не заплановано.</p><Foot /></>;
  const by = {}; ms.forEach(x => { const st = dispSt(x); by[st] = (by[st] || 0) + 1; });
  const overdue = ms.filter(x => dispSt(x) === "overdue");
  return <>
    <Head m={m} title="ЗВІТ" sub="про стан виконання Плану заходів з розбудови доброчесності" />
    <h3>1. Підсумок</h3>
    <p>Усього заходів: {ms.length} ({Object.entries(by).map(([k, n]) => `${M_ST[k][0].toLowerCase()} ${n}`).join(", ")}).{overdue.length ? ` Прострочено ${overdue.length}: потрібні нові строки або причини затримки.` : " Прострочених немає."}</p>
    <h3>2. Перелік заходів</h3>
    <p className="doc-cap">Таблиця 1. Заходи плану трансформації</p>
    <table className="doc-t"><thead><tr><th>№</th><th>Захід</th><th>Відповідальна посада</th><th>Строк</th><th>Стан</th><th>Перевірка результату</th></tr></thead><tbody>
      {ms.map((x, i) => { const st = dispSt(x), d = overdueDays(x); return <tr key={x.id}><td>{i + 1}</td><td>{x.t}</td><td>{x.who}</td><td className="tnum">{ua(x.due)}</td><td>{M_ST[st][0]}{st === "overdue" ? `, ${d} ${daysWord(d)}` : ""}</td><td>{verif(x)[0]}</td></tr>; })}</tbody></table>
    {overdue.length > 0 && <><h3>3. Прострочені заходи</h3><ol>{overdue.map(x => { const d = overdueDays(x); return <li key={x.id}>{x.t}: {x.who}, строк {ua(x.due)}, прострочено на {d} {daysWord(d)}.</li>; })}</ol></>}
    <p>Результат заходу перевіряється наступним циклом оцінювання: показник, на який спрямовано захід, має покращитися.</p>
    <Foot />
  </>;
}

/* Динаміка між циклами */
function ReportDynamics({ m }) {
  const s = m.series || [], last = s[s.length - 1], prev = s[s.length - 2];
  const head = <Head m={m} title="ДОВІДКА" sub="про динаміку рівня зрілості доброчесності" />;
  if (m.noHistory) return <>{head}<p>Попередні цикли зараз недоступні: сервер не віддав історію оцінювань. Оновіть сторінку пізніше.</p><Foot /></>;
  if (!prev || prev === last) return <>{head}<p>Попереднього циклу немає: динаміку буде видно після наступного оцінювання.</p><Foot /></>;
  const rows = COMPS.map(id => ({ id, a: prev.cr && prev.cr[id], b: last.cr && last.cr[id] })).filter(x => x.a != null && x.b != null);
  const ok = x => x.a != null && x.b != null, up = rows.filter(x => ok(x) && x.b - x.a >= 5), down = rows.filter(x => ok(x) && x.a - x.b >= 5), d = last.index == null || prev.index == null ? null : r1(last.index - prev.index);
  return <>
    {head}
    <h3>1. Індекс за циклами</h3>
    <p className="doc-cap">Таблиця 1. Індекс доброчесності</p>
    <table className="doc-t"><thead><tr><th>Цикл</th><th>Індекс</th><th>Рівень</th><th>Зміна</th></tr></thead><tbody>
      {s.map((x, i) => <tr key={i}><td>{x.cycle}</td><td className="tnum">{f1(x.index)}</td><td>{lvT(x.index)}</td><td className="tnum">{i && x.index != null && s[i - 1].index != null ? dl(r1(x.index - s[i - 1].index)) : "–"}</td></tr>)}</tbody></table>
    <h3>2. Компоненти: {prev.cycle} → {last.cycle}</h3>
    <p className="doc-cap">Таблиця 2. Зараховані бали компонентів</p>
    <table className="doc-t"><thead><tr><th>Компонент</th><th>{prev.cycle}</th><th>{last.cycle}</th><th>Зміна</th></tr></thead><tbody>
      {rows.map(x => <tr key={x.id}><td>{COMP[x.id].n}</td><td className="tnum">{fb(x.a)}</td><td className="tnum">{fb(x.b)}</td><td className="tnum">{dl(r1(x.b - x.a))}</td></tr>)}</tbody></table>
    <h3>3. Висновок</h3>
    <p>Індекс {d > 0 ? `зріс на ${pts(d)}` : d < 0 ? `знизився на ${pts(d)}` : "не змінився"}: з {f1(prev.index)} до {f1(last.index)}. {Math.abs(d) < 5 ? "Зміна менша за 5 балів і може бути в межах похибки." : "Зміна більша за 5 балів."}
      {up.length ? ` Помітне покращення: ${up.map(x => COMP[x.id].n).join(", ")}.` : ""}{down.length ? ` Погіршення: ${down.map(x => COMP[x.id].n).join(", ")}; варто переглянути заходи за цими напрямами.` : ""}{m.trust === "C" ? " Достовірність поточного циклу C: перед висновками перевірте дані." : ""}</p>
    <Foot />
  </>;
}

export const RT_RENDER = { appendix_g: ReportG, brief: ReportBrief, measures: ReportMeasures, dynamics: ReportDynamics };
