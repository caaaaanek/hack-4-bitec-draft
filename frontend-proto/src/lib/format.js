/* Форматування чисел і текстів (українська локаль). */
const r1 = v => Math.round(v * 10) / 10;
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fb = v => r1(v).toLocaleString("uk-UA", { maximumFractionDigits: 1 });
export const f1 = v => r1(v).toLocaleString("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const f2 = v => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pts = v => { const a = Math.abs(r1(v)); const w = Number.isInteger(a) ? (a % 10 === 1 && a % 100 !== 11 ? "пункт" : [2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100) ? "пункти" : "пунктів") : "пункта"; return `${fb(a)} ${w}`; };
export const ua = d => d.split("-").reverse().join(".");
export const plural = (n, one, few, many) => (n % 100 >= 11 && n % 100 <= 14) ? many : (n % 10 === 1) ? one : (n % 10 >= 2 && n % 10 <= 4) ? few : many;
// Тексти правил сервера можуть містити довге тире: у інтерфейсі показуємо коротке
export const dsh = t => String(t == null ? "" : t).replace(/—/g, "–");
