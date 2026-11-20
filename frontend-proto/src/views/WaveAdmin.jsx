/* Спільне для адміністрування й секції «Керування циклом»:
 * учасники хвилі (/campaigns/{id}/participants) і відповідальні за пункти чек-листа (/campaigns/{id}/checklist/assignments).
 * Екрани «Люди», «Довідники», «Реєстр ризиків» і сторінка запрошення — в Admin.jsx (окремий чанк). */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset, apiErrText, ApiErr, dn, apiInviteDone } from "../lib/api.js";
import { COMPS, COMP } from "../lib/model.js";
import { plural } from "../lib/format.js";
import { toast, openDrawer, closeDrawer } from "../lib/store.js";
import { copyText } from "../lib/util.js";
import { Loading, Failed, Empty, NoAccess, NeedServer } from "../components/states.jsx";

export const pol = () => (API.cfg && API.cfg.policies) || {};
export const SROLE = { admin: "Уповноважений", respondent: "Респондент", leader: "Керівник", auditor: "Внутрішній аудит", coordinator: "Технічний адміністратор", department: "Департамент" };
export const Err = ({ t }) => <span className="lbl adm-err" role={t ? "alert" : undefined}>{t}</span>;
// Помилки імпорту CSV: «line 3» → «рядок 3»
export const importErr = e => e instanceof ApiErr && e.errors && e.errors.length
  ? e.errors.slice(0, 5).map(i => `${String(i.path || "").replace(/^line /, "рядок ")}: ${i.message}`).join("; ") + (e.errors.length > 5 ? `; ще ${e.errors.length - 5}` : "") + ". Нічого не змінено."
  : apiErrText(e);
// Підрозділи деревом для <select>: відступ за рівнем. Батько поза списком (зона) — корінь.
export function unitOpts(units) {
  const has = new Set(units.map(u => u.id));
  const kids = id => units.filter(u => id === null ? !u.parent_id || !has.has(u.parent_id) : u.parent_id === id).sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const out = [], walk = (id, d) => kids(id).forEach(u => { out.push([u.id, " ".repeat(d) + dn(u.name)]); walk(u.id, d + 1); });
  walk(null, 0); return out;
}
// Повне дерево підрозділів веде технічний адміністратор (/admin/units); решта бачить свою зону (/units)
export const loadUnits = () => apiMod("admUnits", () => api(S.role === "coordinator" ? "/admin/units" : "/units"));
// З кого уповноважений обирає людей для хвилі: активні записи підрозділу хвилі й піддерева
export const loadPeople = (cid, q = "") => apiMod(`people:${cid}:${q}`, () => api(`/campaigns/${cid}/people${q ? "?" + q : ""}`));
export const loadCats = () => apiMod("dCats", () => api("/dictionaries/categories"));
export const Dot = ({ c }) => <span className="dot" style={{ background: c }} />;

