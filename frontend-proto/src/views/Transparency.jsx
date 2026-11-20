/* Прозорість журналу й обліку:
 * 1) хеш журналу для аудиту (POST /admin/audit-log/anchor, GET anchors, POST verify-anchor);
 * 2) лотерея перевірок чек-листа (GET /campaigns/{id}/audit-lottery);
 * 3) запити другій людині (FOUR_EYES_ENABLED: /admin/approvals). */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset, apiErrText, ApiErr, QCAT } from "../lib/api.js";
import { dsh } from "../lib/format.js";
import { toast, render } from "../lib/store.js";
import { copyText } from "../lib/util.js";
import { Pill } from "../components/ui.jsx";
import { Loading, Failed, Empty, NoAccess } from "../components/states.jsx";
import { copyInvite } from "./invite.jsx";

const when = t => new Date(t).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
const copy = (t, what) => copyText(t, () => toast(`${what} скопійовано`));
const Hash = ({ h }) => <code className="hash-full">{h}</code>;

/* --- 1. Хеш журналу для аудиту --- */
export function AnchorCard() {
  const r = apiMod("anchors", () => api("/admin/audit-log/anchors"));
  const last = r && r.data && r.data[0];
  const [busy, setBusy] = useState(""), [seq, setSeq] = useState(""), [hash, setHash] = useState(""), [res, setRes] = useState(null);
  const accept = async () => {
    setBusy("accept");
    try { const a = await api("/admin/audit-log/anchor", { method: "POST", body: { note: "" } }); toast(`Хеш прийнято: запис № ${a.seq}. Збережіть його окремо: роздрукуйте або надішліть собі.`); apiModReset("anchors"); setSeq(String(a.seq)); setHash(a.hash); }
    catch (e) { toast(apiErrText(e)); } finally { setBusy(""); }
  };
  const verify = async e => {
    e.preventDefault(); const s = +seq, h = hash.trim().toLowerCase();
    if (!(s >= 1) || !/^[0-9a-f]{64}$/.test(h)) { setRes({ ok: false, reason: "Вкажіть номер запису (ціле число) і хеш із 64 символів 0-9, a-f." }); return; }
    setBusy("verify"); setRes(null);
    try { setRes(await api("/admin/audit-log/verify-anchor", { method: "POST", body: { seq: s, hash: h } })); }
    catch (er) { setRes({ ok: false, reason: apiErrText(er) }); } finally { setBusy(""); }
  };
  const fill = () => { if (last) { setSeq(String(last.seq)); setHash(last.hash); } };
  const isAud = S.role === "auditor";
  return <section className="card c12 rise" aria-labelledby="anTitle">
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2 id="anTitle">Хеш журналу для аудиту</h2><div className="sp" />{isAud && <button type="button" className="btn btn-primary" onClick={accept} disabled={!!busy}><Ic n="shield" />{busy === "accept" ? "Приймаємо…" : "Прийняти поточний хеш"}</button>}</div>
    <div className="lbl">Аудит приймає хеш останнього запису й зберігає його окремо від системи. Якщо згодом журнал перепишуть, звірка з цією копією це покаже.</div>
    <div style={{ marginTop: 10 }}>{!r ? <span className="lbl" role="status">Завантажуємо…</span>
      : r.error ? <span role="alert" className="lbl">Не вдалося завантажити прийняті хеші: {r.error} <button type="button" className="link-btn" onClick={() => apiModReset("anchors")}>Спробувати ще раз</button></span>
      : last ? <div className="an-last"><div><span className="lbl">Останній прийнятий: запис № </span><b className="tnum">{last.seq}</b><span className="lbl">, {when(last.accepted_at)}</span></div><Hash h={last.hash} /><div className="cd-links"><button type="button" className="btn btn-soft" onClick={() => copy(`${last.seq} ${last.hash}`, "Номер і хеш")}><Ic n="copy" />Копіювати</button><button type="button" className="btn btn-soft" onClick={fill}>Підставити для звірки</button></div></div>
      : <span className="lbl">Аудит ще не приймав хеш журналу.</span>}</div>
    <form className="an-form" onSubmit={verify}>
      <div className="field"><label htmlFor="anSeq">Номер запису з копії аудиту</label><input id="anSeq" className="inp" inputMode="numeric" value={seq} onChange={e => setSeq(e.target.value)} /></div>
      <div className="field an-h"><label htmlFor="anHash">Хеш із копії аудиту</label><input id="anHash" className="inp" spellCheck={false} autoComplete="off" value={hash} onChange={e => setHash(e.target.value)} /></div>
      <button type="submit" className="btn btn-soft" disabled={!!busy}><Ic n="ok" />{busy === "verify" ? "Звіряємо…" : "Перевірити хеш"}</button>
    </form>
    {res && <div className={`note-box ${res.ok ? "" : "an-bad"}`} role="status" style={{ marginTop: 10 }}><b>{res.ok ? "Журнал не змінювали після прийняття хешу" : "Збіг не підтверджено"}</b><span className="lbl">{res.ok ? `Запис № ${res.seq} має саме цей хеш, і весь ланцюг цілий.` : dsh(res.reason || "Хеш не збігся.")}</span></div>}
  </section>;
}

