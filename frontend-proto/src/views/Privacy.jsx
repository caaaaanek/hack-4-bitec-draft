/* «Що саме ми зберігаємо» перед анкетою (GET /respond/privacy). Без бекенду той самий текст статично. */
import { useEffect, useState } from "react";
import { API, api } from "../lib/api.js";
import { S } from "../lib/state.js";
import { dsh } from "../lib/format.js";

const DEMO = { title: "Що саме ми зберігаємо",
  modes: { ballot: ["Жетон зі сліпим підписом: сервер підписує його, не бачачи вмісту, тож відповідь не пов'язати з вами.", "Квитанція лишається лише у вас: після закриття хвилі перевірте, що відповідь урахована."], token: ["Посилання чи QR не пов'язані з вашим обліковим записом: система не знає навіть, хто пройшов.", "Зберігається лише «посилання використано» і відповідь без часу."],
    login: ["Що ви пройшли анкету (щоб не пустити вдруге), без відповідей.", "Ваші відповіді окремо, без вашого імені, часу й дати, у зашифрованому буфері до закриття хвилі.", "При закритті відповіді переносяться перемішаними, а підрозділ узагальнюється до групи щонайменше з 5 людей."] },
  never: ["ПІБ, email, телефон", "вільний текст", "IP-адреса й час подання поруч із відповіддю", "результати груп, менших за k"] };
let cache = null;
// Технічні слова з тексту сервера показуємо людською мовою
const human = t => dsh(t).replace(/\bemail\b/gi, "електронна пошта").replace("IP-адреса", "адреса пристрою в мережі").replace(/груп, менших за k/, `груп, менших за ${S.k} осіб`);

export function PrivacyNote() {
  const [d, setD] = useState(API.on ? cache : DEMO), [err, setErr] = useState(false);
  useEffect(() => { if (!API.on || cache) return; api("/respond/privacy", { auth: false }).then(x => { cache = x; setD(x); }, () => setErr(true)); }, []);
  const mode = API.anon || !API.on ? "token" : "login"; // демо-анкета проходить за жетоном
  if (err) return <div className="note-box pv"><b>Що саме ми зберігаємо</b><span className="lbl">Не вдалося завантажити опис. Коротко: відповіді зберігаються без імені й часу, а результати показуються лише для груп від {S.k} осіб.</span></div>;
  if (!d) return <div className="note-box pv" role="status"><span className="lbl">Завантажуємо, що саме ми зберігаємо…</span></div>;
  // За обліковим записом відповідь іде з анонімним жетоном: показуємо і що зберігаємо про участь, і що дає жетон
  const keep = mode === "login" ? [...((d.modes && d.modes.login) || []), ...((d.modes && d.modes.ballot) || [])] : (d.modes && d.modes[mode]) || [];
  return <div className="note-box pv">
    <b>{dsh(d.title) || "Що саме ми зберігаємо"}</b>
    <ul>{keep.map((t, i) => <li key={i}>{human(t)}</li>)}</ul>
    {d.never && d.never.length > 0 && <><span className="lbl">Ніколи не зберігаємо:</span><ul>{d.never.map((t, i) => <li key={i}>{human(t)}</li>)}</ul></>}
  </div>;
}
