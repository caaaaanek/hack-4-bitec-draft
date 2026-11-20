/* Екрани з даними сервера (null — показати звичайний екран). */
import { useState, useEffect, useCallback } from "react";
import { Ic } from "../lib/icons.jsx";
import { FileDrop } from "../components/FileDrop.jsx";
import { S } from "../lib/state.js";
import { API, api, staffTokenOnly, apiEnsure, apiRetry, apiRetryResults, apiLoadForm, apiFail, apiErrText, RESULT_VIEWS, dn, apiLoadAdm, apiAdmReload, dropWaveMods, apiCreateCampaign, apiCampaignAct, apiQrCreate, apiQrRevoke, apiQrTick,
  QST, QCAT, apiQAct, orgCap, bldOpen, CKS, apiLoadCk, apiCkReload, apiSaveItem, requireFile, fourEyesOn, apiConfirm, apiDelFile, apiDownload, AUDIT_ENT, AUDIT_ACT, apiLoadLog, auditDetails, apiVerify } from "../lib/api.js";
import { COMPS, COMP, level } from "../lib/model.js";
import { fb, ua, plural } from "../lib/format.js";
import { render, toast, openDrawer, closeDrawer, ui } from "../lib/store.js";
import { Pill, LvPill, Num, LevelBar, Ticks } from "../components/ui.jsx";
import { Loading, Failed, Empty } from "../components/states.jsx";
import { UnitCombo, UnitPick } from "../components/UnitCombo.jsx";
import { QrCode, qrAbs } from "../components/QrCode.jsx";
import { bldFromServer, bldNewSec } from "./Builder.jsx";
import { AutopilotSection } from "./Autopilot.jsx";
import { DeptInstitutions, ChooseInst } from "./Department.jsx";
import { AnchorCard, LotteryCard } from "./Transparency.jsx";
import { UrnSection } from "./Urn.jsx";
import { MitraCard } from "./Integrations.jsx";
import { ReceiptsCard } from "./Receipts.jsx";
import { LearnCard } from "./Learn.jsx";
import { ParticipantsSection, AssignSection, loadAsg } from "./WaveAdmin.jsx";

export function apiView(r) {
  if (!API.on) return null;
  if (S.role === "observer") { if (r === "institutions") return <DeptInstitutions />; if ((RESULT_VIEWS.includes(r) || r === "advocate") && !API.deptUnit) return <ChooseInst />; }
  if (RESULT_VIEWS.includes(r) && r !== "sources" && !API.model && API.resErr) return <Failed e={API.resErr} onRetry={apiRetryResults} />;
  if (RESULT_VIEWS.includes(r) && r !== "sources" && !API.model)
    return API.empty ? (API.emptyCode === "no_indexed_wave"
      ? <Empty t="Індексу ще немає">Для цього підрозділу ще не було закритої хвилі з достатньою кількістю відповідей. Індекс зʼявиться, коли в групах набереться щонайменше {S.k} осіб.</Empty>
      : <Empty t="Ще немає закритої хвилі оцінювання">Результати зʼявляться, коли уповноважений закриє хвилю: система порахує індекс і збереже незмінний знімок.</Empty>) : <Loading t="Результати" />;
  if (r === "survey") return apiSurveyView();
  if (r === "me") return <ApiMe />;
  if (r === "manage") return <ApiManage />;
  if (r === "surveys") return <ApiSurveys />;
  if (r === "checklist") return <ApiChecklist />;
  if (r === "audit") return <ApiAudit />;
  return null;
}

function apiSurveyView() {
  if (API.anon) {
    if (API.surveyMsg && !API.survey && API.tokenResults) {
      const r = API.tokenResults;
      return <>
        <section className="c12 rise toolbar"><span className="lbl">{r.campaign_title}{r.closed_on ? `, закрито ${ua(r.closed_on)}` : ""}. Відповіді анонімні: посилання не повʼязане з вашою відповіддю.</span></section>
        {r.my_unit && <ApiScope sc={r.my_unit} title={"Ваша група: " + r.my_unit.unit_name} />}
        <ApiScope sc={r.institution} title={orgCap("nominative") + ": " + r.institution.unit_name} />
        {r.summary && r.summary.length > 0 && <section className="card c12 rise"><div className="card-h"><h2>Коротко</h2></div><div className="rows">{r.summary.map(t => <div key={t} className="row"><span className="dot" style={{ background: "var(--teal)" }} /><div className="grow">{uaSum(t)}</div></div>)}</div></section>}
      </>;
    }
    if (API.surveyMsg && !API.survey) {
      const [t, d] = API.surveyMsg === "used" ? ["Цю анкету вже заповнено", "Повторно відповісти за цим посиланням не можна: так ми захищаємо анонімність і не допускаємо подвоєних відповідей. Дякуємо за участь."]
        : API.surveyMsg === "closed" ? ["Опитування зараз не приймає відповіді", "Хвилю оцінювання ще не відкрито або вже закрито. Перевірте строки в того, хто надіслав вам посилання."]
        : API.surveyMsg === "qr_limit" ? ["Для цього QR відкрито забагато форм", "Зверніться до організатора опитування: він може показати новий QR."]
        : API.surveyMsg === "qr_invalid" ? ["QR недійсний або застарів", "Відскануйте QR ще раз або попросіть організатора показати актуальний."]
        : ["Посилання недійсне або застаріле", "Перевірте, чи адресу скопійовано повністю. Якщо не допомогло, попросіть нове посилання в того, хто надіслав вам анкету."];
      return <div className="survey c12"><section className="card rise" style={{ padding: 32, textAlign: "center" }}><div className="done-ic" style={{ background: "var(--soft)", color: "var(--muted)" }}><Ic n="lock" /></div><h2 style={{ margin: "18px 0 6px", fontSize: 22, fontWeight: 600 }}>{t}</h2><p className="lbl" style={{ maxWidth: 480, margin: "0 auto" }}>{d}</p></section></div>;
    }
    return null;
  }
  // Після подання показуємо подяку; наступний захід на екран бере наступну анкету.
  if (API.survey && API.survey.submitted && S.survey.phase !== "done") API.survey = null;
  if (API.survey) return null;
  if (!apiEnsure("assignments", () => api("/me/assignments"))) return <Loading t="Анкети" />;
  if (API.assignments.error) return <Failed e={API.assignments.error} />;
  const todo = API.assignments.filter(a => a.kind !== "checklist"), next = todo.find(a => !a.submitted);
  if (next && API.formError) return <Failed e={API.formError} />;
  if (next) { apiLoadForm(next); return <Loading t={next.questionnaire_title} />; }
  return <Empty t="Зараз немає анкет до проходження">{todo.length ? `Ви вже пройшли: ${todo.map(a => a.questionnaire_title).join(", ")}.` : staffTokenOnly() ? "Особовий склад проходить анкету анонімно, без входу: за персональним посиланням або QR, які роздає уповноважений. Скористайтеся посиланням, коли його отримаєте." : "Анкети зʼявляться, коли уповноважений відкриє хвилю оцінювання."}<br /><br /><a className="btn btn-soft" href="#me">Мої результати <Ic n="arrowR" /></a></Empty>;
}

