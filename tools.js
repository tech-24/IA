// ==================================================================
// tools.js — دوال الأدوات المساعدة (تُستخدم بلوحة المشرف وصفحة عرض المفتش)
// يتطلب تحميل config.js و image-utils.js قبل هذا الملف
// ==================================================================

// اسم الـ bucket في Supabase Storage اللي تُخزّن فيه أيقونات الأدوات
const TOOL_BUCKET = "tool-images";

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
// تحديث ترتيب أداة واحدة فقط (يُستخدم بعد إعادة الترتيب بالسحب والإفلات)
// -------------------------------------------------
async function updateToolSortOrder(id, sort_order) {
  const { error } = await supabaseClient.from("tools").update({ sort_order }).eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------
// جلب كل الأدوات، مرتبة حسب sort_order
// -------------------------------------------------
async function fetchTools() {
  const { data, error } = await supabaseClient
    .from("tools")
    .select("*")
    .order("sort_order", { ascending: true });
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
