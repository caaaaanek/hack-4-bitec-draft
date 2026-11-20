/* Тексти пояснень за правилами (для панелей і шаблонів асистента). */
import { COMP, LEVELS, TRUST, FLAGS } from "./model.js";
import { S } from "./state.js";
import { fb, f1, pts } from "./format.js";

/* «Чому такий індекс» */
export function whyText(m, noTrust) {
  const t = m.delta == null ? "дані про попередній цикл зараз недоступні" : m.delta > 0 ? `що на ${pts(m.delta)} вище, ніж у попередньому циклі` : m.delta < 0 ? `що на ${pts(m.delta)} нижче, ніж у попередньому циклі` : "що не змінилося порівняно з попереднім циклом";
  // Сервер не дав індексу (замало даних): числа не вигадуємо
  if (m.index == null) return `Індекс за цей цикл не пораховано: в одному чи кількох компонентах замало даних (групи менші за ${S.k} осіб або немає відповідей). Рівень зрілості не визначено.`;
  let s = `Заклад перебуває на рівні зрілості ${m.level} «${LEVELS[m.level - 1]}»: індекс доброчесності ${f1(m.index)} з 100, ${t}.`;
  if (m.limited) s += ` Для компонента «${COMP[m.limited.id].n}» самооцінка (${fb(m.limited.P)}) помітно вища за факти (${fb(m.limited.F)}), тому зараховано ${fb(m.limited.cr.v)}.`;
  const tr = TRUST[m.trust]; if (!noTrust) s += ` Достовірність ${tr[0]}: ${tr[1].toLowerCase()}${m.trust === "C" ? ", тож спершу варто підтвердити факти документами" : ""}.`;
  return s;
}
// Плашка «Достовірність»: скільки прапорців і які саме (для чату ШІ та запасної панелі)
export function flagsText(m) {
  const maj = m.raised.filter(f => f.w === "major").length, min = m.raised.filter(f => f.w === "minor").length, tr = TRUST[m.trust];
  let s = `Варто перевірити додатково. Достовірність ${tr[0]}: ${tr[1].toLowerCase()}. Спрацювало прапорців: ${m.raised.length}${m.raised.length ? ` (серйозних ${maj}, незначних ${min})` : ""}.`;
  if (m.raised.length) s += "\n" + m.raised.map(f => `• ${f.t}${f.w === "major" ? " (серйозний)" : f.w === "info" ? " (до відома)" : " (незначний)"}. ${f.ex}`).join("\n");
  return s + "\nЦе напрям для додаткового аналізу, а не висновок про людей чи підрозділи.";
}
// Картка «Достовірність»: яка літера, за яким правилом і результат кожної з чотирьох перевірок
const CHECK_OK = { "tf-gap": "Самооцінка ніде не перевищує факти більш ніж на 25 пунктів.", "tf-same": "Підозріло однакових анкет не виявлено." };
const CHECK_BAD = { "tf-jump": "Індекс різко змінився між циклами, і пояснення цьому немає.", "tf-experts": "Експертних анкет надійшло менше, ніж очікувалось." };
export const checkText = f => f.raised ? (CHECK_BAD[f.id] || f.ex) : (CHECK_OK[f.id] || f.ex);
export const flagTitle = f => (FLAGS.find(x => x.id === f.id) || f).t;
export function trustText(m) {
  const tr = TRUST[m.trust], n = m.raised.length;
  let s = m.trust === "insufficient" ? `Достовірність не оцінюється: ${tr[2].toLowerCase()}` : `Достовірність ${tr[0]}: ${tr[1].toLowerCase()}. ${n ? `Спрацювало прапорців: ${n} з ${m.flags.length}.` : `Жоден із ${m.flags.length} прапорців не спрацював.`}`;
  s += `\n\nЛітера ставиться за правилом: A без прапорців, B один-два незначних, C хоча б один серйозний або три і більше незначних.`;
  s += `\n\nПеревірки цього циклу:\n` + m.flags.map(f => `${f.raised ? "⚠" : "✓"} ${flagTitle(f)} (${f.w === "major" ? "серйозний" : f.w === "info" ? "до відома" : "незначний"}): ${f.raised ? "спрацював" : "не спрацював"}. ${checkText(f)}`).join("\n");
  return s + "\n\nПрапорець означає напрям для додаткової перевірки даних, а не висновок про людей чи підрозділи.";
}

// Одне речення «Достовірність C, бо …» — готове до кліку, без асистента
export function trustBecause(m) {
  const maj = m.raised.filter(f => f.w === "major"), min = m.raised.filter(f => f.w === "minor"), q = a => a.map(f => `«${flagTitle(f)}»`).join(", ");
  if (m.trust === "insufficient") return `Достовірність не оцінюється, бо відповідей ${m.responses} – менше за мінімальну групу (${S.k} осіб).`;
  if (m.trust === "A") return "Достовірність A, бо жоден прапорець не спрацював: дані узгоджені між собою.";
  if (m.trust === "B") return `Достовірність B, бо спрацювали лише незначні прапорці: ${q(min)}. Серйозних немає.`;
  return maj.length ? `Достовірність C, бо спрацював серйозний прапорець: ${q(maj)}.${min.length ? ` Також незначні: ${q(min)}.` : ""}`
    : `Достовірність C, бо спрацювали три й більше незначних прапорців: ${q(min)}.`;
}
