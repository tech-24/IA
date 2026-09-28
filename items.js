// ==================================================================
// items.js — كل دوال إدارة البنود (تُستخدم في lists.html)
// كل بند تابع لقائمة معيّنة، وعند فتح البند تظهر حالاته (خطوة لاحقة)
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// -------------------------------------------------
// بحث عن البنود بالاسم عبر كل الأقسام والقوائم دفعة وحدة
// ترجع كل بند مع اسم قائمته وقسمه (لعرض السياق بنتائج البحث)
// -------------------------------------------------
async function searchItems(query) {
  // مع أسماء أنواع المنشآت لعرضها كوسم بجانب النتيجة (مع رجوع للاستعلام العادي لو الجدول غير موجود)
  let { data, error } = await supabaseClient
    .from("items")
    .select("*, list:lists(name, category:categories(name)), item_facility_types(facility_types(name))")
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true })
    .limit(30);

  if (error) {
    ({ data, error } = await supabaseClient
      .from("items")
      .select("*, list:lists(name, category:categories(name))")
      .ilike("name", `%${query}%`)
      .order("name", { ascending: true })
      .limit(30));
  }
  if (error) throw error;
  return data;
}

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
  // نجلب مع كل بند أنواع المنشآت المرتبط بها (item_facility_types)
  // لو جدول الأنواع غير موجود بعد (لم يُشغَّل سكربت SQL)، نرجع للاستعلام العادي بدونها
  let { data, error } = await supabaseClient
    .from("items")
    .select("*, item_facility_types(facility_type_id)")
    .eq("list_id", listId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    ({ data, error } = await supabaseClient
      .from("items")
      .select("*")
      .eq("list_id", listId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }));
  }
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// إضافة بند جديد تحت قائمة معيّنة — ترجع الصف المُضاف نفسه
// is_suspended: هل البند موقوف حسب التوجيه (افتراضيًا لا)
// -------------------------------------------------
async function addItem({ list_id, name, is_suspended = false }) {
  const { data, error } = await supabaseClient
    .from("items")
    .insert({ list_id, name, is_suspended })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل بند موجود (الاسم وحالة الإيقاف) — ترجع الصف بعد التعديل
// -------------------------------------------------
async function updateItem(id, { name, is_suspended }) {
  const { data, error } = await supabaseClient
    .from("items")
    .update({ name, is_suspended })
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

// ==================================================================
// ربط البنود بأنواع المنشآت
// ==================================================================

// -------------------------------------------------
// تحديد أنواع المنشآت لبند (استبدال الربط الحالي بالقائمة الجديدة)
// typeIds فاضية = البند مشترك للكل
// نضيف الجديد أولًا ثم نحذف اللي لم يعد مختارًا، عشان لو صار خطأ بالنص
// ما يفقد البند ارتباطاته (أسوأ حالة: يظهر بأنواع زائدة، مو يختفي)
// -------------------------------------------------
async function setItemFacilityTypes(itemId, typeIds) {
  if (typeIds.length > 0) {
    const rows = typeIds.map((id) => ({ item_id: itemId, facility_type_id: id }));
    const { error: upsertError } = await supabaseClient
      .from("item_facility_types")
      .upsert(rows, { onConflict: "item_id,facility_type_id", ignoreDuplicates: true });
    if (upsertError) throw upsertError;
  }

  let deleteQuery = supabaseClient.from("item_facility_types").delete().eq("item_id", itemId);
  if (typeIds.length > 0) {
    deleteQuery = deleteQuery.not("facility_type_id", "in", `(${typeIds.join(",")})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;
}

// -------------------------------------------------
// جلب كل بنود مجموعة قوائم مع أنواعها (يُستخدم عند حذف نوع منشأة لمعرفة أثره)
// -------------------------------------------------
async function fetchItemsForLists(listIds) {
  if (listIds.length === 0) return [];
  const { data, error } = await supabaseClient
    .from("items")
    .select("id, name, list_id, item_facility_types(facility_type_id)")
    .in("list_id", listIds);
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف مجموعة بنود دفعة وحدة (حالاتها وروابطها تنحذف تلقائيًا بقاعدة البيانات)
// -------------------------------------------------
async function deleteItemsByIds(ids) {
  if (ids.length === 0) return;
  const { error } = await supabaseClient.from("items").delete().in("id", ids);
  if (error) throw error;
}
