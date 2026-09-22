// ==================================================================
// ملف المصادقة (auth.js) — كل الدوال المتعلقة بتسجيل الدخول/الخروج
// وتحديد صلاحية المستخدم (مشرف admin / زائر viewer)
// يجب تحميل config.js قبل هذا الملف بالصفحة (فيه supabaseClient)
// ==================================================================

// -------------------------------------------------
// تسجيل دخول بحساب موجود مسبقًا (بريد + كلمة مرور)
// تُستخدم في login.html عند الضغط على زر "دخول"
// -------------------------------------------------
async function login(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error; // لو صار خطأ (بريد خطأ، كلمة مرور غلط...) يرمى للصفحة اللي طلبته
  return data;
}

// -------------------------------------------------
// إنشاء حساب جديد (بريد + كلمة مرور)
// عند الإنشاء، جدول profiles بقاعدة البيانات يضيف له صف تلقائيًا
// بدور "viewer" افتراضيًا (هذا معرّف بملف schema.sql وليس هنا)
// -------------------------------------------------
async function signup(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تسجيل خروج المستخدم الحالي، وإعادته لصفحة تسجيل الدخول
// -------------------------------------------------
async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

// -------------------------------------------------
// جلب بيانات المستخدم المسجل دخوله حاليًا (id + email + role)
// لو ما فيه أحد مسجل دخول، ترجع null
// role تكون إما "admin" أو "viewer" (معرّفة بجدول profiles)
// -------------------------------------------------
async function getCurrentProfile() {
  // الخطوة 1: هل فيه جلسة (session) نشطة بالمتصفح؟
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  // الخطوة 2: نجيب صف هذا المستخدم من جدول profiles عشان نعرف دوره
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, role")
    .eq("id", session.user.id)
    .single();

  if (error) return null;
  return data;
}

// -------------------------------------------------
// "حارس" الصفحات — يوضع بأول كود كل صفحة تحتاج تسجيل دخول
//
// استخدام بسيط (أي صفحة تتطلب تسجيل دخول بغض النظر عن الدور):
//     const profile = await requireAuth();
//
// استخدام لصفحات المشرف فقط (زي admin.html):
//     const profile = await requireAuth({ adminOnly: true });
//
// - لو ما فيه تسجيل دخول أصلاً → يحوّل لصفحة login.html
// - لو adminOnly = true والمستخدم دوره viewer → يحوّل لصفحة index.html
// - لو كل شي تمام → يرجع بيانات المستخدم (profile) عشان تستخدمها بالصفحة
// -------------------------------------------------
async function requireAuth(options = {}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    window.location.href = "login.html";
    return null;
  }

  if (options.adminOnly && profile.role !== "admin") {
    window.location.href = "index.html";
    return null;
  }

  return profile;
}
