/* «Урна з трьома ключами» (/campaigns/{id}/urn*): ключ відповідей хвилі ділиться на 3 частини, відкрити урну
 * можуть лише двоє з трьох власників. Сервер ключа не зберігає. Автопілот хвилю з урною не закриває, лише кличе власників. */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset, apiErrText, apiAdmReload, dn } from "../lib/api.js";
import { toast, render } from "../lib/store.js";
import { route } from "../lib/nav.js";
import { copyText } from "../lib/util.js";
import { Pill } from "../components/ui.jsx";
import { QrCode } from "../components/QrCode.jsx";
import { Loading, Failed, Empty, NoAccess } from "../components/states.jsx";
import { loadPeople } from "./WaveAdmin.jsx";

export const URN_WHY = "Ніхто сам не прочитає відповіді, навіть адміністратор сервера: ключ хвилі поділено на три частини, і відкрити урну можуть лише двоє з трьох власників разом.";
const HOLDER_T = ["Уповноважений", "Внутрішній аудит", "Представник особового складу"];

// Одноразовий показ частини ключа: лише в пам'яті сторінки, після «Я зберіг» зникає
function ShareOnce({ s, onDone }) {
  return <div className="note-box urn-share" role="alert">
    <b>Ваша частина ключа. Її показано один раз</b>
    <span className="lbl">Збережіть її зараз: роздрукуйте QR або скопіюйте текст на окремий носій. На сервері її більше немає, і ніхто не зможе показати її повторно.</span>
    <div className="urn-qr"><QrCode text={s.share} className="urn-qr-svg" label="QR частини ключа" /><code className="hash-full">{s.share}</code></div>
    {s.fingerprint && <span className="lbl">Відбиток ключа хвилі: <span className="tnum">{s.fingerprint}</span></span>}
    <div className="cd-links"><button type="button" className="btn btn-soft" onClick={() => copyText(s.share, () => toast("Частину ключа скопійовано"))}><Ic n="copy" />Копіювати</button><button type="button" className="btn btn-soft" onClick={() => window.print()}><Ic n="file" />Друкувати</button><button type="button" className="btn btn-primary" onClick={onDone}><Ic n="ok" />Я зберіг частину</button></div>
  </div>;
}

