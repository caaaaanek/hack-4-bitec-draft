/* Спільний стан інтерфейсу і перемальовування.
 * Дані (S, API) лишаються звичайними обʼєктами, як і раніше; після зміни викликається render().
 * render(true) — тихе оновлення без анімацій появи; render() — екран монтується заново з анімаціями. */
import { useSyncExternalStore } from "react";

let version = 0, viewKey = 0;
const subs = new Set();
const emit = () => { version++; subs.forEach(f => f()); };
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const useStore = () => useSyncExternalStore(subscribe, () => version);
export const getViewKey = () => viewKey;
export function render(soft) { if (!soft) viewKey++; emit(); }

/* Оверлеї: бічна панель, асистент, поповер, вікно експорту, конструктор, сповіщення */
export const ui = {
  drawer: null,      // { title, body: () => JSX }
  ai: false,         // відкрито асистента
  side: false,       // мобільне меню
  pop: null,         // { kind, anchor, ...дані }
  exp: false,        // вікно експорту
  bld: null,         // дані анкети для конструктора
  toast: null,       // { t, n }
};

export function openDrawer(title, body) { ui.drawer = { title, body, n: (ui.drawer?.n || 0) + 1 }; emit(); }
export function closeDrawer() { if (!ui.drawer) return; ui.drawer = null; emit(); }
let toastN = 0, toastT;
export function toast(t) { ui.toast = { t, n: ++toastN }; emit(); clearTimeout(toastT); toastT = setTimeout(() => { ui.toast = null; emit(); }, 2400); }
export function openPop(kind, anchor, data = {}) {
  if (ui.pop && ui.pop.anchor === anchor && ui.pop.kind === kind) return closePop();
  ui.pop = { kind, anchor, ...data }; emit();
}
export function closePop() { if (!ui.pop) return; ui.pop = null; emit(); }
