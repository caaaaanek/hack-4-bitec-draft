/* Документи для керівника: «Брифінг за 30 секунд» і «Шлях до наступного рівня» (чернетка Плану заходів за Додатком Д).
 * З бекендом: GET /campaigns/{id}/briefing і /next-level-plan (JSON для перегляду, ?format=docx для Word).
 * Без бекенду: брифінг з демо-моделі, Word лише в режимі з сервером. */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { S } from "../lib/state.js";
import { API, api, apiMod, apiModReset, apiFile, apiErrText } from "../lib/api.js";
import { COMP, LSHORT, TRUST, GROUPS, buildRecs, PRI } from "../lib/model.js";
import { fb, f1, ua, dsh } from "../lib/format.js";
import { openDrawer, toast } from "../lib/store.js";
import { cur, can } from "../lib/nav.js";
import { Pill } from "../components/ui.jsx";

const q = () => API.unitId ? `?unit_id=${API.unitId}` : "";
const qd = () => API.unitId ? `?unit_id=${API.unitId}&format=docx` : "?format=docx";

// Кнопка завантаження Word: зайнята на час запиту, результат тостом
function WordBtn({ path, name }) {
  const [busy, setBusy] = useState(false);
  if (!API.on) return <div className="note-box"><span className="lbl">Документ Word доступний у режимі з сервером.</span></div>;
  const go = async () => { setBusy(true); try { await apiFile(path(), name); toast("Документ Word завантажено"); } catch (e) { toast(apiErrText(e)); } finally { setBusy(false); } };
  return <button type="button" className="btn btn-primary" onClick={go} disabled={busy} aria-busy={busy} style={{ justifyContent: "center" }}><Ic n="file" />{busy ? "Готуємо документ…" : "Завантажити Word"}</button>;
}

function PanelState({ r, k, wait = "Завантажуємо…" }) {
  if (!r) return <div className="lbl" role="status">{wait}</div>;
  if (r.status === 404 || r.status === 409) return <div className="lbl">Ще немає закритої хвилі: документ з'явиться після її закриття.</div>;
  if (r.status === 403) return <div className="lock"><Ic n="lock" /><div><b>Немає доступу</b><div className="lbl">Цей документ недоступний для вашої ролі.</div></div></div>;
  return <div role="alert"><div className="lbl">Не вдалося завантажити: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 8 }} onClick={() => apiModReset(k)}>Спробувати ще раз</button></div>;
}

/* --- Брифінг --- */
function demoBriefing() {
  const m = cur(), inv = GROUPS.reduce((a, g) => a + g.inv, 0), resp = GROUPS.reduce((a, g) => a + g.resp, 0);
  const weak = [...m.components].sort((a, b) => a.cr.v - b.cr.v).slice(0, 2);
  return {
    numbers: [{ label: "Індекс доброчесності", text: `${fb(m.index)} зі 100, рівень ${m.level}` }, { label: "Достовірність", text: `${m.trust === "insufficient" ? "?" : m.trust}: ${TRUST[m.trust][1].toLowerCase()}` }, { label: "Участь", text: `${fb(resp / inv * 100)}%` }],
    risks: [...weak.map(c => `${COMP[c.id].n}: ${fb(c.cr.v)}${c.cr.lim ? ", самооцінку не підтверджують факти" : ""}`), "Люди бояться відповідати чесно: непряма оцінка суттєво вища за пряму"],
    decisions: buildRecs(m).slice(0, 3).map(r => ({ title: r.t, priority: PRI[r.pri][0].toLowerCase() })),
  };
}
const useBriefing = () => API.on ? (API.campaignId ? apiMod("brief", () => api(`/campaigns/${API.campaignId}/briefing${q()}`)) : { status: 409 }) : { data: demoBriefing() };
function BriefingBody() {
  const r = useBriefing();
  if (!r || !r.data) return <PanelState r={r} k="brief" />;
  const b = r.data;
  return <>
    <div className="lbl">Одна сторінка для вищого керівництва: три числа, три ризики, три рішення.</div>
    <div className="bf-nums">{(b.numbers || []).map((n, i) => <div key={i} className="bf-num"><span className="lbl">{n.label === "Integrity Index" ? "Індекс доброчесності" : dsh(n.label)}</span><b>{dsh(n.text)}</b></div>)}</div>
    <div><div className="lbl" style={{ marginBottom: 6 }}>Ризики</div><ol className="howto">{(b.risks || []).map((t, i) => <li key={i}>{dsh(t)}</li>)}</ol></div>
    <div><div className="lbl" style={{ marginBottom: 6 }}>Рішення</div><div className="rows">{(b.decisions || []).map((d, i) => <div key={i} className="row" style={{ alignItems: "flex-start" }}><div className="grow">{dsh(d.title)}</div>{d.priority && <Pill cls={d.priority === "високий" ? "p-bad" : d.priority === "середній" ? "p-warn" : "p-info"}>{d.priority}</Pill>}</div>)}</div></div>
    <WordBtn path={() => `/campaigns/${API.campaignId}/briefing${qd()}`} name="briefing.docx" />
  </>;
}
export const openBriefing = () => openDrawer("Брифінг за 30 секунд", BriefingBody);

