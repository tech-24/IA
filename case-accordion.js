// ==================================================================
// case-accordion.js — عرض الحالات كصفوف مستطيلة تنفتح عند الضغط
// يُستخدم في case-view.html (المفتش) و cases.html (المشرف)
// يتطلب تحميل auth.js قبله (escapeHtml)
// ترتيب المحتوى عند الفتح: الصور، الملاحظة، طريقة الرصد، التنبيه (آخر شي)
// ==================================================================

(function injectLightbox() {
  // نافذة تكبير الصورة بملء الشاشة، مع السحب يمين/يسار بين صور نفس الحالة
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.style.display = "none";
  overlay.innerHTML =
    '<button type="button" class="lightbox-close" aria-label="إغلاق">' +
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
    "</button><img alt=\"\" />";
  document.body.appendChild(overlay);

  const img = overlay.querySelector("img");
  let images = [];
  let index = 0;

  function show() { img.src = images[index].image_url; }
  function close() { overlay.style.display = "none"; img.src = ""; }

  window.openCaseLightbox = function (list, i) {
    images = list;
    index = i;
    show();
    overlay.style.display = "flex";
  };

  overlay.querySelector(".lightbox-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  let startX = null;
  overlay.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  overlay.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (dx <= -40 && index < images.length - 1) { index++; show(); }
    else if (dx >= 40 && index > 0) { index--; show(); }
  });
})();

const ACC_ICONS = {
  chevron: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
  placeholder: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  warning: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
};

async function copyCaseText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // بعض المتصفحات بدون HTTPS لا تدعم الحافظة، فنستخدم طريقة بديلة
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    document.body.removeChild(helper);
  }
}

// -------------------------------------------------
// تبني صف حالة واحد. opts.onEdit (اختياري) يضيف زر "تعديل" للمشرف
// -------------------------------------------------
function buildCaseAccordion(c, opts) {
  opts = opts || {};
  const images = c.case_images || [];
  const hasNote = c.note && c.note.trim();
  const hasWarning = c.warning && c.warning.trim();

  const row = document.createElement("div");
  row.className = "case-acc";

  // ---- الرأس: صورة مصغّرة + الاسم + سهم ----
  const head = document.createElement("button");
  head.type = "button";
  head.className = "case-acc-head";
  head.setAttribute("aria-expanded", "false");

  const thumb = document.createElement("span");
  thumb.className = "case-acc-thumb";
  if (images[0]) thumb.innerHTML = `<img src="${escapeHtml(images[0].image_url)}" alt="" />`;
  else thumb.innerHTML = ACC_ICONS.placeholder;

  const title = document.createElement("span");
  title.className = "case-acc-title";
  title.textContent = c.name;

  const chev = document.createElement("span");
  chev.className = "case-acc-chevron";
  chev.innerHTML = ACC_ICONS.chevron;

  head.appendChild(thumb);
  head.appendChild(title);
  head.appendChild(chev);

  // ---- المحتوى المنسدل ----
  const body = document.createElement("div");
  body.className = "case-acc-body";

  // 1) الصور
  const imgRow = document.createElement("div");
  imgRow.className = "case-images-row";
  if (images.length === 0) {
    imgRow.innerHTML = '<div class="empty-hint" style="padding:0">لا توجد صور لهذه الحالة.</div>';
  } else {
    images.forEach((img, i) => {
      const slot = document.createElement("div");
      slot.className = "case-image-slot";
      slot.style.cursor = "zoom-in";
      slot.innerHTML = `<img src="${escapeHtml(img.image_url)}" alt="" />`;
      slot.addEventListener("click", () => openCaseLightbox(images, i));
      imgRow.appendChild(slot);
    });
  }
  body.appendChild(imgRow);

  // 2) الملاحظة (مع زر النسخ)
  if (hasNote) {
    const wrap = document.createElement("div");
    wrap.className = "case-acc-section";
    wrap.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">' +
      '<label class="case-acc-label">ملاحظة</label>' +
      `<button type="button" class="secondary copy-note-btn">${ACC_ICONS.copy} نسخ</button>` +
      "</div>" +
      '<p class="case-acc-text" data-role="note"></p>' +
      '<span class="case-acc-copied" style="display:none">تم النسخ</span>';
    wrap.querySelector('[data-role="note"]').textContent = c.note;
    const btn = wrap.querySelector(".copy-note-btn");
    const confirmEl = wrap.querySelector(".case-acc-copied");
    let timer = null;
    btn.addEventListener("click", async () => {
      await copyCaseText(c.note);
      confirmEl.style.display = "inline";
      clearTimeout(timer);
      timer = setTimeout(() => { confirmEl.style.display = "none"; }, 1800);
    });
    body.appendChild(wrap);
  }

  // 3) طريقة الرصد
  const method = document.createElement("div");
  method.className = "case-acc-section";
  method.innerHTML = '<label class="case-acc-label">طريقة الرصد الصحيحة</label><p class="case-acc-text"></p>';
  method.querySelector("p").textContent = c.monitoring_method || "لا يوجد شرح مضاف لهذه الحالة.";
  body.appendChild(method);

  // 4) التنبيه (آخر شي)
  if (hasWarning) {
    const warn = document.createElement("div");
    warn.className = "case-warning-box";
    warn.style.marginTop = "10px";
    warn.innerHTML =
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">${ACC_ICONS.warning}` +
      '<strong style="color:#B91C1C;font-size:14px">تنبيه</strong></div>' +
      '<p style="color:#7F1D1D;font-size:14px;line-height:1.8;white-space:pre-wrap;margin:0"></p>';
    warn.querySelector("p").textContent = c.warning;
    body.appendChild(warn);
  }

  // زر التعديل للمشرف
  if (typeof opts.onEdit === "function") {
    const actions = document.createElement("div");
    actions.style.marginTop = "14px";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.style.width = "100%";
    editBtn.textContent = "تعديل الحالة";
    editBtn.addEventListener("click", () => opts.onEdit(c));
    actions.appendChild(editBtn);
    body.appendChild(actions);
  }

  // ---- حالة وحيدة: تبقى مفتوحة دائمًا بدون سهم ولا طي (opts.alwaysOpen) ----
  if (opts.alwaysOpen) {
    row.classList.add("open", "locked");
    head.setAttribute("aria-expanded", "true");
    head.disabled = true;
    row.appendChild(head);
    row.appendChild(body);
    return row;
  }

  // ---- الفتح والإغلاق: صف واحد مفتوح في كل مرة ----
  head.addEventListener("click", () => {
    const willOpen = !row.classList.contains("open");
    const list = row.parentElement;
    if (list) {
      list.querySelectorAll(".case-acc.open").forEach((r) => {
        r.classList.remove("open");
        const h = r.querySelector(".case-acc-head");
        if (h) h.setAttribute("aria-expanded", "false");
      });
    }
    if (willOpen) {
      row.classList.add("open");
      head.setAttribute("aria-expanded", "true");
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  row.appendChild(head);
  row.appendChild(body);
  return row;
}
