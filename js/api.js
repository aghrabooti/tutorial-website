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
