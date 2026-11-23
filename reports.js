// ==================================================================
// reports.js — دوال "أداة المحاضر" (أنواع المحاضر، جلب، إضافة، حذف، تنسيق التاريخ)
// يتطلب تحميل config.js و auth.js قبل هذا الملف
// ==================================================================

// أنواع المحاضر المتاحة. لإضافة نوع جديد لاحقًا: نضيف عنصرًا هنا (key + name) ونعرّف حقوله ونموذجه
// في reports-view.html و report-pdf.js. المفتاح (key) هو اللي ينحفظ بالقاعدة بعمود report_type
const REPORT_TYPES = [
  { key: "incident", name: "محضر إثبات واقعة" },
];

// القطاعات الجاهزة (قائمة منسدلة في خانة "مراقب قطاع")
const REPORT_SECTORS = ["الشمال", "الوسط", "الشرق", "الغرب", "الجنوب"];

// أقصى عمر للنموذج المفتوح قبل الحفظ (ساعات). نفس الحد مطبّق بمشغّل القاعدة، فلو انفتح النموذج
// أطول من ذلك نطلب فتح محضر جديد بدل ما يتغير وقته بصمت عند الحفظ
const REPORT_MAX_OPEN_HOURS = 12;

function reportTypeName(key) {
  const t = REPORT_TYPES.find((x) => x.key === key);
  return t ? t.name : key;
}

// الأعمدة اللي نجلبها للقائمة (بدون التواقيع لأنها ثقيلة)، والتواقيع تُجلب عند فتح المحضر
const REPORT_LIST_COLUMNS = "id, tool_id, inspector_id, report_type, occurred_at, created_at, data";

// -------------------------------------------------
// جلب محاضر أداة معيّنة، الأحدث أولًا
// المفتش يرى محاضره فقط، والمشرف/المالك يرى الكل (تحكمه صلاحيات RLS بالقاعدة)
// -------------------------------------------------
// الجلب بالدفعات (fetchAllRows من auth.js): الطلب الواحد ما يرجّع أكثر من 1000 صف، فنكمل الدفعات
// لين تخلص كلها بدل ما تنقطع المحاضر الأقدم بصمت
async function fetchReports(toolId) {
  return fetchAllRows(() =>
    supabaseClient
      .from("reports")
      .select(REPORT_LIST_COLUMNS, { count: "exact" })
      .eq("tool_id", toolId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
  );
}

// جلب محضر كامل بتواقيعه (لعرضه وتصديره)
async function fetchReportFull(id) {
  const { data, error } = await supabaseClient.from("reports").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

// إضافة محضر جديد. ما نرسل created_at (القاعدة تضعه)، و occurred_at هو لحظة فتح النموذج
async function addReport(report) {
  const { data, error } = await supabaseClient.from("reports").insert(report).select().single();
  if (error) throw error;
  return data;
}

// حذف محضر (للمشرف/المالك فقط حسب صلاحيات RLS)
async function deleteReport(id) {
  const { error } = await supabaseClient.from("reports").delete().eq("id", id);
  if (error) throw error;
}

// عدد محاضر أداة معيّنة (تُستخدم برسالة تأكيد حذف الأداة)
async function countReportsForTool(toolId) {
  const { count, error } = await supabaseClient
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("tool_id", toolId);
  if (error) throw error;
  return count || 0;
}

// التوقيع لازم يكون صورة PNG بصيغة data URL (نفس شرط القاعدة) قبل ما نضعها بأي src
function isSafeSignature(value) {
  return typeof value === "string" && value.startsWith("data:image/png;base64,");
}

// ==================================================================
// تنسيق التاريخ والوقت (ميلادي + هجري أم القرى + اليوم)
// ==================================================================
const REPORT_WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function reportPad2(n) {
  return String(n).padStart(2, "0");
}

// اسم اليوم بالعربية
function reportWeekday(date) {
  return REPORT_WEEKDAYS[date.getDay()];
}

// التاريخ الميلادي: { day, month, year } كنصوص (اليوم والشهر برقمين)
function reportGregorianParts(date) {
  return {
    day: reportPad2(date.getDate()),
    month: reportPad2(date.getMonth() + 1),
    year: String(date.getFullYear()),
  };
}

// التاريخ الهجري (تقويم أم القرى) — لو المتصفح ما يدعمه نرجع null ويُترك التاريخ الهجري فارغًا
function reportHijriParts(date) {
  try {
    const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
    const parts = {};
    fmt.formatToParts(date).forEach((p) => {
      if (p.type === "day" || p.type === "month" || p.type === "year") parts[p.type] = p.value;
    });
    if (!parts.day || !parts.month || !parts.year) return null;
    const year = String(parts.year).replace(/\D/g, ""); // احتياط من أي لاحقة مثل "AH"
    if (!year) return null;
    return { day: reportPad2(parts.day), month: reportPad2(parts.month), year };
  } catch (e) {
    return null;
  }
}

// الوقت بنظام 12 ساعة مع ص/م
function reportTime12(date) {
  let hours = date.getHours();
  const minutes = reportPad2(date.getMinutes());
  const ampm = hours >= 12 ? "م" : "ص";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

// نص مختصر للتاريخ بالقوائم: 2026/11/18
function reportDateShort(date) {
  const g = reportGregorianParts(date);
  return `${g.year}/${g.month}/${g.day}`;
}
