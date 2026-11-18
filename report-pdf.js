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
