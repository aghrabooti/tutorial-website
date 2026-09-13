// ─────────────────────────────────────────────────────────────
// ورود مدیر — صفحه‌ی اختصاصی admin.mahdiazizi.com
//
//  • از همان login-user بک‌اند استفاده می‌کند (ادمین هم یک site_user است)
//  • اگر کاربر وارد شد ولی role !== "admin" → توکن ذخیره نمی‌شود و
//    پیام «دسترسی غیرمجاز» می‌بیند (نشست همان‌جا در سرور بسته می‌شود)
//  • اگر از قبل نشست معتبرِ ادمین دارد → مستقیم به /admin
//
//  نکته‌ی امنیتی: بررسی نقش در مرورگر فقط برای UX است؛ همه‌ی توابع
//  admin-* در سرور دوباره role را چک می‌کنند.
// ─────────────────────────────────────────────────────────────

const form          = document.getElementById("admin-login-form");
const phoneInput    = document.getElementById("phone");
const passwordInput = document.getElementById("password");
const loginBtn      = document.getElementById("login-btn");
const message       = document.getElementById("message");

const ADMIN_HOME = "/admin";


function showMessage(text, type = "normal") {

    message.className = "text-center text-sm mt-5 min-h-[1.25rem]";

    if (type === "success")      message.classList.add("text-green-600");
    else if (type === "error")   message.classList.add("text-red-600");
    else                         message.classList.add("text-gray-500");

    message.innerText = text;
}


function validatePhone(phone) {
    return /^09\d{9}$/.test(phone.trim());
}


function clearSession() {
    localStorage.removeItem("session_token");
    localStorage.removeItem("user");
}


// بستن نشست در سرور (بهترین تلاش — خطا مهم نیست)
async function serverLogout(token) {
    try {
        await apiCall("logout-user", { token });
    } catch (e) {
        /* ignore */
    }
}


// ── اگر قبلاً به‌عنوان ادمین وارد شده، مستقیم برو داخل پنل ──
async function checkExistingSession() {

    const token = localStorage.getItem("session_token");

    if (!token) return;

    try {

        const result = await apiCall("check-session", { token });

        const ok = result && (result.valid === true || result.success === true);

        if (ok && result.user && result.user.role === "admin") {

            // اطلاعات کاربر را تازه نگه می‌داریم
            localStorage.setItem("user", JSON.stringify(result.user));
            window.location.replace(ADMIN_HOME);
            return;
        }

        if (!ok) {
            // نشست منقضی/نامعتبر
            clearSession();
        }
        // اگر نشست معتبر ولی غیرادمین است، دست نمی‌زنیم؛
        // کاربر باید با حساب مدیر وارد شود.

    } catch (error) {
        console.error("admin check-session:", error);
    }
}


// ── ورود ──
form.addEventListener("submit", async (e) => {

    e.preventDefault();

    const phone    = phoneInput.value.trim();
    const password = passwordInput.value;

    if (!phone || !password) {
        showMessage("شماره موبایل و رمز عبور را وارد کنید", "error");
        return;
    }

    if (!validatePhone(phone)) {
        showMessage("شماره موبایل صحیح نیست", "error");
        return;
    }

    if (password.length < 4) {
        showMessage("رمز عبور کوتاه است", "error");
        return;
    }

    loginBtn.disabled  = true;
    loginBtn.innerText = "در حال بررسی...";
    showMessage("در حال بررسی اطلاعات...");

    try {

        const result = await apiCall("login-user", { phone, password });

        if (!result.success) {
            showMessage(result.error || "ورود ناموفق بود", "error");
            return;
        }

        const user = result.user || {};

        // ── فقط مدیر اجازه‌ی ورود به این پنل را دارد ──
        if (user.role !== "admin") {

            // نشستی که همین الان ساخته شد را می‌بندیم تا توکن بی‌استفاده نماند
            await serverLogout(result.token);
            clearSession();

            showMessage(
                "این حساب دسترسی مدیریت ندارد. برای ورود دانش‌آموزی از سایت اصلی استفاده کنید.",
                "error"
            );
            return;
        }

        localStorage.setItem("session_token", result.token);
        localStorage.setItem("user", JSON.stringify(user));

        showMessage("ورود موفق — در حال انتقال به پنل...", "success");

        setTimeout(() => {
            window.location.replace(ADMIN_HOME);
        }, 400);

    } catch (error) {

        console.error(error);
        showMessage("خطا در ارتباط با سرور", "error");

    } finally {

        loginBtn.disabled  = false;
        loginBtn.innerText = "ورود به پنل مدیریت";
    }
});


checkExistingSession();
