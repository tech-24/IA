// ==================================================================
// tools.js — دوال الأدوات المساعدة (تُستخدم بلوحة المشرف وصفحة عرض المفتش)
// يتطلب تحميل config.js و image-utils.js قبل هذا الملف
// ==================================================================

// اسم الـ bucket في Supabase Storage اللي تُخزّن فيه أيقونات الأدوات
const TOOL_BUCKET = "tool-images";

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
// إضافة أداة جديدة (الصورة اختيارية، نفس فكرة الأقسام)
// -------------------------------------------------
async function addTool({ name, url, file }) {
  let image_value = null;
  if (file) image_value = await uploadToolImage(file);

  const { data, error } = await supabaseClient
    .from("tools")
    .insert({ name, url, image_type: "upload", image_value })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل أداة موجودة — لو ما اختار المشرف صورة جديدة، تبقى القديمة كما هي
// -------------------------------------------------
async function updateTool(id, { name, url, file }) {
  const updates = { name, url };
  if (file) updates.image_value = await uploadToolImage(file);

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