const uaSum = t => String(t).replace(/Integrity Index/g, "Індекс доброчесності");
function ApiScope({ sc, title }) {
  if (!sc.sufficient) return <section className="card c12 rise"><div className="lock"><Ic n="lock" /><div><b>{title}: результати приховано</b><div className="lbl">Відповіло менше {S.k} осіб. Так ми не дозволяємо обчислити відповіді окремих людей.</div></div></div></section>;
  const idx = sc.index.score ?? 0, lv = (sc.index.level && sc.index.level.level) || level(idx);
  return <>
    <section className="card c5 rise"><div className="lbl">{title}</div>
      <div className="big tnum" style={{ marginTop: 12 }}><Num v={idx} /><span className="of">з 100</span></div>
      <div style={{ margin: "10px 0 14px" }}><LvPill l={lv} /></div><div className="lvs-compact"><LevelBar v={idx} /></div></section>
    <section className="card c7 rise"><div className="card-h"><h2>{title.split(":")[0]}: компоненти</h2></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{sc.components.filter(c => COMPS.includes(c.code)).map((c, i) => { const v = c.score ?? 0; return <div key={c.code}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="comp-ic" style={{ background: COMP[c.code].s, color: COMP[c.code].c }}><Ic n={COMP[c.code].ic} /></span><b>{COMP[c.code].n}</b></span><span style={{ display: "flex", gap: 8, alignItems: "center" }}><b className="tnum">{c.score == null ? "н/д" : fb(v)}</b><LvPill l={(c.level && c.level.level) || level(v)} /></span></div>
        <Ticks n={20} on={Math.round(v / 5)} color={COMP[c.code].c} delay={i * 120} /></div>; })}</div></section>
  </>;
}
function ApiMe() {
  const okA = apiEnsure("assignments", () => api("/me/assignments")), okM = apiEnsure("my", () => api("/me/results").catch(e => e.status === 404 ? [] : Promise.reject(e)));
  if (!okA || !okM) return <Loading t="Мої результати" />;
  if (API.my.error) return <Failed e={API.my.error} />;
  const todo = Array.isArray(API.assignments) ? API.assignments.filter(a => a.kind !== "checklist") : [];
  const latest = Array.isArray(API.my) ? API.my[0] : API.my;
  return <><ReceiptsCard />
    <section className="c12 rise toolbar"><span className="lbl">Відповіді анонімні: вони не повʼязані з вашим обліковим записом.</span></section>
    <section className="card c12 rise"><div className="card-h"><h2>Анкети відкритих хвиль</h2></div>
      <div className="rows">{todo.length ? todo.map((a, i) => <div key={i} className="row"><div className="grow"><div className="t">{a.questionnaire_title}</div><div className="s">{a.campaign_title}</div></div>{a.submitted ? <Pill cls="p-good">Пройдено</Pill> : <a className="btn btn-primary" href="#survey">Пройти анкету <Ic n="arrowR" /></a>}</div>) : <div className="lbl">{staffTokenOnly() ? "Зараз немає відкритих анкет. Особовий склад проходить анкету анонімно: за персональним посиланням або QR від уповноваженого." : "Зараз немає відкритих анкет для вас."}</div>}</div>
      {S.role === "checklist_editor" && <div className="lbl" style={{ marginTop: 10 }}>Ви в робочій групі: <a className="link" href="#checklist">заповнити чек-лист</a>.</div>}</section>
    <LearnCard />
    {latest ? <>
      <section className="c12 rise toolbar"><span className="lbl">{dn(latest.campaign_title)}{latest.closed_on ? `, закрито ${ua(latest.closed_on)}` : ""}</span></section>
      {latest.my_unit && <ApiScope sc={latest.my_unit} title={"Мій підрозділ: " + dn(latest.my_unit.unit_name)} />}
      <ApiScope sc={latest.institution} title={orgCap("nominative") + ": " + dn(latest.institution.unit_name)} />
      {latest.summary && latest.summary.length > 0 && <section className="card c12 rise"><div className="card-h"><h2>Коротко</h2></div><div className="rows">{latest.summary.map(t => <div key={t} className="row"><span className="dot" style={{ background: "var(--teal)" }} /><div className="grow">{uaSum(t)}</div></div>)}</div></section>}
    </> : <Empty t="Результатів ще немає">Вони зʼявляться після закриття хвилі.</Empty>}
  </>;
}

