// ─────────────────────────────────────────────────────────────────
// دارک‌مود — سوییچ تم با نگه‌داری در localStorage
// مقدار اولیه در <head> هر صفحه (قبل از رندر) اعمال می‌شود تا فلش
// سفید رخ ندهد؛ این فایل فقط دکمه و آیکون‌ها را مدیریت می‌کند.
// ─────────────────────────────────────────────────────────────────
(function () {

    function isDark() {
        return document.documentElement.classList.contains("dark");
    }

    function syncIcons() {
        const dark = isDark();
        document
            .querySelectorAll("[data-theme-icon]")
            .forEach((el) => {
                el.textContent = dark ? "☀️" : "🌙";
            });
    }

    function toggle() {
        const dark = !isDark();

        document.documentElement.classList.toggle("dark", dark);

        try {
            localStorage.setItem("theme", dark ? "dark" : "light");
        } catch (e) {}

        syncIcons();
    }

    // دکمه ممکن است دیر (از طریق فچ هدر) به صفحه برسد — delegation
    document.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-theme-toggle]");
        if (btn) {
            e.preventDefault();
            toggle();
        }
    });

    document.addEventListener("DOMContentLoaded", syncIcons);

})();
