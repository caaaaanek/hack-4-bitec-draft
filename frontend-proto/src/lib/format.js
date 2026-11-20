/* Форматування чисел і текстів (українська локаль). */
const r1 = v => Math.round(v * 10) / 10;
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const NODATA = "немає даних";
export const fb = v => v == null ? NODATA : r1(v).toLocaleString("uk-UA", { maximumFractionDigits: 1 });
export const f1 = v => v == null ? NODATA : r1(v).toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const f2 = v => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pts = v => { const a = Math.abs(r1(v)); const w = Number.isInteger(a) ? (a % 10 === 1 && a % 100 !== 11 ? "пункт" : [2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100) ? "пункти" : "пунктів") : "пункта"; return `${fb(a)} ${w}`; };
export const ua = d => d.split("-").reverse().join(".");
export const plural = (n, one, few, many) => (n % 100 >= 11 && n % 100 <= 14) ? many : (n % 10 === 1) ? one : (n % 10 >= 2 && n % 10 <= 4) ? few : many;
// Тексти правил сервера можуть містити довге тире: у інтерфейсі показуємо коротке
// Період фактів із сервера («з 2025-10 по 2026-09») кварталами: факти рахуються лише цілими завершеними кварталами
const qOf = ym => { const m = /^(\d{4})-(\d{2})$/.exec(ym); return m ? { q: Math.ceil(+m[2] / 3), y: m[1] } : null; };
export function quarters(t) {
  const m = /з (\d{4}-\d{2}) по (\d{4}-\d{2})/.exec(String(t || "")); if (!m) return "";
  const a = qOf(m[1]), b = qOf(m[2]); if (!a || !b) return "";
  return a.q === b.q && a.y === b.y ? `${a.q} квартал ${a.y}` : `${a.q} кв. ${a.y} – ${b.q} кв. ${b.y}`;
}
// Тексти сервера: довге тире, англійська назва індексу й узгодження «бал» з числом («54 балів» → «54 бали», «58,9 балів» → «58,9 бала»)
const balW = (n, w) => n.includes(",") || n.includes(".") ? `${n} бала` : `${n} ${plural(+n, "бал", "бали", "балів")}`;
export const dsh = t => String(t == null ? "" : t).replace(/—/g, "–").replace(/Integrity Index/g, "Індекс доброчесності").replace(/(\d+(?:[,.]\d+)?) балів/g, (m, n) => balW(n)).replace(/кожні 1 (день|дн\.)/g, "щодня");