/* --- Керування циклом (уповноважений) --- */
// Закриття з урною чекає частин ключа: скільки введено, знаємо з розділу «Урна», якщо він уже завантажений
const urnWait = id => { const u = API.mod["urn:" + id] && API.mod["urn:" + id].data; return u && u.holders ? `Чекає частин ключа: ${u.holders.filter(h => h.submitted).length} з ${u.threshold || 2}` : "Чекає частин ключа"; };
const CST = { draft: ["Чернетка", "p-mute"], open: ["Триває", "p-good"], closed: ["Завершено", "p-info"] };
function ApiManage() {
  const [ask, setAsk] = useState(null), [tq, setTq] = useState(null), [tu, setTu] = useState(null), [tn, setTn] = useState(""), [show, setShow] = useState(null);
  useEffect(() => { const t = setInterval(apiQrTick, 4000); return () => clearInterval(t); }, []);
  // Поки хвиля чекає підтвердження аудиту, тихо перевіряємо, чи її вже відкрили (в іншому вікні)
  useEffect(() => { const t = setInterval(() => { const A = API.adm; if (A && !A.error && A.campaigns.some(x => x.waitingOpen) && !API.loading.adm) apiLoadAdm(A.sel).then(v => { const st = x => (x.campaigns || []).map(c => c.status + c.waitingOpen).join(); if (st(v) !== st(A)) dropWaveMods(); API.adm = v; render(true); }, () => {}); }, 8000); return () => clearInterval(t); }, []);
  const hideQr = useCallback(() => setShow(null), []);
  if (!apiEnsure("adm", () => apiLoadAdm())) return <Loading t="Керування циклом" />;
  const A = API.adm; if (A.error) return <Failed e={A.error} />;
  const c = A.campaigns.find(x => x.id === A.sel);
  const surveys = c ? A.qs.filter(q => c.questionnaire_ids.includes(q.id) && q.kind !== "checklist") : [];
  const q = surveys.find(x => x.id === tq) || surveys[0], unit = tu || (c && c.unit_id);
  // Людей у групі за замовчуванням: учасники цієї анкети в хвилі (а не 30 для будь-якої анкети)
  const qEl = q && A.progress && (A.progress.items || []).find(i => i.questionnaire_id === q.id), nDef = qEl && qEl.eligible ? qEl.eligible : "", nVal = tn === "" ? nDef : tn;
  const createQr = async () => {
    if (!(+nVal >= 1)) { toast("Вкажіть, скільки людей у групі"); return; }
    try { const l = await apiQrCreate(c.id, q && q.id, q && q.target_category === "expert" ? null : (A.units.find(u => u.id === unit) || A.units.find(u => !u.parent_id) || A.units[0] || {}).id, +nVal); setShow(l.id); }
    catch (e) { apiFail(e); }
  };
  const qrs = c ? A.qr || [] : [], shown = qrs.find(l => l.id === show);
  return <>
    <section className="card c8 rise">
      {c ? <>
        <div className="card-h"><h2>{dn(c.title)}</h2>{c.waitingOpen ? <Pill cls="p-warn">Чекає на підтвердження аудиту</Pill> : c.status === "open" && c.urn_close_requested ? <Pill cls="p-warn">{urnWait(c.id)}</Pill> : <Pill cls={CST[c.status][1]}>{CST[c.status][0]}</Pill>}<div className="sp" />{c.opened_on && <span className="lbl tnum">{c.closed_on ? `${ua(c.opened_on)} – ${ua(c.closed_on)}` : `з ${ua(c.opened_on)}`}</span>}</div>
        <div className="rows">{(A.progress ? A.progress.items : []).length ? A.progress.items.map((i, k) => { const n = i.too_few_people ? 30 : Math.max(1, Math.min(30, i.eligible || 30)), on = i.too_few_people || !i.eligible ? 0 : Math.round((i.submitted || 0) / i.eligible * n); return <div key={k} className="row prog-row"><div className="grow"><div className="prog-h"><span className="t">{i.questionnaire_title}</span>{i.too_few_people && <span className="prog-lock" data-tip={`Менше ${c.min_group_size} осіб: кількості приховано`}><Ic n="lock" /></span>}<b className="tnum prog-n">{i.too_few_people ? "приховано" : `${i.submitted} з ${i.eligible}`}</b></div>
          <div className="ticks" style={{ height: 14, marginTop: 8 }}>{Array.from({ length: n }, (_, j) => <span key={j} style={j < on ? { background: "var(--teal)" } : undefined} />)}</div>
          {i.over_expected && <QrOver />}</div></div>; }) : <div className="lbl">Анкет у хвилі немає.</div>}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }} id="cActs">
          {ask === c.id ? <><div className="lbl" style={{ width: "100%" }}>Прийом відповідей зупиниться, система порахує індекс і збереже незмінний знімок. Відкриті, але не подані форми стануть недійсними. Скасувати не можна.</div><button className="btn btn-ghost" onClick={() => setAsk(null)}>Скасувати</button><button className="btn btn-danger" disabled={!!API.campBusy} onClick={() => { setAsk(null); apiCampaignAct(c.id, "close"); }}>Завершити</button></> : <>
            {c.status === "draft" && (c.waitingOpen ? <div className="lbl">Запит на відкриття надіслано. Хвиля відкриється, щойно внутрішній аудит підтвердить склад учасників.</div>
              : <button className="btn btn-primary" disabled={!!API.campBusy} onClick={() => apiCampaignAct(c.id, "open")}><Ic n="ok" />{fourEyesOn() ? "Попросити відкрити хвилю" : "Відкрити хвилю"}</button>)}
            {c.status === "open" && <button className="btn btn-soft" onClick={() => setAsk(c.id)}><Ic n="lock" />Завершити й порахувати індекс</button>}</>}
        </div></> : <div className="empty"><b>Хвиль ще немає</b><br />Створіть першу хвилю оцінювання.</div>}
    </section>
    <section className="card c4 rise waves-card">
      <div className="card-h"><h2>Хвилі</h2><div className="sp" /><button className="btn btn-soft" style={{ padding: "6px 12px" }} onClick={apiNewCampaign}><Ic n="plus" />Нова</button></div>
      <div className="rows">{A.campaigns.map(x => <a key={x.id} className="row click" href="#manage" onClick={e => { e.preventDefault(); setAsk(null); setTq(null); setTu(null); apiAdmReload(x.id); }} style={x.id === A.sel ? { background: "var(--soft)" } : undefined}><div className="grow"><div className="t">{dn(x.title)}</div><div className="s">{x.access_mode === "token" ? "анонімно за QR" : "за обліковими записами"}</div></div>{x.waitingOpen ? <Pill cls="p-warn">Чекає аудиту</Pill> : <Pill cls={CST[x.status][1]}>{CST[x.status][0]}</Pill>}</a>)}</div>
    </section>
    {c && c.access_mode === "token" && (c.status !== "closed" || qrs.length > 0) && <section className="card c12 rise">
      <div className="card-h"><h2>QR для зали</h2></div>
      <div className="lbl" style={{ marginBottom: 12 }}>Одне посилання на групу. Кожен скан відкриває нову одноразову форму, завершена форма це одна відповідь. Закрили форму без подання й відсканували знову: нова форма, попередня нічого не рахує. Вкажіть, скільки людей у групі: від цього рахується участь, а відповіді понад це число позначаються як можлива накрутка.</div>
      {c.status !== "closed" && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 2, minWidth: 220 }}><label htmlFor="qr-q">Анкета</label><select className="inp" id="qr-q" value={q ? q.id : ""} onChange={e => { setTq(e.target.value); setTn(""); }}>{surveys.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor="qr-u">Підрозділ</label><UnitCombo id="qr-u" units={A.units} value={unit} onChange={setTu} /></div>
        <div className="field" style={{ width: 130 }}><label htmlFor="qr-n">Людей у групі</label><input className="inp tnum" id="qr-n" type="number" min="1" max="100000" value={nVal} onChange={e => setTn(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={createQr}><Ic n="qr" />Створити QR</button>
      </div>}
      {qrs.length > 0 && <div className="rows" style={{ marginTop: 14 }}>{qrs.map(l => <div key={l.id} className="row qr-row">
        <QrCode className="qr-mini" text={qrAbs(l.link)} />
        <div className="grow"><div className="t">{l.questionnaire_title}{l.revoked && <span className="lbl"> (скани зупинено)</span>}</div>
          <div className="s">{dn((A.units.find(u => u.id === l.unit_id) || {}).name || "усі підрозділи")}</div>
          <QrCounters l={l} /></div>
        <div className="qr-acts"><button className="btn btn-soft" onClick={() => setShow(l.id)}><Ic n="qr" />Показати QR</button>
          {!l.revoked && c.status !== "closed" && <button className="btn btn-ghost" onClick={() => apiQrRevoke(c.id, l.id)}>Зупинити скани</button>}</div>
      </div>)}</div>}
    </section>}
    {c && c.access_mode !== "token" && <ParticipantsSection key={"pt" + c.id} c={c} />}
    {c && <AssignSection key={"as" + c.id} c={c} />}
    {c && <AutopilotSection key={c.id} id={c.id} />}
    {c && <UrnSection key={"urn" + c.id} c={c} />}
    <MitraCard />
    {shown && <QrScreen l={shown} onClose={hideQr} />}
  </>;
}
const MODE_HINT = { login: "Вхід під своїм логіном. Відповіді нікому не показуються.", token: "Один скан QR це одна анонімна форма без входу." };

