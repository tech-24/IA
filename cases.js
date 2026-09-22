// ==================================================================
// cases.js — كل دوال إدارة الحالات وصورها (تُستخدم في cases.html)
// كل حالة تابعة لبند، ولها اسم + شرح طريقة الرصد + حتى 3 صور
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// اسم الـ bucket في Supabase Storage اللي تُخزّن فيه صور الحالات
// لازم تنشئه يدويًا من Supabase Dashboard > Storage (نفس التعليمات بملف schema.sql)
const CASE_BUCKET = "case-images";

// -------------------------------------------------
// جلب كل حالات بند معيّن، مع صورها بنفس الاستعلام (case_images)
// بفضل الربط بقاعدة البيانات، ما نحتاج استعلام منفصل لكل حالة
// -------------------------------------------------
async function fetchCases(itemId) {
  const { data, error } = await supabaseClient
    .from("cases")
    .select("*, case_images(*)")
    .eq("item_id", itemId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// إضافة حالة جديدة (بدون صور بعد — الصور تُضاف بعد إنشاء الحالة)
// -------------------------------------------------
async function addCase({ item_id, name, monitoring_method }) {
  const { data, error } = await supabaseClient
    .from("cases")
    .insert({ item_id, name, monitoring_method })
    .select("*, case_images(*)")
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل بيانات حالة موجودة (الاسم وشرح طريقة الرصد)
// -------------------------------------------------
async function updateCase(id, { name, monitoring_method }) {
  const { data, error } = await supabaseClient
    .from("cases")
    .update({ name, monitoring_method })
    .eq("id", id)
    .select("*, case_images(*)")
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف حالة — سيحذف تلقائيًا صورها التابعة لها
// (بسبب "on delete cascade" في قاعدة البيانات)
// -------------------------------------------------
async function deleteCase(id) {
  const { error } = await supabaseClient.from("cases").delete().eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------
// رفع صورة حالة إلى Supabase Storage، ثم تسجيلها بجدول case_images
// نضغط الصورة أولًا (compressImage من image-utils.js) عشان يكون الرفع أسرع
// ترجع الصف الجديد بجدول case_images (فيه رابط الصورة)
// قاعدة البيانات نفسها ترفض أي محاولة إضافة صورة رابعة (حماية إضافية)
// -------------------------------------------------
async function addCaseImage({ case_id, file, sort_order }) {
  const compressedFile = await compressImage(file);
  const fileName = `${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabaseClient.storage
    .from(CASE_BUCKET)
    .upload(fileName, compressedFile);
  if (uploadError) throw uploadError;

  const { data: urlData } = supabaseClient.storage.from(CASE_BUCKET).getPublicUrl(fileName);

  const { data, error } = await supabaseClient
    .from("case_images")
    .insert({ case_id, image_url: urlData.publicUrl, sort_order })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف صورة حالة واحدة
// -------------------------------------------------
async function deleteCaseImage(id) {
  const { error } = await supabaseClient.from("case_images").delete().eq("id", id);
  if (error) throw error;
}
