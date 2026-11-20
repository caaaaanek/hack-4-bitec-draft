/* Маршрути: #екран/параметр, доступ за роллю, поточний заклад. */
import { useSyncExternalStore } from "react";
import { S, NAV, HOME } from "./state.js";
import { API, allowed } from "./api.js";
import { inst, ALPHA } from "./model.js";

export { allowed };
export function route() { let [r, p] = (location.hash || "").slice(1).split("/"); return allowed(r) ? { r, p } : { r: HOME[S.role], p: null }; }
export const can = r => NAV.some(n => n[0] === r && n[3].includes(S.role));
export const cur = () => inst(S.role === "observer" ? S.inst : ALPHA);
export const go = h => { location.hash = h; };
const subHash = f => { addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); };
export const useHash = () => useSyncExternalStore(subHash, () => location.hash);
export const TITLES = { overview: "Огляд закладу", explain: "Розклад індексу", trends: "Динаміка", compare: "Порівняння: самооцінка і факти", whatif: "Що, якщо: прогноз індексу", recs: "Рекомендації", tracker: "Трекер заходів", sources: "Джерела", report: "Звіт", manage: "Керування циклом", surveys: "Анкети", checklist: "Чек-лист", audit: "Журнал", survey: "Анонімне опитування", me: "Мої результати", institutions: "Заклади", watch: "Сигнали", advocate: "Питання перевірки", normative: "Що змінилось для нас", autopilot: "Автопілот хвилі", checks: "Перевірки", learn: "Навчання", views: "Перегляди підрозділів", approvals: "Запити другій людині", urn: "Урна з трьома ключами", people: "Люди", units: "Підрозділи", summary: "Зведення", dicts: "Довідники", risks: "Реєстр ризиків" };
export const isLogin = () => API.down || (API.on && !API.user && !API.anon);
