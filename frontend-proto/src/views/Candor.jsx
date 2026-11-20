/* «Детектор відвертості» і «Детектор підгонки» на «Огляді».
 * З бекендом: GET /campaigns/{id}/candor (непрямі питання, «дзеркало», сигнали підгонки).
 * Без бекенду: приклад, узгоджений з демо-закладом «Альфа» (достовірність C, ті самі числа, що в документації). */
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset } from "../lib/api.js";
import { fb, dsh, plural } from "../lib/format.js";
import { openDrawer } from "../lib/store.js";
import { can } from "../lib/nav.js";
import { Pill } from "../components/ui.jsx";

// Демо: ті самі числа, що в демо-хвилі бекенду; заклад «Альфа» має достовірність C, тож прапорці не суперечать «Огляду»
export const DEMO_CANDOR = {
  candor: {
    list_experiments: [{ statement: "Мені натякали, що оцінку чи рішення можна «покращити» за подяку", n_a: 32, n_b: 31, min_per_variant: 30, sufficient: true, estimate: 19.4, ci: [5.4, 33.3], direct_share: 3.2, gap: 16.2, concealment: true, ratio: 6.1 }],
    mirrors: [{ self_text: "Якби ви стали свідком корупційного порушення, чи повідомили б ви про нього?", n: 63, self_share: 82.5, others_share: 41.3, gap: 41.2, pluralistic_ignorance: true }],
    flags: ["concealment", "pluralistic_ignorance"],
  },
  goodhart: { signals: [{ code: "identical_patterns", title: "Однакові набори відповідей у робочій групі", description: "8 з 14 анкет робочої групи повністю збігаються з іншою анкетою.", rule: "Двійника мають щонайменше половина анкет групи і не менше, ніж мінімальна група." }], flags: ["possible_gaming"] },
};

export function useCandor() {
  if (!API.on) return { data: DEMO_CANDOR };
  if (!API.campaignId) return API.empty ? { none: true } : null;
  const q = API.unitId ? `?unit_id=${API.unitId}` : "";
  return apiMod("candor", () => api(`/campaigns/${API.campaignId}/candor${q}`));
}

const pc = v => `${fb(v)} %`;
// Горизонтальна смуга 0..max з інтервалом: значення читаються з тексту поруч, смуга лише ілюструє
function Bar({ v, ci, max, cls, label }) {
  const w = x => `${Math.max(0, Math.min(100, x / max * 100))}%`;
  return <div className="cd-bar" role="img" aria-label={label}>
    <i className={cls} style={{ width: w(v) }} />
    {ci && <span className="cd-ci" style={{ left: w(ci[0]), width: `calc(${w(ci[1])} - ${w(ci[0])})` }} />}
  </div>;
}

function ListExp({ x }) {
  if (!x.sufficient) {
    const need = x.min_per_variant || 30;
    return <div className="cd-item">
      <div className="cd-st">«{dsh(x.statement)}»</div>
      <div className="lock"><Ic n="lock" /><div><b>Недостатньо даних для чесної оцінки</b><div className="lbl">Непряму оцінку рахуємо, коли на кожен із двох варіантів анкети відповіло щонайменше {need} людей. Зараз {x.n_a ?? 0} і {x.n_b ?? 0}. Пряму відповідь окремо не показуємо, щоб не робити висновків із малої вибірки.</div></div></div>
    </div>;
  }
  const max = Math.max(40, Math.ceil(((x.ci && x.ci[1]) || x.estimate) / 10) * 10);
  return <div className="cd-item">
    <div className="cd-st">«{dsh(x.statement)}»</div>
    <div className="cd-nums">
      <div><span className="lbl">Прямо визнали</span><b className="tnum">{pc(x.direct_share)}</b><Bar v={x.direct_share} max={max} cls="cd-direct" label={`Прямо визнали ${pc(x.direct_share)}`} /></div>
      <div><span className="lbl">Непряма оцінка</span><b className="tnum">{pc(x.estimate)}</b><Bar v={x.estimate} ci={x.ci} max={max} cls="cd-indirect" label={`Непряма оцінка ${pc(x.estimate)}, з імовірністю 95 % від ${pc(x.ci[0])} до ${pc(x.ci[1])}`} /><span className="lbl">з імовірністю 95 % від {pc(x.ci[0])} до {pc(x.ci[1])}</span></div>
    </div>
    {x.concealment && <p className="cd-say">{x.ratio ? `Непряма оцінка в ${fb(x.ratio)} ${Number.isInteger(x.ratio) ? plural(x.ratio, "раз", "рази", "разів") : "раза"} вища за пряму` : "Непряма оцінка вища за пряму"}: прямо визнають не всі.</p>}
  </div>;
}

