// endpointهای منتقل‌شده مستقیم در Next.js اجرا می‌شوند؛ بقیه تا زمان انتقال
// منطقشان از درگاه هم‌مبدأ Next به Edge Function قدیمی proxy می‌شوند.
const NEXT_FUNCTIONS = {
    "get-course": "/api/functions/get-course",
    "check-session": "/api/functions/check-session",
    "logout-user": "/api/functions/logout-user",
    "login-user": "/api/functions/login-user",
    "register-user": "/api/functions/register-user",
    "update-profile": "/api/functions/update-profile",
    "change-password": "/api/functions/change-password",
    "add-to-cart": "/api/functions/add-to-cart",
    "get-cart": "/api/functions/get-cart",
    "remove-from-cart": "/api/functions/remove-from-cart",
    "get-my-address": "/api/functions/get-my-address",
    "save-shipping-address": "/api/functions/save-shipping-address",
    "get-my-courses": "/api/functions/get-my-courses",
    "check-course-access": "/api/functions/check-course-access",
    "admin-get-courses": "/api/functions/admin-get-courses",
    "admin-get-sessions": "/api/functions/admin-get-sessions",
    "admin-users": "/api/functions/admin-users",
    "admin-orders": "/api/functions/admin-orders",
    "admin-create-course": "/api/functions/admin-create-course",
    "admin-update-course": "/api/functions/admin-update-course",
    "admin-save-sessions": "/api/functions/admin-save-sessions",
    "admin-overview": "/api/functions/admin-overview",
    "admin-upload-url": "/api/functions/admin-upload-url",
    "admin-shipments": "/api/functions/admin-shipments",
};

async function apiCall(functionName, data) {
    const action = data && typeof data === "object" ? data.action : undefined;

    // خواندن محتوای عمومی به route فقط-خواندنی Next.js منتقل شده است.
    if (functionName === "site-content" && (action === undefined || action === null || action === "get")) {
        const response = await fetch("/api/site-content", {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store",
        });
        return await response.json();
    }

    // endpointهای منتقل‌شده همان بدنه‌ی قبلی را می‌پذیرند، اما same-origin هستند.
    const nextPath = Object.hasOwn(NEXT_FUNCTIONS, functionName)
        ? NEXT_FUNCTIONS[functionName]
        : null;
    if (nextPath) {
        const response = await fetch(nextPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        return await response.json();
    }

    // endpointهای منتقل‌نشده از درگاه هم‌مبدأ Next عبور می‌کنند؛ این درگاه
    // موقتاً به Edge Function قدیمی proxy می‌کند تا مهاجرت منطق مرحله‌ای باشد.
    const response = await fetch(`/api/functions/${encodeURIComponent(functionName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });

    return await response.json();
}

async function getPublicCourses() {
    try {
        const response = await fetch("/api/courses", {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok && !result?.error) {
            return { data: null, error: { message: "خطا در دریافت محصولات" } };
        }
        return result;
    } catch (error) {
        return {
            data: null,
            error: { message: error?.message || "خطا در ارتباط با سرور" },
        };
    }
}
