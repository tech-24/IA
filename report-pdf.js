// ==================================================================
// report-pdf.js — توليد ملف PDF للمحضر بنفس شكل النموذج الرسمي (A4)، وتنزيله أو مشاركته
// يتطلب: auth.js (isSafeSignature تأتي من reports.js) و reports.js (دوال التاريخ)
// وصورتي report-logo.png و report-footer.png بجانب الصفحة
//
// طريقة العمل: نرسم صفحة المحضر مباشرة على Canvas (المتصفح نفسه يشكّل الحروف العربية ويوصلها)،
// ثم نحوّلها لصورة JPEG ونضعها بملف PDF بصفحة A4 واحدة. بدون أي مكتبة خارجية.
// ==================================================================

const RP_W = 794; // عرض الصفحة بالبكسل (A4 بدقة 96)
const RP_H = 1123; // ارتفاع الصفحة
const RP_SCALE = 2.5; // الدقة الفعلية للصورة (حوالي 240 نقطة بالإنش)
const RP_PAD = 56; // هامش الصفحة الجانبي
const RP_INK = "#111111";
const RP_DOT = "#333333";
const RP_FAMILY = '"Tajawal", "Tahoma", "Segoe UI", sans-serif';

function rpFont(size, weight) {
  return `${weight} ${size}px ${RP_FAMILY}`;
}

