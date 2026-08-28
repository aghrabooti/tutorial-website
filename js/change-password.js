// تغییر رمز عبور — فقط در صفحه‌ی داشبورد بارگذاری می‌شود

document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("change-password-form");
    if (!form) return;

    const btn = document.getElementById("change-password-btn");
    const msg = document.getElementById("change-password-msg");

    function showMsg(text, ok) {
        msg.textContent = text;
        msg.classList.remove("hidden", "text-red-500", "text-green-600");
        msg.classList.add(ok ? "text-green-600" : "text-red-500");
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const token = localStorage.getItem("session_token");
        if (!token) {
            window.location.href = "/login";
            return;
        }

        const current_password = document.getElementById("current-password").value;
        const new_password = document.getElementById("new-password").value;
        const confirm = document.getElementById("new-password-confirm").value;

        if (new_password.length < 8) {
            showMsg("رمز جدید باید حداقل ۸ کاراکتر باشد", false);
            return;
        }

        if (new_password !== confirm) {
            showMsg("رمز جدید و تکرار آن یکسان نیستند", false);
            return;
        }

        if (new_password === current_password) {
            showMsg("رمز جدید نباید مثل رمز فعلی باشد", false);
            return;
        }

        btn.disabled = true;
        btn.innerText = "در حال ثبت...";

        try {
            const res = await apiCall("change-password", {
                token,
                current_password,
                new_password,
            });

            if (res.success) {
                showMsg("رمز عبور با موفقیت تغییر کرد ✓ — سایر دستگاه‌ها خارج شدند", true);
                form.reset();
            } else {
                showMsg(res.error || "خطا در تغییر رمز", false);
            }
        } catch (error) {
            console.error(error);
            showMsg("خطا در ارتباط با سرور", false);
        } finally {
            btn.disabled = false;
            btn.innerText = "ثبت رمز جدید";
        }
    });
});
