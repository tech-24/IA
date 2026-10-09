// ==================================================================
// date-range-picker.js — اختيار فترة زمنية من نافذة واحدة:
// أزرار سريعة (اليوم، أمس، آخر 7 أيام، هذا الشهر، الشهر الماضي، كل الوقت)
// + تقويم ميلادي: اضغط البداية ثم النهاية
// يُستخدم في visits-view.html و visits.html
//
// الحالة (state): { preset: "this_month" } أو { preset: "custom", from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// ==================================================================

const DRP_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const DRP_WEEKDAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const DRP_PRESETS = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "last7", label: "آخر 7 أيام" },
  { key: "this_month", label: "هذا الشهر" },
  { key: "last_month", label: "الشهر الماضي" },
  { key: "all_time", label: "كل الوقت" },
];

function drpYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function drpParse(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// تحوّل الحالة إلى حدود الفترة { from, to } بصيغة YYYY-MM-DD (فارغة = بلا حد)
function resolveDateRange(state) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (state.preset) {
    case "today":
      return { from: drpYmd(today), to: drpYmd(today) };
    case "yesterday": {
      const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      return { from: drpYmd(y), to: drpYmd(y) };
    }
    case "last7":
      return { from: drpYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), to: drpYmd(today) };
    case "this_month":
      return { from: drpYmd(new Date(now.getFullYear(), now.getMonth(), 1)), to: drpYmd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case "last_month":
      return { from: drpYmd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: drpYmd(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case "all_time":
      return { from: "", to: "" };
    default:
      return { from: state.from || "", to: state.to || "" };
  }
}

// نص يصف الفترة (للزر ولملخص التصدير)
function describeDateRange(state) {
  const preset = DRP_PRESETS.find((p) => p.key === state.preset);
  if (preset) return preset.label;
  const f = (state.from || "").replaceAll("-", "/");
  const t = (state.to || "").replaceAll("-", "/");
  if (f && t) return f === t ? f : `${f} – ${t}`;
  return f || t || "كل الوقت";
}

const DRP_ICONS = {
  calendar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
  right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
  left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
};

// -------------------------------------------------
// ينشئ الأداة على زر موجود بالصفحة.
// button: عنصر الزر الذي يعرض الفترة الحالية ويفتح النافذة
// initialState: الحالة الابتدائية
// onChange(state): يُستدعى بعد كل اختيار
// -------------------------------------------------
function createDateRangePicker(button, initialState, onChange) {
  let state = initialState;
  let viewYear, viewMonth;       // الشهر المعروض بالتقويم
  let pendingStart = null;        // أول ضغطة بالتقويم (بانتظار النهاية)

  const overlay = document.createElement("div");
  overlay.className = "drp-overlay";
  overlay.style.display = "none";
  overlay.innerHTML =
    '<div class="drp-box" role="dialog" aria-modal="true">' +
    '<div class="drp-chips"></div>' +
    '<div class="drp-nav">' +
    `<button type="button" class="drp-nav-btn" data-nav="-1" aria-label="الشهر السابق">${DRP_ICONS.right}</button>` +
    '<div class="drp-month-title"></div>' +
    `<button type="button" class="drp-nav-btn" data-nav="1" aria-label="الشهر التالي">${DRP_ICONS.left}</button>` +
    "</div>" +
    '<div class="drp-weekdays"></div>' +
    '<div class="drp-grid"></div>' +
    '<div class="drp-hint"></div>' +
    '<button type="button" class="secondary drp-close" style="width:100%;margin-top:10px">إغلاق</button>' +
    "</div>";
  document.body.appendChild(overlay);

  const chipsEl = overlay.querySelector(".drp-chips");
  const titleEl = overlay.querySelector(".drp-month-title");
  const gridEl = overlay.querySelector(".drp-grid");
  const hintEl = overlay.querySelector(".drp-hint");

  overlay.querySelector(".drp-weekdays").innerHTML = DRP_WEEKDAYS.map((d) => `<span>${d}</span>`).join("");

  function updateButton() {
    button.innerHTML = `<span class="drp-btn-label">${DRP_ICONS.calendar}<span></span></span>`;
    button.querySelector(".drp-btn-label span").textContent = describeDateRange(state);
  }

  function apply(newState) {
    state = newState;
    pendingStart = null;
    updateButton();
    overlay.style.display = "none";
    onChange(state);
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    DRP_PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "drp-chip" + (state.preset === p.key ? " active" : "");
      b.textContent = p.label;
      b.addEventListener("click", () => apply({ preset: p.key }));
      chipsEl.appendChild(b);
    });
  }

  function renderCalendar() {
    titleEl.textContent = `${DRP_MONTHS[viewMonth]} ${viewYear}`;
    gridEl.innerHTML = "";

    // الفترة المظللة: الاختيار الجاري (بداية فقط) أو الفترة المطبّقة حاليًا
    let selFrom = "", selTo = "";
    if (pendingStart) { selFrom = pendingStart; selTo = pendingStart; }
    else if (state.preset === "custom") { selFrom = state.from; selTo = state.to; }

    const first = new Date(viewYear, viewMonth, 1);
    const offset = first.getDay(); // 0 = الأحد (أول عمود من اليمين)
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayStr = drpYmd(new Date());

    for (let i = 0; i < offset; i++) gridEl.appendChild(document.createElement("span"));

    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = drpYmd(new Date(viewYear, viewMonth, day));
      const b = document.createElement("button");
      b.type = "button";
      b.className = "drp-day";
      b.textContent = String(day);
      if (ymd === todayStr) b.classList.add("today");
      if (selFrom && selTo) {
        if (ymd === selFrom) b.classList.add("edge");
        if (ymd === selTo) b.classList.add("edge");
        if (ymd > selFrom && ymd < selTo) b.classList.add("in-range");
      }
      b.addEventListener("click", () => onDayClick(ymd));
      gridEl.appendChild(b);
    }

    hintEl.textContent = pendingStart ? "اختر نهاية الفترة" : "اختر بداية الفترة";
  }

  function onDayClick(ymd) {
    if (!pendingStart) {
      pendingStart = ymd;
      renderCalendar();
      return;
    }
    let from = pendingStart, to = ymd;
    if (to < from) [from, to] = [to, from]; // لو اختار النهاية قبل البداية نقلبهما تلقائيًا
    apply({ preset: "custom", from, to });
  }

  function openPicker() {
    pendingStart = null;
    const base = state.preset === "custom" && state.from ? drpParse(state.from) : new Date();
    viewYear = base.getFullYear();
    viewMonth = base.getMonth();
    renderChips();
    renderCalendar();
    overlay.style.display = "flex";
  }

  overlay.querySelectorAll(".drp-nav-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const d = new Date(viewYear, viewMonth + Number(b.dataset.nav), 1);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      renderCalendar();
    });
  });
  overlay.querySelector(".drp-close").addEventListener("click", () => { overlay.style.display = "none"; });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });
  button.addEventListener("click", openPicker);

  updateButton();
  return { getState: () => state };
}