// -------------------------------------------------
// تحميل الصور (الشعار، الشريط السفلي، التواقيع) وانتظار الخطوط
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
// قياس النص وتقسيمه إلى أسطر
// -------------------------------------------------
function rpMeasure(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

// كلمة طويلة جدًا بلا مسافات (أطول من السطر): نقسمها بالحروف
function rpSplitLong(ctx, text, font, maxW) {
  const out = [];
  let cur = "";
  for (const ch of text) {
    if (cur && rpMeasure(ctx, cur + ch, font) > maxW) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// رمز (token) نصي عادي
function rpWordToken(ctx, text, size, bold, ltr) {
  const font = rpFont(size, bold ? 700 : 400);
  return { kind: "word", text, bold, ltr: !!ltr, font, w: rpMeasure(ctx, text, font) };
}

// يحوّل جملة نصية (كلمات مفصولة بمسافات) إلى رموز
function rpWords(ctx, text, size, bold) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => rpWordToken(ctx, w, size, bold, false));
}

// خانة معبأة (تحتها نقاط): أجزاء قصيرة (يوم، تاريخ، ساعة، قطاع) تبقى كتلة واحدة بعرض أدنى،
// والنص الطويل (جهة، موقع) يتفكك لكلمات ويُرسم الخط المنقط تحت كل سطر منه
function rpFillTokens(ctx, parts, size, maxW, minW, group) {
  const font = rpFont(size, 700);
  const spaceW = rpMeasure(ctx, " ", font);
  const clean = parts.filter((p) => p && p.text);
  const measured = clean.map((p) => ({ text: p.text, ltr: !!p.ltr, w: rpMeasure(ctx, p.text, font) }));
  const total = measured.reduce((s, p) => s + p.w, 0) + spaceW * Math.max(0, measured.length - 1);

  if (measured.length === 0) {
    return [{ kind: "fill", parts: [], font, w: minW, textW: 0 }];
  }
  if (total + 16 <= maxW * 0.62) {
    return [{ kind: "fill", parts: measured, font, w: Math.max(minW, total + 16), textW: total }];
  }
  // نص طويل: كلمات مستقلة تحمل رقم المجموعة
  const tokens = [];
  measured.forEach((p) => {
    const words = p.ltr ? [p.text] : p.text.split(/\s+/).filter(Boolean);
    words.forEach((word) => {
      const pieces = rpSplitLong(ctx, word, font, maxW - 12);
      pieces.forEach((piece) => {
        tokens.push({ kind: "fillWord", text: piece, ltr: p.ltr, font, w: rpMeasure(ctx, piece, font), group });
      });
    });
  });
  return tokens;
}

// يوزّع الرموز على أسطر بعرض maxW (الرموز بترتيب القراءة: الأول يبدأ من اليمين)
function rpWrap(tokens, maxW, spaceW) {
  const lines = [];
  let cur = { items: [], w: 0 };
  tokens.forEach((tok) => {
    const tail = tok.tailW || 0;
    const need = (cur.items.length ? spaceW : 0) + tok.w + tail;
    if (cur.items.length && cur.w + need > maxW) {
      lines.push(cur);
      cur = { items: [], w: 0 };
    }
    tok.gapBefore = cur.items.length ? spaceW : 0;
    cur.items.push(tok);
    cur.w += tok.gapBefore + tok.w + tail;
  });
  if (cur.items.length) lines.push(cur);
  return lines;
}

// -------------------------------------------------
// تخطيط الصفحة كاملة: يرجع قائمة أوامر رسم + هل المحتوى يكفي الصفحة
// -------------------------------------------------
function rpPlanPage(ctx, report, assets, size) {
  const d = report.data || {};
  const ops = [];
  const contentW = RP_W - RP_PAD * 2;
  const rightX = RP_W - RP_PAD;
  const leftX = RP_PAD;
  const lineH = Math.round(size * 2.05 * 10) / 10;
  const bodyFont = rpFont(size, 400);
  const spaceW = rpMeasure(ctx, " ", bodyFont);
  const fillMin = 90;

  const when = new Date(report.occurred_at);
  const g = reportGregorianParts(when);
  const h = reportHijriParts(when);
  const [clock, ampm] = reportTime12(when).split(" ");
  // الترتيب: سنة / شهر / يوم (يُقرأ من اليسار لليمين) — الصيغة المعتمدة بالمراسلات الرسمية
  const dateText = (p) => `${p.year} / ${p.month} / ${p.day}`;

  // ---------- الترويسة ----------
  const govSize = 15;
  const govCx = rightX - 115;
  ["المملكة العربية السعودية", "وزارة البلديات والإسكان", "أمانة منطقة الرياض"].forEach((line, i) => {
    const font = rpFont(govSize, 500);
    const w = rpMeasure(ctx, line, font);
    ops.push({ op: "text", text: line, x: govCx - w / 2, y: 52 + i * 26, font, dir: "rtl" });
  });
  if (assets.logo) {
    const lw = 176;
    const lh = (lw * assets.logo.naturalHeight) / assets.logo.naturalWidth;
    ops.push({ op: "img", img: assets.logo, x: (RP_W - lw) / 2, y: 24, w: lw, h: lh });
  }

  // ---------- العنوان ----------
  const titleFont = rpFont(28, 700);
  const title = reportTypeName(report.report_type);
  const titleW = rpMeasure(ctx, title, titleFont);
  ops.push({ op: "text", text: title, x: (RP_W - titleW) / 2, y: 222, font: titleFont, dir: "rtl" });

  // ---------- فقرات النص ----------
  let y = 258;

  // يرسم فقرة من مقاطع: نص عادي (string) أو خانة معبأة ({ fill: [parts], min })
  function paragraph(segments) {
    const tokens = [];
    let groupId = 0;
    segments.forEach((seg) => {
      if (typeof seg === "string") {
        tokens.push(...rpWords(ctx, seg, size, false));
      } else if (seg.glue) {
        const last = tokens[tokens.length - 1];
        if (last) {
          last.tail = seg.glue;
          last.tailW = rpMeasure(ctx, seg.glue, bodyFont);
        }
      } else {
        groupId++;
        tokens.push(...rpFillTokens(ctx, seg.fill, size, contentW, seg.min || fillMin, groupId));
      }
    });
    const lines = rpWrap(tokens, contentW, spaceW);
    lines.forEach((line) => {
      const base = y + lineH * 0.7;
      let x = rightX;
      let run = null; // مجموعة نص طويل متصلة بنفس السطر
      const closeRun = () => {
        if (run) ops.push({ op: "dots", x1: run.left - 4, x2: run.right + 4, y: base + 6 });
        run = null;
      };
      line.items.forEach((tok) => {
        x -= tok.gapBefore;
        if (tok.kind === "word") {
          closeRun();
          ops.push({ op: "text", text: tok.text, x: x - tok.w, y: base, font: tok.font, dir: "rtl" });
          x -= tok.w;
        } else if (tok.kind === "fill") {
          closeRun();
          // أجزاء الخانة بالتتابع من اليمين، متوسّطة داخل الخانة
          const blockRight = x;
          let px = blockRight - (tok.w - tok.textW) / 2;
          tok.parts.forEach((p, i) => {
            if (i > 0) px -= rpMeasure(ctx, " ", tok.font);
            ops.push({ op: "text", text: p.text, x: px - p.w, y: base, font: tok.font, dir: p.ltr ? "ltr" : "rtl" });
            px -= p.w;
          });
          ops.push({ op: "dots", x1: blockRight - tok.w, x2: blockRight, y: base + 6 });
          x -= tok.w;
        } else {
          // fillWord
          if (!run || run.group !== tok.group) {
            closeRun();
            run = { group: tok.group, right: x, left: x };
          }
          ops.push({ op: "text", text: tok.text, x: x - tok.w, y: base, font: tok.font, dir: tok.ltr ? "ltr" : "rtl" });
          x -= tok.w;
          run.left = x;
        }
        if (tok.tailW) {
          ops.push({ op: "text", text: tok.tail, x: x - tok.tailW, y: base, font: bodyFont, dir: "rtl" });
          x -= tok.tailW;
        }
      });
      closeRun();
      y += lineH;
    });
    y += size * 0.35;
  }

  paragraph([
    "في يوم",
    { fill: [{ text: reportWeekday(when) }] },
    "بتاريخ",
    { fill: [{ text: h ? dateText(h) : "", ltr: true }, h ? { text: "هـ" } : null], min: 120 },
    "الموافق",
    { fill: [{ text: dateText(g), ltr: true }, { text: "م" }], min: 120 },
  ]);
  paragraph(["انتقل مراقب قطاع", { fill: [{ text: d.sector }] }, "إلى الجهة/الفرع", { fill: [{ text: d.entity }], min: 160 }]);
  paragraph([
    "الموقع",
    { fill: [{ text: d.location }], min: 160 },
    { glue: "،" },
    "وذلك لغرض تنفيذ الأعمال الرقابية والمهام الموكلة للأمانة وفق الاختصاص.",
  ]);
  paragraph([
    "وعند الوصول إلى الموقع الساعة",
    { fill: [{ text: clock, ltr: true }, { text: ampm }], min: 100 },
    "تم التعريف بالصفة الوظيفية وإبراز ما يثبت ذلك، كما تم إبراز الخطاب الرسمي المتضمن طلب تمكين المراقب من مباشرة مهامه الرقابية، والمرفق به التعاميم ذات العلاقة، إلا أنه تم منع المراقب من الدخول إلى الموقع للأسباب التالية:",
  ]);

  // ---------- أسباب المنع: أسطر مخططة بنقاط كاملة العرض مثل النموذج الورقي ----------
  const reasonFont = rpFont(size, 700);
  const reasonSpace = rpMeasure(ctx, " ", reasonFont);
  const reasonLines = [];
  String(d.reasons || "")
    .split(/\r?\n/)
    .forEach((para) => {
      const toks = [];
      para
        .split(/\s+/)
        .filter(Boolean)
        .forEach((word) => {
          rpSplitLong(ctx, word, reasonFont, contentW - 16).forEach((piece) => {
            toks.push({ kind: "word", text: piece, font: reasonFont, w: rpMeasure(ctx, piece, reasonFont) });
          });
        });
      const wrapped = rpWrap(toks, contentW - 16, reasonSpace);
      if (wrapped.length === 0) reasonLines.push({ items: [], w: 0 });
      wrapped.forEach((l) => reasonLines.push(l));
    });
  const reasonCount = Math.max(2, reasonLines.length);
  for (let i = 0; i < reasonCount; i++) {
    const base = y + lineH * 0.7;
    const line = reasonLines[i];
    if (line) {
      let x = rightX - 8;
      line.items.forEach((tok) => {
        x -= tok.gapBefore;
        ops.push({ op: "text", text: tok.text, x: x - tok.w, y: base, font: reasonFont, dir: "rtl" });
        x -= tok.w;
      });
    }
    ops.push({ op: "dots", x1: leftX, x2: rightX, y: base + 6 });
    y += lineH;
  }
  y += size * 0.35;

  paragraph(["وبناءً عليه تعذر استكمال أعمال الرقابة والتحقق من الاشتراطات والالتزامات النظامية بالموقع نتيجة عدم السماح بالدخول."]);
  paragraph(["وقد تم إثبات هذه الواقعة في حينها وإعداد هذا المحضر لرفعها للجهة المختصة."]);
  const bodyEnd = y;

  // ---------- التواقيع ----------
  const footerH = assets.footer ? (RP_W * assets.footer.naturalHeight) / assets.footer.naturalWidth : 0;
  const footerTop = RP_H - footerH;
  const blockW = 322;
  const rowFont = rpFont(Math.round(size * 0.85 * 10) / 10, 400);
  const rowSize = Math.round(size * 0.85 * 10) / 10;
  const rowH = 34;
  const sigH = 78;
  const titleLineH = size * 1.7;

  // نص عنوان الكتلة بالتفاف داخل عرضها
  function blockTitle(text, right, top) {
    const font = rpFont(size, 700);
    const lines = rpWrap(rpWords(ctx, text, size, true), blockW, rpMeasure(ctx, " ", font));
    lines.forEach((line, li) => {
      let x = right;
      line.items.forEach((tok) => {
        x -= tok.gapBefore;
        ops.push({ op: "text", text: tok.text, x: x - tok.w, y: top + titleLineH * (li + 0.75), font, dir: "rtl" });
        x -= tok.w;
      });
    });
    return lines.length * titleLineH + 6;
  }

  // صف: عنوان على اليمين + خط منقط يحمل القيمة (نص أو صورة توقيع أو ملاحظة)
  function signRow(right, top, label, value, opts) {
    opts = opts || {};
    const height = opts.tall ? sigH : rowH;
    const labelW = rpMeasure(ctx, label, rowFont);
    const base = top + height - 8;
    ops.push({ op: "text", text: label, x: right - labelW, y: base, font: rowFont, dir: "rtl" });
    const vRight = right - labelW - 8;
    const vLeft = right - blockW;
    ops.push({ op: "dots", x1: vLeft, x2: vRight, y: base + 5 });
    if (opts.image) {
      const maxH = height - 8;
      const maxW = vRight - vLeft - 8;
      const sc = Math.min(maxH / opts.image.naturalHeight, maxW / opts.image.naturalWidth);
      const iw = opts.image.naturalWidth * sc;
      const ih = opts.image.naturalHeight * sc;
      ops.push({ op: "img", img: opts.image, x: vRight - 6 - iw, y: base + 3 - ih, w: iw, h: ih });
    } else if (value) {
      // نصغّر الخط لو القيمة أطول من الخانة
      let fs = rowSize;
      let font = rpFont(fs, 700);
      const avail = vRight - vLeft - 8;
      let w = rpMeasure(ctx, value, font);
      while (w > avail && fs > 9) {
        fs -= 0.5;
        font = rpFont(fs, 700);
        w = rpMeasure(ctx, value, font);
      }
      ops.push({ op: "text", text: value, x: vRight - 6 - w, y: base - 1, font, dir: opts.ltr ? "ltr" : "rtl" });
    }
    return height;
  }

  const refused = !!d.rep_refused;
  const dateLine = dateText(g);

  function inspectorBlock(top) {
    const right = rightX;
    let t = top + blockTitle("مراقب القطاع", right, top);
    t += signRow(right, t, "الاسم:", d.inspector_name);
    t += signRow(right, t, "التوقيع:", "", { tall: true, image: assets.inspectorSig });
    t += signRow(right, t, "التاريخ:", dateLine, { ltr: true });
    return t - top;
  }
  function repBlock(top) {
    const right = leftX + blockW;
    let t = top + blockTitle("ممثل الجهة/ يتم الإفادة في حال الرفض دون التوقيع", right, top);
    t += signRow(right, t, "الاسم:", d.rep_name);
    t += signRow(right, t, "الوظيفة:", d.rep_job);
    t += signRow(right, t, "التوقيع:", refused ? "رفض ممثل الجهة التوقيع على المحضر" : "", {
      tall: true,
      image: refused ? null : assets.repSig,
    });
    t += signRow(right, t, "التاريخ:", dateLine, { ltr: true });
    return t - top;
  }

  // ارتفاع كتلة التواقيع (نحسبه بتخطيط تجريبي ثم نضعها قرب أسفل الصفحة)
  const probeStart = ops.length;
  const signH = Math.max(inspectorBlock(0), repBlock(0));
  ops.length = probeStart; // نتجاهل التخطيط التجريبي
  const signTop = Math.max(bodyEnd + 14, footerTop - signH - 30);
  inspectorBlock(signTop);
  repBlock(signTop);

  // ---------- الشريط السفلي ----------
  if (assets.footer) ops.push({ op: "img", img: assets.footer, x: 0, y: footerTop, w: RP_W, h: footerH });

  return { ops, fits: bodyEnd + 14 + signH <= footerTop - 4 };
}

function rpPaint(ctx, ops) {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ops.forEach((o) => {
    if (o.op === "text") {
      ctx.font = o.font;
      ctx.direction = o.dir || "rtl";
      ctx.fillStyle = RP_INK;
      ctx.fillText(o.text, o.x, o.y);
    } else if (o.op === "dots") {
      ctx.save();
      ctx.strokeStyle = RP_DOT;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([1.1, 3.1]);
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y);
      ctx.lineTo(o.x2, o.y);
      ctx.stroke();
      ctx.restore();
    } else if (o.op === "img") {
      ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
    }
  });
}

