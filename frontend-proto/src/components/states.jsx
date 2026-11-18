/* Стани екрана: завантаження, помилка з повтором, порожньо, немає доступу, лише з сервером. */
import { Ic } from "../lib/icons.jsx";
import { apiRetry } from "../lib/api.js";

export const Loading = ({ t }) => <section className="card c12 rise" role="status" aria-live="polite"><div className="empty"><b>{t}</b><br />Завантажуємо дані з сервера…</div></section>;
export const Failed = ({ e, onRetry = apiRetry }) => <section className="card c12 rise" role="alert"><div className="empty"><b>Не вдалося завантажити дані</b><br />{e}<br /><br /><button type="button" className="btn btn-soft" onClick={onRetry}>Спробувати ще раз</button></div></section>;
export const Empty = ({ t, children }) => <section className="card c12 rise"><div className="empty"><b>{t}</b><br />{children}</div></section>;
export const NoAccess = () => <section className="card c12 rise"><div className="lock"><Ic n="lock" /><div><b>Немає доступу</b><div className="lbl">Цей екран недоступний для вашої ролі.</div></div></div></section>;
// Екрани, які працюють лише з бекендом (на Vercel без сервера)
export const NeedServer = ({ t, children }) => <section className="card c12 rise"><div className="empty"><b>{t}</b><br />Доступно в режимі з сервером.{children ? <><br />{children}</> : null}</div></section>;