export function UrnSection({ c }) {
  const key = "urn:" + c.id, r = apiMod(key, () => api(`/campaigns/${c.id}/urn`));
  const [busy, setBusy] = useState(""), [share, setShare] = useState(null), [input, setInput] = useState(""), [res, setRes] = useState(null), [pick, setPick] = useState(["", "", ""]);
  const isAdmin = S.role === "admin", me = API.user && API.user.id;
  const users = isAdmin && c.status === "draft" ? loadPeople(c.id) : null; // люди хвилі, без повного довідника
  const run = async (k, f) => { setBusy(k); try { await f(); } catch (e) { toast(apiErrText(e)); } finally { setBusy(""); apiModReset(key); render(true); } };
  const head = <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Урна з трьома ключами</h2><div className="sp" />{r && r.data && <Pill cls={r.data.enabled ? "p-good" : "p-mute"}>{r.data.enabled ? "Увімкнено" : "Вимкнено"}</Pill>}</div>;
  if (!r) return <section className="card c12 rise">{head}<div className="lbl" role="status">Завантажуємо…</div></section>;
  if (r.status === 403) return null;
  if (r.error) return <section className="card c12 rise" role="alert">{head}<div className="lbl">Не вдалося завантажити: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 8 }} onClick={() => apiModReset(key)}>Спробувати ще раз</button></section>;
  const u = r.data, mine = u.holders.find(h => h.holder_id === me), closed = c.status === "closed" || (res && res.status === "closed");
  if (!u.enabled && c.status !== "draft") return null; // вимкнену урну ввімкнути вже не можна: картка нічого не дає
  return <section className="card c12 rise urn" aria-label="Урна з трьома ключами">
    {head}
    <div className="lbl">{URN_WHY}</div>
    {u.enabled && <>
      <div className="rows" style={{ marginTop: 10 }}>{u.holders.map((h, i) => <div key={h.holder_id} className="row"><span className="comp-ic" style={{ width: 28, height: 28 }}><Ic n={h.submitted ? "ok" : "lock"} /></span><div className="grow"><div className="t">{dn(h.display_name || HOLDER_T[i] || "Власник")}{h.holder_id === me ? " (ви)" : ""}</div></div><Pill cls={h.submitted ? "p-good" : h.taken ? "p-info" : "p-warn"}>{h.submitted ? "Частину введено" : h.taken ? "Частину забрано" : "Ще не забрав"}</Pill></div>)}</div>
      <div className="lbl" style={{ marginTop: 8 }}>{!u.ready ? "Хвилю можна відкрити, коли всі троє заберуть свої частини: тоді на сервері їх не лишиться." : closed ? "Урну відкрито: хвилю закрито й результати пораховано." : u.close_requested ? `Церемонія відкриття: потрібно ${u.threshold} частини з 3, введено ${u.holders.filter(h => h.submitted).length}.` : "Усі частини роздано. Після збору відповідей урну відкриють двоє з трьох власників. Автопілот сам хвилю не закриє, лише покличе власників."}{u.fingerprint ? ` Відбиток ключа: ${u.fingerprint}.` : ""}</div>
    </>}
    {share && <ShareOnce s={share} onDone={() => setShare(null)} />}
    {mine && !mine.taken && !share && <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => run("take", async () => setShare(await api(`/campaigns/${c.id}/urn/my-share`)))}><Ic n="lock" />{busy === "take" ? "Отримуємо…" : "Забрати свою частину ключа"}</button>}
    {mine && u.close_requested && !mine.submitted && !closed && <form className="urn-in" onSubmit={e => { e.preventDefault(); const v = input.trim(); if (v.length < 10) { toast("Вставте свою частину ключа повністю"); return; } run("submit", async () => { const x = await api(`/campaigns/${c.id}/urn/shares`, { method: "POST", body: { share: v } }); setRes(x); setInput(""); if (x && x.status === "closed") { delete API.mod["urncamp:" + c.id]; if (isAdmin) apiAdmReload(c.id); } }); }}>
      <div className="field"><label htmlFor="urnIn">Ваша частина ключа (текст або вміст QR)</label><textarea id="urnIn" className="inp" rows={3} spellCheck={false} autoComplete="off" value={input} onChange={e => setInput(e.target.value)} /></div>
      <button type="submit" className="btn btn-primary" disabled={!!busy}><Ic n="ok" />{busy === "submit" ? "Перевіряємо…" : "Ввести частину"}</button>
    </form>}
    {res && res.status !== "closed" && <div className="note-box" role="status" style={{ marginTop: 10 }}><b>{`Частину прийнято: ${res.submitted} з ${res.needed}`}</b><span className="lbl">Потрібна ще одна частина від іншого власника.</span></div>}
    {isAdmin && !u.enabled && c.status === "draft" && <UrnSetup c={c} users={users} pick={pick} setPick={setPick} busy={busy} run={run} />}
    {isAdmin && u.enabled && c.status === "draft" && <div className="cd-links" style={{ marginTop: 10 }}><button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => run("off", () => api(`/campaigns/${c.id}/urn`, { method: "DELETE" }))}>{busy === "off" ? "Вимикаємо…" : "Вимкнути урну"}</button>
      <button type="button" className="btn btn-soft" onClick={() => copyText(`${location.origin}/#urn/${c.id}`, () => toast("Посилання для власників скопійовано"))}><Ic n="copy" />Посилання для власників</button></div>}
    {isAdmin && !u.enabled && c.status !== "draft" && <div className="lbl" style={{ marginTop: 8 }}>Урну вмикають лише для чернетки хвилі, до відкриття.</div>}
  </section>;
}

function UrnSetup({ c, users, pick, setPick, busy, run }) {
  if (!users) return null;
  if (!users.data) return users.error ? <div className="lbl" role="alert">Не вдалося завантажити користувачів: {users.error}</div> : <div className="lbl" role="status">Завантажуємо користувачів…</div>;
  const all = users.data, groups = [all.filter(x => x.role === "admin"), all.filter(x => x.role === "auditor"), all.filter(x => x.role === "respondent")];
  const ok = pick.every(Boolean) && new Set(pick).size === 3;
  return <div className="urn-setup">
    <div className="lbl" style={{ margin: "10px 0 6px" }}>Оберіть трьох різних власників частин ключа:</div>
    {HOLDER_T.map((t, i) => <div key={t} className="field"><label htmlFor={`urnH${i}`}>{t}</label><select id={`urnH${i}`} className="inp" value={pick[i]} onChange={e => { const p = [...pick]; p[i] = e.target.value; setPick(p); }}><option value="">Оберіть людину</option>{groups[i].map(x => <option key={x.id} value={x.id}>{dn(x.display_name)} ({x.login})</option>)}</select></div>)}
    <button type="button" className="btn btn-primary" disabled={!ok || !!busy} onClick={() => run("setup", () => api(`/campaigns/${c.id}/urn`, { method: "PUT", body: { holder_ids: pick } }))}><Ic n="lock" />{busy === "setup" ? "Вмикаємо…" : "Увімкнути урну"}</button>
    {!ok && pick.some(Boolean) && <span className="lbl">Потрібні троє різних людей.</span>}
  </div>;
}

