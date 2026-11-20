/* Адміністрування з бекендом: «Люди» (GET/POST/PATCH /admin/users, запрошення), «Довідники»
 * (/dictionaries/categories|facts|positions), «Реєстр ризиків» (/units/{id}/risk-register), сторінка запрошення /invite/<токен>.
 * Завантажується окремим чанком (React.lazy в App.jsx). */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset, apiErrText, ApiErr, dn, apiInviteDone, orgT } from "../lib/api.js";
import { COMPS, COMP } from "../lib/model.js";
import { plural } from "../lib/format.js";
import { toast, openDrawer, closeDrawer } from "../lib/store.js";
import { copyText } from "../lib/util.js";
import { Loading, Failed, Empty, NoAccess, NeedServer } from "../components/states.jsx";
import { pol, SROLE, Err, importErr, unitOpts, loadUnits, loadCats, Dot, inviteAbs } from "./WaveAdmin.jsx";

/* ---------- Люди ---------- */
export function People() {
  if (!API.on) return <NeedServer t="Люди" />;
  const r = apiMod("users", () => api("/admin/users")), un = loadUnits(), cats = loadCats();
  const [q, setQ] = useState(""), [role, setRole] = useState("all");
  if (!r || !un) return <Loading t="Люди" />;
  if (r.error) return r.status === 403 ? <NoAccess /> : <Failed e={r.error} onRetry={() => apiModReset("users")} />;
  const units = un.data || [], uName = id => dn((units.find(u => u.id === id) || {}).name || "");
  const cName = c => ((cats && cats.data || []).find(x => x.code === c) || {}).title || c;
  const s = q.trim().toLowerCase();
  const rows = r.data.filter(u => (role === "all" || u.role === role) && (!s || `${u.login} ${u.display_name} ${uName(u.unit_id)}`.toLowerCase().includes(s)));
  const roles = [...new Set(r.data.map(u => u.role))];
  return <>
    <section className="c12 rise toolbar">
      <label className="search inst-search"><span><Ic n="search" /></span><input id="ppQ" placeholder="Логін, імʼя або підрозділ" value={q} onChange={e => setQ(e.target.value)} /></label>
      <select className="inp" aria-label="Роль" value={role} onChange={e => setRole(e.target.value)}><option value="all">Усі ролі</option>{roles.map(x => <option key={x} value={x}>{SROLE[x] || x}</option>)}</select>
      <span className="lbl tnum">{rows.length} з {r.data.length}</span><div className="sp" />
      <button type="button" className="btn btn-primary" id="ppNew" onClick={() => userForm(null, units)}><Ic n="plus" />Новий обліковий запис</button>
    </section>
    <section className="card c12 rise"><div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Логін</th><th>Імʼя</th><th>Роль</th><th>Підрозділ</th><th>Стан</th><th></th></tr></thead><tbody>
      {rows.map(u => <tr key={u.id}>
        <td className="tnum"><b style={{ fontWeight: 600 }}>{u.login}</b></td><td>{dn(u.display_name)}</td>
        <td>{SROLE[u.role] || u.role}{u.category ? <span className="lbl">, {cName(u.category).toLowerCase()}</span> : null}</td>
        <td>{uName(u.unit_id) || <span className="lbl">–</span>}</td>
        <td className="adm-st">{u.is_active ? <><Dot c="var(--teal)" />Активний</> : <><Dot c="var(--muted)" />Заблоковано</>}</td>
        <td className="adm-acts"><button type="button" className="btn btn-ghost btn-s" onClick={() => userForm(u, units)}><Ic n="edit" />Змінити</button>
          {u.is_active && <button type="button" className="btn btn-ghost btn-s" onClick={() => reinvite(u)}><Ic n="send" />Запрошення</button>}</td>
      </tr>)}
    </tbody></table></div>{!rows.length && <div className="empty">Нікого не знайдено.</div>}</section>
  </>;
}
async function reinvite(u) {
  try { const x = await api(`/admin/users/${u.id}/invite`, { method: "POST" }); showInvite(u.login, x.invite_link, x.invite_expires_at); }
  catch (e) { toast(apiErrText(e)); }
}
function showInvite(login, link, exp) {
  openDrawer("Запрошення", () => <>
    <div>Посилання для <b>{login}</b>. Людина відкриває його й сама ставить пароль. Показується один раз: скопіюйте й передайте особисто.</div>
    <code className="hash-full" id="invLink">{inviteAbs(link)}</code>
    {exp && <div className="lbl">Діє до {new Date(exp).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })}.</div>}
    <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => copyText(inviteAbs(link), () => toast("Посилання скопійовано"))}><Ic n="copy" />Копіювати</button>
  </>);
}
function userForm(u, units) {
  const cats = (API.mod.dCats && API.mod.dCats.data || []).filter(c => c.active);
  openDrawer(u ? "Обліковий запис" : "Новий обліковий запис", () => {
    const [f, setF] = useState(u ? { login: u.login, display_name: u.display_name, role: u.role, category: u.category || "", unit_id: u.unit_id || "", is_active: u.is_active, password: "" }
      : { login: "", display_name: "", role: "respondent", category: (cats[0] || {}).code || "", unit_id: "", is_active: true, password: "" });
    const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const pw = pol().admin_sets_passwords !== false;
    const ok = async () => {
      if (!u && !/^[a-z0-9_.-]{2,}$/i.test(f.login.trim())) return setErr("Логін: щонайменше 2 символи, латиниця, цифри, «_», «.», «-».");
      if (!f.display_name.trim()) return setErr("Вкажіть імʼя.");
      if (f.password && f.password.length < 8) return setErr("Пароль щонайменше 8 символів.");
      const body = { display_name: f.display_name.trim(), role: f.role, category: f.role === "respondent" ? (f.category || null) : null, unit_id: f.unit_id || null };
      if (f.password) body.password = f.password;
      setBusy(true); setErr("");
      try {
        const x = u ? await api(`/admin/users/${u.id}`, { method: "PATCH", body: { ...body, is_active: f.is_active } })
          : await api("/admin/users", { method: "POST", body: { ...body, login: f.login.trim() } });
        apiModReset("users");
        if (x.pending_approval_id) { closeDrawer(); toast("Запит надіслано: зміну має підтвердити друга людина."); }
        else if (x.invite_link) showInvite(x.login, x.invite_link, x.invite_expires_at);
        else { closeDrawer(); toast(u ? "Збережено" : `Обліковий запис ${x.login} створено`); }
      } catch (e) { setErr(apiErrText(e)); setBusy(false); }
    };
    return <>
      {!u && <div className="field"><label htmlFor="uf-l">Логін</label><input className="inp" id="uf-l" autoComplete="off" value={f.login} onChange={e => set("login", e.target.value)} /></div>}
      <div className="field"><label htmlFor="uf-n">Імʼя або псевдонім</label><input className="inp" id="uf-n" value={f.display_name} onChange={e => set("display_name", e.target.value)} /></div>
      <div className="field"><label htmlFor="uf-r">Роль</label><select className="inp" id="uf-r" value={f.role} onChange={e => set("role", e.target.value)}>{Object.entries(SROLE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
      {f.role === "respondent" && <div className="field"><label htmlFor="uf-c">Категорія</label><select className="inp" id="uf-c" value={f.category} onChange={e => set("category", e.target.value)}>{cats.map(c => <option key={c.code} value={c.code}>{c.title}</option>)}</select></div>}
      <div className="field"><label htmlFor="uf-u">Підрозділ</label><select className="inp" id="uf-u" value={f.unit_id} onChange={e => set("unit_id", e.target.value)}><option value="">Без підрозділу</option>{unitOpts(units).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
      {pw && <div className="field"><label htmlFor="uf-p">{u ? "Новий пароль" : "Пароль"}</label><input className="inp" id="uf-p" type="password" autoComplete="new-password" value={f.password} onChange={e => set("password", e.target.value)} />
        <span className="lbl">{u ? "Порожньо: пароль не змінюється." : "Порожньо: людина отримає запрошення й поставить пароль сама."}</span></div>}
      {!pw && !u && <div className="lbl">Пароль людина ставить сама за запрошенням.</div>}
      {u && <label className="adm-chk"><input type="checkbox" checked={f.is_active} onChange={e => set("is_active", e.target.checked)} />Активний (зняти, щоб заблокувати вхід)</label>}
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="uf-ok" style={{ justifyContent: "center" }} disabled={busy} onClick={ok}><Ic n="ok" />{busy ? "Зберігаємо…" : u ? "Зберегти" : "Створити"}</button>
    </>;
  });
}

/* ---------- Сторінка запрошення /invite/<токен> ---------- */
export function InvitePage() {
  const [p, setP] = useState(""), [p2, setP2] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (p.length < 8) return setErr("Пароль щонайменше 8 символів.");
    if (p !== p2) return setErr("Паролі не збігаються.");
    setBusy(true); setErr("");
    try { await api("/auth/invite", { method: "POST", auth: false, body: { token: API.invite, password: p } }); apiInviteDone("Пароль встановлено. Увійдіть зі своїм логіном і новим паролем."); }
    catch (er) { setErr(er instanceof ApiErr && er.status === 429 ? "Забагато спроб. Зачекайте й спробуйте ще раз." : apiErrText(er)); setBusy(false); }
  };
  return <div className="login-wrap c12"><section className="card rise login-card">
    <div className="brand" style={{ padding: "0 0 6px" }}><span className="logo"><Ic n="pulse" size={20} /></span>Integra</div>
    <h2 style={{ margin: "6px 0 2px", fontSize: 22 }}>Встановіть пароль</h2>
    <div className="lbl">Пароль знаєте лише ви: адміністратор його не бачить.</div>
    <form id="invF" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }} onSubmit={submit}>
      <div className="field"><label htmlFor="ip1">Новий пароль</label><input className="inp" id="ip1" type="password" autoComplete="new-password" value={p} onChange={e => setP(e.target.value)} /></div>
      <div className="field"><label htmlFor="ip2">Повторіть пароль</label><input className="inp" id="ip2" type="password" autoComplete="new-password" value={p2} onChange={e => setP2(e.target.value)} /></div>
      <Err t={err} />
      <button className="btn btn-primary" type="submit" style={{ justifyContent: "center" }} disabled={busy}>Зберегти пароль <Ic n="arrowR" /></button>
    </form>
  </section></div>;
}

