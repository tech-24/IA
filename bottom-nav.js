// ==================================================================
// bottom-nav.js — منطق مشترك للشريط السفلي بصفحات المفتش
// يتطلب تحميل circulars.js قبل هذا الملف (فيه hasUnreadCirculars)
// ==================================================================

// -------------------------------------------------
// تتحقق هل فيه تعميم غير مقروء، وتضيف/تحذف نقطة التنبيه الحمراء
// فوق أيقونة "تعاميم" بالشريط السفلي حسب النتيجة
// تُستدعى عند تحميل أي صفحة فيها الشريط، وبعد أي تعميم يُقرأ
// -------------------------------------------------
async function updateCircularsNavDot() {
  try {
    const unread = await hasUnreadCirculars();
    const link = document.querySelector('.bottom-nav a[href="circulars.html"]');
    if (!link) return;

    let dot = link.querySelector(".nav-dot");
    if (unread && !dot) {
      dot = document.createElement("span");
      dot.className = "nav-dot";
      link.appendChild(dot);
    } else if (!unread && dot) {
      dot.remove();
    }
  } catch (e) {
    // فشل التحقق ما يوقف الصفحة، نتجاهله بصمت
  }
}