/* Екран #urn/<хвиля>: для власників частин (аудит, представник особового складу) за посиланням від уповноваженого */
export function UrnScreen() {
  if (!API.on) return <UrnDemo />;
  const id = route().p;
  if (!id) return ["auditor", "admin"].includes(S.role) ? <UrnPick /> : <Empty t="Потрібне посилання">Відкрийте посилання на урну, яке надіслав уповноважений.</Empty>;
  const r = apiMod("urncamp:" + id, () => api(`/campaigns/${id}`).catch(e => e.status === 403 ? { id, title: "", status: "?" } : Promise.reject(e)));
  if (!r) return <Loading t="Урна" />;
  if (r.status === 404) return <Empty t="Хвилю не знайдено">Перевірте посилання.</Empty>;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("urncamp:" + id)} />;
  return <>{r.data.title && <section className="c12 rise"><b>{dn(r.data.title)}</b></section>}<UrnSection c={r.data} /></>;
}
function UrnPick() {
  const r = apiMod("urnCamps", () => api("/campaigns"));
  if (!r) return <Loading t="Хвилі" />;
  if (r.status === 403) return <NoAccess />;
  if (r.error) return <Failed e={r.error} onRetry={() => apiModReset("urnCamps")} />;
  return <section className="card c12 rise"><div className="card-h"><h2>Оберіть хвилю</h2></div><div className="lbl" style={{ marginBottom: 8 }}>{URN_WHY}</div><div className="rows">{r.data.map(c => <a key={c.id} className="row click" href={`#urn/${c.id}`}><div className="grow">{dn(c.title)}</div><Ic n="arrowR" size={16} /></a>)}</div></section>;
}

/* Демо: покрокова демонстрація з вигаданими частинами */
const DEMO_SHARES = ["urn1-1-7f3a9c2e5b81d4f06a3e9b7c1d2f8a4e6b0c3d5f", "urn1-2-1c8e4b7a2f9d6e3b0a5c8f1e4d7b2a9c6f3e0d1b", "urn1-3-9a2d5f8c1e4b7a0d3f6c9e2b5a8d1f4c7e0b3a6d"];
export function UrnDemo() {
  const [step, setStep] = useState(0), steps = ["Хвилю створено: сервер згенерував ключ і розділив його на три частини.", "Кожен власник забирає свою частину один раз: QR або текст.", "Відповіді збираються зашифрованими. Прочитати їх зараз не може ніхто.", "Церемонія відкриття: двоє з трьох вводять свої частини, і хвиля закривається."];
  return <section className="card c12 rise urn">
    <div className="card-h"><h2>Урна з трьома ключами</h2><div className="sp" /><Pill cls="p-info nodot">Демонстрація</Pill></div>
    <div className="lbl">{URN_WHY}</div>
    <ol className="howto" style={{ marginTop: 10 }}>{steps.map((t, i) => <li key={i} className={i <= step ? "" : "lbl"}>{t}</li>)}</ol>
    {step >= 1 && <div className="urn-demo">{HOLDER_T.map((t, i) => <div key={t} className="urn-demo-i"><b>{t}</b>{step === 1 ? <QrCode text={DEMO_SHARES[i]} className="urn-qr-svg" label={`QR частини ключа: ${t}`} /> : <Pill cls={step >= 3 && i < 2 ? "p-good" : "p-info"}>{step >= 3 && i < 2 ? "Частину введено" : "Частину забрано"}</Pill>}</div>)}</div>}
    {step === 3 && <div className="note-box" role="status" style={{ marginTop: 10 }}><b>Урну відкрито двома частинами з трьох</b><span className="lbl">Третя частина не знадобилась: якщо одну частину втратять, хвиля однаково відкриється.</span></div>}
    <div className="cd-links" style={{ marginTop: 10 }}>{step < 3 ? <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>Далі <Ic n="arrowR" /></button> : <button type="button" className="btn btn-soft" onClick={() => setStep(0)}>Спочатку</button>}</div>
    <div className="lbl" style={{ marginTop: 8 }}>Частини тут вигадані. Справжні видаються в режимі з сервером.</div>
  </section>;
}
