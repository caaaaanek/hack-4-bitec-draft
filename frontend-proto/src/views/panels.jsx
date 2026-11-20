/* Пояснювальні бічні панелі: індекс, достовірність, методика, відповіді, питання, джерела, захід. */
import { Ic } from "../lib/icons.jsx";
import { S, AI_ROLES, SURVEY_Q, FACT_META, logItems } from "../lib/state.js";
import { API, CATEGORY_SRC } from "../lib/api.js";
import { FLAGS, COMPS, COMP, LEVELS, LSHORT, LDESC, BOUNDS, CAP, TRUST, TRUST_HINT, SRC, SRC_HINT, GROUPS, ALPHA, M_ST, level, allItems, measures, overdueDays, daysWord, verif, CYCLE } from "../lib/model.js";
import { fb, f2, ua } from "../lib/format.js";
import { openDrawer, closeDrawer, toast } from "../lib/store.js";
import { cur, can, route } from "../lib/nav.js";
import { whyText, checkText, flagTitle, trustBecause } from "../lib/texts.js";
import { aiOpen } from "../ai/assistant.jsx";
import { Pill, TrustPill, CapBars } from "../components/ui.jsx";
import { IndexExtras } from "./IndexExtras.jsx";

const FlagIc = ({ f, ok }) => <span className={`flag-ic ${ok ? "ok" : f.w}`}><Ic n={ok ? "ok" : f.w === "major" ? "alert" : "flag"} /></span>;
const Link = ({ href, children, cls = "link", style }) => <a className={cls} href={href} onClick={closeDrawer} style={style}>{children}</a>;

// Клік на картку: готовий висновок за правилами одразу, без асистента. Обговорити можна кнопкою внизу панелі.
const AskAi = ({ q }) => S.aiOn && AI_ROLES.includes(S.role) ? <button type="button" className="btn btn-soft" style={{ alignSelf: "flex-start" }} onClick={() => { closeDrawer(); aiOpen(q); }}><Ic n="spark" />Обговорити з асистентом</button> : null;
export function openWhy() {
  openDrawer("Чому такий індекс", () => {
    const m = cur(), lim = m.limited;
    return <>
      <div><div className="lbl" style={{ marginBottom: 4 }}>Короткий висновок</div><div style={{ lineHeight: 1.55 }}>{whyText(m)}</div></div>
      {lim && <div className="note-box"><b>Показано з обмеженням</b><span className="lbl">{lim.cr.reason}</span><CapBars c={lim} /></div>}
      <div><div className="card-h" style={{ marginBottom: 6 }}><h2>Варто перевірити додатково</h2><div className="sp" /><TrustPill g={m.trust} /></div>
        <div className="lbl" style={{ marginBottom: 8 }}>Спрацювало прапорців: {m.raised.length}</div>
        {m.raised.length ? <div className="rows">{m.raised.map(f => <div key={f.id} className="row" style={{ alignItems: "flex-start" }}><FlagIc f={f} /><div className="grow"><div style={{ fontWeight: 600 }}>{f.t} <Pill cls="p-mute nodot">{f.w === "major" ? "Серйозний" : "Незначний"}</Pill></div><div className="lbl">{f.ex}</div></div></div>)}</div> : <div>Жоден прапорець не спрацював.</div>}
        <div className="lbl" style={{ marginTop: 10 }}>Напрям для додаткового аналізу. Це не висновок про людей чи підрозділи.</div></div>
      <AskAi q="Чому такий індекс?" />
    </>;
  });
}
export function openTrust() {
  openDrawer("Достовірність результату", () => {
    const m = cur();
    return <>
      <div className="card-h"><h2>{TRUST[m.trust][1]}</h2><div className="sp" /><TrustPill g={m.trust} /></div>
      <div><div className="lbl" style={{ marginBottom: 4 }}>Короткий висновок</div><div style={{ lineHeight: 1.55 }}>{trustBecause(m)}</div></div>
      <div className="lbl">{TRUST_HINT}</div>
      <div className="rows">{m.flags.map(f => <div key={f.id} className="row" style={{ alignItems: "flex-start" }}><FlagIc f={f} ok={!f.raised} /><div className="grow"><div style={{ fontWeight: 600 }}>{flagTitle(f)} <Pill cls={`${f.raised ? "p-bad" : "p-good"} nodot`}>{f.raised ? "Спрацював" : "Не спрацював"}</Pill></div><div className="lbl">{checkText(f)} {f.w === "major" ? "Серйозний прапорець." : "Незначний прапорець."}</div></div></div>)}</div>
      <div className="lbl">Прапорець означає напрям для додаткової перевірки даних, а не висновок про людей чи підрозділи.</div>
      <AskAi q="Чому така достовірність?" />
    </>;
  });
}
// Іконка «i» на картці індексу: як рахується і шкала
export function openHow() {
  openDrawer("Як рахується індекс", () => {
    const m = cur();
    return <>
      <div><div className="lbl" style={{ marginBottom: 6 }}>Як це рахується</div><ol className="howto">
        <li>Індекс від 0 до 100 це середнє трьох компонентів: Культура, Система, Підзвітність.</li>
        <li>Кожен компонент складається зі сприйняття (анкети) і фактів (чек-лист та дані обліку).</li>
        <li>Сприйняття не може бути вищим за факти більш ніж на {CAP} пунктів. Якщо розрив більший, зараховується «факти + {CAP}».</li>
        <li>Рівень зрілості від 1 до 5 визначають межі шкали нижче.</li>
        <li>Достовірність показує, наскільки результату можна довіряти. Вона залежить від прапорців: автоматичних перевірок даних.</li></ol>
        {route().r !== "explain" && <Link href="#explain">Відкрити розклад індексу <Ic n="arrowR" /></Link>}</div>
      <IndexExtras />
      <div><div className="lbl" style={{ marginBottom: 4 }}>Шкала рівнів зрілості</div><div className="rows">{[1, 2, 3, 4, 5].map(l => {
        const lo = [0, ...BOUNDS][l - 1], hi = [...BOUNDS, 100][l - 1];
        return <div key={l} className="row" style={{ alignItems: "flex-start" }}><span className={`lvsq lvdot lv${l} ${l === m.level ? "on" : ""}`} aria-hidden="true" /><div className="grow">{LEVELS[l - 1]} <span className="lbl">{l === 1 ? `від 0 до ${fb(hi)}` : l === 5 ? `вище ${fb(lo)}` : `вище ${fb(lo)} до ${fb(hi)}`}</span><div className="lbl" style={{ fontSize: 12.5, marginTop: 2 }}>{LDESC[l - 1]}</div></div>{l === m.level && <Pill cls="p-good nodot">Поточний</Pill>}</div>;
      })}</div></div>
    </>;
  });
}