/* --- QR для зали: лише кількості, хто відкрив форму, система не зберігає --- */
const QrOver = () => <span className="qr-over" role="alert"><Ic n="lock" />Відповідей більше, ніж людей у групі: можлива накрутка</span>;
function QrCounters({ l }) {
  return <div className="qr-cnt"><span>Завершено: <b className="tnum">{l.completed}</b> з <span className="tnum">{l.expected}</span></span>
    <span className="lbl">Відкрито форм: <span className="tnum">{l.opened}</span>, не завершено: <span className="tnum">{l.opened - l.completed}</span></span>
    {(l.over_expected ?? l.completed > l.expected) && <QrOver />}{l.scan_limit_reached && <span className="lbl">Ліміт сканів вичерпано</span>}</div>;
}
// Повноекранний QR для проєктора; лічильники під ним оновлюються разом з екраном
function QrScreen({ l, onClose }) {
  useEffect(() => {
    const f = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", f); document.querySelector(".qr-x").focus();
    return () => document.removeEventListener("keydown", f);
  }, [onClose]);
  const url = qrAbs(l.link);
  return <div className="qr-screen" role="dialog" aria-modal="true" aria-label="QR для проходження опитування">
    <button type="button" className="icon-btn qr-x" aria-label="Закрити" onClick={onClose}><Ic n="x" /></button>
    <h2>Скануйте, щоб пройти опитування</h2><div className="lbl">{l.questionnaire_title}</div>
    <QrCode className="qr-big" text={url} label="QR-код" />
    <div className="qr-url tnum">{url}</div>
    <QrCounters l={l} />
    <div className="lbl" style={{ maxWidth: 520, textAlign: "center" }}>Анонімно: система не знає, хто відсканував. Форму, закриту без подання, не враховано.</div>
  </div>;
}
function apiNewCampaign() {
  const A = API.adm;
  openDrawer("Нова хвиля оцінювання", () => {
    const [title, setTitle] = useState(""), [unit, setUnit] = useState(null), [ids, setIds] = useState(A.qs.map(q => q.id)), [mode, setMode] = useState("token"), [k, setK] = useState(S.k), [err, setErr] = useState("");
    const ok = async () => {
      if (!title.trim()) return setErr("Вкажіть назву.");
      if (!ids.length) return setErr("Оберіть хоча б одну анкету.");
      if (!(+k >= 5)) return setErr("Мінімальна група: не менше 5 осіб.");
      const u = A.units.find(x => x.id === unit) || A.units.find(x => !x.parent_id) || A.units[0];
      try { await apiCreateCampaign({ title: title.trim(), unit_id: u ? u.id : "", questionnaire_ids: ids, min_group_size: +k, access_mode: mode }); }
      catch (e) { setErr(apiErrText(e)); }
    };
    return <>
      <div className="field"><label htmlFor="n-t">Назва</label><input className="inp" id="n-t" placeholder="Хвиля 3 (весна)" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <UnitPick id="n-u" units={A.units} value={unit} onChange={setUnit} />
      <span className="lbl">Немає потрібного підрозділу? Новий підрозділ створює технічний адміністратор.</span>
      <div className="field"><label>Анкети</label>{A.qs.map(q => <label key={q.id} className="chk-row"><input type="checkbox" className="n-q" value={q.id} checked={ids.includes(q.id)} onChange={e => setIds(v => e.target.checked ? [...v, q.id] : v.filter(x => x !== q.id))} /><span>{q.title} <span className="lbl">v{q.version}</span></span></label>)}</div>
      <div className="field"><label>Як проходять</label><div className="seg seg-full" id="n-m">{[["token", "Анонімно за QR"], ["login", "За обліковими записами"]].map(([m, n]) => <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{n}</button>)}</div><span className="lbl" id="n-mh">{MODE_HINT[mode]}</span></div>
      <div className="field"><label htmlFor="n-k">Мінімальна група, осіб</label><input className="inp tnum" id="n-k" type="number" min="5" value={k} onChange={e => setK(e.target.value)} /><span className="lbl">Менші групи не показуються. Не менше 5.</span></div>
      <span className="lbl" id="n-err" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>{err}</span>
      <button className="btn btn-primary" id="n-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="plus" />Створити чернетку</button>
    </>;
  });
}

