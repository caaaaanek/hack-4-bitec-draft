/* Квитанції жетонів: показ після надсилання й перевірка «мою відповідь враховано» (GET /respond/receipts/{квитанція}). */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { myReceipts, apiCheckReceipt, apiErrText, dn } from "../lib/api.js";
import { toast } from "../lib/store.js";
import { copyText } from "../lib/util.js";

export function ReceiptBox({ r }) {
  return <div className="note-box rc-box"><b>Ваша квитанція</b>
    <span className="lbl">Відповідь надіслано з анонімним жетоном: сервер підписав його, не бачачи вмісту, тож відповідь не пов'язана з вами. Квитанція збережена на цьому пристрої; після закриття хвилі за нею можна перевірити, що відповідь урахована.</span>
    <code className="hash-full">{r}</code>
    <button type="button" className="btn btn-soft" style={{ alignSelf: "flex-start" }} onClick={() => copyText(r, () => toast("Квитанцію скопійовано"))}><Ic n="copy" />Копіювати</button></div>;
}

export function ReceiptsCard() {
  const list = myReceipts(), [st, setSt] = useState({}), [busy, setBusy] = useState("");
  if (!list.length) return null;
  const check = async r => { setBusy(r); try { const x = await apiCheckReceipt(r); setSt(s => ({ ...s, [r]: x.counted ? (x.campaign_closed ? ["Відповідь урахована в закритій хвилі", "p-good"] : ["Відповідь отримано, хвиля ще триває", "p-info"]) : ["Квитанцію не знайдено", "p-warn"] })); } catch (e) { toast(apiErrText(e)); } finally { setBusy(""); } };
  return <section className="card c12 rise"><div className="card-h"><h2>Мої квитанції</h2></div>
    <div className="lbl" style={{ marginBottom: 8 }}>Перевірте, що вашу відповідь урахували. Квитанція не розкриває, що ви відповіли.</div>
    <div className="rows">{list.map(x => <div key={x.receipt} className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}><div className="grow" style={{ minWidth: 0 }}><div className="t">{dn(x.title || "Анкета")}</div><code className="hash-full">{x.receipt}</code>{st[x.receipt] && <span className={`pill ${st[x.receipt][1]}`} role="status">{st[x.receipt][0]}</span>}{st[x.receipt] && st[x.receipt][1] === "p-warn" && <div className="lbl" style={{ marginTop: 4 }}>Якщо хвилю ще не закрито, спробуйте пізніше. Якщо вже закрито, зверніться до уповноваженого з цією квитанцією.</div>}</div>
      <button type="button" className="btn btn-soft" disabled={!!busy} onClick={() => check(x.receipt)}><Ic n="ok" />{busy === x.receipt ? "Перевіряємо…" : "Перевірити, що мою відповідь враховано"}</button></div>)}</div>
  </section>;
}