/* ---------- Довідники ---------- */
export function Dicts() {
  if (!API.on) return <NeedServer t="Довідники" />;
  const mgr = ["admin", "coordinator"].includes(S.role);
  return <><CatsCard mgr={mgr} /><FactsCard mgr={mgr} /><PosCard /></>;
}
function CatsCard({ mgr }) {
  const r = loadCats();
  return <section className="card c12 rise">
    <div className="card-h"><h2>Категорії респондентів</h2><div className="sp" />{mgr && <button type="button" className="btn btn-soft btn-s" id="dcNew" onClick={() => catForm(null)}><Ic n="plus" />Додати</button>}</div>
    <div className="lbl" style={{ marginBottom: 8 }}>Без ваги категорія лише порівнюється з іншими й в індекс не йде.</div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <Err t={r.error} /> : <div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Назва</th><th>Код</th><th>Вага в індексі</th><th>Стан</th><th></th></tr></thead><tbody>
      {r.data.map(c => <tr key={c.code}><td>{c.title}</td><td className="tnum lbl">{c.code}</td><td className="tnum">{c.weight != null && c.in_index ? Math.round(c.weight * 100) + " %" : <span className="lbl">лише порівняння</span>}</td>
        <td className="adm-st">{c.active ? <><Dot c="var(--teal)" />Діє</> : <><Dot c="var(--muted)" />Вимкнено</>}</td>
        <td className="adm-acts">{mgr && <button type="button" className="btn btn-ghost btn-s" onClick={() => catForm(c)}><Ic n="edit" />Змінити</button>}</td></tr>)}
    </tbody></table></div>}
  </section>;
}
function catForm(c) {
  openDrawer(c ? "Категорія" : "Нова категорія", () => {
    const [code, setCode] = useState(c ? c.code : ""), [title, setTitle] = useState(c ? c.title : ""), [w, setW] = useState(c && c.weight != null ? String(Math.round(c.weight * 100)) : ""), [act, setAct] = useState(c ? c.active : true), [err, setErr] = useState("");
    const ok = async () => {
      if (!c && !/^[a-z][a-z0-9_]{1,31}$/.test(code)) return setErr("Код: латиниця з малої літери, цифри, «_», від 2 символів.");
      if (!title.trim()) return setErr("Вкажіть назву.");
      const wv = w.trim() === "" ? null : +w / 100;
      if (wv != null && !(wv > 0 && wv <= 1)) return setErr("Вага: від 1 до 100 % або порожньо.");
      try {
        if (c) await api(`/dictionaries/categories/${encodeURIComponent(c.code)}`, { method: "PATCH", body: { title: title.trim(), weight: wv, active: act } });
        else await api("/dictionaries/categories", { method: "POST", body: { code, title: title.trim(), weight: wv } });
        apiModReset("dCats"); closeDrawer(); toast("Збережено");
      } catch (e) { setErr(apiErrText(e)); }
    };
    return <>
      {!c && <div className="field"><label htmlFor="cf-c">Код</label><input className="inp" id="cf-c" placeholder="cadets" value={code} onChange={e => setCode(e.target.value.trim())} /></div>}
      <div className="field"><label htmlFor="cf-t">Назва</label><input className="inp" id="cf-t" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="cf-w">Вага в індексі, %</label><input className="inp tnum" id="cf-w" inputMode="numeric" value={w} onChange={e => setW(e.target.value)} /><span className="lbl">Порожньо: лише для порівняння.</span></div>
      {c && <label className="adm-chk"><input type="checkbox" checked={act} onChange={e => setAct(e.target.checked)} />Категорія діє</label>}
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="cf-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="ok" />Зберегти</button>
    </>;
  });
}
const OWN = { checks: "Перевірки", learning: "Навчання", training: "Облік навчання", hr: "Кадри", mitra: "Mitra", manual: "Вручну", procurement: "Закупівлі", reports: "Повідомлення", atestat: "Атестація", artemida: "Артеміда" };
function FactsCard({ mgr }) {
  const r = apiMod("dFacts", () => api("/dictionaries/facts"));
  return <section className="card c12 rise">
    <div className="card-h"><h2>Факти</h2><div className="sp" />{mgr && <button type="button" className="btn btn-soft btn-s" id="dfNew" onClick={() => factForm(null)}><Ic n="plus" />Додати</button>}</div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <Err t={r.error} /> : <div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Факт</th><th>Компонент</th><th>Межі рівнів, %</th><th>Хто передає</th><th>Стан</th><th></th></tr></thead><tbody>
      {r.data.map(f => <tr key={f.code}><td style={{ minWidth: 220 }}>{f.title}</td><td>{COMP[f.component] ? COMP[f.component].n : f.component}</td><td className="tnum">{f.thresholds.join(" / ")}</td>
        <td>{f.owner_sources && f.owner_sources.length ? f.owner_sources.map(s => OWN[s] || s).join(", ") : <span className="lbl">будь-яке джерело</span>}</td>
        <td className="adm-st">{f.active ? <><Dot c="var(--teal)" />Діє</> : <><Dot c="var(--muted)" />Вимкнено</>}</td>
        <td className="adm-acts">{mgr && <button type="button" className="btn btn-ghost btn-s" onClick={() => factForm(f)}><Ic n="edit" />Змінити</button>}</td></tr>)}
    </tbody></table></div>}
  </section>;
}
function factForm(f) {
  openDrawer(f ? "Факт" : "Новий факт", () => {
    const [v, setV] = useState(f ? { code: f.code, title: f.title, component: f.component, th: f.thresholds.join(", "), num: f.numerator || "", den: f.denominator || "", rest: f.rest || "", own: (f.owner_sources || []).join(", "), active: f.active }
      : { code: "", title: "", component: COMPS[0], th: "50, 70, 85, 95", num: "", den: "", rest: "", own: "", active: true });
    const [err, setErr] = useState(""), set = (k, x) => setV(o => ({ ...o, [k]: x }));
    const ok = async () => {
      const th = v.th.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (!f && !/^[a-z][a-z0-9_]{1,63}$/.test(v.code)) return setErr("Код: латиниця з малої літери, цифри, «_».");
      if (v.title.trim().length < 3) return setErr("Вкажіть назву.");
      if (th.length !== 4 || th.some(x => !(x >= 0 && x <= 100)) || th.some((x, i) => i && x <= th[i - 1])) return setErr("Межі рівнів: чотири числа від 0 до 100 за зростанням.");
      const own = v.own.split(/[,;\s]+/).filter(Boolean);
      try {
        if (f) await api(`/dictionaries/facts/${encodeURIComponent(f.code)}`, { method: "PATCH", body: { title: v.title.trim(), thresholds: th, active: v.active, owner_sources: own } });
        else await api("/dictionaries/facts", { method: "POST", body: { code: v.code, title: v.title.trim(), component: v.component, thresholds: th, numerator: v.num.trim(), denominator: v.den.trim(), rest: v.rest.trim(), owner_sources: own } });
        apiModReset("dFacts"); closeDrawer(); toast("Збережено");
      } catch (e) { setErr(apiErrText(e)); }
    };
    return <>
      {!f && <div className="field"><label htmlFor="ff-c">Код</label><input className="inp" id="ff-c" value={v.code} onChange={e => set("code", e.target.value.trim())} /></div>}
      <div className="field"><label htmlFor="ff-t">Назва</label><input className="inp" id="ff-t" value={v.title} onChange={e => set("title", e.target.value)} /></div>
      {!f && <div className="field"><label htmlFor="ff-k">Компонент</label><select className="inp" id="ff-k" value={v.component} onChange={e => set("component", e.target.value)}>{COMPS.map(c => <option key={c} value={c}>{COMP[c].n}</option>)}</select></div>}
      <div className="field"><label htmlFor="ff-th">Межі рівнів 2–5, %</label><input className="inp tnum" id="ff-th" value={v.th} onChange={e => set("th", e.target.value)} /><span className="lbl">Чотири числа за зростанням, наприклад 50, 70, 85, 95.</span></div>
      {!f && <div className="field"><label htmlFor="ff-n">Чисельник і знаменник</label><div style={{ display: "flex", gap: 8 }}><input className="inp" id="ff-n" placeholder="пройшли навчання" value={v.num} onChange={e => set("num", e.target.value)} /><input className="inp" aria-label="Знаменник" placeholder="мали пройти" value={v.den} onChange={e => set("den", e.target.value)} /></div></div>}
      <div className="field"><label htmlFor="ff-o">Хто передає (коди джерел через кому)</label><input className="inp" id="ff-o" placeholder="checks, learning" value={v.own} onChange={e => set("own", e.target.value)} /><span className="lbl">Порожньо: будь-яке джерело.</span></div>
      {f && <label className="adm-chk"><input type="checkbox" checked={v.active} onChange={e => set("active", e.target.checked)} />Факт діє</label>}
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="ff-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="ok" />Зберегти</button>
    </>;
  });
}
function PosCard() {
  const r = apiMod("dPos", () => api("/dictionaries/positions"));
  const [t, setT] = useState(""), [err, setErr] = useState("");
  const ed = ["admin", "coordinator", "commissioner"].includes(S.role);
  const add = async e => {
    e.preventDefault(); if (!t.trim()) return;
    try { await api("/dictionaries/positions", { method: "POST", body: { title: t.trim() } }); setT(""); setErr(""); apiModReset("dPos"); API.positions = null; }
    catch (er) { setErr(apiErrText(er)); }
  };
  const del = async p => { try { await api(`/dictionaries/positions/${p.id}`, { method: "DELETE" }); apiModReset("dPos"); API.positions = null; toast(`Посаду «${p.title}» вимкнено`); } catch (er) { toast(apiErrText(er)); } };
  const list = r && r.data ? r.data.filter(p => p.active) : [];
  return <section className="card c12 rise">
    <div className="card-h"><h2>Посади</h2></div>
    <div className="lbl" style={{ marginBottom: 8 }}>З цього списку обирають відповідального за захід. Лише посади, без ПІБ.</div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <Err t={r.error} /> : <div className="rows">{list.map(p => <div key={p.id} className="row"><div className="grow">{p.title}</div>
      {ed && <button type="button" className="btn btn-ghost btn-s" aria-label={`Вимкнути посаду ${p.title}`} onClick={() => del(p)}><Ic n="x" />Вимкнути</button>}</div>)}</div>}
    {ed && <form className="adm-add" onSubmit={add}><input className="inp" id="dpNew" aria-label="Нова посада" placeholder="Нова посада" value={t} onChange={e => setT(e.target.value)} /><button type="submit" className="btn btn-soft"><Ic n="plus" />Додати</button></form>}
    <Err t={err} />
  </section>;
}

