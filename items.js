// ==================================================================
// items.js — كل دوال إدارة البنود (تُستخدم في lists.html)
// كل بند تابع لقائمة معيّنة، وعند فتح البند تظهر حالاته (خطوة لاحقة)
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// -------------------------------------------------
// جلب بيانات بند واحد بالمعرف (يُستخدم بصفحة الحالات لعرض اسم البند)
// -------------------------------------------------
async function fetchItemById(id) {
  const { data, error } = await supabaseClient
    .from("items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

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
// إضافة بند جديد تحت قائمة معيّنة — ترجع الصف المُضاف نفسه
// -------------------------------------------------
async function addItem({ list_id, name }) {
  const { data, error } = await supabaseClient
    .from("items")
    .insert({ list_id, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل اسم بند موجود — ترجع الصف بعد التعديل
// -------------------------------------------------
async function updateItem(id, { name }) {
  const { data, error } = await supabaseClient
    .from("items")
    .update({ name })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف بند — سيحذف تلقائيًا كل الحالات وصورها التابعة له
// (بسبب "on delete cascade" في قاعدة البيانات)
// -------------------------------------------------
async function deleteItem(id) {
  const { error } = await supabaseClient.from("items").delete().eq("id", id);
  if (error) throw error;
}