/* --- 2. Лотерея перевірок --- */
const CK = { full: ["Впроваджено повністю", "p-good"], partial: ["Частково", "p-warn"], none: ["Не впроваджено", "p-bad"] };
// Довгий текст пункту чек-листа: перші речення одразу, решта за кнопкою «Повністю»
function LtText({ t }) {
  if (t.length <= 180) return <div className="grow lt-t">{t}</div>;
  const cut = t.lastIndexOf(" ", 170);
  return <div className="grow lt-t">{t.slice(0, cut)}… <details className="lt-more"><summary>Показати текст повністю</summary>{t}</details></div>;
}
export function LotteryCard({ campaignId, status }) {
  const r = campaignId && status === "closed" ? apiMod("lottery:" + campaignId, () => api(`/campaigns/${campaignId}/audit-lottery`)) : null;
  const head = <div className="card-h"><h2>Лотерея перевірок</h2></div>;
  if (!campaignId) return null;
  if (status !== "closed") return <section className="card c12 rise">{head}<div className="lbl">Жеребкування пунктів для глибокої перевірки проводиться після закриття хвилі.</div></section>;
  if (!r) return <section className="card c12 rise">{head}<div className="lbl" role="status">Завантажуємо…</div></section>;
  if (r.status === 403) return null;
  if (r.error) return <section className="card c12 rise" role="alert">{head}<div className="lbl">Не вдалося провести жеребкування: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 8 }} onClick={() => apiModReset("lottery:" + campaignId)}>Спробувати ще раз</button></section>;
  const d = r.data;
  return <section className="card c12 rise" aria-labelledby="ltTitle">
    <div className="card-h"><h2 id="ltTitle">Лотерея перевірок</h2><div className="sp" /><span className="lbl">{d.count} з {d.population} пунктів</span></div>
    <div className="lbl">Ці пункти чек-листа система вибрала навмання для глибокої перевірки аудитом. Під перевірку може потрапити будь-який пункт, тож чесно заповнювати вигідніше.</div>
    <div className="rows" style={{ marginTop: 10 }}>{d.items.map(x => <div key={x.number} className="row lt-row" style={{ alignItems: "flex-start" }}><b className="tnum" style={{ minWidth: 44 }}>{x.number}</b><LtText t={dsh(x.text).replace(/^[\d.]+\s*/, "")} /><div className="lt-st">{x.status ? <Pill cls={(CK[x.status] || ["", "p-mute"])[1]}>{(CK[x.status] || [x.status])[0]}</Pill> : <Pill cls="p-mute">Не заповнено</Pill>}{x.confirmed && <span className="lbl">підтверджено</span>}</div></div>)}</div>
    <div className="note-box" style={{ marginTop: 12 }}><b>Як перевірити, що вибір не підкрутили</b><span className="lbl">Зерно жеребкування це хеш знімка закритої хвилі: ніхто не міг його передбачити чи змінити, а будь-хто може повторити вибір за цим зерном.</span><Hash h={d.seed} /><button type="button" className="btn btn-soft" onClick={() => copy(d.seed, "Зерно")} style={{ alignSelf: "flex-start" }}><Ic n="copy" />Копіювати зерно</button></div>
  </section>;
}

/* --- 3. Запити другій людині --- */
const KIND = { activate_users: "Нові облікові записи", user_role: "Зміна ролі чи блокування", user_category: "Зміна категорії", user_invite: "Скидання пароля", unit_change: "Зміна підрозділів у чернетці хвилі", open_campaign: "Відкриття хвилі" };
const ROLE_T = { admin: "уповноважений", coordinator: "технічний адміністратор", auditor: "внутрішній аудит", leader: "керівник", department: "Департамент" };
export const fourEyes = () => !!(API.cfg && API.cfg.policies && API.cfg.policies.four_eyes);
export const useApprovals = () => API.on && fourEyes() ? apiMod("approvals", () => api("/admin/approvals?status=pending")) : null;
// same_person, forbidden_role, out_of_zone: сервер пояснює сам (message і hint)
const decideErr = e => apiErrText(e);
const whoDecides = x => (x.approver_roles || []).map(r => ROLE_T[r] || r).join(" або ");

