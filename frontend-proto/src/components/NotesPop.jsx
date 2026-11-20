/* Дзвіночок у шапці: сигнали, що потребують дії, і сповіщення сервера (нагадування, підсумки хвиль). */
import { useEffect, useRef } from "react";
import { API, apiMod, apiModReset, apiNotices } from "../lib/api.js";
import { signals, sigGo, sigTarget, sigError, sigRetry } from "../views/Insights.jsx";
import { closePop } from "../lib/store.js";
import { dsh, ua } from "../lib/format.js";
import { Ic } from "../lib/icons.jsx";

const KIND = { opened: "Хвилю відкрито", reminder: "Нагадування", results: "Результати доступні", recommendations: "Рекомендації чекають рішення", digest: "Підсумок сигналів" };
const seenKey = () => "ii-notes-seen:" + (API.user ? API.user.login : "");
const seenAt = () => { try { return localStorage.getItem(seenKey()) || ""; } catch (e) { return ""; } };
export const markNotesSeen = () => { try { localStorage.setItem(seenKey(), new Date().toISOString()); } catch (e) { /* сховище недоступне */ } };

// Дзвіночок: сигнали, що потребують дії (з правил чергового), і сповіщення сервера.
// Лічильник — нові сповіщення плюс відкриті сигнали: сигнал зникає, лише коли проблему виправлено.
export function notesState() {
  if (API.anon || (API.on && !API.user)) return null;
  const sig = signals() || [], sigErr = sigError();
  if (!API.on) return sig.length ? { r: { data: [] }, list: [], sig, fresh: sig.length } : null;
  const r = apiMod("notes", apiNotices), list = r && r.data ? r.data : [], seen = seenAt();
  return { r, list, sig, sigErr, fresh: list.filter(n => n.created_at > seen).length + sig.length };
}

// Текст сервера: без повтору виду сповіщення, з великої літери, «підпис: число» не розривається
const nb = t => dsh(t).replace(/: (\d)/g, ": $1");
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
const title = n => nb(cap(n.kind === "digest" ? n.title.replace(/^агент-черговий:\s*/i, "") : n.title));
const parts = b => String(b || "").split(/\n|\s•\s|^•\s/).map(s => s.replace(/^•\s*/, "").trim()).filter(Boolean).map(nb);

export function NotesPop({ ns }) {
  const ref = useRef(null), { r, list, sig, sigErr } = ns;
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  // Tab за межі вікна закриває його, щоб фокус не губився під ним
  const blur = e => { if (ref.current && !ref.current.contains(e.relatedTarget)) closePop(); };
  return <div className="notes" ref={ref} tabIndex={-1} onBlur={blur}>
    {sig.length > 0 && <>
      <div className="notes-h">Потребує дії</div>
      <ul className="notes-l notes-sig">{sig.map(x => { const t = sigTarget(x), body = <><span className="dot" style={{ background: x.severity === "critical" ? "var(--red)" : "var(--amber)" }} /><span className="grow"><span className="notes-t">{nb(x.title)}</span>{x.fix && x.fix[0] && <span className="lbl">{nb(x.fix[0])}</span>}</span>{t && <Ic n="arrowR" />}</>;
        return <li key={x.id}>{t ? <button type="button" className="sig-row" onClick={() => { closePop(); sigGo(x); }}>{body}</button> : <div className="sig-row">{body}</div>}</li>; })}</ul>
    </>}
    {sigErr && <><div className="notes-h">Потребує дії</div><div className="lbl notes-e" role="alert">Не вдалося завантажити сигнали: {sigErr} <button type="button" className="link-btn" onClick={sigRetry}>Повторити</button></div></>}
    {(API.on || !sig.length) && <div className="notes-h">Сповіщення за 30 днів</div>}
    {!r ? <div className="lbl notes-e" role="status">Завантажуємо…</div>
      : r.error ? <div className="lbl notes-e" role="alert">{r.error} <button type="button" className="link-btn" onClick={() => apiModReset("notes")}>Повторити</button></div>
      : list.length ? <ul className="notes-l">{list.map(n => { const ps = parts(n.body); return <li key={n.id}>
        <div className="notes-k"><span>{KIND[n.kind] || "Сповіщення"}</span><span className="tnum">{ua(n.created_at.slice(0, 10))}</span></div>
        <div className="notes-t">{title(n)}</div>
        {ps.length > 1 ? <ul className="notes-b">{ps.map((p, i) => <li key={i}>{p}</li>)}</ul> : ps.length ? <div className="lbl">{ps[0]}</div> : null}
      </li>; })}</ul>
      : API.on || !sig.length ? <div className="lbl notes-e">Немає нових сповіщень.</div> : null}
  </div>;
}
