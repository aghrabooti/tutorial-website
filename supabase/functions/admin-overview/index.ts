// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-overview — آمار کلی پنل مدیریت (فقط نقش admin)
// ورودی: { token }
// خروجی: { success, stats: { revenue_rial, paid_orders, users,
//          pending_shipments, missing_shipments },
//          gateway: { sandbox, merchant_configured, merchant_masked,
//                     callback_url } }
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MERCHANT_ID = (Deno.env.get("ZARINPAL_MERCHANT_ID") ?? "").trim();
const SANDBOX_FLAG = (Deno.env.get("ZARINPAL_SANDBOX") ?? "false")
  .trim()
  .toLowerCase() === "true";
const CALLBACK_URL = (Deno.env.get("ZARINPAL_CALLBACK_URL") ?? "").trim();
const PRICE_TO_RIAL = Number(Deno.env.get("PRICE_TO_RIAL_FACTOR") ?? "10");

const MERCHANT_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const TEST_MERCHANT_IDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
]);

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashText(text: string) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// توکن → کاربر admin (در غیر این صورت null)
async function getAdminUser(token: string) {
  const tokenHash = await hashText(token);

  const { data: session } = await supabaseAdmin
    .from("user_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from("site_users")
    .select("id, role")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user || user.role !== "admin") return null;
  return user;
}

function isPhysicalCourse(course: any) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;

  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

async function loadPhysicalCourseIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  const { data, error } = await supabaseAdmin
    .from("courses")
    .select("id, type, requires_shipping");

  if (!error) {
    (data ?? []).forEach((c: any) => {
      if (isPhysicalCourse(c)) ids.add(String(c.id));
    });
    return ids;
  }

  const retry = await supabaseAdmin.from("courses").select("id, type");
  (retry.data ?? []).forEach((c: any) => {
    if (isPhysicalCourse(c)) ids.add(String(c.id));
  });

  return ids;
}

// وضعیت درگاه پرداخت (بدون تماس با زرین‌پال) — برای نمایش در داشبورد مدیر
function gatewayStatus() {
  const merchantConfigured =
    MERCHANT_RE.test(MERCHANT_ID) &&
    !TEST_MERCHANT_IDS.has(MERCHANT_ID.toLowerCase());

  const masked = MERCHANT_ID
    ? `${MERCHANT_ID.slice(0, 8)}…${MERCHANT_ID.slice(-4)}`
    : null;

  const sandbox = SANDBOX_FLAG || !merchantConfigured;

  const problems: string[] = [];
  if (!merchantConfigured)
    problems.push(
      "مرچنت‌کد زرین‌پال تنظیم نشده است (secret: ZARINPAL_MERCHANT_ID)"
    );
  if (!CALLBACK_URL)
    problems.push(
      "آدرس بازگشت تنظیم نشده است (secret: ZARINPAL_CALLBACK_URL)"
    );
  else if (!sandbox && !/^https:\/\//i.test(CALLBACK_URL))
    problems.push("آدرس بازگشت باید https و روی دامنه‌ی ثبت‌شده باشد");
  if (PRICE_TO_RIAL !== 10 && PRICE_TO_RIAL !== 1)
    problems.push("ضریب تبدیل قیمت به ریال غیرعادی است (PRICE_TO_RIAL_FACTOR)");

  return {
    sandbox,
    mode: sandbox ? "sandbox" : "production",
    merchant_configured: merchantConfigured,
    merchant_masked: masked,
    callback_url: CALLBACK_URL || null,
    price_to_rial_factor: PRICE_TO_RIAL,
    problems,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    const usersRes = await supabaseAdmin
      .from("site_users")
      .select("id", { count: "exact", head: true });

    const paidRes = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid");

    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("id, amount_rial, items, course_ids")
      .eq("status", "paid")
      .limit(500);

    const revenueRial = (paidOrders ?? []).reduce(
      (sum: number, o: any) => sum + Number(o.amount_rial ?? 0),
      0
    );

    // ── مرسوله‌های در انتظار ارسال ──
    // علاوه بر مرسوله‌های pending، سفارش‌های پستیِ paid که مرسوله‌شان
    // ساخته نشده هم شمرده می‌شوند تا آماری از قلم نیفتد.
    const shipRes = await supabaseAdmin
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    let pendingShipments = shipRes.error ? null : shipRes.count ?? 0;
    let missingShipments: number | null = shipRes.error ? null : 0;

    if (!shipRes.error) {
      const physicalCourseIds = await loadPhysicalCourseIds();

      const paidOrderIds = (paidOrders ?? []).map((o: any) => String(o.id));

      let existingOrderIds = new Set<string>();
      if (paidOrderIds.length > 0) {
        const { data: shipped } = await supabaseAdmin
          .from("shipments")
          .select("order_id")
          .in("order_id", paidOrderIds);

        existingOrderIds = new Set(
          (shipped ?? []).map((s: any) => String(s.order_id))
        );
      }

      missingShipments = 0;

      for (const o of paidOrders ?? []) {
        const items = Array.isArray(o.items) ? o.items : [];
        const courseIds =
          Array.isArray(o.course_ids) && o.course_ids.length > 0
            ? o.course_ids.map(String)
            : items.map((i: any) => String(i?.course_id ?? "")).filter(Boolean);

        const needsShipping =
          items.some((i: any) => i?.requires_shipping === true) ||
          courseIds.some((id: string) => physicalCourseIds.has(id));

        if (needsShipping && !existingOrderIds.has(String(o.id))) {
          missingShipments++;
          pendingShipments = (pendingShipments ?? 0) + 1;
        }
      }
    }

    return jsonResponse({
      success: true,
      stats: {
        revenue_rial: revenueRial,
        paid_orders: paidRes.count ?? 0,
        users: usersRes.count ?? 0,
        pending_shipments: pendingShipments,
        missing_shipments: missingShipments,
      },
      gateway: gatewayStatus(),
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