// Плашка «Відповідей у циклі»: скільки відповіли за групами і що означає k
export function respGroups(m) {
  if (m.id === ALPHA) return GROUPS.map(g => ({ ...g }));
  const n = m.responses, wg = Math.round(n * .2), ex = 5, os = n - wg - ex;
  return [{ n: "Робоча група", inv: wg + 1, resp: wg }, { n: "Особовий склад", inv: os + 8, resp: os }, { n: "Експерти", inv: ex, resp: ex }];
}
// Іконка «i» на картці достовірності: правило літер і чотири перевірки
export function openTrustHow() {
  openDrawer("Як визначається достовірність", () => <>
    <div><div className="lbl" style={{ marginBottom: 6 }}>Правило</div><ol className="howto">
      <li>Система автоматично перевіряє дані циклу чотирма прапорцями: двома серйозними й двома незначними.</li>
      <li><b>A</b> – жоден прапорець не спрацював.</li>
      <li><b>B</b> – спрацювали один або два незначні.</li>
      <li><b>C</b> – спрацював хоча б один серйозний або три й більше незначних.</li>
      <li>Якщо відповідей менше за мінімальну групу k = {S.k}, достовірність не оцінюється.</li></ol></div>
    <div><div className="lbl" style={{ marginBottom: 4 }}>Перевірки</div><div className="rows">{FLAGS.map(f => <div key={f.id} className="row" style={{ alignItems: "flex-start" }}><FlagIc f={f} /><div className="grow"><div style={{ fontWeight: 600 }}>{f.t}</div><div className="lbl">{f.w === "major" ? "Серйозний" : "Незначний"}</div></div></div>)}</div></div>
    <div className="lbl">Прапорець означає напрям для додаткової перевірки даних, а не висновок про людей чи підрозділи.</div>
  </>);
}
// Іконка «i» на картці заходів: стани, прострочення, перевірка результату
export function openTrackerHow() {
  openDrawer("Як працює трекер заходів", () => <>
    <ol className="howto">
      <li>Захід зʼявляється, коли керівник приймає рекомендацію, або його додають вручну.</li>
      <li>Стани: {["accepted", "inprogress", "done"].map(k => M_ST[k][0].toLowerCase()).join(" → ")}. «Виконано» ставиться лише з доказом.</li>
      <li>Захід прострочено, якщо строк минув, а його ще не виконано.</li>
      <li>Чи дав захід результат, перевіряє наступний цикл оцінювання: показник, на який він спрямований, має покращитися. Тоді стан стає «підтверджено» або «не підтверджено».</li>
      <li>Відповідальний – посада, а не прізвище.</li></ol>
    {route().r !== "tracker" && <Link href="#tracker">Відкрити трекер <Ic n="arrowR" /></Link>}
  </>);
}
// Іконка «i» на картці відповідей (спостерігач): поріг k
export function openRespHow() {
  openDrawer("Відповіді й мінімальна група", () => <ol className="howto">
    <li>Опитування анонімні: кожен отримує одноразове посилання.</li>
    <li>Результат групи показується, лише якщо відповіли щонайменше k = {S.k} осіб. Менші групи приховано, щоб не можна було впізнати людину.</li>
    <li>Якщо відповідей у циклі менше за k, достовірність не оцінюється.</li></ol>);
}

