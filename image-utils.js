// ==================================================================
// image-utils.js — أدوات مشتركة لمعالجة الصور
// حاليًا فيها دالة واحدة: ضغط/تصغير الصورة قبل رفعها لـ Supabase Storage
// صور الآيفون الأصلية أحيانًا توصل 5-10 ميجابايت، وهذا يخلي الرفع بطيء جدًا
// هذي الدالة تصغّر أبعاد الصورة وتقلل جودتها شوي قبل الرفع، بدون فرق يُلاحظ
// بالعين، لكن حجم الملف ينزل بشكل كبير (غالبًا أقل من 300 كيلوبايت)
// ==================================================================

// -------------------------------------------------
// تضغط ملف صورة وترجع ملف جديد أصغر بصيغة jpg
// maxDimension: أقصى عرض أو ارتفاع بالبكسل (الأبعاد الزائدة تتصغّر بنفس النسبة)
// quality: جودة الضغط من 0 إلى 1 (0.75 جودة جيدة جدًا بحجم صغير)
// -------------------------------------------------
function compressImage(file, maxDimension = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();

      img.onload = () => {
        let { width, height } = img;

        // نحسب الأبعاد الجديدة بنفس نسبة الصورة الأصلية، بدون تشويه
        if (width > height && width > maxDimension) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("تعذر ضغط الصورة"));
              return;
            }
            // نحوّل الـ blob لملف بنفس واجهة File العادية عشان بقية الكود يتعامل معه بدون تغيير
            const compressedFile = new File(
              [blob],
              file.name.replace(/\.[^.]+$/, ".jpg"),
              { type: "image/jpeg" }
            );
            resolve(compressedFile);
          },
          "image/jpeg",
          quality
        );
      };

      img.onerror = () => reject(new Error("تعذر قراءة الصورة"));
      img.src = event.target.result;
    };

    reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
    reader.readAsDataURL(file);
  });
}

// -------------------------------------------------
// تستخرج اسم الملف من رابط Supabase Storage العام
// (الرابط شكله https://xxx.supabase.co/storage/v1/object/public/<bucket>/<filename>)
// تُستخدم قبل حذف أي ملف فعليًا من التخزين، عشان نعرف اسمه بالضبط
// -------------------------------------------------
function extractStorageFileName(publicUrl) {
  if (!publicUrl) return null;
  const parts = publicUrl.split("/");
  return parts[parts.length - 1] || null;
}

// ==================================================================
// ختم التاريخ والوقت والعنوان على صور التصوير (يُستخدم عند التقاط صورة من الكاميرا فقط)
// الصور المختارة من المعرض لا تُختم
// ==================================================================

// تاريخ ميلادي بصيغة النظام الموحّدة + وقت بنظام 12 ساعة مع الثواني: 2026/10/09 – 10:42:05 م
function formatStampDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 >= 12 ? "م" : "ص";
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} – ${h12}:${p(d.getMinutes())}:${p(d.getSeconds())} ${suffix}`;
}

// تحويل الإحداثيات إلى عنوان نصي عبر OpenStreetMap (Nominatim). ترجع أسطر العنوان، أو مصفوفة فارغة عند أي فشل.
// تُخزَّن النتيجة مؤقتًا لنفس الموقع لتخدم صورتي المنشأة والرخصة بطلب واحد.
const _addressCache = new Map();
function fetchAddressLines(lat, lng, timeoutMs = 3000) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_addressCache.has(key)) return _addressCache.get(key);

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ar`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];
      const a = (await res.json()).address || {};

      const road = [a.house_number, a.road].filter(Boolean).join(" ");
      let hood = a.neighbourhood || a.suburb || a.quarter || a.city_district || "";
      if (hood && !/^حي\s/.test(hood)) hood = "حي " + hood;
      const city = a.city || a.town || a.village || a.county || a.state || "";
      const place = [city, a.country].filter(Boolean).join("، ");

      return [road, hood, place].filter(Boolean);
    } catch (e) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  })();

  _addressCache.set(key, promise);
  // لا نحتفظ بنتيجة فاشلة حتى تُعاد المحاولة لاحقًا
  promise.then((lines) => { if (lines.length === 0) _addressCache.delete(key); });
  return promise;
}

// ترسم أسطر النص أعلى يمين الصورة (أبيض بظل خفيف) وترجع ملف JPEG جديد (مصغّر لأقصى 1280 بكسل)
async function stampPhoto(file, lines, maxDimension = 1280, quality = 0.85) {
  if (document.fonts && document.fonts.load) {
    try { await document.fonts.load("600 20px Tajawal"); } catch (e) {}
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > h && w > maxDimension) { h = Math.round(h * (maxDimension / w)); w = maxDimension; }
      else if (h >= w && h > maxDimension) { w = Math.round(w * (maxDimension / h)); h = maxDimension; }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      const margin = Math.round(Math.min(w, h) * 0.03);
      let fs = Math.max(14, Math.round(Math.min(w, h) * 0.045));
      ctx.direction = "rtl";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      const setFont = () => { ctx.font = `600 ${fs}px Tajawal, "Segoe UI", Arial, sans-serif`; };
      setFont();

      // لو أطول سطر أعرض من الصورة نصغّر الخط ليتسع
      const maxW = w - margin * 2;
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (widest > maxW) { fs = Math.max(10, Math.floor((fs * maxW) / widest)); setFont(); }

      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = fs * 0.25;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = fs * 0.05;
      let y = margin;
      const lineHeight = fs * 1.3;
      // نرسم النص مرتين ليقوى الظل ويبقى مقروءًا على الخلفيات الفاتحة
      for (let pass = 0; pass < 2; pass++) {
        let lineY = y;
        lines.forEach((l) => {
          ctx.fillText(l, w - margin, lineY);
          lineY += lineHeight;
        });
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("تعذر تجهيز الصورة")); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذر قراءة الصورة")); };
    img.src = url;
  });
}

// نافذة اختيار مصدر الصورة: "camera" أو "gallery" أو null عند الإلغاء
function pickPhotoSource() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "drp-overlay";
    overlay.innerHTML =
      '<div class="drp-box" style="max-width:320px">' +
      '<button type="button" data-v="camera" style="width:100%;margin-bottom:8px">التقاط صورة</button>' +
      '<button type="button" class="secondary drp-close" data-v="gallery" style="width:100%;margin:0 0 8px">اختيار من المعرض</button>' +
      '<button type="button" class="link-btn" data-v="" style="display:block;margin:10px auto 0">إلغاء</button>' +
      "</div>";
    document.body.appendChild(overlay);
    const finish = (v) => { overlay.remove(); resolve(v || null); };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) return finish(null);
      const btn = e.target.closest("button[data-v]");
      if (btn) finish(btn.dataset.v);
    });
  });
}
