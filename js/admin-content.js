/* ─────────────────────────────────────────────────────────────
   admin-content.js — تب «محتوای سایت» در پنل مدیریت

   کار: مدیریت همه‌ی متن‌ها و عکس‌های سایت از یک‌جا.
   - فهرست فیلدها از js/content-manifest.js می‌آید (همان کلیدهای data-content)
   - مقدارهای ذخیره‌شده از فانکشن site-content خوانده می‌شوند
   - عکس‌ها با فشرده‌سازی سمت مرورگر آپلود می‌شوند (kind: "site")
   ───────────────────────────────────────────────────────────── */
(function () {
    "use strict";

    const token = localStorage.getItem("session_token");
    const manifest = window.SITE_CONTENT_MANIFEST;

    let savedValues = {};   // مقدارهای ذخیره‌شده در سرور
    let draft = {};         // تغییرهای ذخیره‌نشده
    let loading = false;
    let filter = "";

    function items() {
        return (manifest?.groups ?? []).flatMap((g) => g.items);
    }

    function esc(text) {
        return String(text ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
    }

    function has(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    /* مقدار فعلی هر فیلد: تغییر ذخیره‌نشده ← مقدار سرور ← پیش‌فرض */
    function valueOf(item) {
        if (has(draft, item.key)) return draft[item.key];
        if (has(savedValues, item.key)) return savedValues[item.key];
        return item.default ?? "";
    }

    function isDirty(key) {
        return has(draft, key) && draft[key] !== (savedValues[key] ?? "");
    }

    function dirtyKeys() {
        return items().map((i) => i.key).filter(isDirty);
    }

    function isOverridden(item) {
        return has(savedValues, item.key) && savedValues[item.key] !== "";
    }

    function status(text, kind) {
        const el = document.getElementById("content-status");
        if (!el) return;

        el.classList.remove("hidden");
        el.className =
            "mt-4 rounded-2xl p-4 text-sm font-bold " +
            (kind === "error"
                ? "bg-red-50 text-red-700 border border-red-100"
                : kind === "ok"
                ? "bg-green-50 text-green-700 border border-green-100"
                : "bg-indigo-50 text-indigo-700 border border-indigo-100");
        el.textContent = text;

        if (kind === "ok") {
            clearTimeout(el._t);
            el._t = setTimeout(() => el.classList.add("hidden"), 4000);
        }
    }

    /* ── ساخت فرم ── */

    function fieldHtml(item) {
        const value = valueOf(item);
        const dirty = isDirty(item.key) ? "ring-2 ring-amber-300" : "";
        const badge = isOverridden(item)
            ? `<span class="text-[10px] font-black bg-indigo-50 text-indigo-600 rounded-full px-2 py-0.5">ویرایش‌شده</span>`
            : `<span class="text-[10px] font-bold text-gray-300">پیش‌فرض</span>`;

        if (item.type === "image") {
            return `
                <div class="bg-gray-50 border border-gray-100 rounded-2xl p-4 ${dirty}">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <p class="text-sm font-black text-gray-800">${esc(item.label)}</p>
                            <p class="text-[11px] text-gray-400 mt-1" dir="ltr">${esc(item.key)}</p>
                        </div>
                        ${badge}
                    </div>

                    <div class="mt-3 flex items-center gap-3 flex-wrap">
                        <img src="${esc(value || item.default || "")}" alt="${esc(item.label)}"
                             class="w-24 h-24 object-cover rounded-2xl bg-white border border-gray-200"
                             onerror="this.style.opacity=.25">

                        <div class="flex flex-col gap-2">
                            <button type="button" data-upload="${esc(item.key)}"
                                class="bg-indigo-600 text-white text-xs font-bold rounded-full px-4 py-2 hover:bg-indigo-700">
                                انتخاب و آپلود عکس
                            </button>
                            <input type="file" accept="image/*" class="hidden" data-file="${esc(item.key)}">
                            <button type="button" data-reset="${esc(item.key)}"
                                class="text-[11px] font-bold text-gray-400 hover:text-red-500">
                                بازگشت به عکس پیش‌فرض
                            </button>
                        </div>
                    </div>
                </div>`;
        }

        const input =
            item.type === "html"
                ? `<textarea data-key="${esc(item.key)}" rows="3"
                       class="w-full mt-2 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm leading-relaxed">${esc(value)}</textarea>`
                : item.type === "counter"
                ? `<input data-key="${esc(item.key)}" value="${esc(value)}" inputmode="numeric"
                       class="w-full mt-2 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm" dir="ltr">`
                : `<input data-key="${esc(item.key)}" value="${esc(value)}"
                       class="w-full mt-2 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm">`;

        return `
            <div class="bg-gray-50 border border-gray-100 rounded-2xl p-4 ${dirty}">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="text-sm font-black text-gray-800">${esc(item.label)}</p>
                        <p class="text-[11px] text-gray-400 mt-1" dir="ltr">${esc(item.key)}</p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        ${badge}
                        <button type="button" data-reset="${esc(item.key)}"
                            class="text-[11px] font-bold text-gray-400 hover:text-red-500">بازگشت</button>
                    </div>
                </div>
                ${input}
            </div>`;
    }

    function render() {
        const host = document.getElementById("content-groups");
        if (!host) return;

        if (!manifest) {
            host.innerHTML = `<p class="text-red-500 text-sm font-bold">فهرست محتوا (content-manifest.js) بارگذاری نشد.</p>`;
            return;
        }

        const q = filter.trim().toLowerCase();

        host.innerHTML = manifest.groups
            .map((group) => {
                const groupItems = group.items.filter((item) => {
                    if (!q) return true;
                    return (
                        item.label.toLowerCase().includes(q) ||
                        item.key.toLowerCase().includes(q) ||
                        group.title.toLowerCase().includes(q)
                    );
                });

                if (!groupItems.length) return "";

                return `
                <div class="bg-white rounded-3xl shadow p-5 sm:p-6">
                    <div class="flex items-baseline justify-between gap-3 flex-wrap">
                        <h3 class="text-base font-black text-gray-900">${esc(group.title)}</h3>
                        <button type="button" data-group-reset="${esc(group.id)}"
                            class="text-[11px] font-bold text-gray-400 hover:text-red-500">
                            بازگردانی همه‌ی این بخش
                        </button>
                    </div>
                    ${group.hint ? `<p class="text-[11px] text-gray-400 mt-1">${esc(group.hint)}</p>` : ""}
                    <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        ${groupItems.map(fieldHtml).join("")}
                    </div>
                </div>`;
            })
            .join("");

        const n = dirtyKeys().length;
        const saveBtn = document.getElementById("content-save");
        if (saveBtn) {
            saveBtn.disabled = n === 0;
            saveBtn.className =
                "rounded-full px-6 py-3 text-sm font-black transition " +
                (n === 0
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700");
            saveBtn.textContent = n === 0 ? "تغییری برای ذخیره نیست" : `ذخیره ${n} تغییر`;
        }

        bindInputs();
    }

    function bindInputs() {
        document.querySelectorAll("[data-key]").forEach((el) => {
            el.oninput = () => {
                draft[el.dataset.key] = el.value;

                const card = el.closest("div[class*='rounded-2xl']");
                if (card) {
                    card.classList.toggle("ring-2", isDirty(el.dataset.key));
                    card.classList.toggle("ring-amber-300", isDirty(el.dataset.key));
                }

                const saveBtn = document.getElementById("content-save");
                const n = dirtyKeys().length;
                if (saveBtn) {
                    saveBtn.disabled = n === 0;
                    saveBtn.textContent = n === 0 ? "تغییری برای ذخیره نیست" : `ذخیره ${n} تغییر`;
                    saveBtn.className =
                        "rounded-full px-6 py-3 text-sm font-black transition " +
                        (n === 0
                            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                            : "bg-indigo-600 text-white hover:bg-indigo-700");
                }
            };
        });

        document.querySelectorAll("[data-reset]").forEach((btn) => {
            btn.onclick = () => resetKeys([btn.dataset.reset]);
        });

        document.querySelectorAll("[data-group-reset]").forEach((btn) => {
            btn.onclick = () => {
                const group = manifest.groups.find((g) => g.id === btn.dataset.groupReset);
                if (!group) return;
                if (!confirm(`همه‌ی متن‌های «${group.title}» به حالت پیش‌فرض برگردند؟`)) return;
                resetKeys(group.items.map((i) => i.key));
            };
        });

        document.querySelectorAll("[data-upload]").forEach((btn) => {
            btn.onclick = () => {
                const input = document.querySelector(`[data-file="${btn.dataset.upload}"]`);
                if (input) input.click();
            };
        });

        document.querySelectorAll("[data-file]").forEach((input) => {
            input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                await uploadImage(input.dataset.file, file);
                input.value = "";
            };
        });
    }

    /* ── ذخیره / بازگردانی ── */

    async function saveAll() {
        const keys = dirtyKeys();
        if (!keys.length) return;

        const payload = {};
        keys.forEach((key) => { payload[key] = draft[key]; });

        try {
            status("در حال ذخیره…", "info");
            const res = await apiCall("site-content", { token, action: "set", items: payload });

            if (!res?.success) throw new Error(res?.error || "خطا در ذخیره‌سازی");

            keys.forEach((key) => { savedValues[key] = draft[key]; delete draft[key]; });
            render();
            status(`✅ ${res.saved ?? keys.length} مورد ذخیره شد. سایت را تازه‌سازی کنید تا نتیجه را ببینید.`, "ok");
        } catch (e) {
            console.error(e);
            status("خطا در ذخیره‌سازی: " + e.message, "error");
        }
    }

    async function resetKeys(keys) {
        if (!keys.length) return;

        try {
            const res = await apiCall("site-content", { token, action: "reset", keys });

            if (!res?.success) throw new Error(res?.error || "خطا در بازگردانی");

            keys.forEach((key) => { delete savedValues[key]; delete draft[key]; });
            render();
            status("✅ به مقدار پیش‌فرض برگشت.", "ok");
        } catch (e) {
            console.error(e);
            status("خطا در بازگردانی: " + e.message, "error");
        }
    }

    /* ── آپلود عکس (با فشرده‌سازی سمت مرورگر) ── */

    function compressImage(file, maxWidth = 1400, quality = 0.85) {
        return new Promise((resolve) => {
            // SVG و GIF را دست نمی‌زنیم (فشرده‌سازی خرابش می‌کند)
            if (/svg|gif/i.test(file.type)) return resolve(file);

            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);

                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);

                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob(
                    (blob) => resolve(blob ? new File([blob], "image.jpg", { type: "image/jpeg" }) : file),
                    "image/jpeg",
                    quality
                );
            };

            img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    }

    async function uploadImage(key, file) {
        try {
            status("در حال فشرده‌سازی عکس…", "info");
            const optimized = await compressImage(file);

            status("در حال ساخت لینک آپلود…", "info");
            const res = await apiCall("admin-upload-url", {
                token,
                kind: "site",
                filename: file.name || "site-image.jpg",
            });

            if (!res?.upload_url) throw new Error(res?.error || "خطا در ساخت لینک آپلود");

            const put = await fetch(res.upload_url, {
                method: "PUT",
                headers: { "Content-Type": optimized.type || "application/octet-stream" },
                body: optimized,
            });

            if (!put.ok) throw new Error("آپلود ناموفق بود");

            draft[key] = res.public_url;
            render();

            const kb = Math.round(optimized.size / 1024);
            status(`✅ عکس آپلود شد (${kb} کیلوبایت). حالا «ذخیره تغییرات» را بزنید.`, "ok");
        } catch (e) {
            console.error(e);
            status("خطا در آپلود عکس: " + e.message, "error");
        }
    }

    /* ── بارگذاری اولیه ── */

    async function loadContentTab() {
        if (loading) return;
        loading = true;

        try {
            status("در حال خواندن محتوای ذخیره‌شده…", "info");
            const res = await apiCall("site-content", { action: "get" });
            savedValues = res?.content ?? {};
            draft = {};
            status(
                Object.keys(savedValues).length
                    ? `ℹ️ ${Object.keys(savedValues).length} مورد ویرایش‌شده روی سایت فعال است.`
                    : "ℹ️ هنوز هیچ متنی ویرایش نشده؛ سایت متن‌های پیش‌فرض خودش را نشان می‌دهد.",
                "info"
            );
        } catch (e) {
            console.error(e);
            status("خطا در خواندن محتوا: " + e.message, "error");
        }

        render();
        loading = false;
    }

    window.loadContentTab = loadContentTab;

    document.addEventListener("DOMContentLoaded", () => {
        const search = document.getElementById("content-search");
        if (search) {
            search.oninput = () => { filter = search.value; render(); };
        }

        const saveBtn = document.getElementById("content-save");
        if (saveBtn) saveBtn.onclick = saveAll;

        // اتصال به سیستم تب‌های پنل (js/admin.js)
        if (typeof loaders !== "undefined") loaders.content = loadContentTab;
    });
})();
