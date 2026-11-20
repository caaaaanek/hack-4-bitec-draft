/* Адміністрування з бекендом: «Люди» (лише технічний адміністратор: /admin/users, запрошення, імпорт CSV), «Довідники»
 * (/dictionaries/categories|facts|positions), «Реєстр ризиків» (/units/{id}/risk-register), сторінка запрошення /invite/<токен>.
 * Завантажується окремим чанком (React.lazy в App.jsx). */
import { Mark } from "../components/Mark.jsx";
import { useState, useEffect } from "react";
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset, apiErrText, ApiErr, dn, apiInviteDone, orgT } from "../lib/api.js";
import { COMPS, COMP } from "../lib/model.js";
import { plural, dsh } from "../lib/format.js";
import { toast, openDrawer, closeDrawer } from "../lib/store.js";
import { copyText } from "../lib/util.js";
import { Loading, Failed, Empty, NoAccess, NeedServer } from "../components/states.jsx";
import { SROLE, Err, importErr, unitOpts, loadUnits, loadCats, Dot, inviteAbs } from "./WaveAdmin.jsx";
import { useApprovals } from "./Transparency.jsx";
import { copyInvite } from "./invite.jsx";

/* ---------- Люди (лише технічний адміністратор) ---------- */
// Записи, які чекають підтвердження уповноваженого (activate_users), — з власних запитів техадміна
function pendingUsers() {
  const r = useApprovals(), ids = new Set();
  for (const a of (r && r.data) || []) if (a.kind === "activate_users") for (const id of (a.payload && a.payload.user_ids) || []) ids.add(id);
  return ids;
}
const pendToast = () => toast("Запит передано уповноваженому: зміна набуде чинності після його підтвердження.");
export function People() {
  if (!API.on) return <NeedServer t="Люди" />;
  const r = apiMod("users", () => api("/admin/users")), un = loadUnits(), cats = loadCats(), pend = pendingUsers();
  const [q, setQ] = useState(""), [role, setRole] = useState("all"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  if (!r || !un) return <Loading t="Люди" />;
  if (r.error) return r.status === 403 ? <NoAccess /> : <Failed e={r.error} onRetry={() => apiModReset("users")} />;
  const units = un.data || [], uName = id => dn((units.find(u => u.id === id) || {}).name || "");
  const cName = c => ((cats && cats.data || []).find(x => x.code === c) || {}).title || c;
  const s = q.trim().toLowerCase(), meId = API.user && API.user.id;
  const rows = r.data.filter(u => (role === "all" || u.role === role) && (!s || `${u.login} ${u.display_name} ${uName(u.unit_id)}`.toLowerCase().includes(s)));
  const roles = [...new Set(r.data.map(u => u.role))];
  const upload = async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    const fd = new FormData(); fd.append("file", file); setBusy(true); setErr("");
    try {
      const x = await api("/admin/users/import", { method: "POST", body: fd }); apiModReset("users", "approvals");
      showImported(x);
    } catch (er) { setErr(importErr(er)); } finally { setBusy(false); }
  };
  return <>
    <section className="c12 rise toolbar">
      <label className="search inst-search"><span><Ic n="search" /></span><input id="ppQ" placeholder="Логін, імʼя або підрозділ" value={q} onChange={e => setQ(e.target.value)} /></label>
      <select className="inp" aria-label="Роль" value={role} onChange={e => setRole(e.target.value)}><option value="all">Усі ролі</option>{roles.map(x => <option key={x} value={x}>{SROLE[x] || x}</option>)}</select>
      <span className="lbl tnum">{rows.length} з {r.data.length}</span><div className="sp" />
      <label className={`btn btn-soft ${busy ? "dis" : ""}`} id="ppImp" data-tip="CSV у UTF-8: login, category, unit і за бажанням display_name. Кожен отримає запрошення й сам поставить пароль."><Ic n="file" />{busy ? "Імпортуємо…" : "Імпорт CSV"}<input type="file" accept=".csv,text/csv" hidden onChange={upload} disabled={busy} /></label>
      <button type="button" className="btn btn-primary" id="ppNew" onClick={() => userForm(null, units)}><Ic n="plus" />Новий обліковий запис</button>
    </section>
    {err && <section className="c12 rise"><Err t={err} /></section>}
    <section className="card c12 rise"><div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Логін</th><th>Імʼя</th><th>Роль</th><th>Підрозділ</th><th>Стан</th><th></th></tr></thead><tbody>
      {rows.map(u => { const self = u.id === meId; return <tr key={u.id}>
        <td className="tnum"><b style={{ fontWeight: 600 }}>{u.login}</b>{self && <span className="lbl"> (ви)</span>}</td><td>{dn(u.display_name)}</td>
        <td>{SROLE[u.role] || u.role}{u.category ? <span className="lbl">, {cName(u.category).toLowerCase()}</span> : null}</td>
        <td>{uName(u.unit_id) || <span className="lbl">–</span>}</td>
        <td className="adm-st">{u.is_active ? <><Dot c="var(--teal)" />Активний</> : pend.has(u.id) ? <><Dot c="var(--amber)" />Чекає підтвердження</> : <><Dot c="var(--muted)" />Заблоковано</>}</td>
        <td className="adm-acts"><button type="button" className="btn btn-ghost btn-s" onClick={() => userForm(u, units)}><Ic n="edit" />Змінити</button>
          {!self && <InviteBtn u={u} />}</td>
      </tr>; })}
    </tbody></table></div>{!rows.length && <div className="empty">Нікого не знайдено.</div>}</section>
  </>;
}
// Нове запрошення прямо в рядку: перший клік питає підтвердження (старий пароль перестане діяти), другий створює посилання й копіює його
function InviteBtn({ u }) {
  const [ask, setAsk] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (!ask) return; const t = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(t); }, [ask]);
  const go = async () => {
    if (!ask) return setAsk(true);
    setAsk(false); setBusy(true);
    try {
      const x = await api(`/admin/users/${u.id}/invite`, { method: "POST" });
      if (x.pending_approval_id) { apiModReset("approvals"); toast("Скидання передано на підтвердження. Посилання отримає той, хто підтвердить."); }
      else copyInvite(u.login, x.invite_link, x.invite_expires_at);
    } catch (e) { toast(apiErrText(e)); }
    setBusy(false);
  };
  return <button type="button" className={`btn btn-s ${ask ? "btn-soft" : "btn-ghost"}`} disabled={busy} onClick={go}
    data-tip={ask ? "Старий пароль і сесії людини перестануть діяти" : u.is_active ? "Якщо людина забула пароль: нове посилання, за яким вона поставить новий" : "Створити посилання для входу й скопіювати його"}><Ic n={u.is_active ? "reset" : "send"} />{busy ? "Створюємо…" : ask ? "Точно? Натисніть ще раз" : u.is_active ? "Скинути пароль" : "Запрошення"}</button>;
}
// Результат масового імпорту: логін і посилання кожному, показуються один раз; CSV формується в браузері й ніде не зберігається
function showImported(x) {
  const list = x.credentials || [];
  const csv = () => {
    const txt = "login,invite_link\n" + list.map(c => `${c.login},${inviteAbs(c.invite_link)}`).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + txt], { type: "text/csv;charset=utf-8" })); a.download = "zaproshennya.csv";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  openDrawer("Імпортовано", () => <>
    <div>Створено облікових записів: <b className="tnum">{x.created_users}</b>. Передайте кожному його посилання особисто. Більше система їх не покаже.</div>
    {x.pending_approval_id && <div className="note-box"><span className="lbl">Записи неактивні, доки імпорт не підтвердить уповноважений. Посилання можна передати вже зараз: увійти вийде після підтвердження.</span></div>}
    <div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Логін</th><th>Посилання</th></tr></thead><tbody>
      {list.map(c => <tr key={c.login}><td className="tnum"><b style={{ fontWeight: 600 }}>{c.login}</b></td><td className="lbl" style={{ wordBreak: "break-all" }}>{inviteAbs(c.invite_link)}</td></tr>)}</tbody></table></div>
    <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} onClick={csv}><Ic n="download" />Завантажити CSV</button>
    <button type="button" className="btn btn-soft" style={{ justifyContent: "center" }} onClick={() => copyText(list.map(c => `${c.login}\t${inviteAbs(c.invite_link)}`).join("\n"), () => toast("Скопійовано"))}><Ic n="copy" />Копіювати все</button>
  </>);
}
function userForm(u, units) {
  const cats = (API.mod.dCats && API.mod.dCats.data || []).filter(c => c.active);
  const self = !!u && u.id === (API.user && API.user.id); // свій запис техадмін змінює лише в межах імені
  openDrawer(u ? "Обліковий запис" : "Новий обліковий запис", () => {
    const [f, setF] = useState(u ? { login: u.login, display_name: u.display_name, role: u.role, category: u.category || "", unit_id: u.unit_id || "", is_active: u.is_active }
      : { login: "", display_name: "", role: "respondent", category: ((cats.find(c => c.code === "staff") || cats[0]) || {}).code || "" /* більшість людей це особовий склад */, unit_id: "", is_active: true });
    const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const ok = async () => {
      if (!u && !/^[a-z0-9_.-]{2,}$/i.test(f.login.trim())) return setErr("Логін: щонайменше 2 символи, латиниця, цифри, «_», «.», «-».");
      if (!f.display_name.trim()) return setErr("Вкажіть імʼя.");
      const body = self ? { display_name: f.display_name.trim() }
        : { display_name: f.display_name.trim(), role: f.role, category: f.role === "respondent" ? (f.category || null) : null, unit_id: f.unit_id || null };
      setBusy(true); setErr("");
      try {
        const x = u ? await api(`/admin/users/${u.id}`, { method: "PATCH", body: self ? body : { ...body, is_active: f.is_active } })
          : await api("/admin/users", { method: "POST", body: { ...body, login: f.login.trim() } });
        apiModReset("users", "approvals");
        if (x.invite_link) copyInvite(x.login, x.invite_link, x.invite_expires_at, x.pending_approval_id ? "Запис неактивний, доки його не підтвердить уповноважений." : null);
        else if (x.pending_approval_id) { closeDrawer(); pendToast(); }
        else { closeDrawer(); toast(u ? "Збережено" : `Обліковий запис ${x.login} створено`); }
      } catch (e) { setErr(apiErrText(e)); setBusy(false); }
    };
    return <>
      {!u && <div className="field"><label htmlFor="uf-l">Логін</label><input className="inp" id="uf-l" autoComplete="off" value={f.login} onChange={e => set("login", e.target.value)} /></div>}
      <div className="field"><label htmlFor="uf-n">Імʼя або псевдонім</label><input className="inp" id="uf-n" value={f.display_name} onChange={e => set("display_name", e.target.value)} /></div>
      {!self && <>
        <div className="field"><label htmlFor="uf-r">Роль</label><select className="inp" id="uf-r" value={f.role} onChange={e => set("role", e.target.value)}>{Object.entries(SROLE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        {f.role === "respondent" && <div className="field"><label htmlFor="uf-c">Категорія</label><select className="inp" id="uf-c" value={f.category} onChange={e => set("category", e.target.value)}>{cats.map(c => <option key={c.code} value={c.code}>{c.title}</option>)}</select></div>}
        <div className="field"><label htmlFor="uf-u">Підрозділ</label><select className="inp" id="uf-u" value={f.unit_id} onChange={e => set("unit_id", e.target.value)}><option value="">Без підрозділу</option>{unitOpts(units).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        {!u && <div className="lbl">Пароль людина ставить сама за одноразовим запрошенням. Запис стане активним після підтвердження уповноваженого.</div>}
        {u && <label className="adm-chk"><input type="checkbox" checked={f.is_active} onChange={e => set("is_active", e.target.checked)} />Активний (зняти, щоб заблокувати вхід)</label>}
        {u && <div className="lbl">Зміну ролі, категорії чи блокування може знадобитися підтвердити другою людиною.</div>}
      </>}
      {self && <div className="lbl">Свій запис ви змінюєте лише в межах імені. Роль, підрозділ і пароль змінює інший адміністратор.</div>}
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="uf-ok" style={{ justifyContent: "center" }} disabled={busy} onClick={ok}><Ic n="ok" />{busy ? "Зберігаємо…" : u ? "Зберегти" : "Створити"}</button>
    </>;
  });
}

/* ---------- Підрозділи (технічний адміністратор) ---------- */
// Структура заморожена від створення хвилі до закриття: 202 — зміну підтвердить уповноважений, 409 — хвиля відкрита
async function unitReq(path, method, body) {
  const x = await api(path, { method, body });
  apiModReset("admUnits", "approvals");
  if (x && x.pending_approval_id) toast(dsh(x.message) || "Зміну передано уповноваженому: вона набуде чинності після підтвердження.");
  return x;
}
export function Units() {
  const [shut, setShut] = useState(() => new Set());
  if (!API.on) return <NeedServer t="Підрозділи" />;
  const un = loadUnits();
  if (!un) return <Loading t="Підрозділи" />;
  if (un.error) return un.status === 403 ? <NoAccess /> : <Failed e={un.error} onRetry={() => apiModReset("admUnits")} />;
  const units = un.data, opts = unitOpts(units), byId = Object.fromEntries(units.map(u => [u.id, u]));
  const depth = u => { let d = 0; for (let p = u.parent_id && byId[u.parent_id]; p; p = p.parent_id && byId[p.parent_id]) d++; return d; };
  // Дерево, що згортається: вузол сховано, якщо згорнуто когось із його предків
  const kids = id => units.filter(x => x.parent_id === id).length, parents = units.filter(u => kids(u.id) && u.parent_id && byId[u.parent_id]).map(u => u.id); // корінь не згортаємо: перший рівень видно завжди
  const hidden = u => { for (let p = u.parent_id && byId[u.parent_id]; p; p = p.parent_id && byId[p.parent_id]) if (shut.has(p.id)) return true; return false; };
  const tog = id => setShut(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShut = parents.length > 0 && parents.every(id => shut.has(id));
  return <>
    <section className="card c12 rise"><div className="card-h" style={{ flexWrap: "wrap" }}><div className="big-stats" style={{ flex: "1 1 auto" }}><div><b className="tnum">{units.length}</b><span>{plural(units.length, "підрозділ", "підрозділи", "підрозділів")}</span></div></div>
      {parents.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setShut(allShut ? new Set() : new Set(parents))}><Ic n={allShut ? "chev" : "chevR"} />{allShut ? "Розгорнути все" : "Згорнути все"}</button>}
      <button type="button" className="btn btn-primary" id="unNew" onClick={() => unitForm(null, units)}><Ic n="plus" />Новий підрозділ</button></div>
    <div className="tbl-wrap"><table className="adm-tbl un-tree"><thead><tr><th>Підрозділ</th><th>Входить до</th><th></th></tr></thead><tbody>
      {opts.filter(([id]) => !hidden(byId[id])).map(([id]) => { const u = byId[id], d = depth(u), n = kids(id); return <tr key={id}>
        <td style={{ paddingLeft: 8 + d * 22 }}>{n ? <button type="button" className={`un-tog ${shut.has(id) ? "shut" : ""}`} aria-expanded={!shut.has(id)} aria-label={`${shut.has(id) ? "Розгорнути" : "Згорнути"} «${dn(u.name)}»`} onClick={() => tog(id)}><Ic n="chev" /></button> : <span className="un-gap" />}<b style={{ fontWeight: d ? 400 : 600 }}>{dn(u.name)}</b>{n && shut.has(id) ? <span className="lbl"> · {n} {plural(n, "вкладений", "вкладені", "вкладених")}</span> : null}</td>
        <td>{u.parent_id && byId[u.parent_id] ? dn(byId[u.parent_id].name) : <span className="lbl">–</span>}</td>
        <td className="adm-acts"><button type="button" className="btn btn-ghost btn-s" onClick={() => unitForm(u, units)}><Ic n="edit" />Змінити</button></td></tr>; })}
    </tbody></table></div>{!units.length && <div className="empty">Підрозділів ще немає.</div>}</section>
  </>;
}
function unitForm(u, units) {
  openDrawer(u ? "Підрозділ" : "Новий підрозділ", () => {
    const [name, setName] = useState(u ? u.name : ""), [par, setPar] = useState(u ? u.parent_id || "" : ""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [ask, setAsk] = useState(false);
    const run = async f => { setBusy(true); setErr(""); try { await f(); closeDrawer(); } catch (e) { setErr(apiErrText(e)); setBusy(false); } };
    const save = () => {
      if (!name.trim()) return setErr("Вкажіть назву.");
      if (!u) return run(async () => { const x = await unitReq("/admin/units", "POST", { name: name.trim(), parent_id: par || null }); if (!x.pending_approval_id) toast(`Підрозділ «${x.name}» створено`); });
      const body = {}; if (name.trim() !== u.name) body.name = name.trim(); if ((par || null) !== (u.parent_id || null)) body.parent_id = par || null;
      if (!Object.keys(body).length) return closeDrawer();
      return run(async () => { const x = await unitReq(`/admin/units/${u.id}`, "PATCH", body); if (!x.pending_approval_id) toast("Збережено"); });
    };
    const del = () => run(async () => { const x = await unitReq(`/admin/units/${u.id}`, "DELETE"); if (!x || !x.pending_approval_id) toast("Підрозділ видалено"); });
    const own = u ? new Set([u.id]) : new Set();
    if (u) { let grow = true; while (grow) { grow = false; for (const x of units) if (x.parent_id && own.has(x.parent_id) && !own.has(x.id)) { own.add(x.id); grow = true; } } }
    return <>
      <div className="field"><label htmlFor="un-n">Назва</label><input className="inp" id="un-n" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="un-p">Входить до</label><select className="inp" id="un-p" value={par} onChange={e => setPar(e.target.value)}><option value="">Верхній рівень</option>{unitOpts(units).filter(([id]) => !own.has(id)).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="un-ok" style={{ justifyContent: "center" }} disabled={busy} onClick={save}><Ic n="ok" />{busy ? "Зберігаємо…" : "Зберегти"}</button>
      {u && (ask ? <div className="note-box"><span className="lbl">Видалити «{dn(u.name)}»? Підрозділ з людьми чи дочірніми підрозділами сервер не видалить.</span><div style={{ display: "flex", gap: 8 }}><button type="button" className="btn btn-ghost" onClick={() => setAsk(false)}>Скасувати</button><button type="button" className="btn btn-soft" disabled={busy} onClick={del}>Видалити</button></div></div>
        : <button type="button" className="btn btn-ghost" style={{ justifyContent: "center" }} onClick={() => setAsk(true)}><Ic n="x" />Видалити підрозділ</button>)}
    </>;
  });
}

/* ---------- Зведення (технічний адміністратор): лише люди й підрозділи, без хвиль і результатів ---------- */
export function Summary() {
  if (!API.on) return <NeedServer t="Зведення" />;
  const r = apiMod("admOverview", () => api("/admin/overview")), cats = loadCats();
  if (!r) return <Loading t="Зведення" />;
  if (r.error) return r.status === 403 ? <NoAccess /> : <Failed e={r.error} onRetry={() => apiModReset("admOverview")} />;
  const d = r.data, u = d.users || {}, cName = c => ((cats && cats.data || []).find(x => x.code === c) || {}).title || c;
  const kv = (obj, f) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).flatMap(([k, n]) => [<dt key={"t" + k}>{f(k)}</dt>, <dd key={"v" + k} className="tnum">{n}</dd>]);
  return <>
    <section className="card c12 rise"><div className="card-h"><h2>Облікові записи</h2><div className="sp" /><a className="pill-btn" href="#people"><Ic n="users" />Люди</a><a className="pill-btn" href="#units"><Ic n="building" />Підрозділи</a></div>
      <div className="big-stats"><div><b className="tnum">{u.total}</b><span>облікових записів</span></div><div><b className="tnum">{u.inactive}</b><span>неактивних (заблоковані чи чекають підтвердження)</span></div><div><b className="tnum">{d.units ? d.units.total : "–"}</b><span>підрозділів</span></div></div></section>
    <section className="card c6 rise"><div className="card-h"><h2>За роллю</h2></div><dl className="kv-big">{kv(u.by_role, k => SROLE[k] || k)}</dl></section>
    <section className="card c6 rise"><div className="card-h"><h2>Респонденти за категорією</h2></div><dl className="kv-big">{kv(u.by_category, cName)}</dl></section>
  </>;
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
    <div className="brand" style={{ padding: "0 0 6px" }}><span className="logo brand-mark"><Mark /></span>Integra</div>
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
  // Категорії й посади веде лише технічний адміністратор; Департамент категорії лише переглядає (сервер дає 403); факти — уповноважений
  if (S.role === "admin") return <FactsCard mgr />;
  if (S.role === "observer") return <CatsCard mgr={false} />;
  return <><CatsCard mgr={S.role === "coordinator"} /><PosCard /></>;
}
function CatsCard({ mgr }) {
  const r = loadCats();
  return <section className="card c12 rise">
    <div className="card-h"><h2>Категорії респондентів</h2><div className="sp" />{mgr && <button type="button" className="btn btn-soft btn-s" id="dcNew" onClick={() => catForm(null)}><Ic n="plus" />Додати</button>}</div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <div><Err t={r.error} /> <button type="button" className="link-btn" onClick={() => apiModReset("dCats")}>Спробувати ще раз</button></div> : <div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Назва</th><th>Код</th><th>Вага в індексі</th><th>Стан</th><th></th></tr></thead><tbody>
      {r.data.map(c => <tr key={c.code}><td>{c.title}</td><td className="tnum lbl">{c.code}</td><td className="tnum">{c.weight != null && c.in_index ? Math.round(c.weight * 100) + " %" : <span className="lbl">лише порівняння</span>}</td>
        <td className="adm-st">{c.active ? <><Dot c="var(--teal)" />Діє</> : <><Dot c="var(--muted)" />Вимкнено</>}</td>
        <td className="adm-acts">{mgr && <button type="button" className="btn btn-ghost btn-s" onClick={() => catForm(c)}><Ic n="edit" />Змінити</button>}</td></tr>)}
    </tbody></table></div>}
  </section>;
}
function catForm(c) {
  openDrawer(c ? "Категорія" : "Нова категорія", () => {
    const [code, setCode] = useState(c ? c.code : ""), [title, setTitle] = useState(c ? c.title : ""), [w, setW] = useState(c && c.weight != null ? String(Math.round(c.weight * 100)) : ""), [act, setAct] = useState(c ? c.active : true), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
    // Вагу вбудованих категорій задає методика (weight_editable: false); редагується лише вага з довідника
    const wEdit = !!(c && c.weight_editable === true);
    const ok = async () => {
      if (!c && !/^[a-z][a-z0-9_]{1,31}$/.test(code)) return setErr("Код: латиниця з малої літери, цифри, «_», від 2 символів.");
      if (!title.trim()) return setErr("Вкажіть назву.");
      const wt = w.trim() ? Number(w.replace(",", ".")) / 100 : null;
      if (wEdit && wt != null && !(wt > 0 && wt <= 1)) return setErr("Вага: від 1 до 100 %, або порожньо, щоб категорія лише порівнювалась.");
      // Вбудованій категорії шлемо лише назву: вага й стан ідуть із методики (інакше 409 weight_from_methodology)
      const body = !c ? { code, title: title.trim() } : c.builtin ? { title: title.trim() } : { title: title.trim(), active: act, ...(wEdit && wt != null ? { weight: wt } : {}) };
      setBusy(true); setErr("");
      try {
        if (c) await api(`/dictionaries/categories/${encodeURIComponent(c.code)}`, { method: "PATCH", body });
        else await api("/dictionaries/categories", { method: "POST", body });
        apiModReset("dCats"); closeDrawer(); toast("Збережено");
      } catch (e) { setErr(apiErrText(e)); } finally { setBusy(false); }
    };
    return <>
      {!c && <div className="field"><label htmlFor="cf-c">Код</label><input className="inp" id="cf-c" placeholder="cadets" value={code} onChange={e => setCode(e.target.value.trim())} /></div>}
      <div className="field"><label htmlFor="cf-t">Назва</label><input className="inp" id="cf-t" value={title} onChange={e => setTitle(e.target.value)} /></div>
      {/* Вага впливає на індекс напряму, тому тут лише показується: її задає методика */}
      {wEdit ? <div className="field"><label htmlFor="cf-w">Вага в індексі, % (порожньо: лише порівняння)</label><input className="inp" id="cf-w" inputMode="decimal" value={w} onChange={e => setW(e.target.value)} /><span className="lbl">Джерело ваги: довідник.</span></div>
        : <div className="field"><span className="lbl">Вага з методики</span><div className="tnum">{w ? `${w} %` : "лише порівняння"}</div><span className="lbl">{c && c.weight_source === "dictionary" ? "Джерело ваги: довідник." : "Джерело ваги: методика. Змінюється лише в методиці."}</span></div>}
      {c && !c.builtin && <label className="adm-chk"><input type="checkbox" checked={act} onChange={e => setAct(e.target.checked)} />Категорія діє</label>}
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="cf-ok" style={{ justifyContent: "center" }} onClick={ok} disabled={busy}><Ic n="ok" />{busy ? "Зберігаємо…" : "Зберегти"}</button>
    </>;
  });
}
const OWN = { checks: "Перевірки", learning: "Навчання", training: "Облік навчання", hr: "Кадри", mitra: "Mitra", manual: "Вручну", procurement: "Закупівлі", reports: "Повідомлення", atestat: "Атестація", artemida: "Артеміда" };
function FactsCard({ mgr }) {
  const r = apiMod("dFacts", () => api("/dictionaries/facts"));
  return <section className="card c12 rise">
    <div className="card-h"><h2>Факти</h2><div className="sp" />{mgr && <button type="button" className="btn btn-soft btn-s" id="dfNew" onClick={() => factForm(null)}><Ic n="plus" />Додати</button>}</div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <Err t={r.error} /> : <div className="tbl-wrap"><table className="adm-tbl"><thead><tr><th>Факт</th><th>Компонент</th><th>Поріг для рівнів 2 · 3 · 4 · 5</th><th>Хто передає</th><th>Стан</th><th></th></tr></thead><tbody>
      {r.data.map(f => <tr key={f.code}><td style={{ minWidth: 220 }}>{f.title}</td><td>{COMP[f.component] ? COMP[f.component].n : f.component}</td><td className="tnum" data-tip="Від першого порогу рівень 2, від другого 3 і так далі; нижче першого рівень 1. Бали: (рівень − 1) · 25"><span style={{ whiteSpace: "nowrap" }}>{f.thresholds.map((t, i) => <span key={i}>{i ? <span className="lbl"> · </span> : null}{t}</span>)} %</span></td>
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
  const ed = S.role === "coordinator";
  const add = async e => {
    e.preventDefault(); if (!t.trim()) return;
    try { await api("/dictionaries/positions", { method: "POST", body: { title: t.trim() } }); setT(""); setErr(""); apiModReset("dPos"); API.positions = null; }
    catch (er) { setErr(apiErrText(er)); }
  };
  const del = async p => { try { await api(`/dictionaries/positions/${p.id}`, { method: "DELETE" }); apiModReset("dPos"); API.positions = null; toast(`Посаду «${p.title}» вимкнено`); } catch (er) { toast(apiErrText(er)); } };
  const list = r && r.data ? r.data.filter(p => p.active) : [];
  return <section className="card c12 rise">
    <div className="card-h"><h2>Посади</h2></div>
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
  // Керівник бачить деталі лише свого підрозділу: чужі в списку дали б тільки відмову
  const units = S.role === "leader" && API.unitId ? un.data.filter(u => u.id === API.unitId) : un.data, root = units.find(u => !u.parent_id) || units[0];
  const id = uid || API.deptUnit || API.unitId || (root && root.id);
  if (!id) return <Empty t="Немає підрозділів" />;
  const key = "risk:" + id, r = apiMod(key, () => api(`/units/${id}/risk-register`));
  const imp = S.role === "admin"; // імпорт реєстру ризиків — уповноважений, решта читає
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
      {imp && <label className={`btn btn-soft ${busy ? "dis" : ""}`} id="rkImp" data-tip="CSV у UTF-8: назва ризику, компонент, за бажанням ймовірність, вплив, захід, відповідальний, стан. Повторний імпорт оновлює ризики з тим самим кодом."><Ic n="file" />{busy ? "Імпортуємо…" : "Імпорт CSV"}<input type="file" accept=".csv,text/csv" hidden onChange={upload} disabled={busy} /></label>}
    </section>
    {err && <section className="c12 rise"><Err t={err} /></section>}
    {!r ? <Loading t="Реєстр ризиків" /> : r.error ? (r.status === 403 || r.status === 404 ? <Empty t="Немає доступу до цього підрозділу">Ризики цього підрозділу бачить лише сам підрозділ.</Empty> : <Failed e={r.error} onRetry={() => apiModReset(key)} />) : !d.items.length
      ? <Empty t="Реєстр порожній">{imp ? `Імпортуйте таблицю ризиків (${orgT("genitive")}) у CSV.` : "Ризики ще не імпортували. Реєстр імпортує уповноважений."}</Empty>
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