// Запрошення сервер віддає як /invite/<токен>; сторінки за цією адресою немає ні в API, ні в nginx,
// тож даємо людині /#invite/<токен>: фрагмент не йде на сервер і не потрапляє в журнали.
export const inviteAbs = l => { const m = String(l).match(/\/invite\/([^/?#]+)/); return m ? `${location.origin}/#invite/${m[1]}` : new URL(l, location.origin).href; };

/* ---------- Учасники хвилі (Керування циклом) ---------- */
export function ParticipantsSection({ c }) {
  const key = "part:" + c.id, r = apiMod(key, () => api(`/campaigns/${c.id}/participants`));
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const ed = c.status === "draft";
  const upload = async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    const fd = new FormData(); fd.append("file", file); setBusy(true); setErr("");
    try {
      const x = await api(`/campaigns/${c.id}/participants/import`, { method: "POST", body: fd }); apiModReset(key);
      toast(`Додано учасників: ${x.added_participants}`); if ((x.credentials || []).length) showCreds(x.credentials);
    } catch (er) { setErr(importErr(er).replace(/(немає|не знайдено)[^;.]*/gi, m => /логін|login|користувач/i.test(m) ? m + " (людей заводить технічний адміністратор)" : m)); } finally { setBusy(false); }
  };
  const clear = async () => { try { await api(`/campaigns/${c.id}/participants`, { method: "DELETE" }); apiModReset(key); toast("Список скинуто: беруть участь усі з підрозділу"); } catch (er) { setErr(apiErrText(er)); } };
  const d = r && r.data, n = d ? d.participants.length : 0;
  return <section className="card c12 rise" aria-labelledby="ptT">
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2 id="ptT">Учасники</h2><div className="sp" />
      {ed && <><button type="button" className="btn btn-ghost btn-s" onClick={() => pickParticipants(c, d)}><Ic n="users" />Обрати зі списку</button>
        <label className={`btn btn-soft btn-s ${busy ? "dis" : ""}`} id="ptImp"><Ic n="file" />{busy ? "Імпортуємо…" : "Імпорт CSV"}<input type="file" accept=".csv,text/csv" hidden onChange={upload} disabled={busy} /></label>
        {d && d.explicit && <button type="button" className="btn btn-ghost btn-s" onClick={clear}>Скинути список</button>}</>}
    </div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <Err t={r.error} /> : <div className="adm-line">{d.explicit ? <>Явний список: <b className="tnum">{n}</b> {plural(n, "людина", "людини", "людей")}{n ? <span className="lbl">, зокрема {d.participants.slice(0, 4).map(p => dn(p.display_name || p.login)).join(", ")}{n > 4 ? "…" : ""}</span> : null}</>
      : <>Беруть участь усі респонденти підрозділу хвилі.</>}</div>}
    {ed && <div className="lbl" style={{ marginTop: 6 }}>CSV у UTF-8: <code>login,category,unit[,display_name]</code>. Імпорт лише додає людей, які вже мають обліковий запис: нових заводить технічний адміністратор. Стовпці з ПІБ, email чи телефоном сервер відхилить.</div>}
    {!ed && <div className="lbl" style={{ marginTop: 6 }}>Склад змінюється лише в чернетці.</div>}
    <Err t={err} />
  </section>;
}
function showCreds(list) {
  openDrawer("Нові облікові записи", () => <>
    <div>Передайте кожному його рядок особисто. Більше система їх не покаже.</div>
    <div className="rows">{list.map(x => <div key={x.login} className="row"><div className="grow"><b className="tnum">{x.login}</b><div className="lbl" style={{ wordBreak: "break-all" }}>{x.invite_link ? inviteAbs(x.invite_link) : x.password}</div></div></div>)}</div>
    <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => copyText(list.map(x => `${x.login}\t${x.invite_link ? inviteAbs(x.invite_link) : x.password}`).join("\n"), () => toast("Скопійовано"))}><Ic n="copy" />Копіювати все</button>
  </>);
}
function pickParticipants(c, d) {
  openDrawer("Учасники хвилі", () => {
    const r = loadPeople(c.id, "role=respondent");
    const [sel, setSel] = useState(() => new Set(d && d.explicit ? d.participants.map(p => p.id) : [])), [q, setQ] = useState(""), [err, setErr] = useState("");
    if (!r) return <span className="lbl">Завантажуємо…</span>;
    if (r.error) return <Err t={r.error} />;
    const all = r.data, s = q.trim().toLowerCase();
    const shown = all.filter(u => !s || `${u.login} ${u.display_name}`.toLowerCase().includes(s));
    const tog = id => setSel(x => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const save = async () => {
      try { await api(`/campaigns/${c.id}/participants`, { method: "PUT", body: { user_ids: [...sel] } }); apiModReset("part:" + c.id); closeDrawer(); toast(`Учасників: ${sel.size}`); }
      catch (e) { setErr(apiErrText(e)); }
    };
    return <>
      <label className="search"><span><Ic n="search" /></span><input placeholder="Логін або псевдонім" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="lbl">Обрано {sel.size} з {all.length}. <button type="button" className="link-btn" onClick={() => setSel(new Set(shown.map(u => u.id)))}>Усі показані</button> · <button type="button" className="link-btn" onClick={() => setSel(new Set())}>Жодного</button></div>
      <div className="rows pt-list">{shown.map(u => <label key={u.id} className="row click adm-chk"><input type="checkbox" checked={sel.has(u.id)} onChange={() => tog(u.id)} /><span className="grow">{dn(u.display_name)} <span className="lbl tnum">{u.login}</span></span></label>)}</div>
      <Err t={err} />
      <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} onClick={save}><Ic n="ok" />Зберегти список</button>
    </>;
  });
}

/* ---------- Відповідальні за пункти чек-листа ---------- */
export const asgKey = id => "asg:" + id;
export const loadAsg = id => apiMod(asgKey(id), () => api(`/campaigns/${id}/checklist/assignments`));
export function AssignSection({ c }) {
  if (c.has_checklist === false) return null; // без чек-листа не питаємо сервер: інакше 404 у консолі на кожному екрані
  return <AssignBody c={c} />;
}
function AssignBody({ c }) {
  const r = loadAsg(c.id);
  if (r && r.error && r.status === 404) return null; // у хвилі немає чек-листа
  const d = r && r.data, n = d ? d.filter(x => x.enterer_id || x.confirmer_id).length : 0;
  return <section className="card c12 rise" aria-labelledby="asT">
    <div className="card-h"><h2 id="asT">Відповідальні за чек-лист</h2><div className="sp" />{c.status !== "closed" && d && <button type="button" className="btn btn-soft btn-s" id="asOpen" onClick={() => assignForm(c)}><Ic n="users" />Розподілити</button>}</div>
    {!r ? <span className="lbl">Завантажуємо…</span> : r.error ? <Err t={r.error} /> : <div className="adm-line">Призначено <b className="tnum">{n}</b> з <span className="tnum">{d.length}</span> пунктів.<span className="lbl"> Без призначення вносить будь-хто з робочої групи, підтверджує будь-хто з тих, хто має право.</span></div>}
  </section>;
}
function assignForm(c) {
  openDrawer("Відповідальні за пункти", () => {
    const conf = pol().checklist_confirmers || ["auditor"];
    const w = loadPeople(c.id, "category=working_group"), r = loadPeople(c.id), a = loadAsg(c.id);
    const [v, setV] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
    if (!r || !w || !a) return <span className="lbl">Завантажуємо…</span>;
    if (r.error || w.error || a.error) return <Err t={r.error || w.error || a.error} />;
    const cur = v || Object.fromEntries(a.data.map(x => [x.question_id, [x.enterer_id || "", x.confirmer_id || ""]]));
    const wg = w.data.filter(u => u.role === "respondent"), cf = r.data.filter(u => conf.includes(u.role));
    const set = (qid, i, val) => setV(() => { const n = { ...cur, [qid]: [...cur[qid]] }; n[qid][i] = val; return n; });
    const save = async () => {
      const bad = a.data.find(x => cur[x.question_id][0] && cur[x.question_id][0] === cur[x.question_id][1]);
      if (bad) return setErr(`Пункт ${bad.number}: вносить і підтверджує не та сама людина.`);
      setBusy(true); setErr("");
      try {
        const items = a.data.map(x => ({ question_id: x.question_id, enterer_id: cur[x.question_id][0] || null, confirmer_id: cur[x.question_id][1] || null }));
        API.mod[asgKey(c.id)] = { data: await api(`/campaigns/${c.id}/checklist/assignments`, { method: "PUT", body: { items } }) }; closeDrawer(); toast("Відповідальних збережено");
      } catch (e) { setErr(e instanceof ApiErr && e.errors ? e.errors.slice(0, 3).map(i => { const k = +String(i.path).replace(/\D/g, ""); return `Пункт ${(a.data[k] || {}).number || ""}: ${i.message}`; }).join("; ") : apiErrText(e)); setBusy(false); }
    };
    const fillAll = (i, val) => setV(() => Object.fromEntries(a.data.map(x => { const p = [...cur[x.question_id]]; p[i] = val; return [x.question_id, p]; })));
    const opts = (list, empty) => <><option value="">{empty}</option>{list.map(u => <option key={u.id} value={u.id}>{dn(u.display_name)}</option>)}</>;
    return <>
      <div className="lbl">Вносить член робочої групи, підтверджує {conf.map(x => (SROLE[x] || x).toLowerCase()).join(" або ")}. Це мають бути різні люди.</div>
      <div className="as-all"><select className="inp" aria-label="Вносить для всіх пунктів" value="" onChange={e => fillAll(0, e.target.value)}>{opts(wg, "Вносить для всіх…")}</select>
        <select className="inp" aria-label="Підтверджує для всіх пунктів" value="" onChange={e => fillAll(1, e.target.value)}>{opts(cf, "Підтверджує для всіх…")}</select></div>
      <div className="as-list">{a.data.map(x => <div key={x.question_id} className="as-row"><b className="tnum">{x.number}</b>
        <select className="inp" aria-label={`Пункт ${x.number}: вносить`} value={cur[x.question_id][0]} onChange={e => set(x.question_id, 0, e.target.value)}>{opts(wg, "Будь-хто з РГ")}</select>
        <select className="inp" aria-label={`Пункт ${x.number}: підтверджує`} value={cur[x.question_id][1]} onChange={e => set(x.question_id, 1, e.target.value)}>{opts(cf, "Будь-хто з правом")}</select></div>)}</div>
      <Err t={err} />
      <button type="button" className="btn btn-primary" id="asSave" style={{ justifyContent: "center" }} disabled={busy} onClick={save}><Ic n="ok" />{busy ? "Зберігаємо…" : "Зберегти"}</button>
    </>;
  });
}