// يرسم صفحة المحضر على Canvas ويرجعه
// report لازم يحمل التواقيع (inspector_signature / rep_signature) — اجلبه بـ fetchReportFull لو ناقصة
async function renderReportCanvas(report) {
  const [logo, footer, inspectorSig, repSig] = await Promise.all([
    rpLoadImage("report-logo.png"),
    rpLoadImage("report-footer.png"),
    rpLoadImage(isSafeSignature(report.inspector_signature) ? report.inspector_signature : null),
    rpLoadImage(isSafeSignature(report.rep_signature) ? report.rep_signature : null),
  ]);
  await rpWaitFonts();
  const assets = { logo, footer, inspectorSig, repSig };

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(RP_W * RP_SCALE);
  canvas.height = Math.round(RP_H * RP_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RP_SCALE, RP_SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, RP_W, RP_H);

  // نبدأ بالحجم الطبيعي وننزل تدريجيًا لو الأسباب طويلة ولم تكفِ الصفحة
  let plan = null;
  for (let size = 16; size >= 11; size -= 0.5) {
    plan = rpPlanPage(ctx, report, assets, size);
    if (plan.fits) break;
  }
  rpPaint(ctx, plan.ops);
  return canvas;
}

// -------------------------------------------------
// كتابة ملف PDF بسيط (صفحة A4 فيها صورة JPEG واحدة) — بدون مكتبات
// -------------------------------------------------
function rpPdfBytes(jpeg, pxW, pxH, title) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const beginObj = (n) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
  };

  // عنوان الملف بترميز UTF-16BE (يدعم العربية)
  let titleHex = "FEFF";
  for (let i = 0; i < title.length; i++) titleHex += title.charCodeAt(i).toString(16).padStart(4, "0");

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + سطر ثنائي

  beginObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObj(2);
  push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  beginObj(3);
  push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n");
  beginObj(4);
  push(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
  beginObj(5);
  push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  beginObj(6);
  push(`<< /Title <${titleHex}> /Producer (Inspector Assistant) >>\nendobj\n`);

  const xrefPos = pos;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let n = 1; n <= 6; n++) xref += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  push(xref);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  chunks.forEach((c) => {
    out.set(c, at);
    at += c.length;
  });
  return out;
}

