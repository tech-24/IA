// ==================================================================
// lists.js — كل دوال إدارة القوائم (تُستخدم في lists.html)
// القوائم تندرج تحت قسم معيّن (مثال: تحت قسم "تجاري" قائمة "بنود عامة")
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// -------------------------------------------------
// جلب كل قوائم قسم معيّن، مرتبة حسب sort_order
// -------------------------------------------------
async function fetchLists(categoryId) {
  const { data, error } = await supabaseClient
    .from("lists")
    .select("*")
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// إضافة قائمة جديدة تحت قسم معيّن
// -------------------------------------------------
async function addList({ category_id, name }) {
  const { data, error } = await supabaseClient
    .from("lists")
    .insert({ category_id, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل اسم قائمة موجودة
// -------------------------------------------------
async function updateList(id, { name }) {
  const { error } = await supabaseClient.from("lists").update({ name }).eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------
// حذف قائمة — سيحذف تلقائيًا كل البنود والحالات التابعة لها
// (بسبب "on delete cascade" في قاعدة البيانات)
// -------------------------------------------------
async function deleteList(id) {
  const { error } = await supabaseClient.from("lists").delete().eq("id", id);
  if (error) throw error;
}