/* --- Анкети (Департамент) --- */
function ApiSurveys() {
  if (!apiEnsure("qs", () => api("/questionnaires"))) return <Loading t="Анкети" />;
  if (API.qs.error) return <Failed e={API.qs.error} />;
  const list = [...API.qs].sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);
  return <>
    <section className="c12 rise toolbar"><div className="sp" /><button className="btn btn-primary" onClick={bldNew}><Ic n="plus" />Нова анкета</button></section>
    {list.map(q => <section key={q.id} className="card c6 rise">
      <div className="comp-top"><span className="comp-ic" style={{ background: "var(--lime-soft)", color: "var(--teal-deep)" }}><Ic n={q.kind === "checklist" ? "check" : "survey"} /></span><b>{q.title}</b><div className="sp" style={{ flex: 1 }} /><Pill cls={QST[q.status][1]}>{QST[q.status][0]}</Pill></div>
      <div className="lbl" style={{ marginTop: 10 }}>{q.kind === "checklist" ? "Чек-лист" : QCAT[q.target_category]} · версія {q.version}</div>
      {/* wrap-reverse: якщо кнопки не вміщаються, дата лишається внизу ліворуч, а кнопки піднімаються рядком вище */}
      <div className="q-foot"><span className="lbl">Оновлено {ua(q.updated_at.slice(0, 10))}</span><div className="q-acts">
        <button className="btn btn-soft" onClick={() => apiOpenQ(q.id)}><Ic n="eye" />Переглянути</button>
        {q.status === "draft" ? <><button className="btn btn-soft" onClick={() => bldOpen(q.id)}><Ic n="edit" />Редагувати</button><button className="btn btn-primary" disabled={!!API.qBusy} onClick={() => apiQAct(q.id, "publish")}><Ic n="ok" />Опублікувати</button></>
          : q.status === "published" ? <><button className="btn btn-ghost" disabled={!!API.qBusy} onClick={() => apiQAct(q.id, "new-version")}><Ic n="plus" />Нова версія</button><button className="btn btn-ghost" disabled={!!API.qBusy} onClick={() => apiQAct(q.id, "archive")}>В архів</button></>
          : q.status === "archived" ? <button className="btn btn-ghost" disabled={!!API.qBusy} onClick={() => apiQAct(q.id, "restore")}>Повернути з архіву</button> : null}</div></div>
    </section>)}
  </>;
}
async function apiOpenQ(id) {
  try {
    const q = await api(`/questionnaires/${id}`);
    const nSec = q.sections.length, nQ = q.sections.reduce((a, s) => a + s.questions.length, 0);
    openDrawer(q.title, () => <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Pill cls="p-mute nodot">Версія {q.version}</Pill><Pill cls="p-mute nodot">{q.kind === "checklist" ? "Чек-лист" : QCAT[q.target_category]}</Pill><Pill cls="p-mute nodot">{nSec} {plural(nSec, "розділ", "розділи", "розділів")}, {nQ} {plural(nQ, "питання", "питання", "питань")}</Pill></div>
      {q.sections.map((s, i) => <section key={i} className="pv-sec">
        <div className="pv-sec-h"><span className="pv-num">{i + 1}</span><b className="pv-sec-t">{s.title}</b><span className="pv-cnt">{s.questions.length} {plural(s.questions.length, "питання", "питання", "питань")}</span></div>
        {s.questions.map((x, j) => <div key={j} className="pv-q">
          <div className="pv-qt"><span className="pv-qn">{j + 1}.</span> {x.text}</div>
          {x.options.length ? <ul className="pv-opts">{x.options.map((o, k) => <li key={k}><span className="pv-score">{fb(o.score)}</span><span>{o.text}</span></li>)}</ul> : <div className="s">Шкала від {x.scale_min} до {x.scale_max}</div>}
        </div>)}
      </section>)}
    </>);
  } catch (e) { apiFail(e); }
}
// Код анкети з назви: українська транслітерація, лише латиниця, цифри й дефіс
const BLD_TR = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "yu", я: "ya", "'": "", "’": "" };
const bldSlug = t => t.trim().toLowerCase().replace(/./g, c => BLD_TR[c] ?? c).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Створення нової анкети: коротка форма, далі конструктор
function bldNew() {
  openDrawer("Нова анкета", () => {
    const [title, setTitle] = useState(""), [code, setCode] = useState(""), [touched, setTouched] = useState(false), [g, setG] = useState("working_group"), [kind, setKind] = useState("survey"), [err, setErr] = useState("");
    const ok = async () => {
      const t = title.trim(), c = code.trim();
      if (!t) return setErr("Вкажіть назву.");
      if (!/^[a-z0-9_.-]+$/.test(c)) return setErr("Код: лише латиниця, цифри, дефіс і крапка.");
      try { const q = await api("/questionnaires", { method: "POST", body: { code: c, title: t, description: "", kind, target_category: g, sections: [] } }); closeDrawer(); const b = bldFromServer(q); b.sections = [bldNewSec()]; b.dirty = true; ui.bld = { b, n: Date.now() }; render(true); }
      catch (e) { setErr(apiErrText(e)); }
    };
    return <>
      <div className="field"><label htmlFor="bn-t">Назва</label><input className="inp" id="bn-t" placeholder="Наприклад, Анкета для курсантів" value={title} onChange={e => { setTitle(e.target.value); if (!touched) setCode(bldSlug(e.target.value)); }} /></div>
      <div className="field"><label htmlFor="bn-c">Код</label><input className="inp" id="bn-c" placeholder="kursanty-survey" value={code} onChange={e => { setCode(e.target.value); setTouched(true); }} /><span className="lbl">Латиницею, цифри, дефіс. За кодом пов'язуються версії анкети.</span></div>
      <div className="field"><label htmlFor="bn-g">Для кого</label><select className="inp" id="bn-g" value={g} onChange={e => setG(e.target.value)}>{Object.entries(QCAT).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
      <div className="field"><label htmlFor="bn-k">Вид</label><select className="inp" id="bn-k" value={kind} onChange={e => setKind(e.target.value)}><option value="survey">Анкета зрілості</option><option value="checklist">Чек-лист</option></select></div>
      <span className="lbl" id="bn-err" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>{err}</span>
      <button className="btn btn-primary" id="bn-ok" style={{ justifyContent: "center" }} onClick={ok}><Ic n="plus" />Створити й відкрити конструктор</button>
    </>;
  });
}

/* --- Чек-лист: вносить робоча група, підтверджує внутрішній аудит (policies.checklist_confirmers) --- */
function ApiChecklist() {
  if (!apiEnsure("ck", () => apiLoadCk())) return <Loading t="Чек-лист" />;
  const K = API.ck; if (K.error) return <Failed e={K.error} />;
  if (!K.camps.length) return <Empty t="Немає хвилі з чек-листом">Чек-лист зʼявиться, коли уповноважений відкриє хвилю з ним.</Empty>;
  const camp = K.camps.find(c => c.id === K.sel), open = camp && camp.status === "open";
  const conf = (API.cfg.policies && API.cfg.policies.checklist_confirmers) || ["auditor"];
  const ed = S.role === "checklist_editor" && open, ap = conf.includes(S.role) && open, D = K.data;
  const head = <section className="c12 rise toolbar">{D && <span className="lbl tnum">Внесено {D.filled} з {D.total} · підтверджено {D.confirmed}</span>}<div className="sp" />
    {K.camps.length > 1 ? <select className="inp" aria-label="Хвиля" value={K.sel} onChange={e => apiCkReload(e.target.value)}>{K.camps.map(c => <option key={c.id} value={c.id}>{dn(c.title)}</option>)}</select> : <span className="lbl">{camp ? camp.title : ""}</span>}</section>;
  if (!D) return <>{head}<Empty t="Чек-лист недоступний">{K.err || ""}</Empty></>;
  const asg = loadAsg(K.sel), AS = Object.fromEntries(((asg && asg.data) || []).map(a => [a.question_id, a]));
  const mine = it => !it.enterer_id || it.enterer_id === (API.user && API.user.id);
  return <>{head}{S.role === "auditor" && <LotteryCard campaignId={K.sel} status={camp && camp.status} />}
    <section className="card c12 rise"><div className="tbl-wrap"><table><thead><tr><th>Пункт</th><th>Компонент</th><th>Стан і доказ</th><th>Документи</th><th></th></tr></thead><tbody>
      {D.items.map(it => <tr key={it.question_id} id={`ck-${it.question_id}`}><td style={{ minWidth: 260 }}><div className="ck-txt" tabIndex={0} title="Натисніть, щоб розгорнути"><b style={{ fontWeight: 600 }}>{it.number}.</b> {it.text.replace(/^\d+(\.\d+)*\.\s*/, "")}</div></td>
        <td className="lbl">{COMPS.includes(it.component) && COMP[it.component].n}</td>
        <td style={{ minWidth: 240 }}><div className="ck-st"><span className="dot" style={{ background: it.status ? CKC[it.status] : "var(--faint)" }} /><span><b style={{ fontWeight: 500 }}>{it.status ? CKS[it.status][0] : "Не внесено"}</b>{it.status && <span className="lbl">{it.confirmed ? " · підтверджено" : " · не підтверджено"}</span>}{it.file_required && <span className="lbl ck-need"> · потрібен документ</span>}</span></div>{it.evidence && <div className="lbl" style={{ marginTop: 8, lineHeight: 1.45 }}>{it.evidence}</div>}{AS[it.question_id] && (AS[it.question_id].enterer || AS[it.question_id].confirmer) && <div className="lbl ck-who">{AS[it.question_id].enterer && <>Вносить: {dn(AS[it.question_id].enterer)}</>}{AS[it.question_id].enterer && AS[it.question_id].confirmer && " · "}{AS[it.question_id].confirmer && <>підтверджує: {dn(AS[it.question_id].confirmer)}</>}</div>}</td>
        <td className="lbl" style={{ minWidth: 160 }}>{it.files.length ? it.files.map(f => <div key={f.id}><a className="link" href="#checklist" onClick={e => { e.preventDefault(); apiDownload(K.sel, it.question_id, f.id, f.filename); }}>{f.filename}</a> <span className="hash" title={`sha256 ${f.sha256}`}>{f.sha256.slice(0, 10)}</span>{ed && <> <a className="link" href="#checklist" aria-label="Прибрати файл" onClick={e => { e.preventDefault(); apiDelFile(K.sel, it.question_id, f.id); }}>×</a></>}</div>) : it.status ? "Документа немає" : "–"}</td>
        <td style={{ whiteSpace: "nowrap" }}>{ed && mine(it) && <button className="btn btn-soft" style={{ padding: "6px 12px" }} onClick={() => apiEditItem(it.question_id)}><Ic n="edit" />{it.confirmed ? "Змінити (зніме підтвердження)" : it.status ? "Змінити" : "Внести"}</button>}{ap && it.status && (!it.confirmer_id || it.confirmer_id === (API.user && API.user.id)) ? (it.confirmed ? <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={() => apiConfirm(it.question_id, false)}>Відкликати</button> : it.file_required ? <span data-tip="Без документа пункт підтвердити не можна. Попросіть робочу групу додати документ."><button className="btn btn-primary" style={{ padding: "6px 12px" }} disabled><Ic n="ok" />Підтвердити</button></span>
          : <button className="btn btn-primary" style={{ padding: "6px 12px" }} onClick={() => apiConfirm(it.question_id, true)}><Ic n="ok" />Підтвердити</button>) : null}</td></tr>)}
    </tbody></table></div></section>
  </>;
}
function apiEditItem(qid) {
  const it = API.ck.data.items.find(x => x.question_id === qid), camp = API.ck.sel;
  openDrawer("Внести пункт чек-листа", () => {
    const [st, setSt] = useState(it.status), [ev, setEv] = useState(it.evidence || ""), [cm, setCm] = useState(it.comment || ""), [files, setFiles] = useState([]), [err, setErr] = useState(""), [busy, setBusy] = useState(false), E = API.cfg.evidence, needDoc = requireFile() && (st === "full" || st === "partial");
    const ok = async () => {
      if (!st) return setErr("Оберіть статус.");
      setBusy(true); setErr("");
      try {
        await apiSaveItem(camp, qid, { status: st, evidence: ev.trim(), comment: cm.trim() }, files);
        toast(files.length ? `Пункт ${it.number} збережено, документів додано: ${files.length}` : `Пункт ${it.number} збережено`);
        closeDrawer(); apiCkReload(camp);
      } catch (e) { setErr(apiErrText(e)); setBusy(false); } // нічого не змінилось: форма лишається заповненою
    };
    return <>
      <div><div className="lbl">Пункт {it.number}</div><div style={{ fontWeight: 600, marginTop: 4 }}>{it.text}</div></div>
      {it.indicator && <div className="lbl">{it.indicator}</div>}
      <div className="field"><label>Статус</label><div className="seg" id="e-st">{Object.entries(CKS).map(([k, [n]]) => <button key={k} type="button" className={st === k ? "on" : ""} onClick={() => setSt(k)}>{n}</button>)}</div></div>
      <div className="field"><label>Документи-підтвердження{needDoc && <span className="req"> (обовʼязково)</span>}</label>
        {it.files.length > 0 && <div className="fd-list">{it.files.map(f => <div key={f.id} className="fd-row"><Ic n="file" /><a className="link grow" href="#checklist" onClick={e => { e.preventDefault(); apiDownload(camp, qid, f.id, f.filename); }}>{f.filename}</a><span className="lbl">уже додано</span></div>)}</div>}
        <FileDrop files={files} onChange={setFiles} exts={E.allowed_extensions} maxBytes={E.max_bytes} maxFiles={E.max_files_per_item} already={it.files.length} hint={`Наказ, протокол, скан, фото; до ${Math.round(E.max_bytes / 1048576)} МБ.`} />
        {needDoc && !it.files.length && !files.length ? <span className="lbl fd-err">Без документа зберегти можна, але аудит такий пункт не підтвердить.</span>
          : <span className="lbl">Новий документ знімає підтвердження пункту: його перевірять ще раз.</span>}</div>
      <div className="field"><label htmlFor="e-ev">Опис доказу</label><textarea className="inp" id="e-ev" rows="2" placeholder="Наприклад, наказ № 45 від 03.11.2026, с. 2" value={ev} onChange={e => setEv(e.target.value)} /></div>
      <div className="field"><label htmlFor="e-cm">Коментар</label><input className="inp" id="e-cm" value={cm} onChange={e => setCm(e.target.value)} /></div>
      <span className="lbl" id="e-err" style={{ color: "color-mix(in srgb, var(--red) 60%, var(--fg))" }}>{err}</span>
      <button className="btn btn-primary" id="e-ok" style={{ justifyContent: "center" }} disabled={busy} onClick={ok}><Ic n="send" />{busy ? "Зберігаю…" : "Зберегти"}</button>
    </>;
  });
}

const CKC = { full: "var(--teal)", partial: "var(--amber)", none: "var(--red)" };
/* --- Журнал --- */
function ApiAudit() {
  if (!apiEnsure("log", apiLoadLog)) return <Loading t="Журнал" />;
  if (API.log.error) return <Failed e={API.log.error} />;
  const { rows, units, users } = API.log, F = { q: "", ent: "all", who: "all", ...API.logF };
  const set = (k, v) => { API.logF = { ...(API.logF || {}), [k]: v }; API.logLim = 50; render(true); };
  const lim = API.logLim || 50;
  // Ім'я з відповіді журналу (actor_display), якщо сервер його дає: аудиту список користувачів недоступний
  const disp = Object.fromEntries(rows.filter(x => x.actor_id && x.actor_display).map(x => [x.actor_id, x.actor_display]));
  const who = id => { if (disp[id]) return dn(disp[id]) + (API.user && id === API.user.id ? " (ви)" : ""); const u = users.find(u => u.id === id); return u ? dn(u.display_name) + (API.user && u.id === API.user.id ? " (ви)" : "") : id ? `Користувач ${(unk[id] ??= Object.keys(unk).length + 1)}` : "Система"; }, unk = {};
  const act = x => AUDIT_ACT[`${x.entity}:${x.action}`] || `${AUDIT_ENT[x.entity] || x.entity}: ${x.action}`;
  const fmt = at => new Date(at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
  const items = rows.map(x => ({ x, a: act(x), w: who(x.actor_id), d: auditDetails(x, units), t: fmt(x.at) }));
  const q = (F.q || "").trim().toLowerCase();
  const shown = items.filter(i => (F.ent === "all" || i.x.entity === F.ent) && (F.who === "all" || i.x.actor_id === F.who) && (!q || `${i.a} ${i.w} ${i.d} ${i.t} ${i.x.seq} ${i.x.hash}`.toLowerCase().includes(q)));
  const groups = []; shown.forEach(i => { const g = groups[groups.length - 1]; if (g && g[0].a === i.a && g[0].w === i.w && g[0].d === i.d) g.push(i); else groups.push([i]); });
  const ents = [...new Set(rows.map(x => x.entity))].sort((a, b) => (AUDIT_ENT[a] || a).localeCompare(AUDIT_ENT[b] || b, "uk"));
  const actors = [...new Set(rows.map(x => x.actor_id).filter(Boolean))].map(id => [id, who(id)]).sort((a, b) => a[1].localeCompare(b[1], "uk"));
  return <><AnchorCard /><section className="card c12 rise">
    <div className="card-h" style={{ flexWrap: "wrap" }}><h2>Журнал дій</h2><div className="sp" /><span id="chainSt">{API.chain && <Pill cls={API.chain.ok ? "p-good" : "p-bad"}>{API.chain.ok ? `Ланцюг цілісний: перевірено ${API.chain.checked} записів` : `Ланцюг порушено на записі № ${API.chain.broken_seq}`}</Pill>}</span><button className="btn btn-soft" onClick={apiVerify}><Ic n="shield" />Перевірити цілісність</button></div>
    <div className="toolbar" style={{ marginBottom: 8 }}><label className="search inst-search"><span><Ic n="search" /></span><input id="logQ" placeholder="Дія, хто, підрозділ, дата або хеш" value={F.q || ""} onChange={e => set("q", e.target.value)} /></label>
      <select className="inp" aria-label="Тип дії" value={F.ent} onChange={e => set("ent", e.target.value)}><option value="all">Усі дії</option>{ents.map(e => <option key={e} value={e}>{AUDIT_ENT[e] || e}</option>)}</select>
      {actors.length > 0 && <select className="inp" aria-label="Хто" value={F.who} onChange={e => set("who", e.target.value)}><option value="all">Усі користувачі</option>{actors.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
      <span className="lbl tnum">Показано {shown.length} з {rows.length}</span></div>
    {groups.length ? <><div className="tl">{groups.slice(0, lim).map((g, i) => { const f = g[0], l = g[g.length - 1]; return <div key={f.x.seq} className="tl-i rise" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}><span className="nd" /><div><div style={{ fontWeight: 500 }}>{f.a}{g.length > 1 && <> <span className="pill p-mute nodot">×{g.length}</span></>}</div><div className="lbl">{f.w} · {g.length > 1 ? `${l.t} – ${f.t}` : f.t}{f.d ? " · " + f.d : ""}</div></div><span className="hash" data-tip={`Запис № ${f.x.seq}`}>{f.x.hash.slice(0, 10)}</span></div>; })}</div>
      {groups.length > lim && <button type="button" className="btn btn-soft" style={{ marginTop: 12 }} onClick={() => { API.logLim = lim + 50; render(true); }}>Показати ще {Math.min(50, groups.length - lim)} з {groups.length - lim}</button>}</> : <div className="empty">Записів за цим запитом немає.</div>}
  </section></>;
}
