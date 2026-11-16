import { createDatabase } from "../../../../lib/database.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const database = createDatabase();
const MAX_VALUE_LENGTH = 8000;
const MAX_KEYS_PER_CALL = 200;
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json"
        }
    });
}
async function hashText(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
async function getAdminUser(token) {
    const tokenHash = await hashText(token);
    const { data: session } = await database.from("user_sessions").select("*").eq("token_hash", tokenHash).eq("is_active", true).maybeSingle();
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) return null;
    const { data: user } = await database.from("site_users").select("id, role").eq("id", session.user_id).maybeSingle();
    if (!user || user.role !== "admin") return null;
    return user;
}
function isValidKey(key) {
    return typeof key === "string" && /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(key);
}
function sanitizeItems(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object") return clean;
    for (const [key, value] of Object.entries(raw)){
        if (!isValidKey(key)) continue;
        const text = value === null || value === undefined ? "" : String(value);
        clean[key] = text.slice(0, MAX_VALUE_LENGTH);
        if (Object.keys(clean).length >= MAX_KEYS_PER_CALL) break;
    }
    return clean;
}
export async function POST(req) {
    try {
        const body = await req.json().catch(()=>({}));
        const action = body.action ?? "get";
        if (action === "get") {
            const { data, error } = await database.from("site_content").select("key, value, updated_at");
            if (error) {
                console.error(error);
                const message = String(error.message ?? "");
                const tableMissing = /relation|does not exist|schema cache/i.test(message);
                return jsonResponse({
                    success: false,
                    content: {},
                    table_missing: tableMissing,
                    error: tableMissing ? "جدول site_content در دیتابیس ساخته نشده" : "خطا در خواندن محتوا"
                });
            }
            const content = {};
            let latest = "";
            for (const row of data ?? []){
                if (!row.value) continue;
                content[row.key] = row.value;
                if (row.updated_at > latest) latest = row.updated_at;
            }
            return jsonResponse({
                success: true,
                content,
                updated_at: latest
            });
        }
        if (!body.token) return jsonResponse({
            error: "توکن ارسال نشده"
        }, 401);
        const admin = await getAdminUser(body.token);
        if (!admin) return jsonResponse({
            error: "دسترسی غیرمجاز — فقط مدیر"
        }, 403);
        if (action === "set") {
            const items = sanitizeItems(body.items);
            if (!Object.keys(items).length) {
                return jsonResponse({
                    error: "چیزی برای ذخیره ارسال نشد"
                }, 400);
            }
            const rows = Object.entries(items).map(([key, value])=>({
                    key,
                    value,
                    updated_at: new Date().toISOString(),
                    updated_by: admin.id
                }));
            let { error } = await database.from("site_content").upsert(rows, {
                onConflict: "key"
            });
            if (error) {
                console.error("upsert with updated_by failed", error);
                const retryRows = Object.entries(items).map(([key, value])=>({
                        key,
                        value,
                        updated_at: new Date().toISOString()
                    }));
                const retry = await database.from("site_content").upsert(retryRows, {
                    onConflict: "key"
                });
                error = retry.error;
                if (error) {
                    console.error("upsert failed", error);
                    const message = String(error.message ?? "");
                    if (/relation|does not exist|schema cache/i.test(message)) {
                        return jsonResponse({
                            error: "جدول site_content در دیتابیس ساخته نشده",
                            details: message,
                            table_missing: true
                        }, 500);
                    }
                    return jsonResponse({
                        error: "خطا در ذخیره‌سازی",
                        details: message
                    }, 500);
                }
            }
            return jsonResponse({
                success: true,
                saved: rows.length
            });
        }
        if (action === "reset") {
            const keys = (Array.isArray(body.keys) ? body.keys : []).filter((k)=>isValidKey(k)).slice(0, MAX_KEYS_PER_CALL);
            if (!keys.length) return jsonResponse({
                error: "کلیدی ارسال نشد"
            }, 400);
            const { error } = await database.from("site_content").delete().in("key", keys);
            if (error) {
                console.error(error);
                return jsonResponse({
                    error: "خطا در بازگردانی"
                }, 500);
            }
            return jsonResponse({
                success: true,
                removed: keys.length
            });
        }
        return jsonResponse({
            error: "اکشن نامعتبر است"
        }, 400);
    } catch (error) {
        console.error(error);
        return jsonResponse({
            error: error?.message ?? "خطای داخلی"
        }, 500);
    }
}