// بناء ملف PDF (Blob) للمحضر
async function buildReportPdfBlob(report) {
  const canvas = await renderReportCanvas(report);
  const jpegBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("تعذر تجهيز صورة المحضر"))), "image/jpeg", 0.93);
  });
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const bytes = rpPdfBytes(jpeg, canvas.width, canvas.height, reportTypeName(report.report_type));
  return new Blob([bytes], { type: "application/pdf" });
}

// اسم الملف: محضر_إثبات_واقعة_2026-11-18_10-35.pdf
function reportPdfFileName(report) {
  const when = new Date(report.occurred_at);
  const g = reportGregorianParts(when);
  const name = reportTypeName(report.report_type).replace(/\s+/g, "_");
  return `${name}_${g.year}-${g.month}-${g.day}_${reportPad2(when.getHours())}-${reportPad2(when.getMinutes())}.pdf`;
}

// آخر ملفات PDF مولّدة (بمفتاح المحضر) — عشان زر المشاركة لو احتاج ضغطة ثانية ما نعيد التوليد
const reportPdfCache = new Map();

async function getReportPdfFile(report) {
  const cached = reportPdfCache.get(report.id);
  if (cached) return cached;
  const blob = await buildReportPdfBlob(report);
  const file = new File([blob], reportPdfFileName(report), { type: "application/pdf" });
  reportPdfCache.set(report.id, file);
  if (reportPdfCache.size > 3) reportPdfCache.delete(reportPdfCache.keys().next().value);
  return file;
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

// ==================================================================
// نسخة تجريبية: الكتابة مباشرة على ملف النموذج الأصلي (report-template.pdf)
// بدل إعادة رسم النموذج. نرسم القيم والتواقيع على طبقة شفافة (Canvas) بنفس مقاس الصفحة
// ثم نلصقها فوق صفحة النموذج الأصلي بمكتبة pdf-lib (تُحمَّل عند أول استخدام فقط).
// الإحداثيات كلها بالنقطة (pt) وتُقاس من أعلى يسار الصفحة، ومقاسة من ملف النموذج نفسه؛
// لو تغيّر تصميم النموذج لازم تُعاد معايرتها (الكائن RT).
// ==================================================================

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
  const [lib, tplBytes] = await Promise.all([rtLoadPdfLib(), rtFetchTemplate()]);
  const { canvas, notes } = await renderTemplateOverlay(report);
  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("تعذّر تجهيز طبقة الكتابة"))), "image/png");
  });
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  const pdfDoc = await lib.PDFDocument.load(tplBytes, { updateMetadata: false });
  const page = pdfDoc.getPage(0);
  const box = page.getMediaBox();
  const image = await pdfDoc.embedPng(pngBytes);
  page.drawImage(image, { x: box.x, y: box.y, width: box.width, height: box.height });
  pdfDoc.setTitle(reportTypeName(report.report_type));
  const bytes = await pdfDoc.save();
  return { blob: new Blob([bytes], { type: "application/pdf" }), notes };
}

async function getReportTemplatePdfFile(report) {
  const key = report.id + ":tpl";
  const cached = reportPdfCache.get(key);
  if (cached) return cached;
  const { blob, notes } = await buildTemplatePdfBlob(report);
  const name = reportPdfFileName(report).replace(/\.pdf$/, "_على_النموذج_الأصلي.pdf");
  const file = new File([blob], name, { type: "application/pdf" });
  file.rtNotes = notes;
  reportPdfCache.set(key, file);
  if (reportPdfCache.size > 3) reportPdfCache.delete(reportPdfCache.keys().next().value);
  return file;
}
