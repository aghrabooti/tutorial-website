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

  console.error("[api/functions/admin-shipments] Course select fallback:", error);
  const retry = await supabase.from("courses").select("id, type");
  for (const course of retry.data ?? []) {
    if (isPhysicalCourse(course)) ids.add(String(course.id));
  }
  return ids;
}

async function createShipmentFromOrder(supabase, order) {
  const { data: address, error: addressError } = await supabase
    .from("user_addresses")
    .select("*")
    .eq("user_id", String(order.user_id))
    .maybeSingle();

  if (addressError) console.error("[api/functions/admin-shipments] Address lookup failed:", addressError);
  if (!address) return { created: false, missing_address: true };

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("shipments")
    .insert({
      order_id: String(order.id),
      user_id: String(order.user_id),
      full_name: address.full_name,
      phone: address.phone,
      province: address.province,
      city: address.city,
      address: address.address,
      postal_code: address.postal_code,
      status: "pending",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[api/functions/admin-shipments] Shipment insert failed:", error);
    return { created: false, error: error.message };
  }

  return { created: true, shipment_id: inserted?.id ?? null };
}

async function resyncMissingShipments(supabase, physicalCourseIds) {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, user_id, amount_rial, ref_id, status, source, items, course_ids, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[api/functions/admin-shipments] Orders lookup failed:", error);
    return { created: 0, missing_address: 0, failed: 0, needs_shipping: 0 };
  }

  const relevant = (orders ?? []).filter((order) => needsShipping(order, physicalCourseIds));
  if (relevant.length === 0) {
    return { created: 0, missing_address: 0, failed: 0, needs_shipping: 0 };
  }

  const orderIds = relevant.map((order) => String(order.id));
  const { data: existing } = await supabase
    .from("shipments")
    .select("order_id")
    .in("order_id", orderIds);
  const haveShipment = new Set((existing ?? []).map((shipment) => String(shipment.order_id)));

  let created = 0;
  let missingAddress = 0;
  let failed = 0;
  const errors = {};

  for (const order of relevant) {
    if (haveShipment.has(String(order.id))) continue;
    const result = await createShipmentFromOrder(supabase, order);
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
    const supabase = createServiceSupabaseClient();
    const auth = await findActiveAdmin(supabase, token);
    if (!auth.admin) return jsonNoStore({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    if (action === "mark_sent") {
      const shipmentId = body?.shipment_id;
      if (!shipmentId) return jsonNoStore({ error: "شناسه‌ی مرسوله ارسال نشده" }, 400);

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("shipments")
        .update({
          status: "sent",
          tracking_code: String(body?.tracking_code ?? "").trim() || null,
          sent_at: now,
          updated_at: now,
        })
        .eq("id", shipmentId);

      if (error) {
        console.error("[api/functions/admin-shipments] Mark sent failed:", error);
        return jsonNoStore({ error: "خطا در ثبت ارسال" }, 500);
      }
      return jsonNoStore({ success: true });
    }

    let sync = null;
    if (action === "resync") {
      const ids = await loadPhysicalCourseIds(supabase);
      sync = await resyncMissingShipments(supabase, ids);
    }

    const physicalCourseIds = await loadPhysicalCourseIds(supabase);
    const autoSync = await resyncMissingShipments(supabase, physicalCourseIds);
    if (!sync) sync = autoSync;

    const { data: shipments, error: shipmentError } = await supabase
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (shipmentError) {
      console.error("[api/functions/admin-shipments] Shipment list failed:", shipmentError);
      return jsonNoStore({ error: "خطا در خواندن مرسوله‌ها" }, 500);
    }

    const { data: paidOrders } = await supabase
      .from("orders")
      .select("id, user_id, amount_rial, ref_id, status, source, items, course_ids, created_at")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(300);

    const physicalOrders = (paidOrders ?? []).filter((order) => needsShipping(order, physicalCourseIds));
    const ordersById = Object.fromEntries(physicalOrders.map((order) => [String(order.id), order]));
    const userIds = [...new Set([
      ...(shipments ?? []).map((shipment) => String(shipment.user_id ?? "")),
      ...physicalOrders.map((order) => String(order.user_id)),
    ])].filter(Boolean);

    let usersById = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("site_users")
        .select("id, first_name, last_name, phone")
        .in("id", userIds);
      usersById = Object.fromEntries((users ?? []).map((user) => [String(user.id), user]));
    }

    const itemTitles = (order) => orderItems(order).map((item) => item.title).filter(Boolean);
    const orderIdsWithShipment = new Set((shipments ?? []).map((shipment) => String(shipment.order_id)));
    const rows = (shipments ?? []).map((shipment) => {
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
          note: sync?.errors?.[String(order.id)] ?? null,
        };
      });

    return jsonNoStore({ success: true, shipments: rows, missing_shipments: missingShipments, sync });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-shipments] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس مرسوله‌ها تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
