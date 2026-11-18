// ==================================================================
// report-pdf.js — توليد ملف PDF للمحضر بالكتابة مباشرة على ملف النموذج الأصلي (report-template.pdf)، وتنزيله أو مشاركته
// يتطلب: reports.js (دوال التاريخ و isSafeSignature) ووجود report-template.pdf بجانب الصفحة
//
// طريقة العمل: نرسم القيم والتواقيع على طبقة شفافة (Canvas، فالمتصفح نفسه يشكّل الحروف العربية ويوصلها)
// بنفس مقاس صفحة النموذج، ثم نلصقها فوق صفحة النموذج الأصلي بمكتبة pdf-lib (تُحمَّل من jsDelivr عند أول استخدام).
// الإحداثيات كلها بالنقطة (pt) وتُقاس من أعلى يسار الصفحة، ومقاسة من ملف النموذج نفسه؛
// لو تغيّر تصميم النموذج لازم تُعاد معايرتها (الكائن RT).
// ==================================================================

const RP_FAMILY = '"Tajawal", "Tahoma", "Segoe UI", sans-serif';

function rpFont(size, weight) {
  return `${weight} ${size}px ${RP_FAMILY}`;
}

// -------------------------------------------------
// تحميل صور التواقيع وانتظار الخطوط
// -------------------------------------------------
function rpLoadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // صورة ناقصة لا توقف التوليد
    img.src = src;
  });
}

async function rpWaitFonts() {
  try {
    if (document.fonts && document.fonts.load) {
      const sample = "محضر إثبات واقعة 0123456789";
      await Promise.all([
        document.fonts.load(rpFont(16, 400), sample),
        document.fonts.load(rpFont(16, 700), sample),
      ]);
      await document.fonts.ready;
    }
  } catch (e) {
    // لو تعذر تحميل الخط نكمل بالخط الاحتياطي
  }
}

// -------------------------------------------------
// إعدادات الكتابة على النموذج
// -------------------------------------------------
const RT_FILE = "report-template.pdf";
const RT_PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const RT_SCALE = 3.5; // بكسل لكل نقطة بطبقة الكتابة
const RT_INK = "#0d0d0d";
const RT_RAISE = 2; // رفع القيمة فوق خط النقاط حتى تبقى النقاط ظاهرة تحتها

// مواضع الخانات (x1..x2 بالنقطة، base = مستوى خط النقاط/السطر من أعلى الصفحة)
const RT = {
  w: 595.32,
  h: 841.92,
  weekday: { x: [433, 490], base: 224 },
  hijri: { base: 224, day: [366, 392], month: [318, 359], year: [288, 311] },
  greg: { base: 224, day: [176, 200], month: [128, 167], year: [97, 120] },
  sector: { x: [350, 446], base: 259.5 },
  entity: { x: [76, 253], base: 259.5, extraBase: 272 },
  location: { x: [364, 501], base: 295 },
  time: { x: [309, 372], base: 352.5 },
  // أسباب المنع: سطر منقط واحد بالنموذج (base) وحوله مساحة لسطرين إضافيين
  reasons: { x: [92, 540], base: 432, minY: 413, maxY: 450 },
  insp: {
    name: { x: [388, 503], base: 616.5 },
    sig: { x: [390, 498], base: 643.5 },
    date: { base: 670, day: [478, 504], month: [440, 471], year: [397, 433] },
  },
  rep: {
    name: { x: [101, 216], base: 636.8 },
    job: { x: [91, 205], base: 662.2 },
    sig: { x: [101, 209], base: 689.2 },
    date: { base: 715.8, day: [190, 218], month: [153, 185], year: [110, 147] },
  },
};

// -------------------------------------------------
// تحميل pdf-lib عند الحاجة
// -------------------------------------------------
let rtPdfLibPromise = null;
function rtLoadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!rtPdfLibPromise) {
    rtPdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = RT_PDFLIB_URL;
      s.onload = () => (window.PDFLib ? resolve(window.PDFLib) : reject(new Error("تعذّر تجهيز مكتبة PDF")));
      s.onerror = () => {
        rtPdfLibPromise = null;
        reject(new Error("تعذّر تحميل مكتبة PDF، تأكد من الاتصال بالإنترنت وحاول مرة أخرى"));
      };
      document.head.appendChild(s);
    });
  }
  return rtPdfLibPromise;
}