function Mirror({ x }) {
  if (x.n != null && x.n < S.k) return <div className="cd-item"><div className="lock"><Ic n="lock" /><div><b>«Дзеркало»: результати приховано</b><div className="lbl">Відповіло менше {S.k} людей.</div></div></div></div>;
  return <div className="cd-item">
    <div className="cd-st">Дзеркало: «{dsh(x.self_text)}»</div>
    <div className="cd-nums">
      <div><span className="lbl">Про себе: так</span><b className="tnum">{pc(x.self_share)}</b><Bar v={x.self_share} max={100} cls="cd-self" label={`Про себе відповіли «так» ${pc(x.self_share)}`} /></div>
      <div><span className="lbl">Про колег: так</span><b className="tnum">{pc(x.others_share)}</b><Bar v={x.others_share} max={100} cls="cd-others" label={`Про колег думають «так» ${pc(x.others_share)}`} /></div>
    </div>
    {x.pluralistic_ignorance && <p className="cd-say">Кожен вважає себе винятком: про себе люди кажуть «я б повідомив», а про колег «вони б змовчали». Допомагає показати реальну норму: скільки людей насправді готові повідомити.</p>}
  </div>;
}

function openCandorHow() {
  openDrawer("Як працює детектор відвертості", () => <>
    <div className="lbl">Детектор вимірює, наскільки люди недоговорюють, і нічого не дізнається про жодну людину.</div>
    <div><b>Непряме питання «скільки з переліку»</b><p className="lbl" style={{ margin: "6px 0 0" }}>Людина бачить кілька тверджень і відповідає лише, скільки з них правдиві для неї, а не які саме. Половина анкет має на одне твердження більше. Різниця середніх між двома половинами показує, як часто трапляється чутлива ситуація. Окрема відповідь нічого не розкриває.</p></div>
    <div><b>Пряме питання про те саме</b><p className="lbl" style={{ margin: "6px 0 0" }}>Розрив між прямою відповіддю і непрямою оцінкою показує, наскільки люди бояться відповідати чесно. Тоді спрацьовує прапорець «приховування», і достовірність результату знижується.</p></div>
    <div><b>Дзеркало</b><p className="lbl" style={{ margin: "6px 0 0" }}>Після питання про себе йде питання про більшість колег. Якщо про себе відповідають значно краще, ніж про колег, це плюралістичне незнання: кожен вважає себе винятком. Це не обман, а проблема культури, яку лікують розповіддю про реальну норму.</p></div>
    <div><b>Коли чисел немає</b><p className="lbl" style={{ margin: "6px 0 0" }}>Непряму оцінку показуємо, коли на кожну половину анкет відповіло щонайменше 30 людей, разом з інтервалом, у якому з імовірністю 95 % лежить справжнє значення. Розділ «Відвертість» в індекс не входить.</p></div>
  </>);
}

const FLAG_TXT = {
  concealment: ["Приховування", "Люди відповідають обережніше, ніж є насправді. Через це достовірність знижено."],
  pluralistic_ignorance: ["Недовіра до колег", "Люди готові діяти, але думають, що інші не готові. Допоможе розповідь про реальну норму."],
};
function Links() {
  return <div className="cd-links">
    {can("recs") && <a className="btn btn-soft" href="#recs"><Ic n="bulb" />Рекомендації</a>}
    {can("advocate") && <a className="btn btn-soft" href="#advocate"><Ic n="scale" />Питання перевірки</a>}
  </div>;
}

