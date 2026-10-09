// ==================================================================
// ملف المصادقة (auth.js) — كل الدوال المتعلقة بتسجيل الدخول/الخروج
// وتحديد صلاحية المستخدم (مشرف admin / زائر viewer)
// يجب تحميل config.js قبل هذا الملف بالصفحة (فيه supabaseClient)
// ==================================================================

// -------------------------------------------------
// تنقّي أي نص قبل إدراجه داخل HTML (بأي مكان يُستخدم فيه innerHTML)
// تمنع أي محاولة حقن كود (XSS) لو كتب المشرف رمز HTML بالغلط أو بقصد
// بأي اسم/عنوان/نص (قسم، بند، حالة، تعميم، أداة...)
// استخدمها دائمًا حول أي نص قادم من قاعدة البيانات قبل ما تحطه بقالب innerHTML
// -------------------------------------------------
function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

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
// fullName يُرسل ضمن بيانات التسجيل نفسها (مو باستدعاء منفصل بعدها)، وقاعدة البيانات
// تحفظه تلقائيًا بـ profiles.full_name عن طريق مُشغّل عند إنشاء الحساب
async function signup(email, password, fullName) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// طلب استعادة كلمة المرور: يرسل Supabase رابطًا للبريد يفتح صفحة reset-password.html
// الصفحة تحدد رابط العودة تلقائيًا من موقع الصفحة الحالية (نفس المجلد)
// -------------------------------------------------
async function requestPasswordReset(email) {
  const redirectTo = new URL("reset-password.html", window.location.href).href;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// -------------------------------------------------
// تعيين كلمة مرور جديدة للمستخدم الحالي (جلسة الاستعادة القادمة من رابط البريد)
// -------------------------------------------------
async function updateMyPassword(newPassword) {
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// -------------------------------------------------
// تسجيل خروج المستخدم الحالي، وإعادته لصفحة تسجيل الدخول
// -------------------------------------------------
async function logout() {
  sessionStorage.removeItem("mode_restore_done"); // عند الدخول التالي نعيد فحص آخر وضع
  sessionStorage.removeItem("inspector_profile_cache"); // نفضي النسخة المحفوظة مؤقتًا من بيانات الدور
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

// -------------------------------------------------
// جلب بيانات المستخدم المسجل دخوله حاليًا (id + email + role + is_disabled)
// لو ما فيه أحد مسجل دخول، ترجع null
// role تكون "owner" (مالك النظام) أو "admin" (مشرف) أو "viewer" (مفتش)
//
// تسريع: نخزّن النتيجة مؤقتًا بـ sessionStorage (يتفضّى تلقائيًا لما تسكّر التبويب،
// أو عند تسجيل الخروج). هذا يلغي طلب قاعدة بيانات إضافي بكل انتقال بين الصفحات
// بنفس الجلسة — بدل ما نسأل الخادم "مين أنت؟" بكل صفحة، نسأله مرة وحدة بس.
// -------------------------------------------------
async function getCurrentProfile() {
  // الخطوة 1: هل فيه جلسة (session) نشطة بالمتصفح؟
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  // الخطوة 2: لو عندنا نسخة محفوظة مؤقتًا لنفس المستخدم، نستخدمها فورًا بدون اتصال بالخادم
  const cached = sessionStorage.getItem("inspector_profile_cache");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.id === session.user.id) return parsed;
    } catch (e) {
      // لو كان المحتوى المخزّن تالف لأي سبب، نتجاهله ونكمل نجيبه من الخادم عادي
    }
  }

  // الخطوة 3: نجيب صف هذا المستخدم من جدول profiles عشان نعرف دوره وحالة حسابه واسمه
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, role, is_disabled, full_name")
    .eq("id", session.user.id)
    .single();

  if (error) return null;

  sessionStorage.setItem("inspector_profile_cache", JSON.stringify(data));
  return data;
}

// -------------------------------------------------
// شاشة الحساب المعطّل — تستبدل محتوى الصفحة بالكامل، تستخدمها requireAuth تلقائيًا
// -------------------------------------------------
function showDisabledAccountScreen() {
  document.body.innerHTML = `
    <div class="disabled-account-screen">
      <h2>تم تعطيل حسابك</h2>
      <p>لا يمكنك استخدام مساعد المفتش حاليًا. تواصل مع مالك النظام لإعادة تفعيل حسابك.</p>
      <button id="disabledLogoutBtn" class="secondary">تسجيل الخروج</button>
    </div>
  `;
  document.getElementById("disabledLogoutBtn").addEventListener("click", logout);
}

// -------------------------------------------------
// حفظ الاسم الثلاثي للمستخدم الحالي (صفحة "حسابي")
// عن طريق دالة set_my_name فقط — ما نعدّل صف profiles مباشرة، حتى ما يقدر أحد يغيّر دوره
// -------------------------------------------------
async function setMyName(name) {
  const { error } = await supabaseClient.rpc("set_my_name", { p_name: name });
  if (error) throw error;
  // نحدّث النسخة المخزّنة مؤقتًا عشان الاسم الجديد يبين فورًا بباقي الصفحات بدون انتظار
  const cached = sessionStorage.getItem("inspector_profile_cache");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      parsed.full_name = name;
      sessionStorage.setItem("inspector_profile_cache", JSON.stringify(parsed));
    } catch (e) {
      // لو كانت النسخة المخزّنة تالفة، نتجاهل التحديث المؤقت — ستُجلب صحيحة بالمرة الجاية
    }
  }
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
// - لو الحساب معطّل → يستبدل الصفحة بشاشة "تم تعطيل حسابك"
// - لو adminOnly = true والمستخدم دوره viewer → يحوّل لصفحة index.html
//   (مالك النظام "owner" يُعامل معاملة المشرف بالكامل، فيعتبر مطابقًا لـ adminOnly)
// - لو كل شي تمام → يرجع بيانات المستخدم (profile) عشان تستخدمها بالصفحة،
//   ويُظهر رابط "إدارة المستخدمين" بالقائمة الجانبية تلقائيًا لو كان المستخدم مالك النظام
// -------------------------------------------------
async function requireAuth(options = {}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    window.location.href = "login.html";
    return null;
  }

  if (profile.is_disabled) {
    showDisabledAccountScreen();
    return null;
  }

  const isAdminOrOwner = profile.role === "admin" || profile.role === "owner";
  if (options.adminOnly && !isAdminOrOwner) {
    window.location.href = "index.html";
    return null;
  }

  // رابط إدارة المستخدمين بالقائمة الجانبية (لو موجود بالصفحة) يظهر لمالك النظام فقط
  const usersLink = document.getElementById("usersManageLink");
  if (usersLink) usersLink.style.display = profile.role === "owner" ? "" : "none";

  return profile;
}