/* ---------- Реєстр ризиків ---------- */
const RST = { open: ["Відкритий", "var(--red)"], mitigated: ["Знижено", "var(--teal)"], accepted: ["Прийнято", "var(--muted)"] };
export function Risks() {
  if (!API.on) return <NeedServer t="Реєстр ризиків" />;
  const un = apiMod("rUnits", () => api("/units"));
  const [uid, setUid] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  if (!un) return <Loading t="Реєстр ризиків" />;
  if (un.error) return <Failed e={un.error} onRetry={() => apiModReset("rUnits")} />;
  const units = un.data, root = units.find(u => !u.parent_id) || units[0];
  const id = uid || API.deptUnit || API.unitId || (root && root.id);
  if (!id) return <Empty t="Немає підрозділів" />;
  const key = "risk:" + id, r = apiMod(key, () => api(`/units/${id}/risk-register`));
  const imp = ["admin", "commissioner"].includes(S.role);
  const upload = async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    const fd = new FormData(); fd.append("file", file); setBusy(true); setErr("");
    try { const x = await api(`/units/${id}/risk-register/import`, { method: "POST", body: fd }); apiModReset(key); toast(`Імпортовано: нових ${x.created ?? 0}, оновлено ${x.updated ?? 0}`); }
    catch (er) { setErr(importErr(er)); } finally { setBusy(false); }
  };
  const d = r && r.data;
  return <>
    <section className="c12 rise toolbar">
      {units.length > 1 && <select className="inp" aria-label="Підрозділ" value={id} onChange={e => setUid(e.target.value)}>{unitOpts(units).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
      <div className="sp" />
      {imp && <label className={`btn btn-soft ${busy ? "dis" : ""}`} id="rkImp"><Ic n="file" />{busy ? "Імпортуємо…" : "Імпорт CSV"}<input type="file" accept=".csv,text/csv" hidden onChange={upload} disabled={busy} /></label>}
    </section>
    {imp && <section className="c12 rise"><div className="lbl">CSV у UTF-8: <code>code,title,component</code> і за потреби <code>likelihood,impact,measure,owner,status</code>. Компонент: culture, system, accountability. Повторний імпорт оновлює ризики за кодом.</div>{err && <div style={{ marginTop: 6 }}><Err t={err} /></div>}</section>}
    {!r ? <Loading t="Реєстр ризиків" /> : r.error ? (r.status === 403 ? <NoAccess /> : <Failed e={r.error} onRetry={() => apiModReset(key)} />) : !d.items.length
      ? <Empty t="Реєстр порожній">{imp ? `Імпортуйте таблицю ризиків (${orgT("genitive")}) у CSV.` : "Ризики ще не імпортували."}</Empty>
      : <section className="card c12 rise">
        <div className="rk-sum">{COMPS.map(c => { const b = d.by_component[c] || { total: 0, open: 0, without_measure: 0 }; return <span key={c}><b>{COMP[c].n}</b>: {b.total} {plural(b.total, "ризик", "ризики", "ризиків")}, відкритих {b.open}{b.without_measure ? <span className="rk-warn">, без заходу {b.without_measure}</span> : null}</span>; })}</div>
        <div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Ризик</th><th>Компонент</th><th>Бал</th><th>Захід</th><th>Відповідальний</th><th>Стан</th></tr></thead><tbody>
          {d.items.map(x => <tr key={x.id}><td style={{ minWidth: 240 }}><span className="lbl tnum">{x.code}</span> {x.title}</td><td>{x.component_title || (COMP[x.component] || {}).n}</td>
            <td className="tnum">{x.score != null ? <span title={`Ймовірність ${x.likelihood} × вплив ${x.impact}`}>{x.score}</span> : <span className="lbl">–</span>}</td>
            <td>{x.measure_title ? <>{x.measure_title}{!x.measure_id && <span className="lbl"> (немає в трекері)</span>}</> : <span className="rk-warn">немає</span>}</td>
            <td>{x.owner || <span className="lbl">–</span>}</td>
            <td className="adm-st"><Dot c={(RST[x.status] || RST.open)[1]} />{(RST[x.status] || [x.status])[0]}</td></tr>)}
        </tbody></table></div>
      </section>}
  </>;
}

