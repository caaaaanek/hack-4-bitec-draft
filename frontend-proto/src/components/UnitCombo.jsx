/* Вибір підрозділу: пошук по назві. Нові підрозділи заводить технічний адміністратор. */
import { useState } from "react";
import { dn } from "../lib/api.js";

export function UnitCombo({ id, units, value, onChange }) {
  const cur = units.find(u => u.id === value) || units.find(u => !u.parent_id || !units.some(x => x.id === u.parent_id)) || units[0];
  const val = cur ? cur.id : "";
  const [q, setQ] = useState(null), [all, setAll] = useState(false), [act, setAct] = useState(-1);
  const open = q !== null, text = open ? q : dn(cur ? cur.name : "");
  const ql = (q || "").trim().toLowerCase();
  const curName = cur ? cur.name : "";
  const show = all || !ql || dn(curName).toLowerCase() === ql ? units : units.filter(u => dn(u.name).toLowerCase().includes(ql));
  const items = show.slice(0, 50).map(u => ({ id: u.id, label: `${u.parent_id ? "└ " : ""}${dn(u.name)}` }));
  const close = () => { setQ(null); setAll(false); setAct(-1); };
  const pick = it => { onChange(it.id); close(); };
  const key = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) { setQ(text); setAll(true); } setAct(i => e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const t = items[act] || (items.length === 1 ? items[0] : null); if (t) pick(t); }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); close(); } }
  };
  return <div className="combo" id={id}>
    <input className="inp" role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" placeholder="Почніть вводити назву підрозділу" value={text}
      onFocus={e => { e.target.select(); setQ(dn(curName)); setAll(true); }} onChange={e => { setQ(e.target.value); setAll(false); setAct(-1); }} onBlur={close} onKeyDown={key} />
    <ul className="combo-list" role="listbox" hidden={!open}>
      {items.length ? items.map((it, i) => <li key={it.id} role="option" aria-selected={it.id === val} className={`${it.id === val ? "sel" : ""} ${i === act ? "act" : ""}`} onMouseDown={e => { e.preventDefault(); pick(it); }}>{it.label}</li>)
        : <li className="none">Нічого не знайдено</li>}
    </ul>
  </div>;
}

/* Вибір підрозділу рівнями: спершу підрозділ організації, потім (якщо є) його структурний підрозділ і так далі.
 * Порожній вибір на рівні означає «увесь» батьківський підрозділ. Організацію обирати не треба, якщо вона одна. */
export function UnitPick({ id, units, value, onChange }) {
  // Зона уповноваженого може починатися не з кореня: батька поза списком вважаємо коренем
  const byId = Object.fromEntries(units.map(u => [u.id, u])), top = u => !u.parent_id || !byId[u.parent_id];
  const kids = p => units.filter(u => p === null ? top(u) : u.parent_id === p).sort((a, b) => dn(a.name).localeCompare(dn(b.name), "uk"));
  const roots = kids(null);
  const cur = byId[value] || roots[0];
  const chain = []; for (let u = cur; u; u = u.parent_id ? byId[u.parent_id] : null) chain.unshift(u);
  // рівні: [батько, вибраний нащадок або null]
  const levels = [];
  if (roots.length > 1) levels.push({ parent: null, opts: roots, sel: chain[0], label: "Організація" });
  for (let d = 0; d < chain.length; d++) {
    const opts = kids(chain[d].id); if (!opts.length) break;
    levels.push({ parent: chain[d], opts, sel: chain[d + 1] || null, label: levels.length ? "Структурний підрозділ" : "Підрозділ" });
    if (!chain[d + 1]) break;
  }
  return <div className="unit-pick" id={id}>
    {levels.map((l, i) => <div key={i} className="field"><label htmlFor={`${id}-${i}`}>{l.label}</label>
      <select className="inp" id={`${id}-${i}`} value={l.sel ? l.sel.id : ""} onChange={e => onChange(e.target.value || (l.parent ? l.parent.id : roots[0].id))}>
        {l.parent && <option value="">{l.parent.parent_id ? `Увесь «${dn(l.parent.name)}»` : roots.length > 1 ? `Уся «${dn(l.parent.name)}»` : "Уся організація"}</option>}
        {l.opts.map(u => <option key={u.id} value={u.id}>{dn(u.name)}</option>)}
      </select></div>)}
  </div>;
}
