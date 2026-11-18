/* Вибір підрозділу: пошук по назві й (для уповноваженого) створення нового прямо зі списку. */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { dn, apiCreateUnit, apiErrText } from "../lib/api.js";
import { toast } from "../lib/store.js";

export function UnitCombo({ id, units, value, onChange, canCreate }) {
  const cur = units.find(u => u.id === value) || units.find(u => !u.parent_id) || units[0];
  const val = cur ? cur.id : "";
  const [q, setQ] = useState(null), [all, setAll] = useState(false), [act, setAct] = useState(-1);
  const open = q !== null, text = open ? q : dn(cur ? cur.name : "");
  const ql = (q || "").trim().toLowerCase();
  const curName = cur ? cur.name : "";
  const show = all || !ql || dn(curName).toLowerCase() === ql ? units : units.filter(u => dn(u.name).toLowerCase().includes(ql));
  const exact = units.some(u => dn(u.name).toLowerCase() === ql);
  const items = show.slice(0, 50).map(u => ({ id: u.id, label: `${u.parent_id ? "└ " : ""}${dn(u.name)}` }));
  if (canCreate && ql && !exact) items.unshift({ add: q.trim() });
  const close = () => { setQ(null); setAll(false); setAct(-1); };
  const pick = async it => {
    if (it.add) { try { const u = await apiCreateUnit(it.add, val); onChange(u.id); } catch (e) { toast(apiErrText(e)); return; } }
    else onChange(it.id);
    close();
  };
  const key = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) { setQ(text); setAll(true); } setAct(i => e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const t = items[act] || (items.length === 1 ? items[0] : null); if (t) pick(t); }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); close(); } }
  };
  return <div className="combo" id={id}>
    <input className="inp" role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" placeholder="Почніть вводити назву підрозділу" value={text}
      onFocus={e => { e.target.select(); setQ(dn(curName)); setAll(true); }} onChange={e => { setQ(e.target.value); setAll(false); setAct(-1); }} onBlur={close} onKeyDown={key} />
    <ul className="combo-list" role="listbox" hidden={!open}>
      {items.length ? items.map((it, i) => it.add
        ? <li key="add" role="option" className={`add ${i === act ? "act" : ""}`} onMouseDown={e => { e.preventDefault(); pick(it); }}><Ic n="plus" />Створити «{it.add}»{cur ? ` всередині «${dn(cur.name)}»` : ""}</li>
        : <li key={it.id} role="option" aria-selected={it.id === val} className={`${it.id === val ? "sel" : ""} ${i === act ? "act" : ""}`} onMouseDown={e => { e.preventDefault(); pick(it); }}>{it.label}</li>)
        : <li className="none">Нічого не знайдено</li>}
    </ul>
  </div>;
}
