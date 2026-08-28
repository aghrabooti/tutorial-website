// ─────────────────────────────────────────────────────────────
// پنل مدیریت — داشبورد، سفارش‌ها، مرسوله‌ها، کاربران، فایل‌ها
// ─────────────────────────────────────────────────────────────

function checkAdmin() {

    const token = localStorage.getItem("session_token");

    if (!token) {
        window.location.href = "/login";
        return false;
    }

    const user = JSON.parse(localStorage.getItem("user") || "null");

    if (!user || user.role !== "admin") {
        alert("دسترسی غیرمجاز");
        window.location.href = "/dashboard";
        return false;
    }

    return true;
}

if (!checkAdmin()) {
    throw new Error("unauthorized");
}

const token = localStorage.getItem("session_token");


// ── ابزارهای کمکی ──

const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));

const faNum = (n) => Number(n ?? 0).toLocaleString("fa-IR");

// مبالغ در orders به ریال است؛ نمایش به تومان
const toman = (rial) => faNum(Math.round(Number(rial ?? 0) / 10));

const fmtDate = (iso) => {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("fa-IR", {
            dateStyle: "short",
            timeStyle: "short",
        });
    } catch {
        return "—";
    }
};

const STATUS_FA = {
    paid: "موفق ✅",
    pending: "در انتظار پرداخت ⏳",
    failed: "ناموفق ❌",
    init: "ناتمام",
};


// ── تب‌ها ──

const loaders = {};

function switchTab(name) {
    document.querySelectorAll("main section[id^='sec-']").forEach((sec) => {
        sec.classList.toggle("hidden", sec.id !== "sec-" + name);
    });

    document.querySelectorAll(".tab-btn").forEach((btn) => {
        const active = btn.dataset.tab === name;
        btn.classList.toggle("bg-indigo-600", active);
        btn.classList.toggle("text-white", active);
        btn.classList.toggle("bg-white", !active);
        btn.classList.toggle("border", !active);
    });

    loaders[name]?.();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});


// ── داشبورد ──

loaders.overview = async () => {
    try {
        const res = await apiCall("admin-overview", { token });

        if (!res.success) {
            console.error(res.error);
            return;
        }

        const s = res.stats;
        document.getElementById("stat-revenue").textContent = toman(s.revenue_rial);
        document.getElementById("stat-orders").textContent = faNum(s.paid_orders);
        document.getElementById("stat-users").textContent = faNum(s.users);
        document.getElementById("stat-shipments").textContent =
            s.pending_shipments == null ? "—" : faNum(s.pending_shipments);
    } catch (e) {
        console.error(e);
    }
};


// ── سفارش‌ها ──

