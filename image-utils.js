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
