// ==================================================================
// export.js — تصدير زيارات أداة إلى ملف Excel + مجلد صور، داخل ZIP واحد
// يتطلب تحميل مكتبتي ExcelJS و JSZip (عبر CDN) قبل هذا الملف، بجانب visits.js
// ==================================================================

const BRAND_COLOR_ARGB = "FF3379BD"; // نفس اللون الأساسي للهوية، بصيغة ARGB اللي تحتاجها ExcelJS
const STATUS_FILL_COLORS = ["FFDCFCE7", "FFFEE2E2", "FFFEF3C7", "FFE2E8F0", "FFEDE9FE", "FFCFFAFE"];
const STATUS_TEXT_COLORS = ["FF166534", "FF991B1B", "FF92400E", "FF334155", "FF5B21B6", "FF155E75"];

// -------------------------------------------------
// تنظيف اسم من الرموز الممنوعة بأسماء الملفات/المجلدات
// -------------------------------------------------
function sanitizeFileName(name) {
  return (name || "بدون اسم").replace(/[\/\\:*?"<>|]/g, "").trim() || "بدون اسم";
}

// -------------------------------------------------
// تنسيق التاريخ والوقت بالشكل المطلوب بالتصدير (ميلادي، منفصلين)
// -------------------------------------------------
function exportDateParts(iso) {
  const d = new Date(iso);
  const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "م" : "ص";
  hours = hours % 12 || 12;
  const time = `${hours}:${minutes} ${ampm}`;
  return { date, time };
}

// -------------------------------------------------
// جلب صورة من رابط موقّت وإرجاعها كـ ArrayBuffer (لتضمينها بالإكسل أو حفظها بالمجلد)
// -------------------------------------------------
async function fetchImageBuffer(path) {
  if (!path) return null;
  const url = await getVisitPhotoSignedUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch (e) {
    return null;
  }
}

// -------------------------------------------------
// التصدير الرئيسي
// tool: صف الأداة { id, name }
// visits: الزيارات المطلوب تصديرها — المفلترة فعليًا (نفس اللي ظاهر بالقائمة)
// statuses / areas: كل حالات ونطاقات الأداة (بترتيبها، لتوليد أعمدة الملخص وألوان الحالات)
// includePhotos: true = ملف Excel + مجلد صور داخل ZIP، false = ملف Excel وحده بدون صور
// filterSummary: نص يوضّح الفلاتر الفعّالة وقت التصدير، يُكتب أعلى ورقة "ملخص"
// onProgress(done, total): استدعاء اختياري لتحديث شريط تقدّم بالواجهة (يُستدعى فقط لو تضمين الصور مفعّل)
// -------------------------------------------------
async function exportVisitsToZip(tool, visits, statuses, areas, includePhotos, filterSummary, onProgress) {
  const workbook = new ExcelJS.Workbook();

  // لون كل حالة حسب ترتيبها — نفس منطق الألوان المستخدم بعرض القائمة بالصفحة
  const statusColorIndex = {};
  statuses.forEach((s, i) => {
    statusColorIndex[s.id] = i % STATUS_FILL_COLORS.length;
  });

  // نجمّع الزيارات حسب النطاق — النطاق بدون أي زيارة ما يُنشأ له شيء إطلاقًا
  const visitsByArea = new Map();
  visits.forEach((v) => {
    const key = v.area_id || "بدون نطاق";
    if (!visitsByArea.has(key)) visitsByArea.set(key, []);
    visitsByArea.get(key).push(v);
  });

  // ================================================================
  // ورقة "ملخص" أولًا: صف لكل نطاق فيه زيارات + صف الإجمالي بالنهاية
  // ================================================================
  const summarySheet = workbook.addWorksheet("ملخص", { views: [{ rightToLeft: true }] });
  const summaryColumnCount = 2 + statuses.length;

  if (filterSummary) {
    const filterRow = summarySheet.addRow([filterSummary]);
    summarySheet.mergeCells(filterRow.number, 1, filterRow.number, summaryColumnCount);
    filterRow.font = { italic: true, color: { argb: "FF64748B" } };
    summarySheet.addRow([]); // صف فاضي يفصل الفلاتر عن الجدول
  }

  const summaryHeader = ["النطاق", "عدد الزيارات", ...statuses.map((s) => s.name)];
  const headerRow = summarySheet.addRow(summaryHeader);
  styleHeaderRow(headerRow);

  const totals = new Array(statuses.length).fill(0);
  let grandTotal = 0;

  areas.forEach((area) => {
    const areaVisits = visitsByArea.get(area.id) || [];
    if (areaVisits.length === 0) return; // بدون زيارات = بدون صف بالملخص
    const counts = statuses.map((s) => areaVisits.filter((v) => v.status_id === s.id).length);
    counts.forEach((c, i) => (totals[i] += c));
    grandTotal += areaVisits.length;
    summarySheet.addRow([area.name, areaVisits.length, ...counts]);
  });

  const totalRow = summarySheet.addRow(["الإجمالي", grandTotal, ...totals]);
  totalRow.font = { bold: true };

  summarySheet.columns.forEach((col) => (col.width = 16));
  summarySheet.getColumn(1).width = 20;

  // ================================================================
  // ورقة لكل نطاق فيه زيارة واحدة على الأقل
  // ================================================================
  const AREA_COLUMNS = [
    { header: "م", width: 5 },
    { header: "التاريخ", width: 13 },
    { header: "الوقت", width: 11 },
    { header: "اسم المنشأة", width: 26 },
    { header: "رقم الرخصة", width: 16 },
    { header: "المجمع / الشارع", width: 20 },
    { header: "الحالة", width: 16 },
    { header: "منفّذ الزيارة", width: 20 },
    { header: "الموقع", width: 14 },
  ];
  if (includePhotos) {
    AREA_COLUMNS.push({ header: "صورة المنشأة", width: 16 }, { header: "صورة الرخصة", width: 16 });
  }

  // لتسمية ملفات الصور بمجلد كل نطاق (تكرار اسم المنشأة داخل نفس النطاق يُرقَّم) — تُستخدم فقط لو تضمين الصور مفعّل
  const usedNamesByArea = new Map();
  // نثبّت رقم التكرار مرة وحدة لكل زيارة (مو مرة لكل صورة)، عشان صورتي نفس الزيارة ياخذوا نفس الرقم
  function establishmentOccurrence(areaName, establishmentName) {
    if (!usedNamesByArea.has(areaName)) usedNamesByArea.set(areaName, new Map());
    const counts = usedNamesByArea.get(areaName);
    const base = sanitizeFileName(establishmentName);
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    return n;
  }

  const zip = includePhotos ? new JSZip() : null;
  const photosFolder = includePhotos ? zip.folder("الصور") : null;
  let doneCount = 0;
  const totalPhotos = includePhotos
    ? visits.filter((v) => v.establishment_photo_path).length + visits.filter((v) => v.license_photo_path).length
    : 0;

  for (const area of areas) {
    const areaVisits = (visitsByArea.get(area.id) || []).slice().sort((a, b) => new Date(a.visited_at) - new Date(b.visited_at));
    if (areaVisits.length === 0) continue;

    const sheetName = sanitizeFileName(area.name).slice(0, 31) || "نطاق"; // أسماء أوراق إكسل لا تتجاوز 31 حرفًا
    const sheet = workbook.addWorksheet(sheetName, { views: [{ rightToLeft: true }] });
    sheet.columns = AREA_COLUMNS;
    styleHeaderRow(sheet.getRow(1));

    let areaFolder = null; // ننشئ مجلد النطاق بالصور فقط أول ما تحتاجه فعليًا (صورة حقيقية موجودة)

    for (let i = 0; i < areaVisits.length; i++) {
      const v = areaVisits[i];
      const { date, time } = exportDateParts(v.visited_at);
      const statusName = (statuses.find((s) => s.id === v.status_id) || {}).name || "";
      const inspector = (v.profiles && (v.profiles.full_name || v.profiles.email)) || "—";
      // الرابط اليدوي الملصق له الأولوية، وإلا رابط الإحداثيات التلقائية
      const locationUrl =
        v.location_url || (v.latitude && v.longitude ? `https://maps.google.com/?q=${v.latitude},${v.longitude}` : null);

      const rowValues = [
        i + 1,
        date,
        time,
        v.establishment_name,
        v.license_number || "",
        v.street || "",
        statusName,
        inspector,
        locationUrl ? { text: "فتح الموقع", hyperlink: locationUrl } : "",
      ];
      if (includePhotos) rowValues.push("", "");

      const row = sheet.addRow(rowValues);
      if (includePhotos) row.height = 60;

      const colorIdx = statusColorIndex[v.status_id];
      if (colorIdx !== undefined) {
        const cell = row.getCell(7);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL_COLORS[colorIdx] } };
        cell.font = { color: { argb: STATUS_TEXT_COLORS[colorIdx] }, bold: true };
      }
      if (locationUrl) row.getCell(9).font = { color: { argb: "FF3379BD" }, underline: true };

      if (!includePhotos) continue; // بدون تضمين صور، نكتفي بصف البيانات النصية

      // رقم تكرار اسم المنشأة بهذا النطاق (مشترك بين صورتي الزيارة)
      const occurrence = v.establishment_photo_path || v.license_photo_path ? establishmentOccurrence(area.name, v.establishment_name) : null;
      const suffix = occurrence && occurrence > 1 ? ` (${occurrence})` : "";
      const baseName = sanitizeFileName(v.establishment_name) + suffix;

      // صورة المنشأة: نضيفها للإكسل (مصغّرة بالخلية) وللمجلد (نفس الملف الأصلي)
      if (v.establishment_photo_path) {
        const buffer = await fetchImageBuffer(v.establishment_photo_path);
        if (buffer) {
          if (!areaFolder) areaFolder = photosFolder.folder(sanitizeFileName(area.name));
          areaFolder.file(`${baseName} - منشأة.jpg`, buffer);
          const imgId = workbook.addImage({ buffer, extension: "jpeg" });
          sheet.addImage(imgId, { tl: { col: 9, row: row.number - 1 }, ext: { width: 70, height: 60 } });
        }
        doneCount++;
        if (onProgress) onProgress(doneCount, totalPhotos);
      }

      // صورة الرخصة: نفس الفكرة
      if (v.license_photo_path) {
        const buffer = await fetchImageBuffer(v.license_photo_path);
        if (buffer) {
          if (!areaFolder) areaFolder = photosFolder.folder(sanitizeFileName(area.name));
          areaFolder.file(`${baseName} - رخصة.jpg`, buffer);
          const imgId = workbook.addImage({ buffer, extension: "jpeg" });
          sheet.addImage(imgId, { tl: { col: 10, row: row.number - 1 }, ext: { width: 70, height: 60 } });
        }
        doneCount++;
        if (onProgress) onProgress(doneCount, totalPhotos);
      }
    }

    sheet.autoFilter = { from: "A1", to: { row: 1, column: AREA_COLUMNS.length } };
  }

  // ================================================================
  // تجميع الملف النهائي
  // تضمين الصور مفعّل: إكسل + مجلد الصور داخل ZIP
  // تضمين الصور مطفّي: ملف إكسل وحده، بدون ZIP
  // ================================================================
  const excelBuffer = await workbook.xlsx.writeBuffer();
  const safeToolName = sanitizeFileName(tool.name);
  const dateStamp = new Date().toISOString().slice(0, 10);

  if (includePhotos) {
    // نفس نسخة zip اللي أُنشئت فوق (وفيها مجلد "الصور" معبّى فعليًا أثناء الحلقة) — نضيف لها ملف الإكسل الآن بس
    zip.file(`${safeToolName}.xlsx`, excelBuffer);
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${safeToolName} - ${dateStamp}.zip`);
  } else {
    downloadBlob(
      new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${safeToolName} - ${dateStamp}.xlsx`
    );
  }
}

// -------------------------------------------------
// تنسيق صف العنوان: خلفية بلون الهوية، نص أبيض عريض، وتجميد الصف
// -------------------------------------------------
function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLOR_ARGB } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
  });
  row.worksheet.views = [{ rightToLeft: true, state: "frozen", ySplit: row.number }];
}

// -------------------------------------------------
// تنزيل ملف Blob مباشرة بالمتصفح باسم معيّن
// -------------------------------------------------
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