async function loadOrders() {
    const body = document.getElementById("orders-body");
    body.innerHTML = `<tr><td class="p-4 text-gray-400" colspan="6">در حال بارگذاری...</td></tr>`;

    try {
        const res = await apiCall("admin-orders", { token });

        if (!res.success) {
            body.innerHTML = `<tr><td class="p-4 text-red-500" colspan="6">${esc(res.error)}</td></tr>`;
            return;
        }

        if (res.orders.length === 0) {
            body.innerHTML = `<tr><td class="p-4 text-gray-400" colspan="6">سفارشی ثبت نشده است</td></tr>`;
            return;
        }

        body.innerHTML = res.orders
            .map(
                (o) => `
            <tr class="border-b last:border-0">
                <td class="p-4 whitespace-nowrap">${fmtDate(o.created_at)}</td>
                <td class="p-4">
                    <div class="font-bold">${esc(o.user_name)}</div>
                    <div class="text-gray-400 text-xs" dir="ltr">${esc(o.user_phone)}</div>
                </td>
                <td class="p-4">${o.items.map(esc).join("، ") || "—"}</td>
                <td class="p-4 font-bold whitespace-nowrap">${toman(o.amount_rial)}</td>
                <td class="p-4 whitespace-nowrap">${STATUS_FA[o.status] ?? esc(o.status)}</td>
                <td class="p-4 text-xs" dir="ltr">${o.ref_id ?? "—"}</td>
            </tr>`
            )
            .join("");
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td class="p-4 text-red-500" colspan="6">خطا در ارتباط با سرور</td></tr>`;
    }
}

loaders.orders = loadOrders;
document.getElementById("orders-refresh").addEventListener("click", loadOrders);


// ── مرسوله‌ها ──

let shipmentsCache = [];

function renderShipments() {
    const filter = document.getElementById("shipments-filter").value;
    const list = document.getElementById("shipments-list");

    const rows = shipmentsCache.filter(
        (s) => filter === "all" || s.status === filter
    );

    if (rows.length === 0) {
        list.innerHTML = `
            <div class="bg-white rounded-3xl shadow p-8 text-center text-gray-400">
                مرسوله‌ای در این وضعیت نیست
            </div>`;
        return;
    }

    list.innerHTML = rows
        .map((s) => {
            const sent = s.status === "sent";

            return `
        <div class="bg-white rounded-3xl shadow p-6 border-r-4 ${
            sent ? "border-gray-300" : "border-amber-400"
        }">

            <div class="flex justify-between flex-wrap gap-3">
                <div>
                    <span class="font-black">${esc(s.full_name)}</span>
                    <span class="text-gray-500 text-sm mr-2" dir="ltr">${esc(s.phone)}</span>
                </div>
                <div class="text-sm">
                    ${
                        sent
                            ? `<span class="bg-gray-100 text-gray-600 rounded-full px-3 py-1 font-bold">ارسال‌شده 📮</span>`
                            : `<span class="bg-amber-100 text-amber-700 rounded-full px-3 py-1 font-bold">در انتظار ارسال</span>`
                    }
                </div>
            </div>

            <div class="mt-3 text-sm">
                <span class="text-gray-500">اقلام:</span>
                ${s.items.map(esc).join("، ") || "—"}
                ${s.amount_rial ? `<span class="text-gray-400">(${toman(s.amount_rial)} تومان)</span>` : ""}
            </div>

            <div class="mt-3 text-sm leading-relaxed bg-gray-50 rounded-2xl p-4 select-all">
                <div><span class="text-gray-500">استان:</span> ${esc(s.province)} — <span class="text-gray-500">شهر:</span> ${esc(s.city)}</div>
                <div class="mt-1"><span class="text-gray-500">نشانی:</span> ${esc(s.address)}</div>
                <div class="mt-1"><span class="text-gray-500">کد پستی:</span> <span dir="ltr" class="font-bold">${esc(s.postal_code)}</span></div>
            </div>

            <div class="mt-3 flex justify-between items-center flex-wrap gap-3 text-xs text-gray-400">
                <span>ثبت: ${fmtDate(s.created_at)}</span>

                ${
                    sent
                        ? `<span>ارسال: ${fmtDate(s.sent_at)} — کد رهگیری: <b dir="ltr" class="text-gray-700">${esc(s.tracking_code ?? "—")}</b></span>`
                        : `<button
                             onclick="markShipmentSent('${s.id}')"
                             class="bg-green-600 text-white px-5 py-2 rounded-2xl font-bold hover:bg-green-700">
                             ثبت ارسال ✓
                           </button>`
                }
            </div>

        </div>`;
        })
        .join("");
}

async function loadShipments() {
    const list = document.getElementById("shipments-list");
    list.innerHTML = `
        <div class="bg-white rounded-3xl shadow p-8 text-center text-gray-400">
            در حال بارگذاری...
        </div>`;

    try {
        const res = await apiCall("admin-shipments", { token, action: "list" });

        if (!res.success) {
            list.innerHTML = `
                <div class="bg-white rounded-3xl shadow p-8 text-center text-red-500">
                    ${esc(res.error)}
                </div>`;
            return;
        }

        shipmentsCache = res.shipments;
        renderShipments();
    } catch (e) {
        console.error(e);
        list.innerHTML = `
            <div class="bg-white rounded-3xl shadow p-8 text-center text-red-500">
                خطا در ارتباط با سرور
            </div>`;
    }
}

window.markShipmentSent = async (id) => {
    const tracking = prompt("کد رهگیری پستی (اختیاری):");

    if (tracking === null) return; // انصراف

    try {
        const res = await apiCall("admin-shipments", {
            token,
            action: "mark_sent",
            shipment_id: id,
            tracking_code: tracking,
        });

        if (res.success) {
            await loadShipments();
        } else {
            alert(res.error || "خطا در ثبت ارسال");
        }
    } catch (e) {
        console.error(e);
        alert("خطا در ارتباط با سرور");
    }
};

loaders.shipments = loadShipments;
document.getElementById("shipments-refresh").addEventListener("click", loadShipments);
document.getElementById("shipments-filter").addEventListener("change", renderShipments);


// ── کاربران ──

async function loadUsers() {
    const body = document.getElementById("users-body");
    body.innerHTML = `<tr><td class="p-4 text-gray-400" colspan="3">در حال بارگذاری...</td></tr>`;

    try {
        const res = await apiCall("admin-users", { token });

        if (!res.success) {
            body.innerHTML = `<tr><td class="p-4 text-red-500" colspan="3">${esc(res.error)}</td></tr>`;
            return;
        }

        body.innerHTML = res.users
            .map(
                (u) => `
            <tr class="border-b last:border-0">
                <td class="p-4 font-bold">
                    ${esc([u.first_name, u.last_name].filter(Boolean).join(" ") || "—")}
                </td>
                <td class="p-4" dir="ltr">${esc(u.phone)}</td>
                <td class="p-4">${u.role === "admin" ? "مدیر 👑" : "کاربر"}</td>
            </tr>`
            )
            .join("");
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td class="p-4 text-red-500" colspan="3">خطا در ارتباط با سرور</td></tr>`;
    }
}

loaders.users = loadUsers;
document.getElementById("users-refresh").addEventListener("click", loadUsers);


// ── فایل و تصویر ──

const PDF_TYPE_FA = { lecture: "جزوه", book: "کتاب", course: "دوره" };

