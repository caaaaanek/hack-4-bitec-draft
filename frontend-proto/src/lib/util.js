/* Дрібні дії з браузером: завантаження файлу й копіювання в буфер. */
import { toast } from "./store.js";
import { addLog, me } from "./state.js";

export function download(name, txt, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: type + ";charset=utf-8" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast("Завантажено: " + name); addLog(me(), `Експорт звіту (${name})`);
}
export function fallbackCopy(txt, done) {
  const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("Не вдалося скопіювати"); }
  ta.remove();
}
export function copyText(txt, done) {
  try { navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done)); } catch (e) { fallbackCopy(txt, done); }
}
