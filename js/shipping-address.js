// فرم ثبت آدرس ارسال مرسوله‌های پستی (کتاب / جزوه)
// این صفحه بعد از پرداخت موفقِ سفارشی که شامل محصول فیزیکی است باز می‌شود:
//   /shipping-address?order=<order_uuid>

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order");
const token = localStorage.getItem("session_token");

const faDigits = "۰۱۲۳۴۵۶۷۸۹";

function toLatinDigits(s) {
    return (s || "").replace(/[۰-۹]/g, (d) => String(faDigits.indexOf(d)));
}

function showError(message) {
    const box = document.getElementById("form-error");
    box.textContent = message;
    box.classList.remove("hidden");
}

function hideError() {
    document.getElementById("form-error").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {

    const form = document.getElementById("shipping-form");
    const saveBtn = document.getElementById("save-btn");

    if (!token) {
        window.location.href = "/login";
        return;
    }

    if (!orderId) {
        form.classList.add("hidden");
        document.getElementById("state-invalid").classList.remove("hidden");
        return;
    }

    // پیش‌پر کردن نام و شماره تماس از پروفایل (اختیاری — در صورت خطا بیخیال می‌شویم)
    try {
        const res = await apiCall("check-session", { token });
        const user = res.user ?? null;

        if ((res.success || res.valid) && user) {
            const fullName = [user.first_name, user.last_name]
                .filter(Boolean)
                .join(" ")
                .trim();

            if (fullName) {
                document.getElementById("full-name").value = fullName;
            }

            // شماره در دیتابیس 989XXXXXXXXX است؛ برای نمایش 09XXXXXXXXX
            if (user.phone) {
                const phone = toLatinDigits(String(user.phone));
                document.getElementById("phone").value =
                    phone.startsWith("98") ? "0" + phone.substring(2) : phone;
            }
        }
    } catch (e) {
        console.warn("prefill skipped", e);
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        const full_name   = document.getElementById("full-name").value.trim();
        const phone       = toLatinDigits(document.getElementById("phone").value.trim()).replace(/[\s-]/g, "");
        const province    = document.getElementById("province").value;
        const city        = document.getElementById("city").value.trim();
        const address     = document.getElementById("address").value.trim();
        const postal_code = toLatinDigits(document.getElementById("postal-code").value.trim()).replace(/\s/g, "");

        if (!full_name || !phone || !province || !city || !address || !postal_code) {
            showError("لطفاً همه‌ی فیلدها را کامل کنید");
            return;
        }

        if (!/^(?:0?9\d{9}|989\d{9})$/.test(phone)) {
            showError("شماره تماس معتبر نیست؛ مثال: 09123456789");
            return;
        }

        if (!/^\d{10}$/.test(postal_code)) {
            showError("کد پستی باید دقیقاً ۱۰ رقم باشد");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "در حال ذخیره...";

        try {
            const result = await apiCall("save-shipping-address", {
                token,
                order_id: orderId,
                full_name,
                phone,
                province,
                city,
                address,
                postal_code,
            });

            if (result.success) {
                form.classList.add("hidden");
                hideError();
                document.getElementById("page-heading").parentElement.classList.add("hidden");
                document.getElementById("state-done").classList.remove("hidden");
            } else {
                showError(result.error || "خطا در ذخیره آدرس");
            }
        } catch (error) {
            console.error(error);
            showError("خطا در ارتباط با سرور؛ لطفاً دوباره تلاش کنید");
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "ثبت آدرس";
        }
    });
});