let rtTemplatePromise = null;
function rtGetTemplate() {
  if (!rtTemplatePromise) {
    rtTemplatePromise = rtFetchTemplate().catch((e) => {
      rtTemplatePromise = null;
      throw e;
    });
  }
  return rtTemplatePromise;
}

async function rtFetchTemplate() {
  let res;
  try {
    res = await fetch(RT_FILE);
  } catch (e) {
    throw new Error("تعذّر تحميل ملف النموذج الأصلي");
  }
  if (!res.ok) throw new Error("ملف النموذج الأصلي (report-template.pdf) غير موجود بجانب الصفحة");
  return new Uint8Array(await res.arrayBuffer());
}

// -------------------------------------------------
// أدوات الرسم على الطبقة
// -------------------------------------------------
function rtFont(size) {
  return `700 ${size}px ${RP_FAMILY}`;
}

function rtWidth(ctx, text, size, dir) {
  ctx.font = rtFont(size);
  ctx.direction = dir || "rtl";
  return ctx.measureText(text).width;
}

// يقص النص بنقاط ثلاث لو أطول من العرض
function rtEllipsize(ctx, text, size, maxW, dir) {
  if (rtWidth(ctx, text, size, dir) <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && rtWidth(ctx, chars.join("") + "…", size, dir) > maxW) chars.pop();
  return chars.join("").trimEnd() + "…";
}

// يكتب نصًا متوسّطًا داخل خانة، وينزّل حجم الخط لو لم يكفِ. يرجع false لو اضطر لقصّه
function rtFill(ctx, text, [x1, x2], base, o) {
  o = o || {};
  text = String(text == null ? "" : text).trim();
  if (!text) return true;
  const dir = o.dir || "rtl";
  const maxW = x2 - x1 - 2;
  let size = o.size || 12;
  const min = o.min || 8;
  while (size > min && rtWidth(ctx, text, size, dir) > maxW) size -= 0.5;
  let out = text;
  let ok = true;
  if (rtWidth(ctx, text, size, dir) > maxW) {
    out = rtEllipsize(ctx, text, size, maxW, dir);
    ok = false;
  }
  ctx.font = rtFont(size);
  ctx.direction = dir;
  ctx.textAlign = "center";
  ctx.fillStyle = RT_INK;
  ctx.fillText(out, (x1 + x2) / 2, base - (o.raise == null ? RT_RAISE : o.raise));
  return ok;
}

// تقسيم نص لأسطر بعرض محدد (بالكلمات)
function rtWrapText(ctx, text, size, maxW) {
  const lines = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        return;
      }
      let cur = "";
      words.forEach((word) => {
        // كلمة أطول من السطر: نقسمها بالحروف
        const pieces = [];
        if (rtWidth(ctx, word, size) > maxW) {
          let part = "";
          for (const ch of word) {
            if (part && rtWidth(ctx, part + ch, size) > maxW) {
              pieces.push(part);
              part = ch;
            } else part += ch;
          }
          if (part) pieces.push(part);
        } else pieces.push(word);
        pieces.forEach((piece, i) => {
          const test = cur && i === 0 ? cur + " " + piece : piece;
          if (cur && (i > 0 || rtWidth(ctx, test, size) > maxW)) {
            lines.push(cur);
            cur = piece;
          } else cur = test;
        });
      });
      if (cur) lines.push(cur);
    });
  return lines;
}

