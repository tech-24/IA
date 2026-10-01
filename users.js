// ==================================================================
// ملف إدارة المستخدمين (users.js) — خاص بصفحة users.html (مالك النظام فقط)
// يعتمد على دوال جاهزة بقاعدة البيانات (set_user_role, set_user_disabled)
// تتحقق هي نفسها إن الطالب هو المالك وترفض غيره، فهذا الملف مجرد واجهة لها
// يجب تحميل config.js قبل هذا الملف (فيه supabaseClient)
// ==================================================================

// -------------------------------------------------
// جلب كل حسابات النظام، مرتبة من الأقدم للأحدث (ترتيب التسجيل)
// -------------------------------------------------
async function fetchAllProfiles() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, role, is_disabled, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تغيير دور حساب: newRole تكون "admin" (ترقية لمشرف) أو "viewer" (إرجاع لمفتش)
// الدالة بقاعدة البيانات نفسها ترفض أي محاولة غير مصرّح بها (غير المالك، أو على المالك نفسه)
// -------------------------------------------------
async function setUserRole(targetId, newRole) {
  const { error } = await supabaseClient.rpc("set_user_role", {
    target: targetId,
    new_role: newRole,
  });
  if (error) throw error;
}

// -------------------------------------------------
// تعطيل أو تفعيل حساب
// -------------------------------------------------
async function setUserDisabled(targetId, disabled) {
  const { error } = await supabaseClient.rpc("set_user_disabled", {
    target: targetId,
    disabled: disabled,
  });
  if (error) throw error;
}
