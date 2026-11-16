import { createDatabase } from "../../../../lib/database.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const database = createDatabase();
const EARLY_MINUTES = 5;
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
async function getSessionUser(token) {
    const tokenHash = await hashText(token);
    const { data: session } = await database.from("user_sessions").select("*").eq("token_hash", tokenHash).eq("is_active", true).maybeSingle();
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
        await database.from("user_sessions").update({
            is_active: false
        }).eq("id", session.id);
        return null;
    }
    const { data: user } = await database.from("site_users").select("id").eq("id", session.user_id).maybeSingle();
    return user ?? null;
}
export async function POST(req) {
    try {
        const { token, course_id } = await req.json();
        if (!token) return jsonResponse({
            error: "توکن ارسال نشده"
        }, 401);
        if (!course_id) return jsonResponse({
            error: "شناسه‌ی دوره ارسال نشده"
        }, 400);
        const user = await getSessionUser(token);
        if (!user) return jsonResponse({
            error: "نشست معتبر نیست"
        }, 401);
        const { data: paidOrders } = await database.from("orders").select("course_ids").eq("user_id", String(user.id)).eq("status", "paid");
        const owned = new Set((paidOrders ?? []).flatMap((o)=>o.course_ids ?? []));
        if (!owned.has(String(course_id))) {
            return jsonResponse({
                error: "دسترسی فقط برای خریداران است"
            }, 403);
        }
        const { data: sessions, error } = await database.from("course_sessions").select("*").eq("course_id", course_id).order("session_number", {
            ascending: true
        });
        if (error) {
            console.error(error);
            return jsonResponse({
                error: "خطا در خواندن جلسات"
            }, 500);
        }
        const now = Date.now();
        const EARLY_MS = EARLY_MINUTES * 60 * 1000;
        const out = (sessions ?? []).map((s)=>{
            if (!s.is_online) {
                return {
                    ...s,
                    online_available: true
                };
            }
            const start = s.scheduled_at ? new Date(s.scheduled_at).getTime() : null;
            const available = start != null && now >= start - EARLY_MS;
            return {
                ...s,
                online_url: available ? s.online_url : null,
                online_available: available
            };
        });
        return jsonResponse({
            success: true,
            sessions: out,
            server_now: new Date().toISOString()
        });
    } catch (error) {
        console.error(error);
        return jsonResponse({
            error: error?.message ?? "خطای سرور"
        }, 500);
    }
}
