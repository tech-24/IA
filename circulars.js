// ==================================================================
// circulars.js — دوال التعاميم (تُستخدم بلوحة المشرف وصفحة عرض المفتش)
// يتطلب تحميل config.js قبل هذا الملف
// ==================================================================

// -------------------------------------------------
// سطر توقيع التعميم: "آخر تعديل: <المعدّل>" إن وُجد (حتى لو كان هو الكاتب)،
// وإلا "بواسطة: <الكاتب>"، وإذا الاثنين فارغين ما يظهر سطر (ترجع نصًا فارغًا)
// العمودان author_name و editor_name تعبّيهما قاعدة البيانات تلقائيًا عند الإضافة والتعديل،
// فلا نرسلهما أبدًا عند الحفظ — ويصلان مع كل جلب لأن الاستعلامات تطلب كل الأعمدة (select *)،
// وكذلك مع الصف المرجَّع بعد الإضافة والتعديل (.select() بعد insert/update)
// -------------------------------------------------
function circularSignature(c) {
  const editor = (c.editor_name || "").trim();
  if (editor) return "آخر تعديل: " + editor;
  const author = (c.author_name || "").trim();
  if (author) return "بواسطة: " + author;
  return "";
}

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
// image_url اختياري: لا يُرسل للقاعدة إلا إذا مُرِّر (حتى تبقى الإضافة تعمل قبل تشغيل SQL العمود الجديد)
// -------------------------------------------------
async function addCircular({ title, content, image_url }) {
  const row = { title, content };
  if (image_url !== undefined) row.image_url = image_url;
  const { data, error } = await supabaseClient
    .from("circulars")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// تعديل تعميم موجود — ترجع الصف بعد التعديل
// image_url: لا يُمرَّر = بدون تغيير، رابط = صورة جديدة، null = حذف الصورة
// -------------------------------------------------
async function updateCircular(id, { title, content, image_url }) {
  const updates = { title, content };
  if (image_url !== undefined) updates.image_url = image_url;
  const { data, error } = await supabaseClient
    .from("circulars")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------
// حذف تعميم — ونحذف صورته (إن وُجدت) من التخزين بعد نجاح حذف الصف
// imageUrl: رابط صورة التعميم الحالية (من الكائن المعروض بالصفحة)
// -------------------------------------------------
async function deleteCircular(id, imageUrl) {
  const { error } = await supabaseClient.from("circulars").delete().eq("id", id);
  if (error) throw error;
  if (imageUrl) await deleteCircularImageFile(imageUrl);
}

// ==================================================================
// صورة التعميم (صورة واحدة اختيارية) — حاوية Storage عامة اسمها circular-images
// الرفع والحذف للمشرف فقط (بسياسات Storage). يتطلب image-utils.js قبل هذا الملف
// ==================================================================
const CIRCULAR_IMAGES_BUCKET = "circular-images";

// يضغط الصورة (JPEG، أقصى بُعد 1280، جودة 75%) ويرفعها باسم فريد، ويرجع رابطها العام
async function uploadCircularImage(file) {
  const compressed = await compressImage(file, 1280, 0.75);
  const fileName = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabaseClient.storage
    .from(CIRCULAR_IMAGES_BUCKET)
    .upload(fileName, compressed, { contentType: "image/jpeg" });
  if (error) throw error;
  const { data } = supabaseClient.storage.from(CIRCULAR_IMAGES_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// يحذف ملف صورة تعميم من التخزين بصمت (فشل الحذف لا يوقف شيئًا، والصف أهم)
// نتأكد أن الرابط فعلًا من حاويتنا حتى لا نحذف شيئًا غير مقصود
async function deleteCircularImageFile(url) {
  if (!url || !url.includes("/" + CIRCULAR_IMAGES_BUCKET + "/")) return;
  const fileName = extractStorageFileName(url);
  if (!fileName) return;
  try {
    await supabaseClient.storage.from(CIRCULAR_IMAGES_BUCKET).remove([fileName]);
  } catch (e) {
    // تجاهل بصمت
  }
}

// -------------------------------------------------
// حفظ تعميم (جديد أو معدّل) مع معالجة صورته كاملة:
//  - رفع الصورة الجديدة أولًا، ثم حفظ التعميم برابطها
//  - لو فشل حفظ التعميم بعد الرفع: نحذف الصورة اللي ارتفعت
//  - لو انحفظ والصورة القديمة استُبدلت أو حُذفت: نحذف ملفها القديم
// id: null للإضافة. newFile: ملف جديد أو null. removeImage: true لحذف الصورة الحالية
// ترجع الصف المحفوظ
// -------------------------------------------------
async function saveCircularWithImage({ id, title, content, newFile, removeImage, oldImageUrl }) {
  let uploadedUrl = null;
  if (newFile) uploadedUrl = await uploadCircularImage(newFile);

  const fields = { title, content };
  if (newFile) fields.image_url = uploadedUrl;
  else if (removeImage) fields.image_url = null;

  let saved;
  try {
    saved = id ? await updateCircular(id, fields) : await addCircular(fields);
  } catch (e) {
    if (uploadedUrl) await deleteCircularImageFile(uploadedUrl);
    throw e;
  }

  if (oldImageUrl && (newFile || removeImage)) await deleteCircularImageFile(oldImageUrl);
  return saved;
}

// -------------------------------------------------
// خانة "إرفاق صورة (اختياري)" داخل نافذة التعميم
// تُبنى داخل عنصر حاوية فاضي، وترجع مقبضًا للتحكم:
//   setCurrent(url): تعيين الصورة المحفوظة (أو null) وتصفير أي اختيار
//   reset(): نفس setCurrent(null)
//   getState(): { newFile, removeImage }
// -------------------------------------------------
function mountCircularImageField(container) {
  container.className = "field circ-img-field";
  container.innerHTML =
    "<label>إرفاق صورة (اختياري)</label>" +
    '<div class="circ-img-preview" style="display:none"><img alt="معاينة الصورة" /></div>' +
    '<div class="circ-img-actions">' +
    '<button type="button" class="secondary" data-act="pick">اختيار صورة</button>' +
    '<button type="button" class="link-btn" data-act="remove" style="display:none;color:#b91c1c">حذف الصورة</button>' +
    "</div>" +
    '<input type="file" accept="image/*" style="display:none" />';

  const preview = container.querySelector(".circ-img-preview");
  const previewImg = preview.querySelector("img");
  const pickBtn = container.querySelector('[data-act="pick"]');
  const removeBtn = container.querySelector('[data-act="remove"]');
  const input = container.querySelector('input[type="file"]');

  let currentUrl = null; // الصورة المحفوظة بالتعميم
  let newFile = null;    // صورة اختارها المستخدم للتو
  let removed = false;   // طلب حذف الصورة المحفوظة
  let objectUrl = null;

  function render() {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    let shown = null;
    if (newFile) {
      objectUrl = URL.createObjectURL(newFile);
      shown = objectUrl;
    } else if (!removed) {
      shown = currentUrl;
    }
    if (shown) {
      previewImg.src = shown;
      preview.style.display = "block";
    } else {
      previewImg.removeAttribute("src");
      preview.style.display = "none";
    }
    pickBtn.textContent = shown ? "تغيير الصورة" : "اختيار صورة";
    removeBtn.style.display = shown ? "inline-block" : "none";
  }

  pickBtn.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const f = input.files[0];
    input.value = "";
    if (!f) return;
    newFile = f;
    removed = false;
    render();
  });
  removeBtn.addEventListener("click", () => {
    newFile = null;
    removed = !!currentUrl; // لو كان فيه صورة محفوظة نحذفها عند الحفظ
    render();
  });

  render();
  return {
    setCurrent(url) {
      currentUrl = url || null;
      newFile = null;
      removed = false;
      input.value = "";
      render();
    },
    reset() { this.setCurrent(null); },
    getState() { return { newFile, removeImage: removed }; },
  };
}

// -------------------------------------------------
// عرض صورة التعميم بملء الشاشة على خلفية سوداء مع زر إغلاق
// (يُغلق أيضًا بالضغط على الخلفية أو بمفتاح Esc)
// -------------------------------------------------
function openCircularImageLightbox(url) {
  const overlay = document.createElement("div");
  overlay.className = "circ-lightbox";
  overlay.innerHTML =
    '<button type="button" class="circ-lightbox-close" aria-label="إغلاق">' +
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>' +
    "</button>" +
    '<img alt="صورة التعميم" />';
  overlay.querySelector("img").src = url;

  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.addEventListener("click", (e) => {
    if (e.target.closest(".circ-lightbox-close") || e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
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
