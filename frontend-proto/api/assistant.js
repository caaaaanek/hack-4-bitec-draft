// ШІ-асистент: лише пояснює вже розраховані правилами результати й пише чернетки.
// Отримує тільки агреговані показники (після порогу k), жодних окремих відповідей.
//
// Провайдер: будь-який OpenAI-сумісний /chat/completions.
//   демо:            Groq (безкоштовний тариф)         LLM_API_KEY=<ключ Groq>
//   закритий контур: локальна модель через Ollama    LLM_BASE_URL=http://ollama:11434/v1  LLM_MODEL=llama3.3
// Без ключа (і без LLM_BASE_URL) асистент працює на шаблонах у браузері.

const BASE_URL = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "openai/gpt-oss-120b";
const CONFIGURED = Boolean(API_KEY || process.env.LLM_BASE_URL);
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 25000;

const SYSTEM = `Ти асистент Integra, інформаційно-аналітичної системи оцінювання доброчесності закладу сектору безпеки і оборони.
Відповідай українською, коротко й по суті: до 120 слів, якщо не просять чернетку звіту (тоді до 200 слів).

Жорсткі правила:
- Усі числа, рівні зрілості, прапорці та рекомендації вже розраховані явними правилами системи й передані тобі в JSON. Використовуй лише ці числа. Нічого не перераховуй і не вигадуй нових оцінок, рівнів чи статусів.
- Ти не ухвалюєш рішень: не приймаєш і не відхиляєш рекомендацій, не змінюєш статусів, не ставиш оцінок. Можеш лише пояснити або запропонувати формулювання, яке затвердить посадова особа.
- Не роби висновків про конкретних людей, командирів чи підрозділи і не порівнюй підрозділи між собою. Оцінювання є інструментом розвитку, а не покарання.
- Коли пояснюєш, називай правило або формулу, з якої взялося число (наприклад: «бал від 40 до 60: зона „потребує уваги“», «зараховано = min(самооцінка; факти + 25)»).
- Якщо в даних немає відповіді, так і скажи.
- Простий текст без Markdown: без заголовків, зірочок і таблиць; списки рядками з «• ». Не став довге тире.

Методика v2.1 (для пояснень):
• Три компоненти з однаковою вагою: Культура, Система, Підзвітність. Індекс доброчесності = середнє компонентів, що мають дані.
• Самооцінка компонента S = зважене середнє джерел: особовий склад 0,35, робоча група 0,25, експерти 0,20, чек-лист 0,20. Якщо в джерелі менше k відповідей, його вага ділиться між рештою пропорційно. Відповіді переводяться в бали 0-100.
• Факти F = середнє балів показників фактів компонента. Показник: частка у відсотках, за порогами рівень 1-5, бал = (рівень - 1)·25.
• Правило реальності: якщо S більша за F + 25, зараховується F + 25 (самооцінку не підтверджують факти). Якщо F більша за S + 25, лишається S: факти бал не піднімають. Без фактів компонент дорівнює S.
• Рівні зрілості (бал більший або рівний межі): 1 Початковий від 0, 2 Керований від 12,5, 3 Визначений від 37,5, 4 Вимірюваний від 62,5, 5 Оптимізуючий від 87,5.
• Слабка ланка: рівень індексу не вищий за рівень найслабшого компонента плюс 1.
• Зони за балом: критична зона від 0, потребує уваги від 40, задовільно від 60, сильна сторона від 75.
• Достовірність: C, якщо є серйозний прапорець або 3 і більше незначних; B, якщо 1-2 незначних; A, якщо прапорців немає. Достовірність індексу = найгірша серед компонентів.
• Мінімальна група k = 5: результати груп, менших за k, не показуються.`;

const MAX_Q = 1000;
const MAX_CTX = 30000;

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ live: CONFIGURED, model: CONFIGURED ? MODEL : null });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!CONFIGURED) return res.status(503).json({ error: "assistant_not_configured" });

  const { question, context, history } = req.body || {};
  if (typeof question !== "string" || !question.trim() || question.length > MAX_Q) {
    return res.status(400).json({ error: "bad_question" });
  }
  const ctx = JSON.stringify(context ?? {});
  if (ctx.length > MAX_CTX) return res.status(413).json({ error: "context_too_large" });

  const messages = [{ role: "system", content: SYSTEM }];
  const past = Array.isArray(history) ? history.slice(-4) : [];
  for (const m of past) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    messages.push({ role: m.role, content: m.content.slice(0, 2000) });
  }
  messages.push({ role: "user", content: `Дані поточного циклу (агреговані, JSON):\n${ctx}\n\nЗапитання: ${question.trim()}` });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 4096 }),
      signal: controller.signal,
    });
    if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
    if (!r.ok) return res.status(502).json({ error: "upstream_error", status: r.status });
    const data = await r.json();
    const text = (data?.choices?.[0]?.message?.content || "").replace(/\*\*/g, "").trim();
    if (!text) return res.status(502).json({ error: "empty_answer" });
    return res.status(200).json({ text, model: MODEL });
  } catch (e) {
    return res.status(504).json({ error: e?.name === "AbortError" ? "timeout" : "network_error" });
  } finally {
    clearTimeout(timer);
  }
}
