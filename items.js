// ==================================================================
// items.js — كل دوال إدارة البنود (تُستخدم في lists.html)
// كل بند تابع لقائمة معيّنة، وعند فتح البند تظهر حالاته (خطوة لاحقة)
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// -------------------------------------------------
// جلب كل بنود قائمة معيّنة، مرتبة حسب sort_order
// -------------------------------------------------
async function fetchItems(listId) {
  const { data, error } = await supabaseClient
    .from("items")
    .select("*")
    .eq("list_id", listId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// إضافة بند جديد تحت قائمة معيّنة
// -------------------------------------------------
async function addItem({ list_id, name }) {
  const { error } = await supabaseClient.from("items").insert({ list_id, name });
  if (error) throw error;
}

// -------------------------------------------------
// تعديل اسم بند موجود
// -------------------------------------------------
async function updateItem(id, { name }) {
  const { error } = await supabaseClient.from("items").update({ name }).eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------
// حذف بند — سيحذف تلقائيًا كل الحالات وصورها التابعة له
// (بسبب "on delete cascade" في قاعدة البيانات)
// -------------------------------------------------
async function deleteItem(id) {
  const { error } = await supabaseClient.from("items").delete().eq("id", id);
  if (error) throw error;
}