// Заголовок запиту: текст сервера містить службові коди категорій, тому для відкриття хвилі будуємо свій
const CODE_T = { respondent: "респондент", admin: "уповноважений", coordinator: "технічний адміністратор", auditor: "внутрішній аудит", leader: "керівник", department: "Департамент", staff: "особовий склад", expert: "експерт", working_group: "робоча група" };
// Службові коди ролей і категорій — словами; логіни в «лапках» не чіпаємо
const human = t => dsh(t).split(/(«[^»]*»)/).map(p => p.startsWith("«") ? p : p.replace(/\b[a-z_]{3,}\b/g, w => CODE_T[w] || (QCAT[w] ? QCAT[w].toLowerCase() : w))).join("");
const apTitle = x => x.kind === "open_campaign" ? `Відкрити хвилю ${(/«[^»]+»/.exec(x.summary || "") || ["«без назви»"])[0]}` : human(x.summary) || KIND[x.kind] || "Запит";
export function Approvals() {
  const r = useApprovals(), [busy, setBusy] = useState(""), [note, setNote] = useState({});
  if (!API.on) return <Empty t="Запити другій людині">Доступно в режимі з сервером, коли увімкнено принцип двох осіб.</Empty>;
  if (!fourEyes()) return <Empty t="Принцип двох осіб вимкнено">Зараз привілейовані дії виконуються без підтвердження другою людиною. Його вмикає налаштування сервера.</Empty>;
  if (!r) return <Loading t="Запити другій людині" />;
  if (r.status === 403) return <NoAccess />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("approvals")} />;
  const me = API.user && API.user.id;
  const act = async (x, how) => {
    setBusy(x.id + how);
    try {
      const y = await api(`/admin/approvals/${x.id}/${how}`, { method: "POST", body: { comment: note[x.id] || "" } });
      apiModReset("approvals"); API.adm = null;
      if (y && y.invite_link) copyInvite(String((/«([^»]+)»/.exec(x.summary || "") || [, "людини"])[1]), y.invite_link, y.invite_expires_at);
      else toast(how === "approve" ? (x.kind === "open_campaign" ? "Підтверджено: хвилю відкрито" : "Запит підтверджено") : "Запит відхилено");
    }
    catch (e) { toast(decideErr(e)); } finally { setBusy(""); render(true); }
  };
  const intro = null;
  if (!r.data.length) return <>{intro}<Empty t="Запитів немає">Нових запитів, що чекають підтвердження, немає.</Empty></>;
  return <>{intro}{r.data.map(x => { const own = x.requested_by_id && x.requested_by_id === me, p = x.payload || {};
    return <section key={x.id} className="card c12 rise">
      <div className="card-h" style={{ flexWrap: "wrap" }}><h2 className="ap-t">{apTitle(x)}</h2><div className="sp" /><Pill cls="p-info nodot">{KIND[x.kind] || "Інший запит"}</Pill></div>
      <div className="lbl">Запит від {when(x.requested_at)}{own ? " · ви створили цей запит" : ""}</div>
      {x.kind === "open_campaign" && p.eligible && <dl className="inst-kv" style={{ marginTop: 10 }}>{Object.entries(p.eligible).flatMap(([c, n]) => [<dt key={"t" + c}>Склад: {(QCAT[c] || c).toLowerCase()}</dt>, <dd key={"v" + c} className="tnum">{n}</dd>])}{p.created_last_30_days != null && <><dt>Нових облікових записів за 30 днів</dt><dd className="tnum">{p.created_last_30_days}</dd></>}</dl>}
      {x.kind === "activate_users" && Array.isArray(p.user_ids) && <div className="lbl" style={{ marginTop: 8 }}>Облікових записів: {p.user_ids.length}</div>}
      {!x.can_decide ? <div className="note-box" style={{ marginTop: 10 }}><span className="lbl">{whoDecides(x) ? `Підтверджує: ${whoDecides(x)}.` : ""}{own ? " Власний запит підтвердити чи відхилити не можна." : ""}</span></div>
        : <div className="ap-act">
          <div className="field"><label htmlFor={`apc-${x.id}`}>Коментар (необов'язково)</label><input id={`apc-${x.id}`} className="inp" maxLength={1000} value={note[x.id] || ""} onChange={e => setNote({ ...note, [x.id]: e.target.value })} /></div>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act(x, "approve")}><Ic n="ok" />{busy === x.id + "approve" ? "Підтверджуємо…" : "Підтвердити"}</button>
          <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => act(x, "reject")}>{busy === x.id + "reject" ? "Відхиляємо…" : "Відхилити"}</button>
        </div>}
    </section>; })}</>;
}
