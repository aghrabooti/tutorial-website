import { createDatabase } from "../../../../lib/database.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "course-files";
const URL_TTL = 300;
const database = createDatabase();
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
                error: "این فایل فقط برای خریداران فعال است"
            }, 403);
        }
        const { data, error } = await database.storage.from(BUCKET).createSignedUrl(`${course_id}.pdf`, URL_TTL);
        if (error || !data?.signedUrl) {
            console.error(error);
            return jsonResponse({
                error: "فایل این محصول هنوز بارگذاری نشده است"
            }, 404);
        }
        return jsonResponse({
            success: true,
            url: data.signedUrl
        });
    } catch (error) {
        console.error(error);
        return jsonResponse({
            error: error?.message ?? "خطای سرور"
        }, 500);
    }
}