async function loadProductsDropdown() {
    const sel = document.getElementById("pdf-course");

    try {
        const { data, error } = await db
            .from("courses")
            .select("id, title, type");

        if (error) throw error;

        // محصولات فیزیکی اول
        const rows = (data ?? []).sort(
            (a, b) => (b.type !== "course") - (a.type !== "course")
        );

        sel.innerHTML =
            `<option value="" disabled selected>انتخاب کنید...</option>` +
            rows
                .map(
                    (c) =>
                        `<option value="${c.id}">${esc(c.title)} (${
                            PDF_TYPE_FA[c.type] ?? c.type
                        })${c.type !== "course" ? " 📦" : ""}</option>`
                )
                .join("");
    } catch (e) {
        console.error(e);
        sel.innerHTML = `<option value="" disabled selected>خطا در بارگذاری محصولات</option>`;
    }
}

async function uploadToSignedUrl(uploadUrl, file, statusEl) {
    const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
    });

    if (!put.ok) {
        const txt = await put.text().catch(() => "");
        console.error("upload failed", put.status, txt);
        throw new Error("upload failed");
    }
}

function initFileTab() {
    const pdfBtn = document.getElementById("pdf-upload-btn");
    const pdfStatus = document.getElementById("pdf-status");
    const imgBtn = document.getElementById("img-upload-btn");
    const imgStatus = document.getElementById("img-status");

    pdfBtn.addEventListener("click", async () => {
        pdfStatus.className = "mt-3 text-sm text-gray-500";
        pdfStatus.textContent = "";

        const courseId = document.getElementById("pdf-course").value;
        const file = document.getElementById("pdf-file").files[0];

        if (!courseId) {
            pdfStatus.className = "mt-3 text-sm text-red-500";
            pdfStatus.textContent = "ابتدا محصول را انتخاب کنید";
            return;
        }
        if (!file) {
            pdfStatus.className = "mt-3 text-sm text-red-500";
            pdfStatus.textContent = "فایل PDF را انتخاب کنید";
            return;
        }

        pdfBtn.disabled = true;
        pdfBtn.innerText = "در حال آپلود...";

        try {
            pdfStatus.textContent = "در حال گرفتن مجوز آپلود...";
            const res = await apiCall("admin-upload-url", {
                token,
                kind: "pdf",
                course_id: courseId,
            });

            if (!res.success) throw new Error(res.error || "خطا در مجوز آپلود");

            pdfStatus.textContent = "در حال ارسال فایل...";
            await uploadToSignedUrl(res.upload_url, file, pdfStatus);

            pdfStatus.className = "mt-3 text-sm text-green-600";
            pdfStatus.textContent = "آپلود شد ✓ — فایل محصول به‌روزرسانی شد";
            document.getElementById("pdf-file").value = "";
        } catch (e) {
            console.error(e);
            pdfStatus.className = "mt-3 text-sm text-red-500";
            pdfStatus.textContent = e.message || "خطا در آپلود";
        } finally {
            pdfBtn.disabled = false;
            pdfBtn.innerText = "آپلود فایل";
        }
    });

    imgBtn.addEventListener("click", async () => {
        imgStatus.className = "mt-3 text-sm text-gray-500";
        imgStatus.textContent = "";

        const file = document.getElementById("img-file").files[0];

        if (!file) {
            imgStatus.className = "mt-3 text-sm text-red-500";
            imgStatus.textContent = "فایل تصویر را انتخاب کنید";
            return;
        }

        imgBtn.disabled = true;
        imgBtn.innerText = "در حال آپلود...";

        try {
            imgStatus.textContent = "در حال گرفتن مجوز آپلود...";
            const res = await apiCall("admin-upload-url", {
                token,
                kind: "image",
                filename: file.name,
            });

            if (!res.success) throw new Error(res.error || "خطا در مجوز آپلود");

            imgStatus.textContent = "در حال ارسال فایل...";
            await uploadToSignedUrl(res.upload_url, file, imgStatus);

            document.getElementById("img-url").value = res.public_url;
            document.getElementById("img-url-box").classList.remove("hidden");

            imgStatus.className = "mt-3 text-sm text-green-600";
            imgStatus.textContent = "آپلود شد ✓ — لینک را کپی و در فرم دوره قرار دهید";
            document.getElementById("img-file").value = "";
        } catch (e) {
            console.error(e);
            imgStatus.className = "mt-3 text-sm text-red-500";
            imgStatus.textContent = e.message || "خطا در آپلود";
        } finally {
            imgBtn.disabled = false;
            imgBtn.innerText = "آپلود عکس";
        }
    });

    document.getElementById("img-copy-btn").addEventListener("click", async () => {
        const url = document.getElementById("img-url").value;
        try {
            await navigator.clipboard.writeText(url);
            document.getElementById("img-copy-btn").innerText = "کپی شد ✓";
            setTimeout(
                () => (document.getElementById("img-copy-btn").innerText = "کپی"),
                2000
            );
        } catch {
            document.getElementById("img-url").select();
            document.execCommand("copy");
        }
    });
}

loaders.files = loadProductsDropdown;


// ── شروع ──

document.addEventListener("DOMContentLoaded", () => {
    initFileTab();
    switchTab("overview");
});
