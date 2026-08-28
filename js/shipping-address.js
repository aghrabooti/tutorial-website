// ثبت/ویرایش نشانی پستی کاربر
// این صفحه «قبل از پرداخت» باز می‌شود: اگر سبد خرید شامل کتاب/جزوه باشد و
// کاربر هنوز نشانی ثبت نکرده باشد، payment-request او را به اینجا می‌فرستد.
// نشانی یک‌بار ثبت می‌شود و برای خریدهای بعدی دیگر فرم نشان داده نمی‌شود.

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

    const fields = {
        full_name: document.getElementById("full-name"),
        phone: document.getElementById("phone"),
        province: document.getElementById("province"),
        city: document.getElementById("city"),
        address: document.getElementById("address"),
        postal_code: document.getElementById("postal-code"),
    };

    // ۱) اگر قبلاً نشانی ثبت کرده، فرم را با همان پر کن (حالت ویرایش/بازبینی)
    try {
        const res = await apiCall("get-my-address", { token });

        if (res?.success && res.address) {
            fields.full_name.value = res.address.full_name ?? "";
            fields.phone.value = res.address.phone ?? "";
            fields.province.value = res.address.province ?? "";
            fields.city.value = res.address.city ?? "";
            fields.address.value = res.address.address ?? "";
            fields.postal_code.value = res.address.postal_code ?? "";
        }
    } catch (e) {
        console.warn("address prefill skipped", e);
    }

    // ۲) برای کاربر تازه: نام و شماره تماس را از پروفایل پیش‌فرض کن
    try {
        const res = await apiCall("check-session", { token });
        const user = res.user ?? null;

        if ((res.success || res.valid) && user) {
            if (!fields.full_name.value) {
                const fullName = [user.first_name, user.last_name]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                if (fullName) fields.full_name.value = fullName;
            }

            // شماره در دیتابیس 989XXXXXXXXX است؛ برای نمایش 09XXXXXXXXX
            if (!fields.phone.value && user.phone) {
                const phone = toLatinDigits(String(user.phone));
                fields.phone.value =
                    phone.startsWith("98")
                        ? "0" + phone.substring(2)
                        : phone;
            }
        }
    } catch (e) {
        console.warn("profile prefill skipped", e);
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        const full_name   = fields.full_name.value.trim();
        const phone       = toLatinDigits(fields.phone.value.trim()).replace(/[\s-]/g, "");
        const province    = fields.province.value;
        const city        = fields.city.value.trim();
        const address     = fields.address.value.trim();
        const postal_code = toLatinDigits(fields.postal_code.value.trim()).replace(/\s/g, "");

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
