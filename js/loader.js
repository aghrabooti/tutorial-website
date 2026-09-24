/* ─────────────────────────────────────────────────────────────
   loader.js — مدیریت لودر سراسری + ابزار اسکلتون برای بخش‌های پویا
   این فایل با defer در <head> همه‌ی صفحات بارگذاری می‌شود.
   نکته: خودِ لودر داخل HTML هر صفحه است (تا پیش از اجرای JS هم دیده شود)
   و این فایل فقط آن را در زمان درست مخفی می‌کند.
   ───────────────────────────────────────────────────────────── */
(function () {
    "use strict";

    var MIN_SHOW = 300;    // حداقل زمان نمایش (میلی‌ثانیه) تا چشم نخوره
    var MAX_SHOW = 5000;   // قفل اطمینان: اگر «load» هرگز رخ نداد، ببند
    var START = Date.now();
    var closed = false;

    function loaderEl() {
        return document.getElementById("page-loader");
    }

    function hideLoader() {
        if (closed) return;
        closed = true;

        var el = loaderEl();
        var bar = document.getElementById("page-loader-bar");

        if (bar) {
            bar.style.transition = "opacity .3s ease";
            bar.style.opacity = "0";
            setTimeout(function () { bar.remove(); }, 320);
        }

        if (!el) return;

        el.classList.add("is-done");

        // بعد از محو شدن، از DOM حذف می‌شود تا هیچ عکس/اسکرین‌شاتی از گوگل
        // یا کاربر آن را نبیند و پشت صفحه باقی نماند
        setTimeout(function () { el.remove(); }, 420);
    }

    function scheduleHide() {
        var elapsed = Date.now() - START;
        setTimeout(hideLoader, Math.max(0, MIN_SHOW - elapsed));
    }

    // مهم: منتظر «load» کامل نمی‌مانیم (چون اگر عکسی سنگین باشد کاربر
    // پشت لودر می‌ماند). با آماده‌شدن ساختار صفحه لودر کنار می‌رود.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scheduleHide);
    } else {
        scheduleHide();
    }

    window.addEventListener("load", scheduleHide);

    // اگر صفحه از کش مرورگر (back/forward) برگشت، لودر نباید برگردد
    window.addEventListener("pageshow", function (e) {
        if (e.persisted) hideLoader();
    });

    // قفل اطمینان
    setTimeout(hideLoader, MAX_SHOW);

    // اگر خطای اجرایی رخ داد، صفحه پشت لودر گیر نکند
    window.addEventListener("error", function () {
        setTimeout(hideLoader, 400);
    });

    /* ── ابزار ساخت اسکلتون (برای بخش‌هایی که داده از Supabase می‌آید) ── */

    function repeat(n, fn) {
        var out = "";
        for (var i = 0; i < n; i++) out += fn(i);
        return out;
    }

    var Skeleton = {
        // کارت شبیه کارت دوره‌ها
        card: function () {
            return '' +
                '<div class="sk-card">' +
                    '<div class="relative">' +
                        '<div class="sk sk-cover"></div>' +
                        '<div class="sk sk-badge"></div>' +
                    '</div>' +
                    '<div class="sk-body">' +
                        '<div style="display:flex;flex-direction:column;gap:10px">' +
                            '<div class="sk sk-line tall sk-block" style="width:75%"></div>' +
                            '<div class="sk sk-line sk-block mid"></div>' +
                            '<div class="sk sk-line short"></div>' +
                        '</div>' +
                        '<div class="sk-footer">' +
                            '<div class="sk sk-line tall" style="width:88px"></div>' +
                            '<div class="sk sk-pill"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        },

        cards: function (count, extraClass) {
            return repeat(count || 4, function () {
                var c = Skeleton.card();
                if (extraClass) {
                    c = c.replace('class="sk-card"', 'class="sk-card ' + extraClass + '"');
                }
                return c;
            });
        },

        // چند خط متن
        lines: function (count, widths) {
            widths = widths || ["mid", "short", "", "short"];
            return repeat(count || 3, function (i) {
                return '<div class="sk sk-line ' + (widths[i % widths.length] || "") + '" style="margin-bottom:10px"></div>';
            });
        },

        // ردیف شبیه جدول‌های پنل ادمین
        row: function () {
            return '' +
                '<div class="sk-row">' +
                    '<div class="sk sk-avatar"></div>' +
                    '<div class="sk-lines">' +
                        '<div class="sk sk-line mid"></div>' +
                        '<div class="sk sk-line short"></div>' +
                    '</div>' +
                '</div>';
        },

        rows: function (count) {
            return repeat(count || 4, function () { return Skeleton.row(); });
        },
    };

    /* ── اسپینر روی دکمه‌ها (مثلاً هنگام پرداخت یا ذخیره) ── */

    function btnLoading(btn, on, label) {
        if (!btn) return;

        if (on) {
            if (btn.dataset.originalHtml === undefined) {
                btn.dataset.originalHtml = btn.innerHTML;
            }
            btn.dataset.loading = "1";
            btn.disabled = true;
            btn.innerHTML = '<span class="btn-spin"></span>' + (label || btn.dataset.loadingLabel || "در حال انجام…");
        } else {
            btn.dataset.loading = "0";
            btn.disabled = false;
            if (btn.dataset.originalHtml !== undefined) {
                btn.innerHTML = btn.dataset.originalHtml;
                delete btn.dataset.originalHtml;
            }
        }
    }

    /* ── اسپینر داخل هر عنصر (مثلاً متن «در حال بارگذاری») ── */

    function inlineSpinner(label) {
        return '<span style="display:inline-flex;align-items:center;gap:8px;justify-content:center">' +
               '<span class="btn-spin dark"></span>' + (label || "در حال بارگذاری…") +
               '</span>';
    }

    window.Skeleton = Skeleton;
    window.btnLoading = btnLoading;
    window.inlineSpinner = inlineSpinner;
    window.hidePageLoader = hideLoader;
})();
