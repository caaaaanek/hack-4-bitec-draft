/* Одноразове посилання-запрошення: після створення запису, скидання пароля чи підтвердження скидання. */
import { Ic } from "../lib/icons.jsx";
import { toast, openDrawer, closeDrawer } from "../lib/store.js";
import { copyText } from "../lib/util.js";
import { inviteAbs } from "./WaveAdmin.jsx";

export function showInvite(login, link, exp, note) {
  openDrawer("Запрошення", () => <>
    <div>Посилання для <b>{login}</b>. Людина відкриває його й сама ставить пароль. Показується один раз: скопіюйте й передайте особисто.</div>
    {note && <div className="note-box"><span className="lbl">{note}</span></div>}
    <code className="hash-full" id="invLink">{inviteAbs(link)}</code>
    {exp && <div className="lbl">Діє до {new Date(exp).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })}.</div>}
    <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => copyText(inviteAbs(link), () => toast("Посилання скопійовано"))}><Ic n="copy" />Копіювати</button>
  </>);
}

// Одразу копіює посилання й показує сповіщення; якщо браузер не дав скопіювати, відкриває панель з посиланням
export function copyInvite(login, link, exp, note) {
  const url = inviteAbs(link), ok = () => { closeDrawer(); toast(note ? `Запрошення для ${login} скопійовано. ${note}` : `Запрошення для ${login} скопійовано`); };
  const fail = () => showInvite(login, link, exp, note);
  try { navigator.clipboard.writeText(url).then(ok, fail); } catch (e) { fail(); }
}
