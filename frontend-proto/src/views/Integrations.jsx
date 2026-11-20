/* Стан інтеграції з Mitra для уповноваженого (GET /integrations/status) і повторна відправка (POST /integrations/theme2/sync). */
import { useState } from "react";
import { Ic } from "../lib/icons.jsx";
import { API, api, apiMod, apiModReset, apiErrText } from "../lib/api.js";
import { dsh } from "../lib/format.js";
import { toast } from "../lib/store.js";
import { Pill } from "../components/ui.jsx";

const when = t => t ? new Date(t).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "";
export function MitraCard() {
  const r = API.on ? apiMod("integr", () => api("/integrations/status")) : null, [busy, setBusy] = useState(false);
  if (!r || r.status === 403) return null;
  const head = <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Інтеграція з Mitra</h2><div className="sp" />{r.data && (r.data.theme2_enabled ? (r.data.theme2_failed.length ? <Pill cls="p-bad">Є збої</Pill> : <Pill cls="p-good">Працює</Pill>) : <Pill cls="p-mute">Не налаштовано</Pill>)}</div>;
  if (!r.data) return <section className="card c12 rise">{head}{r.error ? <div role="alert"><div className="lbl">Не вдалося завантажити стан: {r.error}</div><button type="button" className="btn btn-soft" style={{ marginTop: 8 }} onClick={() => apiModReset("integr")}>Спробувати ще раз</button></div> : <div className="lbl" role="status">Завантажуємо…</div>}</section>;
  const d = r.data, failed = d.theme2_failed || [];
  const sync = async () => { setBusy(true); try { const x = await api("/integrations/theme2/sync?retry_failed=true", { method: "POST" }); toast(`Надіслано: ${x.sent}. Не вдалося: ${x.failed}. У черзі: ${x.pending}.`); } catch (e) { toast(apiErrText(e)); } finally { setBusy(false); apiModReset("integr"); } };
  if (!d.theme2_enabled) return null; // не налаштовано: картці нічого показати
  return <section className="card c12 rise" aria-label="Інтеграція з Mitra">{head}
    <div className="lbl">Прийняті заходи надсилаються в Mitra, а звідти повертаються стан виконання й звіт виконавця.</div>
    <dl className="inst-kv" style={{ marginTop: 10 }}><dt>У черзі на відправку</dt><dd className="tnum">{d.theme2_pending}</dd><dt>Не вдалося надіслати</dt><dd className="tnum">{failed.length}</dd>{d.theme2_auto_sync_seconds > 0 && <><dt>Автоматична відправка</dt><dd>кожні {Math.round(d.theme2_auto_sync_seconds)} с</dd></>}{d.theme2_public_url && <><dt>Адреса Mitra</dt><dd className="mt-url"><a href={d.theme2_public_url} target="_blank" rel="noopener noreferrer">{d.theme2_public_url}</a></dd></>}</dl>
    {failed.length > 0 && <div className="rows" style={{ marginTop: 10 }}>{failed.map((f, i) => <div key={f.measure_id || i} className="row" style={{ alignItems: "flex-start" }}><span className="dot" style={{ background: "var(--red)", marginTop: 7 }} /><div className="grow"><div className="t mt-t">{dsh(f.title) || "Захід"}</div><div className="lbl">Спроб: {f.attempts}{f.created_at ? ` · з ${when(f.created_at)}` : ""}</div>{f.last_error && <details className="lt-more"><summary>Технічна причина</summary><code className="hash-full">{f.last_error}</code></details>}</div></div>)}</div>}
    <div className="cd-links" style={{ marginTop: 10 }}><button type="button" className="btn btn-soft" disabled={busy} onClick={sync}><Ic n="send" />{busy ? "Надсилаємо…" : failed.length ? "Надіслати повторно" : "Надіслати зараз"}</button></div>
  </section>;
}