export function openResp() {
  openDrawer("Відповіді в циклі " + CYCLE, () => {
    const m = cur(), gs = respGroups(m), inv = gs.reduce((a, g) => a + g.inv, 0), resp = gs.reduce((a, g) => a + g.resp, 0);
    return <>
      <div className="stat4 tnum" style={{ gridTemplateColumns: "repeat(3,1fr)" }}><div><small>Запрошено</small><b>{inv}</b></div><div><small>Відповіли</small><b>{resp}</b></div><div><small>Охоплення</small><b>{Math.round(resp / inv * 100)} %</b></div></div>
      <div><div className="lbl" style={{ marginBottom: 6 }}>За групами</div><div className="rows">{gs.map(g => { const hid = g.resp < S.k && g.unit; return <div key={g.n} className="row"><div className="grow"><div className="t">{g.n}</div><div className="dist-bar" style={{ marginTop: 6 }}><i style={{ width: `${g.resp / g.inv * 100}%`, background: hid ? "var(--faint)" : "var(--teal)" }} /></div></div><b className="tnum">{g.resp} з {g.inv}</b>{hid && <Pill cls="p-mute nodot">Приховано</Pill>}</div>; })}</div></div>
      <div className="note-box"><b>Мінімальна група k = {S.k}</b><span className="lbl">Результати групи показуються, лише якщо відповіли щонайменше {S.k} людей. Менші групи додаються до вищого рівня, щоб нікого не можна було впізнати. Окремі відповіді не зберігаються разом з особою: жетон одноразовий і не повʼязаний з іменем.</span></div>
    </>;
  });
}

