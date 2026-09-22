// ==================================================================
// ملف الإعدادات — يحتوي بيانات الاتصال بمشروع Supabase الخاص بك
// كل الصفحات (login.html, index.html, admin.html) تحمّل هذا الملف
// أول شي عشان يصير عندها اتصال جاهز بقاعدة البيانات
// ==================================================================

// رابط مشروعك في Supabase
// تلقاه من: Supabase Dashboard > Project Settings > API > Project URL
const SUPABASE_URL = "https://twbatrsenepuaylyiqsq.supabase.co";

// المفتاح العام (anon key) — مفتاح عادي غير سري، مخصص للاستخدام من المتصفح
// تلقاه من نفس الصفحة: Supabase Dashboard > Project Settings > API > anon public
const SUPABASE_ANON_KEY = "sb_publishable_lmkLoSyKSvFvaZz9ORo0hg_E4v2a0a4";

// إنشاء "عميل" Supabase (supabaseClient) باستخدام الرابط والمفتاح أعلاه
// هذا المتغير supabaseClient هو اللي تستخدمه بقية الملفات (auth.js وغيره)
// للتواصل مع قاعدة البيانات والمصادقة — لا تغيّر اسمه إلا إذا عدّلت
// كل مكان يُستخدم فيه بالملفات الثانية
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
