// ==================================================================
// tools.js — دوال الأدوات المساعدة (تُستخدم بلوحة المشرف وصفحة عرض المفتش)
// يتطلب تحميل config.js و image-utils.js قبل هذا الملف
// ==================================================================

// اسم الـ bucket في Supabase Storage اللي تُخزّن فيه أيقونات الأدوات
const TOOL_BUCKET = "tool-images";

// رابط ثابت يميّز "أداة تسجيل الزيارات" الجاهزة عن أي رابط خارجي أو ملف عادي
const VISIT_TOOL_URL = "app://visits";

// هل هذي الأداة من نوع "تسجيل الزيارات" الجاهزة؟
function isVisitTool(tool) {
  return tool.url === VISIT_TOOL_URL;
}

// رابط ثابت يميّز "أداة المحاضر" الجاهزة
const REPORTS_TOOL_URL = "app://reports";

// هل هذي الأداة من نوع "المحاضر" الجاهزة؟
function isReportsTool(tool) {
  return tool.url === REPORTS_TOOL_URL;
}

// هل هي أداة جاهزة (من أي نوع)؟
function isBuiltinTool(tool) {
  return isVisitTool(tool) || isReportsTool(tool);
}

// الأدوات الجاهزة المتاحة: المفتاح (يُستخدم بقائمة الاختيار)، الاسم المقترح، الرابط الثابت، وصفحة الفتح.
// لإضافة أداة جاهزة جديدة نضيف عنصرًا هنا ونعدّل isBuiltinTool
const BUILTIN_TOOLS = [
  { key: "visits", name: "تسجيل الزيارات", url: VISIT_TOOL_URL, page: "visits-view.html" },
  { key: "reports", name: "المحاضر", url: REPORTS_TOOL_URL, page: "reports-view.html" },
];

// الأداة الجاهزة المطابقة لأداة محفوظة (أو undefined لو الأداة رابط/ملف عادي)
function builtinForTool(tool) {
  return BUILTIN_TOOLS.find((b) => b.url === tool.url);
}

// رابط صفحة الأداة الجاهزة (مع رقم الأداة)
function builtinToolHref(tool) {
  const b = builtinForTool(tool);
  return b ? `${b.page}?tool_id=${encodeURIComponent(tool.id)}` : null;
}

// أيقونة بديلة تظهر لو الأداة بلا أيقونة مرفوعة (HTML جاهز للإدراج داخل .icon-text)
function toolFallbackIconHtml(tool) {
  if (isVisitTool(tool)) return "📋";
  if (isReportsTool(tool)) {
    return '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--primary)"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><polyline points="14 3 14 8 19 8"></polyline><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>';
  }
  return "🔗";
}

// -------------------------------------------------
// حذف ملف أيقونة/ملف أداة فعليًا من Supabase Storage
// bucketConst: أي bucket نحذف منه (TOOL_BUCKET للأيقونة، أو TOOL_FILE_BUCKET للملف)
// نحذف فقط لو الرابط فعلاً من مشروعنا بـ Supabase (تحسبًا لو كان رابط خارجي عادي)
// -------------------------------------------------
async function deleteToolStorageFile(fileUrl, bucketName) {
  if (!fileUrl || !fileUrl.includes(SUPABASE_URL)) return;
  const fileName = extractStorageFileName(fileUrl);
  if (!fileName) return;
  try {
    await supabaseClient.storage.from(bucketName).remove([fileName]);
  } catch (e) {
    // تجاهل بصمت — حذف صف قاعدة البيانات أهم وما نوقفه بسبب فشل حذف الملف
  }
}

// -------------------------------------------------
// جلب كل الأدوات، مرتبة حسب sort_order ثم تاريخ الإضافة (ترتيب ثابت)
// -------------------------------------------------
async function fetchTools() {
  const { data, error } = await supabaseClient
    .from("tools")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// اسم الـ bucket في Supabase Storage اللي تُخزّن فيه الملفات المرفقة للأدوات (PDF وغيرها)
const TOOL_FILE_BUCKET = "tool-files";

// -------------------------------------------------
// رفع ملف (PDF أو أي مستند) للأداة، وإرجاع رابطه العام
// نفس الرابط يُحفظ بحقل url العادي — لا فرق بالاستخدام بعدها
// (بدون ضغط، لأن هذا مو بالضرورة صورة)
// -------------------------------------------------
async function uploadToolFile(file) {
  const fileExt = file.name.split(".").pop();
  const fileName = `${crypto.randomUUID()}.${fileExt}`;

  const { error } = await supabaseClient.storage.from(TOOL_FILE_BUCKET).upload(fileName, file);
  if (error) throw error;

  const { data } = supabaseClient.storage.from(TOOL_FILE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// -------------------------------------------------
// رفع أيقونة أداة إلى Supabase Storage وإرجاع رابطها العام
// نضغط الصورة أولًا (compressImage من image-utils.js) عشان يكون الرفع أسرع
// -------------------------------------------------
async function uploadToolImage(file) {
  const compressedFile = await compressImage(file);
  const fileName = `${crypto.randomUUID()}.jpg`;

  const { error } = await supabaseClient.storage.from(TOOL_BUCKET).upload(fileName, compressedFile);
  if (error) throw error;

  const { data } = supabaseClient.storage.from(TOOL_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// -------------------------------------------------
// إضافة أداة جديدة (الأيقونة اختيارية، نفس فكرة الأقسام)
// url_type: "link" (رابط خارجي يكتبه المشرف) أو "file" (ملف يرفعه ويُستخرج له رابط تلقائيًا)
// -------------------------------------------------
async function addTool({ name, url, urlFile, file }) {
  let image_value = null;
  if (file) image_value = await uploadToolImage(file);

  const finalUrl = urlFile ? await uploadToolFile(urlFile) : url;

  const { data, error } = await supabaseClient
    .from("tools")
    .insert({ name, url: finalUrl, image_type: "upload", image_value })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل أداة موجودة — لو ما اختار المشرف صورة/ملف جديد، تبقى القديمة كما هي
// -------------------------------------------------
async function updateTool(id, { name, url, urlFile, file }) {
  const updates = { name };
  if (file) updates.image_value = await uploadToolImage(file);
  if (urlFile) {
    updates.url = await uploadToolFile(urlFile);
  } else if (url) {
    updates.url = url;
  }

  const { data, error } = await supabaseClient
    .from("tools")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف أداة
// -------------------------------------------------
async function deleteTool(id) {
  const { error } = await supabaseClient.from("tools").delete().eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------
// إخفاء/إظهار أداة عن المفتشين (تبقى ظاهرة للمشرف دائمًا)
// -------------------------------------------------
async function updateToolHidden(id, isHidden) {
  const { error } = await supabaseClient.from("tools").update({ is_hidden: isHidden }).eq("id", id);
  if (error) throw error;
}
