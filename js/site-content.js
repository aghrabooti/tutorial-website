/* ─────────────────────────────────────────────────────────────
   site-content.js — اعمال متن‌ها و عکس‌های ویرایش‌شده از پنل ادمین

   مکانیزم:
   ۱) هر عنصری که در HTML مقدار پیش‌فرض دارد، با data-content="کلید"
      یا data-content-img="کلید" علامت‌گذاری شده است.
   ۲) این فایل مقدارهای ذخیره‌شده را می‌گیرد و روی همان عنصرها می‌گذارد.
   ۳) اگر کلیدی در دیتابیس نباشد، عنصر دست‌نخورده می‌مانَد → سایت همیشه
      حتی بدون این فایل هم درست نمایش داده می‌شود (بریف امن برای سئو).
   ───────────────────────────────────────────────────────────── */
(function () {
    "use strict";

    var CACHE_KEY = "site_content_cache_v1";
    var API_FUNCTION = "site-content";

    /* اگر فانکشن site-content روی سرور نباشد (مثلاً هنوز ساخته نشده)،
       هر بار صدا زدنش یک خطای قرمز CORS در کنسول می‌سازد. پس یک‌بار
       امتحان می‌کنیم و بعدش مدتی بی‌سر‌و‌صدا رد می‌شویم.
       برای تلاش دوباره‌ی فوری: window.SiteContent.refresh() */
    var SKIP_KEY = "site_content_skip_v1";
    var SKIP_MS = 6 * 60 * 60 * 1000; // شش ساعت

    function isSkipped() {
        try {
            var t = Number(localStorage.getItem(SKIP_KEY) || 0);
            return t > 0 && Date.now() - t < SKIP_MS;
        } catch (e) {
            return false;
        }
    }

    function markSkipped() {
        try {
            localStorage.setItem(SKIP_KEY, String(Date.now()));
        } catch (e) {
            /* بی‌خیال */
        }
    }

    function clearSkip() {
        try {
            localStorage.removeItem(SKIP_KEY);
        } catch (e) {
            /* بی‌خیال */
        }
    }

    /* ── اعمال یک نگاشت (کلید → مقدار) روی DOM ── */

    function applyOne(el, value, kind) {
        if (value === undefined || value === null || value === "") return false;

        try {
            if (kind === "image") {
                if (el.getAttribute("src") === value) return false;
                el.setAttribute("src", value);
                el.removeAttribute("srcset");
                return true;
            }

            if (kind === "counter") {
                var num = Number(String(value).replace(/[^\d.-]/g, ""));
                if (el.dataset.count !== undefined) el.dataset.count = String(num || value);
                var formatted = isNaN(num) ? value : num.toLocaleString("fa-IR");
                if (el.textContent !== formatted) el.textContent = formatted;
                return true;
            }

            if (el.dataset.contentType === "html") {
                if (el.innerHTML === value) return false;
                el.innerHTML = value;
                return true;
            }

            if (el.textContent.trim() !== String(value).trim()) {
                el.textContent = value;
                return true;
            }
        } catch (e) {
            /* یک عنصر خراب نباید بقیه‌ی صفحه را متوقف کند */
        }

        return false;
    }

    function applyContent(map) {
        if (!map || typeof map !== "object") return 0;

        var n = 0;

        document.querySelectorAll("[data-content]").forEach(function (el) {
            var key = el.getAttribute("data-content");
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                var type = el.dataset.contentType || "text";
                if (applyOne(el, map[key], type)) n++;
            }
        });

        document.querySelectorAll("[data-content-img]").forEach(function (el) {
            var key = el.getAttribute("data-content-img");
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                if (applyOne(el, map[key], "image")) n++;
            }
        });

        return n;
    }

    /* ── کش محلی: تا صفحه بدون پرش و بدون انتظار شبکه نمایش داده شود ── */

    function readCache() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && parsed.content ? parsed.content : null;
        } catch (e) {
            return null;
        }
    }

    function writeCache(content) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                content: content,
                saved_at: Date.now(),
            }));
        } catch (e) {
            /* حافظه پر است — بی‌خیال */
        }
    }

    /* ── گرفتن مقدارها از سرور ── */

    async function fetchContent() {
        var payload = { action: "get" };

        try {
            if (typeof apiCall === "function") {
                var res = await apiCall(API_FUNCTION, payload);
                return res && res.content ? res.content : null;
            }

            // اگر api.js در صفحه نبود، مستقیم صدا می‌زنیم
            var base = "https://qbsfotperzzhuimnpmto.supabase.co/functions/v1";
            var anon =
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFic2ZvdHBlcnp6aHVpbW5wbXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTM2NzIsImV4cCI6MjA5OTI4OTY3Mn0.N8Pv0hz3yKLcTVvwfiRlKW-yEE-d4vc1rkroZBglyTA";

            var response = await fetch(base + "/" + API_FUNCTION, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + anon,
                },
                body: JSON.stringify(payload),
            });

            var data = await response.json();
            return data && data.content ? data.content : null;
        } catch (e) {
            return null;
        }
    }

    /* ── بخش مشترک (فوتر/هدر) با JS تزریق می‌شود، پس دوباره اعمال می‌کنیم ── */

    function watchInjectedParts(map) {
        if (!window.MutationObserver) return;

        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes.length) {
                    applyContent(map);
                    return;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // بعد از چند ثانیه، دیده‌بانی لازم نیست
        setTimeout(function () { observer.disconnect(); }, 8000);
    }

    /* ── شروع ── */

    var current = {};

    async function init(force) {
        var cached = readCache();
        if (cached) {
            current = cached;
            applyContent(cached);
        }

        // فانکشن روی سرور نیست؟ بی‌سروصدا رد شو (متن‌های پیش‌فرض سایت می‌مانند)
        if (!force && isSkipped()) {
            watchInjectedParts(current);
            return;
        }

        var fresh = await fetchContent();

        if (fresh) {
            clearSkip();
            current = fresh;
            writeCache(fresh);
            applyContent(fresh);
        } else if (!cached) {
            // سرور جواب نداد و نسخه‌ی کش‌شده هم نداریم → مدتی بی‌سروصدا می‌مانیم
            markSkipped();

            if (window.console && console.info) {
                console.info(
                    "site-content روی سرور در دسترس نیست؛ متن‌های پیش‌فرض سایت نمایش داده می‌شود."
                );
            }
        }

        watchInjectedParts(current);
    }

    window.applySiteContent = function (map) {
        return applyContent(map || current);
    };

    window.SiteContent = {
        apply: applyContent,
        refresh: function () { return init(true); },
        get current() { return current; },
        CACHE_KEY: CACHE_KEY,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
