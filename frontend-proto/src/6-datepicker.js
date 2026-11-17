// Власний вибір дати (замість <input type="date">). Обробники делеговані на document.
const DP_MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const DP_WD = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];
let dpOpen = null; // { el, y, m } - одне відкрите вікно за раз

// Чиста логіка сітки місяця (m: 0-11). shift = кількість порожніх клітинок перед 1-м числом (тиждень з понеділка).
function dpGrid(y, m) {
  const shift = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < shift; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return { shift, days, cells };
}
function dpIso(y, m, d) { return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function dpFmt(iso) { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; }

function datePicker(id, value, min) {
  return `<div class="dp" id="${id}" data-val="${value}" data-min="${min}"><button type="button" class="inp dp-field" aria-haspopup="dialog" aria-expanded="false"><span class="dp-txt">${value ? dpFmt(value) : "ДД.ММ.РРРР"}</span><span class="dp-ic">${IC.cal}</span></button></div>`;
}

function dpRender() {
  const { el, y, m, pop } = dpOpen;
  const min = el.dataset.min || "";
  const sel = el.dataset.val || "";
  const cells = dpGrid(y, m).cells.map(d => {
    if (d === null) return "<span></span>";
    const iso = dpIso(y, m, d);
    const cls = ["dp-day"];
    if (iso === sel) cls.push("is-sel");
    if (iso === TODAY) cls.push("is-today");
    return `<button type="button" class="${cls.join(" ")}" data-iso="${iso}"${min && iso < min ? " disabled" : ""}>${d}</button>`;
  }).join("");
  pop.innerHTML = `<div class="dp-head"><button type="button" class="dp-nav" data-nav="-1" aria-label="Попередній місяць">‹</button><b class="dp-title">${DP_MONTHS[m]} ${y}</b><button type="button" class="dp-nav" data-nav="1" aria-label="Наступний місяць">›</button></div><div class="dp-wd">${DP_WD.map(w => `<span>${w}</span>`).join("")}</div><div class="dp-grid">${cells}</div><div class="dp-foot"><button type="button" class="dp-today" data-today="1"${min && TODAY < min ? " disabled" : ""}>Сьогодні</button></div>`;
}

function dpOpenAt(dp) {
  dpClose();
  const [y, m] = (dp.dataset.val || TODAY).split("-").map(Number);
  dp.querySelector(".dp-field").setAttribute("aria-expanded", "true");
  const pop = document.createElement("div");
  pop.className = "dp-pop";
  pop.setAttribute("role", "dialog");
  document.body.appendChild(pop); // у body, щоб бічна панель з прокруткою й transform не обрізала вікно
  dpOpen = { el: dp, y, m: m - 1, pop };
  dpRender();
  // fixed: вікно не обрізається прокруткою бічної панелі; відкривається вгору, якщо знизу немає місця
  const r = dp.getBoundingClientRect(), pw = pop.offsetWidth, ph = 340, z = parseFloat(document.documentElement.style.zoom) || 1;
  const vw = window.innerWidth / z, vh = window.innerHeight / z, rb = r.bottom / z, rt = r.top / z;
  pop.style.left = Math.max(8, Math.min(r.left / z, vw - pw - 8)) + "px";
  pop.style.top = (rb + 6 + ph > vh && rt - 6 - ph > 0 ? rt - 6 - ph : rb + 6) + "px";
}

function dpClose(focus) {
  if (!dpOpen) return;
  const fld = dpOpen.el.querySelector(".dp-field");
  dpOpen.pop.remove();
  fld.setAttribute("aria-expanded", "false");
  dpOpen = null;
  if (focus) fld.focus();
}

function dpSelect(iso) {
  const el = dpOpen.el;
  el.dataset.val = iso;
  el.querySelector(".dp-txt").textContent = dpFmt(iso);
  dpClose(true);
}

document.addEventListener("click", e => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const fld = t.closest(".dp-field");
  if (fld) {
    const dp = fld.closest(".dp");
    const was = dpOpen && dpOpen.el === dp;
    dpClose();
    if (!was) dpOpenAt(dp);
    return;
  }
  if (!dpOpen) return;
  if (!dpOpen.el.contains(t) && !dpOpen.pop.contains(t)) { dpClose(); return; }
  const nav = t.closest("[data-nav]");
  if (nav) {
    const step = Number(nav.dataset.nav);
    dpOpen.m += step;
    if (dpOpen.m < 0) { dpOpen.m = 11; dpOpen.y--; }
    if (dpOpen.m > 11) { dpOpen.m = 0; dpOpen.y++; }
    dpRender();
    dpOpen.pop.querySelector(`[data-nav="${step}"]`).focus();
    return;
  }
  const day = t.closest("[data-iso]");
  if (day && !day.disabled) { dpSelect(day.dataset.iso); return; }
  const today = t.closest("[data-today]");
  if (today && !today.disabled) dpSelect(TODAY);
});

// Capture-фаза: Escape закриває лише вікно дати, а не драбину (5-ai-router.js слухає Escape на document).
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && dpOpen) { e.stopImmediatePropagation(); dpClose(true); }
}, true);

// Вікно прив'язане до екрана (fixed): під час прокрутки чи зміни розміру просто закриваємо
document.addEventListener("scroll", e => { if (dpOpen && !(e.target.closest && e.target.closest(".dp-pop"))) dpClose(); }, true);
addEventListener("resize", () => dpClose());