function CardState({ r, t }) {
  if (!r) return <div className="lbl" role="status">Завантажуємо…</div>;
  if (r.none || r.status === 409 || r.status === 404) return <div className="lbl">Ще немає закритої хвилі: {t} з'явиться після її закриття.</div>;
  if (r.status === 403) return <div className="lock"><Ic n="lock" /><div><b>Немає доступу</b><div className="lbl">Ці дані недоступні для вашої ролі.</div></div></div>;
  if (r.error) return <div role="alert"><div className="lbl">Не вдалося завантажити: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 8 }} onClick={() => apiModReset("candor")}>Спробувати ще раз</button></div>;
  return null;
}

/* «Що люди бояться сказати прямо» */
// Якщо в хвилі немає непрямих питань, картку не показуємо: прикладів замість даних на «Огляді» немає
export function CandorCard() {
  const r = useCandor(), st = <CardState r={r} t="картка" />, c = r && r.data && r.data.candor;
  if (r && (r.none || (r.data && !((c && c.list_experiments || []).length || (c && c.mirrors || []).length)))) return null;
  const lists = (c && c.list_experiments) || [], mirrors = (c && c.mirrors) || [], flags = (c && c.flags) || [];
  return <section className="card c12 rise cd-card" aria-labelledby="cdTitle">
    <div className="card-h"><h2 id="cdTitle">Що люди бояться сказати прямо</h2><div className="sp" /><button type="button" className="pill-btn" onClick={openCandorHow}><Ic n="help" />Як це рахується</button></div>
    {r && r.data ? <>
      {<div className="cd-grid">
        {lists.map((x, i) => <ListExp key={"l" + i} x={x} />)}
        {mirrors.map((x, i) => <Mirror key={"m" + i} x={x} />)}
      </div>}
      {flags.length > 0 && <div className="cd-flags">{flags.filter(f => FLAG_TXT[f]).map(f => <div key={f} className="cd-flag"><Pill cls={f === "concealment" ? "p-warn" : "p-info"}>{FLAG_TXT[f][0]}</Pill><span className="lbl">{FLAG_TXT[f][1]}</span></div>)}<Links /></div>}
    </> : st}
  </section>;
}

/* «Ознаки підгонки показників» (детектор Гудхарта) */
const GOODHART_RULES = "Правила шукають п'ять слідів: значення фактів скупчуються якраз над порогами методики, сплеск «Виконано» в трекері перед хвилею, масова зміна чек-листа на «повністю» перед закриттям, однакові анкети в робочій групі, різкий ріст участі в останній день з ідеальними відповідями.";
function openGamingHow() {
  openDrawer("Як шукаються ознаки підгонки", () => <>
    <div className="lbl">{GOODHART_RULES}</div>
    <div className="lbl">Сигнал це привід для питання, а не висновок. Якщо він спрацював, достовірність знижується на один щабель.</div>
  </>);
}
export function GamingCard() {
  const r = useCandor(), g = r && r.data && r.data.goodhart, sig = (g && g.signals) || [];
  if (r && r.none) return null;
  return <section className="card c12 rise gm-card" aria-labelledby="gmTitle">
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2 id="gmTitle">Ознаки підгонки показників</h2><div className="sp" />{r && r.data && (sig.length ? <Pill cls="p-warn">Можлива підгонка</Pill> : <Pill cls="p-good">Ознак немає</Pill>)}<button type="button" className="pill-btn" onClick={openGamingHow}><Ic n="help" />Як це працює</button></div>
    {r && r.data ? <>
      {sig.length ? <div className="rows">{sig.map((s, i) => <div key={s.code || i} className="row" style={{ alignItems: "flex-start" }}><span className="dot" style={{ background: "var(--amber)", marginTop: 7 }} /><div className="grow"><div className="t gm-t">{dsh(s.title)}</div><div className="lbl">{dsh(s.description)}</div>{s.rule && <div className="lbl" style={{ fontSize: 12 }}>Правило: {dsh(s.rule).replace(/\bk\b/g, "мінімальна група")}</div>}</div></div>)}</div>
        : <div className="lbl">У цій хвилі ознак підгонки не знайдено.</div>}
      {sig.length > 0 && <><p className="lbl" style={{ margin: "10px 0 0" }}>Через це достовірність знижено на один щабель.</p><Links /></>}
    </> : <CardState r={r} t="перевірка" />}
  </section>;
}
