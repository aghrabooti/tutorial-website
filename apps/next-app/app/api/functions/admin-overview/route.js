import { query } from "../../../../lib/postgres.js";
import { findActivePostgresAdmin } from "../../../../lib/admin-auth.js";
import { jsonNoStore, isValidSessionToken } from "../../../../lib/session-token.js";

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

    const [usersResult, paidCountResult, paidOrdersResult, pendingResult] = await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM public.site_users"),
      query("SELECT COUNT(*)::int AS count FROM public.orders WHERE status = 'paid'"),
      query(
        `SELECT id, amount_rial, items, course_ids
         FROM public.orders
         WHERE status = 'paid'
         LIMIT 500`
      ),
      query("SELECT COUNT(*)::int AS count FROM public.shipments WHERE status = 'pending'"),
    ]);

    const paidOrders = paidOrdersResult.rows;
    const revenueRial = paidOrders.reduce(
      (sum, order) => sum + Number(order.amount_rial ?? 0),
      0
    );
    let pendingShipments = Number(pendingResult.rows[0]?.count ?? 0);
    let missingShipments = 0;

    const { rows: courses } = await query("SELECT id, type, requires_shipping FROM public.courses");
    const physicalCourseIds = new Set(
      courses.filter(isPhysicalCourse).map((course) => String(course.id))
    );
    const paidOrderIds = paidOrders.map((order) => String(order.id));
    let existingOrderIds = new Set();
    if (paidOrderIds.length > 0) {
      const { rows: shipped } = await query(
        "SELECT order_id FROM public.shipments WHERE order_id = ANY($1::uuid[])",
        [paidOrderIds]
      );
      existingOrderIds = new Set(shipped.map((shipment) => String(shipment.order_id)));
    }

    for (const order of paidOrders) {
      const items = Array.isArray(order.items) ? order.items : [];
      const courseIds = Array.isArray(order.course_ids) && order.course_ids.length > 0
        ? order.course_ids.map(String)
        : items.map((item) => String(item?.course_id ?? "")).filter(Boolean);
      const needsShipping = items.some((item) => item?.requires_shipping === true) ||
        courseIds.some((id) => physicalCourseIds.has(id));

      if (needsShipping && !existingOrderIds.has(String(order.id))) {
        missingShipments++;
        pendingShipments++;
      }
    }

    return jsonNoStore({
      success: true,
      stats: {
        revenue_rial: revenueRial,
        paid_orders: Number(paidCountResult.rows[0]?.count ?? 0),
        users: Number(usersResult.rows[0]?.count ?? 0),
        pending_shipments: pendingShipments,
        missing_shipments: missingShipments,
      },
      gateway: getGatewayStatus(),
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith("Missing server environment variable:");
    console.error("[api/functions/admin-overview] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      { error: missingConfig ? "سرویس داشبورد تنظیم نشده است" : "خطا در دریافت داشبورد" },
      missingConfig ? 503 : 500
    );
  }
}
