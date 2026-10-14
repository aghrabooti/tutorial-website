import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveAdmin } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPhysicalCourse(course) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;
  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

async function loadPhysicalCourseIds(supabase) {
  const ids = new Set();
  const { data, error } = await supabase
    .from("courses")
    .select("id, type, requires_shipping");

  if (!error) {
    for (const course of data ?? []) {
      if (isPhysicalCourse(course)) ids.add(String(course.id));
    }
    return ids;
  }

  const retry = await supabase.from("courses").select("id, type");
  for (const course of retry.data ?? []) {
    if (isPhysicalCourse(course)) ids.add(String(course.id));
  }
  return ids;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, user_id, amount_rial, status, source, items, course_ids, ref_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[api/functions/admin-orders] Order lookup failed:", error);
      return jsonNoStore({ error: "خطا در خواندن سفارش‌ها" }, 500);
    }

    const physicalCourseIds = await loadPhysicalCourseIds(supabase);
    const orderIds = (orders ?? []).map((order) => String(order.id));

    let shipmentsByOrder = {};
    if (orderIds.length > 0) {
      const { data: shipments } = await supabase
        .from("shipments")
        .select("order_id, status, tracking_code")
        .in("order_id", orderIds);
      shipmentsByOrder = Object.fromEntries(
        (shipments ?? []).map((shipment) => [String(shipment.order_id), shipment])
      );
    }

    const userIds = [...new Set((orders ?? []).map((order) => order.user_id))];
    let usersById = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("site_users")
        .select("id, first_name, last_name, phone")
        .in("id", userIds);
      usersById = Object.fromEntries((users ?? []).map((u) => [String(u.id), u]));
    }

    const rows = (orders ?? []).map((order) => {
      const user = usersById[String(order.user_id)] ?? {};
      const items = Array.isArray(order.items) ? order.items : [];
      const courseIds = Array.isArray(order.course_ids) && order.course_ids.length > 0
        ? order.course_ids.map(String)
        : items.map((item) => String(item?.course_id ?? "")).filter(Boolean);
      const needsShipping = items.some((item) => item?.requires_shipping === true) ||
        courseIds.some((id) => physicalCourseIds.has(id));
      const shipment = shipmentsByOrder[String(order.id)] ?? null;

      return {
        id: order.id,
        created_at: order.created_at,
        status: order.status,
        source: order.source,
        amount_rial: order.amount_rial,
        ref_id: order.ref_id,
        user_name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "—",
        user_phone: user.phone ?? "—",
        items: items.map((item) => item.title).filter(Boolean),
        needs_shipping: needsShipping,
        shipment_status: needsShipping ? (shipment ? shipment.status ?? "pending" : "none") : null,
        tracking_code: shipment?.tracking_code ?? null,
      };
    });

    return jsonNoStore({ success: true, orders: rows });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-orders] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس سفارش‌ها تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