// Питання анкети, з яких склалося джерело сприйняття (режим API): id «компонент-категорія», бал саме цієї групи
export function itemQs(x) {
  if (!x || x.kind !== "p" || !API.on || !API.res) return [];
  const cat = x.id.slice(x.c.length + 1);
  return (API.res.questions || []).filter(q => q.component === x.c).map(q => { const g = (q.by_category || []).find(g => g.category === cat); return g ? { code: q.code, t: q.text, v: g.score, n: g.n } : null; }).filter(Boolean);
}
export function openItem(id) {
  const m = cur(), x = allItems(m).find(i => i.id === id); if (!x) return;
  const isP = x.kind === "p";
  openDrawer(isP ? (itemQs(x).length ? "Анкета" : "Питання анкети") : "Показник фактів", () => {
    const m = cur(), x = allItems(m).find(i => i.id === id); if (!x) return null;
    const qs = itemQs(x), c = m.byId[x.c], q = isP && x.id !== "sy-p3" ? SURVEY_Q.find(q => q.si === COMPS.indexOf(x.c) && q.qi === (+x.id.slice(-1) - 1)) : null;
    return <>
      <div><div className="lbl">{COMP[x.c].n} · {isP ? SRC[x.src][0] : "Факти"}</div><div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{x.t}</div></div>
      <div className="stat4 tnum" style={{ gridTemplateColumns: "repeat(3,1fr)" }}><div><small>Значення</small><b>{fb(x.v)}</b></div><div><small>Вага в компоненті</small><b>{x.w} %</b></div><div><small>Внесок в індекс</small><b>{f2(x.v * (c.cr.v / (isP ? c.P : c.F) || 1) / 3 * x.w / 100)}</b></div></div>
      <div><div className="lbl" style={{ marginBottom: 4 }}>Звідки число</div><div style={{ lineHeight: 1.55 }}>{isP ? `${SRC_HINT[x.src]} Відповіді переводяться в бали: варіант 1 це 0, варіант 5 це 100.` : x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}, тобто ${fb(x.v)} %. Джерело: ${x.from}.` : `Рівень ${x.val} з 5 за анкетою чек-листа. Рівень переводиться в бали: (рівень − 1) × 25 = ${fb(x.v)}. Джерело: ${x.from}.`}</div></div>
      {qs.length > 0 && <div><div className="lbl" style={{ marginBottom: 4 }}>Питання анкети ({qs.length}), бал цієї групи</div><div className="rows">{qs.map(i => <a key={i.code} className="row click" href="#" onClick={e => { e.preventDefault(); openApiQ(i.code); }}><div className="grow">{i.t}</div><b className="tnum">{i.v != null ? fb(i.v) : "–"}</b></a>)}</div></div>}
      {q && <div><div className="lbl" style={{ marginBottom: 6 }}>Відповідне питання в анкеті особового складу</div><div style={{ fontWeight: 500, marginBottom: 6 }}>{q.t}</div><ol className="howto">{q.o.map(o => <li key={o}>{o}</li>)}</ol></div>}
      <div><div className="lbl" style={{ marginBottom: 4 }}>Як іде в індекс</div><div style={{ lineHeight: 1.55 }}>Компонент «{COMP[x.c].n}»: {isP ? `сприйняття ${fb(c.P)}` : `факти ${fb(c.F)}`} це зважене середнє {isP ? "питань" : "показників"}. Зараховано {fb(c.cr.v)}{c.cr.lim ? " з обмеженням: " + c.cr.reason : "."} Індекс це середнє трьох компонентів.</div></div>
    </>;
  });
}

// Питання анкети з результатів хвилі: бал, бал за групами й розподіл відповідей
export function openApiQ(code) {
  const q = API.res && (API.res.questions || []).find(i => i.code === code); if (!q) return toast("Питання не знайдено в результатах хвилі");
  const grp = k => (CATEGORY_SRC[k] || [null, k])[1];
  openDrawer("Питання анкети", () => <>
    <div style={{ fontWeight: 600, fontSize: 16 }}>{q.text}</div>
    <div className="lbl" style={{ margin: "4px 0 14px" }}>{[q.section, COMP[q.component] ? COMP[q.component].n : q.component].filter((v, i, a) => v && a.indexOf(v) === i).join(" · ")} · код {q.code}</div>
    <div className="stat4 tnum" style={{ gridTemplateColumns: "1fr 1fr" }}><div><small>Середній бал</small><b>{q.score != null ? fb(q.score) : "–"}</b></div><div><small>Рівень</small><b>{q.score != null ? LSHORT[level(q.score) - 1] : "–"}</b></div></div>
    {q.by_category.map(g => <div key={g.category} style={{ marginTop: 16 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{grp(g.category)}</b><span className="lbl tnum">{g.n} відп. · бал {g.score != null ? fb(g.score) : "–"}</span></div>
      {g.distribution.map((d, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 44px", gap: 8, alignItems: "center", marginTop: 6, fontSize: 13 }}><span>{d.option_text}</span><div className="contrib"><i style={{ width: `${d.percent}%`, background: "var(--teal)" }} /></div><span className="lbl tnum" style={{ textAlign: "right" }}>{fb(d.percent)}%</span></div>)}</div>)}
    <Link cls="btn btn-soft" href={`#explain/${q.component}`} style={{ justifyContent: "center", marginTop: 18 }}><Ic n="arrowR" />Компонент у розкладі індексу</Link>
  </>);
}

/* Джерела: перегляд даних джерела (синтетичні записи) */
export const SOURCES = [
  ["Результати анкет", "Модуль анонімних опитувань платформи", "auto", "Оновлюється після кожної відповіді", "Відповіді респондентів агрегуються автоматично. Окремі відповіді не показуються."],
  ["Чек-лист", "Чек-лист закладу", "manual", "Внесено 10.11.2026", "Один працівник вносить дані, інший підтверджує їх. Кожен пункт має джерело й дату."],
  ["Декларації подані вчасно", "Відкрита база декларацій", "planned", "Немає даних: інтеграцію ще не підключено", "Поки значення вносять вручну в чек-лист. Автоматичне отримання планується."],
  ["Конфлікти інтересів", "Рішення з попереднього хакатону", "approval", "Немає даних: потрібне погодження власника рішення", "Рішення може підказувати випадки для перевірки. Використання потребує погодження."],
  ["Закупівлі", "Інший проєкт команди з оцінки закупівель", "planned", "Немає даних: інтеграцію ще не підключено", "Результати оцінки закупівель можуть стати фактами для компонента Підзвітність."],
  ["Скарги й звернення", "Журнал звернень закладу", "manual", "Внесено 12.11.2026", "Кількість звернень і розглянутих у строк вносить уповноважений."],
  ["Охоплення навчанням", "Флешкартки доброчесності платформи", "auto", "Оновлюється щодня за історією проходження колод", "Скільки учасників пройшли всі обовʼязкові колоди за рік. Лише частка, без імен; групи менші за k приховані."],
  ["Звітування за заходами", "Система суміжної команди", "approval", "Немає даних: інтеграцію ще не погоджено", "Автоматичне оновлення статусів заходів планується. Поки статуси змінюють вручну в трекері."],
];
// З сервером показники декларацій, конфліктів інтересів і закупівель рахує модуль «Перевірки» (docs/features.md, розділ 6)
const SERVER_SRC = {
  2: ["Модуль «Перевірки»", "auto", "Рахує система за правилами", "Строк подання декларацій перевіряє модуль «Перевірки». Показник потрапляє в екран «Порівняння»."],
  3: ["Модуль «Перевірки»", "auto", "Рахує система за правилами", "Правила конфлікту інтересів знаходять випадки, а уповноважений розглядає їх. Показник потрапляє в «Порівняння»."],
  4: ["Модуль «Перевірки»", "auto", "Рахує система за правилами", "Правила червоних прапорців перевіряють закупівлі. Показник потрапляє в «Порівняння»."],
};
export const srcRows = () => SOURCES.map((r, i) => API.on && SERVER_SRC[i] ? [r[0], ...SERVER_SRC[i]] : r);
export const MODE = { auto: ["Автоматично", "p-good"], manual: ["Ручний ввід", "p-info"], planned: ["Планується", "p-mute"], approval: ["Потребує погодження", "p-warn"] };
const SRC_DATA = {
  decl: { n: 100, ok: 45, rows: [["Керівний склад", 12, 10], ["Науково-педагогічні працівники", 38, 19], ["Посадові особи служб забезпечення", 30, 11], ["Інші зобовʼязані особи", 20, 5]] },
  coi: [["КІ-2026-014", "Участь у комісії з відбору, де є родич", "Висновок у строк", "02.10.2026"], ["КІ-2026-015", "Сумісництво в компанії-постачальнику", "Висновок із запізненням", "05.10.2026"], ["КІ-2026-016", "Рецензування роботи підлеглого", "Висновок у строк", "11.10.2026"], ["КІ-2026-017", "Розподіл службового житла", "На розгляді", "20.10.2026"], ["КІ-2026-018", "Преміювання за поданням родича", "Висновок із запізненням", "27.10.2026"], ["КІ-2026-019", "Закупівля в компанії колишнього працівника", "На розгляді", "03.11.2026"]],
  proc: [["UA-2026-09-12-000341", "Продукти харчування", "1 учасник", "Високий"], ["UA-2026-09-30-001207", "Ремонт гуртожитку", "Зміни до договору після підписання", "Високий"], ["UA-2026-10-08-000519", "Навчальна література", "2 учасники", "Середній"], ["UA-2026-10-21-002144", "Паливо", "Ціна близька до очікуваної", "Низький"], ["UA-2026-11-02-000088", "Компʼютерна техніка", "Вимоги під одного постачальника", "Середній"]],
  comp: [["Освітній процес", 18, 13], ["Побутові питання", 14, 9], ["Дії посадових осіб", 12, 6], ["Фінансові питання", 9, 5], ["Інше", 7, 3]],
};
const Tbl = ({ hs, rows }) => <div className="tbl-wrap"><table><thead><tr>{hs.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
const N = ({ children, style }) => <span className="tnum" style={style}>{children}</span>;
export function openSource(i) {
  const [name, from, mo, age] = srcRows()[i];
  openDrawer(name, () => {
    const m = cur();
    const synth = <div className="lbl">Записи синтетичні, для демонстрації. {mo === "planned" || mo === "approval" ? "Після підключення інтеграції дані надходитимуть автоматично." : ""}</div>;
    let body;
    if (API.on && SERVER_SRC[i]) body = <><div className="lbl">Записи окремих закупівель і декларацій тут не показуються: у модулі зберігаються лише знахідки з публічними ідентифікаторами.</div>{can("checks") && <Link cls="btn btn-soft" href="#checks"><Ic n="shield" />Відкрити «Перевірки»</Link>}</>;
    else if (i === 0) body = <><div className="lbl">Агреговані результати за питаннями. Окремих відповідей немає.</div><Tbl hs={["Питання", "Група", "Бал"]} rows={m.pItems.map(x => [x.t, SRC[x.src][0].replace("Сприйняття ", ""), <b className="tnum">{fb(x.v)}</b>])} /><Link href="#explain">Відкрити в розкладі індексу <Ic n="arrowR" /></Link></>;
    else if (i === 1) body = <Tbl hs={["Показник", "Дані", "Ким внесено"]} rows={m.fItems.map(x => [x.t, <N>{x.kind === "pct" ? `${x.val[0]} з ${x.val[1]}` : `рівень ${x.val} з 5`}</N>, (FACT_META[x.id] || ["10.11.2026", "Вносить дані чек-листа"]).join(", ") + ". Підтверджено"])} />;
    else if (i === 2) { const d = SRC_DATA.decl; body = <><div className="stat4 tnum" style={{ gridTemplateColumns: "repeat(3,1fr)" }}><div><small>Зобовʼязані</small><b>{d.n}</b></div><div><small>Подали вчасно</small><b>{d.ok}</b></div><div><small>Частка</small><b>{d.ok} %</b></div></div><Tbl hs={["Категорія", "Зобовʼязані", "Вчасно"]} rows={d.rows.map(r => [r[0], <N>{r[1]}</N>, <N>{r[2]}</N>])} />{synth}</>; }
    else if (i === 3) body = <><div className="lbl">Повідомлення про потенційні конфлікти інтересів і висновки уповноваженого. Імена не показуються.</div><Tbl hs={["Номер", "Суть", "Статус", "Дата"]} rows={SRC_DATA.coi.map(r => [<N>{r[0]}</N>, r[1], <Pill cls={r[2].includes("у строк") ? "p-good nodot" : r[2].includes("запізн") ? "p-bad nodot" : "p-mute nodot"}>{r[2]}</Pill>, <N>{r[3]}</N>])} />{synth}</>;
    else if (i === 4) body = <><div className="lbl">Закупівлі закладу з ознаками ризику з проєкту оцінки закупівель.</div><Tbl hs={["Ідентифікатор", "Предмет", "Ознака", "Ризик"]} rows={SRC_DATA.proc.map(r => [<N style={{ fontSize: 12 }}>{r[0]}</N>, r[1], r[2], <Pill cls={r[3] === "Високий" ? "p-bad nodot" : r[3] === "Середній" ? "p-warn nodot" : "p-good nodot"}>{r[3]}</Pill>])} />{synth}</>;
    else if (i === 5) { const c = SRC_DATA.comp, t = c.reduce((a, r) => a + r[1], 0), ok = c.reduce((a, r) => a + r[2], 0); body = <><div className="stat4 tnum" style={{ gridTemplateColumns: "repeat(3,1fr)" }}><div><small>Звернень</small><b>{t}</b></div><div><small>Розглянуто в строк</small><b>{ok}</b></div><div><small>Частка</small><b>{Math.round(ok / t * 100)} %</b></div></div><Tbl hs={["Тема", "Звернень", "У строк"]} rows={c.map(r => [r[0], <N>{r[1]}</N>, <N>{r[2]}</N>])} />{synth}</>; }
    else if (i === 6) body = <><div className="lbl">Показник «Охоплення навчанням» рахується з проходження флешкарток. Результат потрапляє в «Обʼєктивні показники» екрана «Порівняння» як частка пройшовших.</div><Link cls="btn btn-soft" href="#learn"><Ic n="book" />Відкрити «Навчання»</Link></>;
    else body = <><div className="lbl">Поки статуси заходів змінюють вручну.</div>{can("tracker") ? <Link cls="btn btn-soft" href="#tracker"><Ic n="target" />Відкрити трекер заходів</Link> : <div className="lbl">Заходів за цикл: {measures().length}.</div>}</>;
    return <><div><div className="lbl">{from}</div><div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}><Pill cls={MODE[mo][1]}>{MODE[mo][0]}</Pill><span className="lbl">{age}</span></div></div>{body}</>;
  });
}

// Захід: подробиці й перехід у систему звітування суміжної команди
const MEASURES_APP = { name: "Система звітування за заходами (суміжна команда)", url: "" };
export function openMeasure(id) {
  if (!measures().find(m => m.id === id)) return;
  openDrawer("Захід", () => {
    const x = measures().find(m => m.id === id); if (!x) return null;
    const m = cur(), it = allItems(m).find(i => i.id === x.ind), d = overdueDays(x), hist = logItems().filter(l => l.a.includes(x.t) || l.a.includes(x.id)).reverse();
    return <>
      <div><div className="lbl">З рекомендації: {x.rec}</div><div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{x.t}</div></div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Pill cls={M_ST[x.st][1]}>{M_ST[x.st][0]}</Pill>{d > 0 && <Pill cls="p-bad">Прострочено на {d} {daysWord(d)}</Pill>}<Pill cls={verif(x)[1] + " nodot"}>{verif(x)[0]}</Pill></div>
      <dl className="inst-kv" style={{ gridTemplateColumns: "auto 1fr" }}><dt>Відповідальна посада</dt><dd>{x.who}</dd><dt>Строк</dt><dd className="tnum">{ua(x.due)}</dd>{it && <><dt>Повʼязаний показник</dt><dd><Link href={`#explain/${it.id}`}>{it.t}: {fb(it.v)}</Link></dd></>}</dl>
      <div><div className="lbl" style={{ marginBottom: 6 }}>Історія в журналі</div>{hist.length ? <div className="rows">{hist.map((l, i) => <div key={i} className="row"><div className="grow"><div className="t" style={{ fontSize: 13 }}>{l.a}</div><div className="s">{l.who} · {l.t}</div></div></div>)}</div> : <div className="lbl">Змін статусу в цьому циклі ще не було.</div>}</div>
      {x.ext ? <div className="note-box" style={{ minWidth: 0 }}><b>Звіт виконавця в {x.ext.system}</b><span className="lbl">{x.ext.t}</span>
        {x.ext.note && <span className="lbl" style={{ overflowWrap: "anywhere", whiteSpace: "pre-line" }}>Коментар координатора: {x.ext.note}</span>}
        {x.ext.summary && <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{x.ext.summary}</span>}
        {x.ext.docs.map(d => <span key={d.sha} className="lbl" style={{ overflowWrap: "anywhere" }}>{d.name} · sha256 <span className="tnum" title={d.sha}>{d.sha.slice(0, 12)}…</span>{d.url && <> · <a href={d.url} target="_blank" rel="noopener noreferrer">Перевірити справжність у {x.ext.system}</a></>}</span>)}
        {x.ext.url ? <a className="btn btn-soft" href={x.ext.url} target="_blank" rel="noopener noreferrer" style={{ justifyContent: "center" }}><Ic n="arrowR" />Відкрити в {x.ext.system}</a> : (!x.ext.state || x.ext.state === "inbox") && <span className="lbl" style={{ fontSize: 12 }}>Координатор {x.ext.system} ще не повʼязав захід із програмою.</span>}</div>
      : <div className="note-box"><b>Звіт виконавця</b><span className="lbl">Документи й звіти про виконання ведуться в окремому застосунку суміжної команди.</span>
        {MEASURES_APP.url ? <a className="btn btn-soft" href={MEASURES_APP.url} target="_blank" rel="noopener" style={{ justifyContent: "center" }}><Ic n="arrowR" />Відкрити в застосунку звітування</a> : <><button className="btn btn-soft" disabled style={{ justifyContent: "center", opacity: .6 }}><Ic n="arrowR" />Відкрити в застосунку звітування</button><span className="lbl" style={{ fontSize: 12 }}>Посилання зʼявиться після погодження інтеграції.</span></>}</div>}
    </>;
  });
}
