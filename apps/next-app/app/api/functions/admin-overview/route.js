import { createServiceSupabaseClient } from "../../../../lib/supabase-server.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";
import { findActiveAdmin } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MERCHANT_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TEST_MERCHANT_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
]);

function getGatewayStatus() {
  const merchantId = (process.env.ZARINPAL_MERCHANT_ID ?? "").trim();
  const sandboxFlag = (process.env.ZARINPAL_SANDBOX ?? "false").trim().toLowerCase() === "true";
  const callbackUrl = (process.env.ZARINPAL_CALLBACK_URL ?? "").trim();
  const priceToRial = Number(process.env.PRICE_TO_RIAL_FACTOR ?? "10");
  const merchantConfigured = MERCHANT_RE.test(merchantId) && !TEST_MERCHANT_IDS.has(merchantId.toLowerCase());
  const merchantMasked = merchantId ? `${merchantId.slice(0, 8)}…${merchantId.slice(-4)}` : null;
  const sandbox = sandboxFlag || !merchantConfigured;

  const problems = [];
  if (!merchantConfigured) problems.push("مرچنت‌کد زرین‌پال تنظیم نشده است (secret: ZARINPAL_MERCHANT_ID)");
  if (!callbackUrl) {
    problems.push("آدرس بازگشت تنظیم نشده است (secret: ZARINPAL_CALLBACK_URL)");
  } else if (!sandbox && !/^https:\/\//i.test(callbackUrl)) {
    problems.push("آدرس بازگشت باید https و روی دامنه‌ی ثبت‌شده باشد");
  }
  if (priceToRial !== 10 && priceToRial !== 1) {
    problems.push("ضریب تبدیل قیمت به ریال غیرعادی است (PRICE_TO_RIAL_FACTOR)");
  }

  return {
    sandbox,
    mode: sandbox ? "sandbox" : "production",
    merchant_configured: merchantConfigured,
    merchant_masked: merchantMasked,
    callback_url: callbackUrl || null,
    price_to_rial_factor: priceToRial,
    problems,
  };
}

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

    const usersRes = await supabase.from("site_users").select("id", { count: "exact", head: true });
    const paidRes = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid");
    const { data: paidOrders } = await supabase
      .from("orders")
      .select("id, amount_rial, items, course_ids")
      .eq("status", "paid")
      .limit(500);

    const revenueRial = (paidOrders ?? []).reduce(
      (sum, order) => sum + Number(order.amount_rial ?? 0),
      0
    );

    const shipRes = await supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    let pendingShipments = shipRes.error ? null : shipRes.count ?? 0;
    let missingShipments = shipRes.error ? null : 0;

    if (!shipRes.error) {
      const physicalCourseIds = await loadPhysicalCourseIds(supabase);
      const paidOrderIds = (paidOrders ?? []).map((order) => String(order.id));
      let existingOrderIds = new Set();
      if (paidOrderIds.length > 0) {
        const { data: shipped } = await supabase
          .from("shipments")
          .select("order_id")
          .in("order_id", paidOrderIds);
        existingOrderIds = new Set((shipped ?? []).map((shipment) => String(shipment.order_id)));
      }

      missingShipments = 0;
      for (const order of paidOrders ?? []) {
        const items = Array.isArray(order.items) ? order.items : [];
        const courseIds = Array.isArray(order.course_ids) && order.course_ids.length > 0
          ? order.course_ids.map(String)
          : items.map((item) => String(item?.course_id ?? "")).filter(Boolean);
        const needsShipping = items.some((item) => item?.requires_shipping === true) ||
          courseIds.some((id) => physicalCourseIds.has(id));

        if (needsShipping && !existingOrderIds.has(String(order.id))) {
          missingShipments++;
          pendingShipments = (pendingShipments ?? 0) + 1;
        }
      }
    }

    return jsonNoStore({
      success: true,
      stats: {
        revenue_rial: revenueRial,
        paid_orders: paidRes.count ?? 0,
        users: usersRes.count ?? 0,
        pending_shipments: pendingShipments,
        missing_shipments: missingShipments,
      },
      gateway: getGatewayStatus(),
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/admin-overview] Request failed:", error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس داشبورد تنظیم نشده است" : error?.message ?? "خطای سرور" },
      missingConfig ? 503 : 500
    );
  }
}
