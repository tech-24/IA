// ==================================================================
// circulars.js — دوال التعاميم (تُستخدم بلوحة المشرف وصفحة عرض المفتش)
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// -------------------------------------------------
// جلب كل التعاميم، الأحدث أولًا
// -------------------------------------------------
async function fetchCirculars() {
  const { data, error } = await supabaseClient
    .from("circulars")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// إضافة تعميم جديد — ترجع الصف المُضاف نفسه
// -------------------------------------------------
async function addCircular({ title, content }) {
  const { data, error } = await supabaseClient
    .from("circulars")
    .insert({ title, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل تعميم موجود — ترجع الصف بعد التعديل
// -------------------------------------------------
async function updateCircular(id, { title, content }) {
  const { data, error } = await supabaseClient
    .from("circulars")
    .update({ title, content })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف تعميم
// -------------------------------------------------
async function deleteCircular(id) {
  const { error } = await supabaseClient.from("circulars").delete().eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------
// هل فيه تعميم واحد على الأقل ما قرأه المستخدم الحالي؟
// تُستخدم لإظهار علامة التنبيه على تبويب "تعاميم" بالشريط السفلي
// استعلام واحد بس (بدل اثنين): نجيب كل التعاميم مع سجل قراءة المستخدم الحالي
// المدمج معها — وبفضل صلاحيات RLS على circular_reads، السجل المرتبط يرجع
// فارغًا تلقائيًا لأي تعميم ما قرأه، بدون ما نحتاج نمرر معرّف المستخدم يدويًا
// -------------------------------------------------
async function hasUnreadCirculars() {
  const { data, error } = await supabaseClient
    .from("circulars")
    .select("id, circular_reads(user_id)");
  if (error) throw error;
  return data.some((c) => !c.circular_reads || c.circular_reads.length === 0);
}

// -------------------------------------------------
// جلب معرّفات كل التعاميم اللي قرأها المستخدم الحالي (لصفحة عرض المفتش)
// ترجع مصفوفة من المعرّفات، تُستخدم لمعرفة أي تعميم "جديد" (غير مقروء)
// -------------------------------------------------
async function fetchMyReadCircularIds() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabaseClient
    .from("circular_reads")
    .select("circular_id")
    .eq("user_id", session.user.id);
  if (error) throw error;
  return data.map((r) => r.circular_id);
}

// -------------------------------------------------
// تسجيل إن المستخدم الحالي قرأ تعميم معيّن (تُستدعى عند فتح/توسيع التعميم)
// upsert مع ignoreDuplicates عشان ما يصير خطأ لو ضغط عليه أكثر من مرة
// -------------------------------------------------
async function markCircularRead(circularId) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { error } = await supabaseClient
    .from("circular_reads")
    .upsert(
      { circular_id: circularId, user_id: session.user.id },
      { onConflict: "circular_id,user_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}