/* --- Шлях до наступного рівня --- */
const useNext = () => API.on ? (API.campaignId ? apiMod("next", () => api(`/campaigns/${API.campaignId}/next-level-plan${q()}`)) : { status: 409 }) : null;
function NextBody() {
  const r = useNext();
  const intro = <div className="lbl">Чернетка Плану заходів за Додатком Д: найменший набір кроків, щоб перейти на наступний рівень зрілості, з відповідальними посадами й строками. Це чернетка: перед затвердженням її переглядає робоча група.</div>;
  if (!API.on) return <>{intro}<div className="note-box"><span className="lbl">План рахується на сервері з фактів і чек-листа закритої хвилі. Доступно в режимі з сервером.</span></div></>;
  if (!r || !r.data) return <>{intro}<PanelState r={r} k="next" wait="Готуємо план: перебираємо факти й пункти чек-листа. Це може тривати до 30 секунд…" /></>;
  const d = r.data, steps = d.steps || [], top = d.status === "top" || !d.target_level;
  return <>
    {intro}
    {top ? <div className="note-box"><b>Найвищий рівень уже досягнуто</b><span className="lbl">Наступного рівня немає: план підтримки складається з поточних рекомендацій.</span></div>
      : <div className="bf-nums"><div className="bf-num"><span className="lbl">Зараз</span><b>{d.current_level.level} «{d.current_level.title}», {f1(d.index)}</b></div><div className="bf-num"><span className="lbl">Мета</span><b>{d.target_level.level} «{d.target_level.title}»{d.index_after != null ? `, ${f1(d.index_after)}` : ""}</b></div></div>}
    {d.status && d.status !== "reached" && !top && <div className="note-box"><span className="lbl">Навіть усі кроки плану не дають наступного рівня: потрібні додаткові заходи поза розрахунком.</span></div>}
    {steps.length > 0 && <div className="rows">{steps.map((s, i) => <div key={i} className="row" style={{ alignItems: "flex-start" }}><b className="tnum" style={{ minWidth: 22 }}>{s.no || i + 1}.</b><div className="grow"><div className="t nl-t">{dsh(s.title)}</div><div className="lbl">{dsh(s.responsible)}{s.due_date ? ` · до ${ua(s.due_date)}` : ""}{s.component && COMP[s.component] ? ` · ${COMP[s.component].n}` : ""}</div></div>{s.index_after != null && <span className="tnum lbl" title="Індекс після кроку">→ {f1(s.index_after)}</span>}</div>)}</div>}
    <WordBtn path={() => `/campaigns/${API.campaignId}/next-level-plan${qd()}`} name="next-level-plan.docx" />
  </>;
}
export const openNextLevel = () => openDrawer("Шлях до наступного рівня", NextBody);
// План рахується до 30 с: поки запит іде, кнопка показує прогрес і не приймає повторних кліків
const nextBusy = () => !!(API.on && API.loading["m:next"]);

// Кнопки на «Огляді» і в «Звіті»: для ролей, яким бекенд віддає брифінг (керівник, Департамент, аудит)
export const canBriefing = () => ["leader", "observer", "auditor"].includes(S.role);
export function LeaderDocs() {
  if (!canBriefing()) return null;
  return <>
    <button type="button" className="btn btn-soft" onClick={openBriefing}><Ic n="file" />Брифінг за 30 секунд</button>
    <button type="button" className="btn btn-soft" onClick={openNextLevel} disabled={nextBusy()} aria-busy={nextBusy() || undefined}><Ic n="trend" />{nextBusy() ? "Готуємо план… (до 30 с)" : "Шлях до наступного рівня"}</button>
  </>;
}