// سطر منقط بنفس شكل نقاط النموذج
function rtDots(ctx, x1, x2, base) {
  ctx.save();
  ctx.fillStyle = "#222222";
  for (let x = x1; x <= x2; x += 2.736) {
    ctx.beginPath();
    ctx.arc(x, base - 0.6, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// يرسم صورة التوقيع بعد قص الهوامش الشفافة حولها، داخل مستطيل محدد وفوق خط
function rtDrawSignature(ctx, img, [x1, x2], bottom, maxH) {
  if (!img) return;
  const tmp = document.createElement("canvas");
  tmp.width = img.naturalWidth;
  tmp.height = img.naturalHeight;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(img, 0, 0);
  const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
  let minX = tmp.width, minY = tmp.height, maxX = -1, maxY = -1;
  for (let y = 0; y < tmp.height; y++) {
    for (let x = 0; x < tmp.width; x++) {
      if (data[(y * tmp.width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return; // لوحة فاضية
  const sw = maxX - minX + 1;
  const sh = maxY - minY + 1;
  const sc = Math.min((x2 - x1) / sw, maxH / sh);
  const dw = sw * sc;
  const dh = sh * sc;
  ctx.drawImage(tmp, minX, minY, sw, sh, (x1 + x2) / 2 - dw / 2, bottom - dh, dw, dh);
}

// -------------------------------------------------
// رسم الطبقة كاملة
// -------------------------------------------------
async function renderTemplateOverlay(report) {
  const d = report.data || {};
  const notes = [];
  const [inspectorSig, repSig] = await Promise.all([
    rpLoadImage(isSafeSignature(report.inspector_signature) ? report.inspector_signature : null),
    rpLoadImage(isSafeSignature(report.rep_signature) ? report.rep_signature : null),
  ]);
  await rpWaitFonts();

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(RT.w * RT_SCALE);
  canvas.height = Math.round(RT.h * RT_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RT_SCALE, RT_SCALE);
  ctx.textBaseline = "alphabetic";

  const when = new Date(report.occurred_at);
  const g = reportGregorianParts(when);
  const h = reportHijriParts(when);

  // ---------- السطر الأول: اليوم والتاريخان ----------
  rtFill(ctx, reportWeekday(when), RT.weekday.x, RT.weekday.base);
  if (h) {
    rtFill(ctx, h.day, RT.hijri.day, RT.hijri.base, { dir: "ltr" });
    rtFill(ctx, h.month, RT.hijri.month, RT.hijri.base, { dir: "ltr" });
    rtFill(ctx, h.year.slice(2), RT.hijri.year, RT.hijri.base, { dir: "ltr" }); // النموذج مطبوع عليه 14
  }
  rtFill(ctx, g.day, RT.greg.day, RT.greg.base, { dir: "ltr" });
  rtFill(ctx, g.month, RT.greg.month, RT.greg.base, { dir: "ltr" });
  rtFill(ctx, g.year.slice(2), RT.greg.year, RT.greg.base, { dir: "ltr" }); // النموذج مطبوع عليه 20

  // ---------- القطاع والجهة والموقع والساعة ----------
  rtFill(ctx, d.sector, RT.sector.x, RT.sector.base);
  rtFillEntity(ctx, d.entity, notes);
  rtFillLocation(ctx, d.location, notes);
  const [clock, ampm] = reportTime12(when).split(" ");
  rtFill(ctx, `${clock} ${ampm}`, RT.time.x, RT.time.base);

  // ---------- أسباب المنع ----------
  rtFillReasons(ctx, d.reasons, notes);

  // ---------- المراقب ----------
  rtFill(ctx, d.inspector_name, RT.insp.name.x, RT.insp.name.base);
  rtDrawSignature(ctx, inspectorSig, RT.insp.sig.x, RT.insp.sig.base + 3, 34);
  rtDate(ctx, g, RT.insp.date);

  // ---------- ممثل الجهة ----------
  rtFill(ctx, d.rep_name, RT.rep.name.x, RT.rep.name.base);
  rtFill(ctx, d.rep_job, RT.rep.job.x, RT.rep.job.base);
  if (d.rep_refused) {
    // العبارة على سطرين داخل مساحة التوقيع
    const cx = (RT.rep.sig.x[0] + RT.rep.sig.x[1]) / 2;
    ctx.font = rtFont(9.5);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.fillStyle = RT_INK;
    ctx.fillText("رفض ممثل الجهة", cx, RT.rep.sig.base - 13);
    ctx.fillText("التوقيع على المحضر", cx, RT.rep.sig.base - 2.5);
  } else {
    rtDrawSignature(ctx, repSig, RT.rep.sig.x, RT.rep.sig.base + 3, 31);
  }
  rtDate(ctx, g, RT.rep.date);

  return { canvas, notes };
}

function rtDate(ctx, g, spec) {
  const o = { dir: "ltr", raise: 1 };
  rtFill(ctx, g.day, spec.day, spec.base, o);
  rtFill(ctx, g.month, spec.month, spec.base, o);
  rtFill(ctx, g.year, spec.year, spec.base, o);
}

// الجهة/الفرع: سطر واحد، ولو طويلة تنزل لسطر ثانٍ منقط تحته
function rtFillEntity(ctx, text, notes) {
  text = String(text || "").trim();
  if (!text) return;
  const [x1, x2] = RT.entity.x;
  const maxW = x2 - x1 - 2;
  if (rtWidth(ctx, text, 12) <= maxW || rtWidth(ctx, text, 9.5) <= maxW) {
    rtFill(ctx, text, RT.entity.x, RT.entity.base, { min: 9.5 });
    return;
  }
  const size = 10;
  let lines = rtWrapText(ctx, text, size, maxW);
  if (lines.length > 2) {
    lines = lines.slice(0, 2);
    lines[1] = rtEllipsize(ctx, lines[1] + " …", size, maxW);
    notes.push("اسم الجهة أطول من مساحته بالنموذج فتم اختصاره");
  }
  rtFill(ctx, lines[0], RT.entity.x, RT.entity.base, { size, min: size });
  if (lines[1]) {
    rtDots(ctx, x1, x2, RT.entity.extraBase + 1.5);
    rtFill(ctx, lines[1], RT.entity.x, RT.entity.extraBase, { size, min: size });
  }
}

// الموقع: سطر واحد، ولو طويل جدًا يُكتب على سطرين صغيرين داخل نفس الخانة (نغطي نقاطها الأصلية)
function rtFillLocation(ctx, text, notes) {
  text = String(text || "").trim();
  if (!text) return;
  const [x1, x2] = RT.location.x;
  const base = RT.location.base;
  const maxW = x2 - x1 - 2;
  if (rtWidth(ctx, text, 9) <= maxW) {
    rtFill(ctx, text, RT.location.x, base, { min: 9 });
    return;
  }
  const size = 8.5;
  let lines = rtWrapText(ctx, text, size, maxW);
  if (lines.length > 2) {
    lines = lines.slice(0, 2);
    lines[1] = rtEllipsize(ctx, lines[1] + " …", size, maxW);
    notes.push("الموقع أطول من خانته بالنموذج فتم اختصاره");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x1 - 0.8, base - 3.2, x2 - x1 + 4.4, 4.6); // بدون لمس الفاصلة قبلها ولا كلمة الموقع بعدها
  rtFill(ctx, lines[0], RT.location.x, base - 5.7, { size, min: size, raise: 0 });
  if (lines[1]) rtFill(ctx, lines[1], RT.location.x, base + 3.8, { size, min: size, raise: 0 });
}

// أسباب المنع: نملأ السطر المنقط الموجود، ونضيف أسطرًا منقطة بنفس الشكل لو لزم،
// وننزّل حجم الخط تدريجيًا حتى يكفي المكان المتاح بين الفقرتين
function rtFillReasons(ctx, text, notes) {
  text = String(text || "").trim();
  if (!text) return;
  const [x1, x2] = RT.reasons.x;
  const maxW = x2 - x1 - 8;
  const span = RT.reasons.maxY - RT.reasons.minY;
  const base = RT.reasons.base;
  const plans = [
    { size: 12, pitch: 15.75, keepOriginal: true },
    { size: 11, pitch: 14 },
    { size: 10, pitch: 12.8 },
    { size: 9, pitch: 12 },
  ];
  let chosen = null;
  let lines = null;
  for (const p of plans) {
    const cap = Math.floor(span / p.pitch) + 1;
    const ls = rtWrapText(ctx, text, p.size, maxW);
    if (ls.length <= (p.keepOriginal ? 3 : cap)) {
      chosen = p;
      lines = ls;
      break;
    }
  }
  if (!chosen) {
    // حتى الخط الأصغر لا يكفي: نقص آخر سطر مسموح
    chosen = plans[plans.length - 1];
    const cap = Math.floor(span / chosen.pitch) + 1;
    lines = rtWrapText(ctx, text, chosen.size, maxW).slice(0, cap);
    lines[cap - 1] = rtEllipsize(ctx, lines[cap - 1] + " …", chosen.size, maxW);
    notes.push("أسباب المنع أطول من مساحتها بالنموذج فتم اختصارها بالملف");
  }

  const n = lines.length;
  let bases;
  if (chosen.keepOriginal) {
    // نبقي السطر المنقط الأصلي، والأسطر الإضافية فوقه وتحته
    bases = n === 1 ? [base] : n === 2 ? [base - chosen.pitch, base] : [base - chosen.pitch, base, base + chosen.pitch];
    bases.forEach((b) => {
      if (b !== base) rtDots(ctx, x1, x2, b);
    });
  } else {
    // نغطي السطر الأصلي بمستطيل أبيض ونرسم أسطرنا بالمسافة المناسبة حول موضعه
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x1 - 4, base - 3.2, x2 - x1 + 12, 4.6);
    const total = (n - 1) * chosen.pitch;
    let start = base - total / 2;
    start = Math.max(start, RT.reasons.minY);
    bases = lines.map((_, i) => start + i * chosen.pitch);
    bases.forEach((b) => rtDots(ctx, x1, x2, b));
  }
  // كل سطر يُكتب من اليمين (محاذاة يمين) مثل فقرات النموذج
  ctx.font = rtFont(chosen.size);
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = RT_INK;
  lines.forEach((line, i) => ctx.fillText(line, x2 - 4, bases[i] - RT_RAISE));
}

// -------------------------------------------------
// بناء ملف PDF (على النموذج الأصلي)
// -------------------------------------------------
async function buildTemplatePdfBlob(report) {
  const [lib, tplBytes] = await Promise.all([rtLoadPdfLib(), rtGetTemplate()]);
  const { canvas, notes } = await renderTemplateOverlay(report);
  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("تعذّر تجهيز طبقة الكتابة"))), "image/png");
  });
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  const pdfDoc = await lib.PDFDocument.load(tplBytes.slice(), { updateMetadata: false });
  const page = pdfDoc.getPage(0);
  const box = page.getMediaBox();
  const image = await pdfDoc.embedPng(pngBytes);
  page.drawImage(image, { x: box.x, y: box.y, width: box.width, height: box.height });
  pdfDoc.setTitle(reportTypeName(report.report_type));
  const bytes = await pdfDoc.save();
  return { blob: new Blob([bytes], { type: "application/pdf" }), notes };
}

// -------------------------------------------------
// الملف الجاهز للتنزيل والمشاركة
// -------------------------------------------------
// اسم الملف: محضر_إثبات_واقعة_2026-11-18_10-35.pdf
function reportPdfFileName(report) {
  const when = new Date(report.occurred_at);
  const g = reportGregorianParts(when);
  const name = reportTypeName(report.report_type).replace(/\s+/g, "_");
  return `${name}_${g.year}-${g.month}-${g.day}_${reportPad2(when.getHours())}-${reportPad2(when.getMinutes())}.pdf`;
}

// آخر ملفات PDF مولّدة (بمفتاح المحضر) — عشان زر المشاركة لو احتاج ضغطة ثانية ما نعيد التوليد
const reportPdfCache = new Map();

// يرجع File جاهز للتنزيل أو المشاركة
async function getReportPdfFile(report) {
  const cached = reportPdfCache.get(report.id);
  if (cached) return cached;
  const { blob } = await buildTemplatePdfBlob(report);
  const file = new File([blob], reportPdfFileName(report), { type: "application/pdf" });
  reportPdfCache.set(report.id, file);
  if (reportPdfCache.size > 3) reportPdfCache.delete(reportPdfCache.keys().next().value);
  return file;
}

// تحميل مسبق للمكتبة والقالب عند فتح تفاصيل المحضر، حتى لا يتأخر التنزيل أو المشاركة بعد الضغط
function prefetchReportPdfAssets() {
  rtLoadPdfLib().catch(() => {});
  rtGetTemplate().catch(() => {});
}

function downloadReportPdfFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// هل المتصفح يقدر يشارك ملف PDF؟
function canShareReportFile(file) {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  } catch (e) {
    return false;
  }
}
