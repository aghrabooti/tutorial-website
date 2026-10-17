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

function orderItems(order) {
  return Array.isArray(order?.items) ? order.items : [];
}

function needsShipping(order, physicalCourseIds) {
  const items = orderItems(order);
  if (items.some((item) => item?.requires_shipping === true)) return true;
  const courseIds = Array.isArray(order?.course_ids)
    ? order.course_ids.map(String)
    : items.map((item) => String(item?.course_id ?? "")).filter(Boolean);
  return courseIds.some((id) => physicalCourseIds.has(id));
}

async function loadPhysicalCourseIds() {
  const { rows: courses } = await query(
    "SELECT id, type, requires_shipping FROM public.courses"
  );
  return new Set(courses.filter(isPhysicalCourse).map((course) => String(course.id)));
}

async function createShipmentFromOrder(order) {
  const { rows: addresses } = await query(
    `SELECT full_name, phone, province, city, address, postal_code
     FROM public.user_addresses
     WHERE user_id = $1
     LIMIT 1`,
    [String(order.user_id)]
  );
  const address = addresses[0];
  if (!address) return { created: false, missing_address: true };

  const { rows: inserted } = await query(
    `INSERT INTO public.shipments
       (order_id, user_id, full_name, phone, province, city, address, postal_code, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), NOW())
     ON CONFLICT (order_id) DO NOTHING
     RETURNING id`,
    [
      String(order.id),
      String(order.user_id),
      address.full_name,
      address.phone,
      address.province,
      address.city,
      address.address,
      address.postal_code,
    ]
  );
  if (inserted.length === 0) return { created: false, error: "shipment already exists" };
  return { created: true, shipment_id: inserted[0].id };
}

async function resyncMissingShipments(physicalCourseIds) {
  const { rows: orders } = await query(
    `SELECT id, user_id, amount_rial, ref_id, status, source, items, course_ids, created_at
     FROM public.orders
     WHERE status = 'paid'
     ORDER BY created_at DESC
     LIMIT 300`
  );
  const relevant = orders.filter((order) => needsShipping(order, physicalCourseIds));
  if (relevant.length === 0) {
    return { created: 0, missing_address: 0, failed: 0, needs_shipping: 0 };
  }

  const orderIds = relevant.map((order) => String(order.id));
  const { rows: existing } = await query(
    "SELECT order_id FROM public.shipments WHERE order_id = ANY($1::uuid[])",
    [orderIds]
  );
  const haveShipment = new Set(existing.map((shipment) => String(shipment.order_id)));

  let created = 0;
  let missingAddress = 0;
  let failed = 0;
  const errors = {};

  for (const order of relevant) {
    if (haveShipment.has(String(order.id))) continue;
    const result = await createShipmentFromOrder(order);
    if (result.created) created++;
    else if (result.missing_address) missingAddress++;
    else {
      failed++;
      if (result.error) errors[String(order.id)] = String(result.error);
    }
  }

  return {
    created,
    missing_address: missingAddress,
    failed,
    errors,
    needs_shipping: relevant.length,
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "درخواست نامعتبر است" }, 400);
  }

  const token = body?.token;
  const action = body?.action ?? "list";
  if (!isValidSessionToken(token)) return jsonNoStore({ error: "توکن ارسال نشده" }, 401);

  try {
    const auth = await findActivePostgresAdmin(token);
    if (auth.error && !auth.expired) throw auth.error;
    if (auth.userError) throw auth.userError;
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (action === "mark_sent") {
      const shipmentId = body?.shipment_id;
      if (!shipmentId) return jsonNoStore({ error: "شناسه‌ی مرسوله ارسال نشده" }, 400);

      await query(
        `UPDATE public.shipments
         SET status = 'sent',
             tracking_code = $1,
             sent_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [String(body?.tracking_code ?? "").trim() || null, shipmentId]
      );
      return jsonNoStore({ success: true });
    }

    let sync = null;
    if (action === "resync") {
      const ids = await loadPhysicalCourseIds();
      sync = await resyncMissingShipments(ids);
    }

    const physicalCourseIds = await loadPhysicalCourseIds();
    const autoSync = await resyncMissingShipments(physicalCourseIds);
    if (!sync) sync = autoSync;

    const { rows: shipments } = await query(
      `SELECT * FROM public.shipments
       ORDER BY created_at DESC
       LIMIT 300`
    );
    const { rows: paidOrders } = await query(
      `SELECT id, user_id, amount_rial, ref_id, status, source, items, course_ids, created_at
       FROM public.orders
       WHERE status = 'paid'
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const physicalOrders = paidOrders.filter((order) => needsShipping(order, physicalCourseIds));
    const ordersById = Object.fromEntries(physicalOrders.map((order) => [String(order.id), order]));
    const userIds = [...new Set([
      ...shipments.map((shipment) => String(shipment.user_id ?? "")),
      ...physicalOrders.map((order) => String(order.user_id)),
    ])].filter(Boolean);

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

    const itemTitles = (order) => orderItems(order).map((item) => item.title).filter(Boolean);
    const orderIdsWithShipment = new Set(shipments.map((shipment) => String(shipment.order_id)));
    const rows = shipments.map((shipment) => {
      const order = ordersById[String(shipment.order_id)] ?? {};
      const user = usersById[String(shipment.user_id ?? order.user_id)] ?? {};
      return {
        id: shipment.id,
        order_id: shipment.order_id,
        status: shipment.status ?? "pending",
        tracking_code: shipment.tracking_code ?? null,
        full_name: shipment.full_name,
        phone: shipment.phone,
        province: shipment.province,
        city: shipment.city,
        address: shipment.address,
        postal_code: shipment.postal_code,
        created_at: shipment.created_at,
        sent_at: shipment.sent_at ?? null,
        amount_rial: order.amount_rial ?? null,
        ref_id: order.ref_id ?? null,
        items: itemTitles(order),
        user_name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || null,
        user_phone: user.phone ?? null,
        no_shipment: false,
      };
    });

    const missingShipments = physicalOrders
      .filter((order) => !orderIdsWithShipment.has(String(order.id)))
      .map((order) => {
        const user = usersById[String(order.user_id)] ?? {};
        return {
          id: null,
          order_id: order.id,
          status: "no_shipment",
          tracking_code: null,
          full_name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "—",
          phone: user.phone ?? "—",
          province: null,
          city: null,
          address: null,
          postal_code: null,
          created_at: order.created_at,
          sent_at: null,
          amount_rial: order.amount_rial ?? null,
          ref_id: order.ref_id ?? null,
          items: itemTitles(order),
          user_name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || null,
          user_phone: user.phone ?? null,
          no_shipment: true,
        };
      });

    return jsonNoStore({ success: true, shipments: rows, missing_shipments: missingShipments, sync });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-shipments] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس مرسوله‌ها تنظیم نشده است" : "خطا در پردازش مرسوله‌ها" },
      missingConfig ? 503 : 500
    );
  }
}
