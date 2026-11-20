/* Документи-підтвердження: перетягнути або обрати кілька файлів, з перевіркою типу й розміру. */
import { useRef, useState } from "react";
import { Ic } from "../lib/icons.jsx";

export const fsize = n => n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;

// files: масив File (або {name,size} для вже доданих у демо); onChange отримує новий масив
export function FileDrop({ files, onChange, exts, maxBytes, maxFiles, already = 0, hint }) {
  const inp = useRef(null), [over, setOver] = useState(false), [err, setErr] = useState("");
  const add = list => {
    const out = [...files], bad = [];
    for (const f of list) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (exts && exts.length && !exts.includes(ext)) { bad.push(`«${f.name}»: такий тип файлу не приймається`); continue; }
      if (maxBytes && f.size > maxBytes) { bad.push(`«${f.name}»: більше ${fsize(maxBytes)}`); continue; }
      if (maxFiles && already + out.length >= maxFiles) { bad.push(`Не більше ${maxFiles} файлів на пункт`); break; }
      if (!out.some(x => x.name === f.name && x.size === f.size)) out.push(f);
    }
    setErr(bad.join(". ")); onChange(out);
  };
  return <div className="fd">
    <div className={`fd-zone ${over ? "over" : ""}`} role="button" tabIndex={0} aria-label="Додати документи-підтвердження"
      onClick={() => inp.current.click()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.current.click(); } }}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
      <span className="fd-ic"><Ic n="file" /></span>
      <div><b>Додати документ</b><div className="lbl">Перетягніть сюди або натисніть, щоб обрати. {hint}</div></div>
      <input ref={inp} type="file" multiple hidden accept={exts && exts.length ? exts.map(x => "." + x).join(",") : undefined} onChange={e => { add([...e.target.files]); e.target.value = ""; }} />
    </div>
    {files.length > 0 && <div className="fd-list">{files.map((f, i) => <div key={f.name + i} className="fd-row"><Ic n="file" /><span className="grow">{f.name}</span><span className="lbl tnum">{fsize(f.size)}</span>
      <button type="button" className="icon-btn sm" aria-label={`Прибрати ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}><Ic n="x" /></button></div>)}</div>}
    {err && <span className="lbl fd-err">{err}</span>}
  </div>;
}
