// ==================================================================
// categories.js — كل دوال إدارة الأقسام (تُستخدم في admin.html)
// يتطلب تحميل config.js قبل هذا الملف (فيه supabaseClient)
// ==================================================================

// اسم الـ bucket في Supabase Storage اللي تُخزّن فيه صور الأقسام
// لازم تنشئه يدويًا من Supabase Dashboard > Storage قبل استخدام رفع الصور
const CATEGORY_BUCKET = "category-images";

// -------------------------------------------------
// جلب بيانات قسم واحد بالمعرف (يُستخدم بصفحة القوائم لعرض اسم القسم)
// -------------------------------------------------
async function fetchCategoryById(id) {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// جلب كل الأقسام من قاعدة البيانات، مرتبة حسب sort_order
// -------------------------------------------------
async function fetchCategories() {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// رفع ملف صورة إلى Supabase Storage وإرجاع رابطها العام
// يُستخدم فقط لو المشرف اختار "رفع صورة" بدل "أيقونة يدوية"
// نضغط الصورة أولًا (compressImage من image-utils.js) عشان يكون الرفع أسرع
// -------------------------------------------------
async function uploadCategoryImage(file) {
  const compressedFile = await compressImage(file);
  const fileName = `${crypto.randomUUID()}.jpg`; // اسم فريد يمنع تعارض الملفات

  const { error } = await supabaseClient.storage
    .from(CATEGORY_BUCKET)
    .upload(fileName, compressedFile);
  if (error) throw error;

  const { data } = supabaseClient.storage.from(CATEGORY_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// -------------------------------------------------
// إضافة قسم جديد
// image_type: "upload" (فيه ملف صورة) أو "icon" (نص/إيموجي يدوي)
// ترجع الصف المُضاف نفسه (بدل إعادة تحميل كل الأقسام من الخادم مرة ثانية)
// -------------------------------------------------
async function addCategory({ name, image_type, file, iconValue }) {
  let image_value = null;

  if (image_type === "upload" && file) {
    image_value = await uploadCategoryImage(file); // نرفع الصورة ونحفظ رابطها
  } else if (image_type === "icon") {
    image_value = iconValue; // نحفظ النص/الإيموجي مباشرة بدون رفع
  }

  const { data, error } = await supabaseClient
    .from("categories")
    .insert({ name, image_type, image_value })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل قسم موجود
// لو ما اختار المشرف صورة/أيقونة جديدة، تبقى القديمة كما هي (keepExistingImage)
// ترجع الصف بعد التعديل (نفس فكرة addCategory أعلاه)
// -------------------------------------------------
async function updateCategory(id, { name, image_type, file, iconValue, keepExistingImage }) {
  const updates = { name, image_type };

  if (image_type === "upload" && file) {
    updates.image_value = await uploadCategoryImage(file);
  } else if (image_type === "icon" && !keepExistingImage) {
    updates.image_value = iconValue;
  }

  const { data, error } = await supabaseClient
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف قسم — سيحذف تلقائيًا كل البنود والحالات وصورها التابعة له
// (بسبب "on delete cascade" في قاعدة البيانات)
// -------------------------------------------------
async function deleteCategory(id) {
  const { error } = await supabaseClient.from("categories").delete().eq("id", id);
  if (error) throw error;
}
