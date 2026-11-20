/* Сповіщення (лише з сервером): нагадування, підсумки хвиль, підсумок чергового. Вікно відкривається з дзвіночка в шапці. */
import { useEffect, useRef } from "react";
import { API, apiMod, apiModReset, apiNotices } from "../lib/api.js";
import { closePop } from "../lib/store.js";
import { dsh, ua } from "../lib/format.js";

const KIND = { opened: "Хвилю відкрито", reminder: "Нагадування", results: "Результати доступні", recommendations: "Рекомендації чекають рішення", digest: "Підсумок сигналів" };
const seenKey = () => "ii-notes-seen:" + (API.user ? API.user.login : "");
const seenAt = () => { try { return localStorage.getItem(seenKey()) || ""; } catch (e) { return ""; } };
export const markNotesSeen = () => { try { localStorage.setItem(seenKey(), new Date().toISOString()); } catch (e) { /* сховище недоступне */ } };

export function notesState() {
  if (!API.on || !API.user || API.anon) return null;
  const r = apiMod("notes", apiNotices), list = r && r.data ? r.data : [], seen = seenAt();
  return { r, list, fresh: list.filter(n => n.created_at > seen).length };
}

// Текст сервера: без повтору виду сповіщення, з великої літери, «підпис: число» не розривається
const nb = t => dsh(t).replace(/: (\d)/g, ": $1");
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
const title = n => nb(cap(n.kind === "digest" ? n.title.replace(/^агент-черговий:\s*/i, "") : n.title));
const parts = b => String(b || "").split(/\n|\s•\s|^•\s/).map(s => s.replace(/^•\s*/, "").trim()).filter(Boolean).map(nb);

export function NotesPop({ ns }) {
  const ref = useRef(null), { r, list } = ns;
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  // Tab за межі вікна закриває його, щоб фокус не губився під ним
  const blur = e => { if (ref.current && !ref.current.contains(e.relatedTarget)) closePop(); };
  return <div className="notes" ref={ref} tabIndex={-1} onBlur={blur}>
    <div className="notes-h">Сповіщення за 30 днів</div>
    {!r ? <div className="lbl notes-e" role="status">Завантажуємо…</div>
      : r.error ? <div className="lbl notes-e" role="alert">{r.error} <button type="button" className="link-btn" onClick={() => apiModReset("notes")}>Повторити</button></div>
      : list.length ? <ul className="notes-l">{list.map(n => { const ps = parts(n.body); return <li key={n.id}>
        <div className="notes-k"><span>{KIND[n.kind] || "Сповіщення"}</span><span className="tnum">{ua(n.created_at.slice(0, 10))}</span></div>
        <div className="notes-t">{title(n)}</div>
        {ps.length > 1 ? <ul className="notes-b">{ps.map((p, i) => <li key={i}>{p}</li>)}</ul> : ps.length ? <div className="lbl">{ps[0]}</div> : null}
      </li>; })}</ul>
      : <div className="lbl notes-e">Немає нових сповіщень.</div>}
  </div>;
}
