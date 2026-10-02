// ==================================================================
// visits.js — دوال "أداة تسجيل الزيارات" (حالات، نطاقات، زيارات، صور)
// يتطلب تحميل config.js و auth.js و image-utils.js قبل هذا الملف
// ==================================================================

// اسم الـ bucket الخاص (غير عام) لصور الزيارات بـ Supabase Storage
const VISIT_PHOTOS_BUCKET = "visit-photos";

// ==================================================================
// حالات الزيارة (خاصة بكل أداة زيارات على حدة)
// ==================================================================
async function fetchVisitStatuses(toolId) {
  const { data, error } = await supabaseClient
    .from("visit_statuses")
    .select("*")
    .eq("tool_id", toolId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// ==================================================================
// نطاقات الزيارة (خاصة بكل أداة زيارات على حدة)
// ==================================================================
async function fetchVisitAreas(toolId) {
  const { data, error } = await supabaseClient
    .from("visit_areas")
    .select("*")
    .eq("tool_id", toolId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// ==================================================================
// الزيارات نفسها
// ==================================================================

// جلب زيارات أداة معيّنة (مع اسم الحالة والنطاق)، الأحدث أولًا
// mineOnly = true يرجّع زيارات المستخدم الحالي بس (تُستخدم تلقائيًا عبر RLS للمفتش،
// لكن نمررها صراحة عشان واجهة "زياراتي" تتصرف صح حتى لو فتحها مشرف بوضع المفتش)
//
// ملاحظة: ما نجلب اسم المفتش عبر ربط PostgREST المباشر (visits.inspector_id تشير
// إلى auth.users لا إلى profiles)، فنجلبه بطلب منفصل (fetchProfilesByIds) ونلحقه
// يدويًا — أضمن ولا يعتمد على وجود مفتاح خارجي مباشر بين الجدولين
async function fetchVisits(toolId, { mineOnly, myId } = {}) {
  let query = supabaseClient
    .from("visits")
    .select("*, visit_statuses(name), visit_areas(name)")
    .eq("tool_id", toolId)
    .order("visited_at", { ascending: false });

  if (mineOnly && myId) query = query.eq("inspector_id", myId);

  const { data, error } = await query;
  if (error) throw error;

  if (!mineOnly && data.length > 0) {
    // "كل الزيارات" (المشرف) يحتاج اسم المفتش لكل زيارة — نجلب الملفات المطلوبة دفعة وحدة
    const ids = [...new Set(data.map((v) => v.inspector_id))];
    const profilesById = await fetchProfilesByIds(ids);
    data.forEach((v) => {
      v.profiles = profilesById[v.inspector_id] || null;
    });
  }
  return data;
}

// جلب بيانات مجموعة مستخدمين بمعرّفاتهم (اسم ثلاثي + بريد) — طلب مباشر من profiles
// بدون الاعتماد على أي ربط تلقائي، فيشتغل بغض النظر عن تفاصيل المفاتيح الخارجية
async function fetchProfilesByIds(ids) {
  if (ids.length === 0) return {};
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  if (error) throw error;
  const map = {};
  data.forEach((p) => {
    map[p.id] = p;
  });
  return map;
}

// إضافة زيارة جديدة — id يُنشئه العميل مسبقًا (crypto.randomUUID()) عشان يُستخدم
// بمسار رفع الصور قبل ما يُحفظ صف الزيارة نفسه
async function addVisit(visit) {
  const { data, error } = await supabaseClient.from("visits").insert(visit).select().single();
  if (error) throw error;
  return data;
}

async function updateVisit(id, updates) {
  const { data, error } = await supabaseClient
    .from("visits")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// حذف زيارة واحدة (للمشرف فقط حسب صلاحيات RLS)
async function deleteVisit(id) {
  const { error } = await supabaseClient.from("visits").delete().eq("id", id);
  if (error) throw error;
}

// حذف ملف صورة واحد بمساره — تُستدعى لتنظيف صورة قديمة بعد رفع بديلة لها بمسار مختلف
async function deleteVisitPhotoFile(path) {
  if (!path) return;
  try {
    await supabaseClient.storage.from(VISIT_PHOTOS_BUCKET).remove([path]);
  } catch (e) {
    // تجاهل بصمت
  }
}

// تنظيف صور زيارة واحدة من التخزين (تُستدعى قبل deleteVisit من الصفحة نفسها،
// لأن حذف صف الزيارة وحده لا يحذف صورها تلقائيًا من Storage)
async function deleteVisitPhotoFiles(visit) {
  const paths = [visit.establishment_photo_path, visit.license_photo_path].filter(Boolean);
  if (paths.length === 0) return;
  try {
    await supabaseClient.storage.from(VISIT_PHOTOS_BUCKET).remove(paths);
  } catch (e) {
    // تجاهل بصمت — حذف صف الزيارة أهم وما نوقفه بسبب فشل حذف الصور
  }
}

// عدد زيارات أداة معيّنة (تُستخدم برسالة تأكيد حذف الأداة)
async function countVisitsForTool(toolId) {
  const { count, error } = await supabaseClient
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("tool_id", toolId);
  if (error) throw error;
  return count || 0;
}

// ==================================================================
// صور الزيارات — مخزن خاص (Private)، لازم رابط موقّت مؤقت لعرضها
// المسار: {inspector_id}/{visit_id}/establishment.jpg أو license.jpg
// ==================================================================

// رفع صورة زيارة (منشأة أو رخصة) بعد ضغطها، وإرجاع المسار (مو رابط عام، لأن الـ bucket خاص)
async function uploadVisitPhoto(file, inspectorId, visitId, kind) {
  const compressedFile = await compressImage(file);
  const path = `${inspectorId}/${visitId}/${kind}.jpg`;
  const { error } = await supabaseClient.storage
    .from(VISIT_PHOTOS_BUCKET)
    .upload(path, compressedFile, { upsert: true });
  if (error) throw error;
  return path;
}

// رابط مؤقت لعرض صورة محفوظة بالمخزن الخاص (صالح لساعة واحدة)
async function getVisitPhotoSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabaseClient.storage
    .from(VISIT_PHOTOS_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) return null; // لا نكسر عرض الزيارة كاملة بسبب فشل رابط صورة وحدة
  return data.signedUrl;
}

// -------------------------------------------------
// تنظيف كل صور أداة زيارات قبل حذفها نهائيًا (تُستدعى من tools-admin.html)
// نجمع كل المسارات أول (establishment + license لكل زياراتها)، ثم نحذفها دفعة وحدة
// -------------------------------------------------
async function deleteAllVisitPhotosForTool(toolId) {
  const { data, error } = await supabaseClient
    .from("visits")
    .select("establishment_photo_path, license_photo_path")
    .eq("tool_id", toolId);
  if (error) throw error;

  const paths = [];
  data.forEach((v) => {
    if (v.establishment_photo_path) paths.push(v.establishment_photo_path);
    if (v.license_photo_path) paths.push(v.license_photo_path);
  });
  if (paths.length === 0) return;

  try {
    await supabaseClient.storage.from(VISIT_PHOTOS_BUCKET).remove(paths);
  } catch (e) {
    // تجاهل بصمت — حذف صف الأداة أهم وما نوقفه بسبب فشل حذف بعض الصور
  }
}
