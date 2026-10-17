import { query } from "../../../../lib/postgres.js";
import { findActivePostgresAdmin } from "../../../../lib/admin-auth.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPhysicalCourse(course) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;
  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
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
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    const { rows: orders } = await query(
      `SELECT id, user_id, amount_rial, status, source, items, course_ids, ref_id, created_at
       FROM public.orders
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const { rows: courses } = await query(
      "SELECT id, type, requires_shipping FROM public.courses"
    );
    const physicalCourseIds = new Set(
      courses.filter(isPhysicalCourse).map((course) => String(course.id))
    );

    const orderIds = orders.map((order) => String(order.id));
    let shipmentsByOrder = {};
    if (orderIds.length > 0) {
      const { rows: shipments } = await query(
        `SELECT order_id, status, tracking_code
         FROM public.shipments
         WHERE order_id = ANY($1::uuid[])`,
        [orderIds]
      );
      shipmentsByOrder = Object.fromEntries(
        shipments.map((shipment) => [String(shipment.order_id), shipment])
      );
    }

    const userIds = [...new Set(orders.map((order) => String(order.user_id)))];
    let usersById = {};
    if (userIds.length > 0) {
      const { rows: users } = await query(
        `SELECT id, first_name, last_name, phone
         FROM public.site_users
         WHERE id::text = ANY($1::text[])`,
        [userIds]
      );
      usersById = Object.fromEntries(users.map((user) => [String(user.id), user]));
    }

    const rows = orders.map((order) => {
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
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-orders] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس سفارش‌ها تنظیم نشده است" : "خطا در خواندن سفارش‌ها" },
      missingConfig ? 503 : 500
    );
  }
}
