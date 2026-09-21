// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// admin-shipments — مدیریت مرسوله‌های پستی (فقط نقش admin)
// ورودی:
//   { token, action: "list" }                                → فهرست مرسوله‌ها
//   { token, action: "resync" }                              → ساخت مرسوله‌های جامانده
//   { token, action: "mark_sent", shipment_id, tracking_code? } → ثبت ارسال
//
// نکته‌ی مهم: پیش از خواندن فهرست، سفارش‌های paid که شامل کتاب/جزوه هستند و
// مرسوله‌شان ساخته نشده، **خودکار** از روی نشانی ثبت‌شده‌ی کاربر ساخته می‌شوند
// (خودترمیمی). بنابراین خریدهای قبلی هم در پنل مدیریت دیده می‌شوند.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ── محصول فیزیکی: کتاب/جزوه (type) یا requires_shipping ──
function isPhysicalCourse(course: any) {
  if (!course) return false;
  if (course.requires_shipping === true) return true;

  const type = String(course.type ?? "").trim().toLowerCase();
  return type === "book" || type === "lecture";
}

function orderItems(order: any) {
  return Array.isArray(order?.items) ? order.items : [];
}

// آیا این سفارش باید پستی فرستاده شود؟ (بدون وابستگی به نام ستون‌های احتمالی)
async function needsShipping(order: any, physicalCourseIds: Set<string>) {
  const items = orderItems(order);
  if (items.some((i: any) => i?.requires_shipping === true)) return true;

  const courseIds = Array.isArray(order?.course_ids)
    ? order.course_ids.map(String)
    : items.map((i: any) => String(i?.course_id ?? "")).filter(Boolean);

  return courseIds.some((id: string) => physicalCourseIds.has(id));
}

// فهرست شناسه‌ی محصولات فیزیکی — با دو کوئری، برای سازگاری با دیتابیس‌هایی
// که ستون requires_shipping را ندارند
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

  console.error("[admin-shipments] courses select fallback:", error);

  const retry = await supabaseAdmin.from("courses").select("id, type");
  (retry.data ?? []).forEach((c: any) => {
    if (isPhysicalCourse(c)) ids.add(String(c.id));
  });

  return ids;
}

// ── ساخت مرسوله‌ی جامانده برای یک سفارش ──
async function createShipmentFromOrder(order: any) {
  const { data: addr, error: addrErr } = await supabaseAdmin
    .from("user_addresses")
    .select("*")
    .eq("user_id", String(order.user_id))
    .maybeSingle();

  if (addrErr) console.error("[admin-shipments] address select:", addrErr);

  if (!addr) {
    return { created: false, missing_address: true };
  }

  const now = new Date().toISOString();

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("shipments")
    .insert({
      order_id: String(order.id),
      user_id: String(order.user_id),
      full_name: addr.full_name,
      phone: addr.phone,
      province: addr.province,
      city: addr.city,
      address: addr.address,
      postal_code: addr.postal_code,
      status: "pending",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    console.error("[admin-shipments] shipment insert failed:", insErr);
    return { created: false, error: insErr.message };
  }

  console.log(`[admin-shipments] ✅ مرسوله برای سفارش ${order.id} ساخته شد`);
  return { created: true, shipment_id: inserted?.id ?? null };
}

// ── خودترمیمی: هر سفارش paid پستی که مرسوله ندارد، ساخته می‌شود ──
async function resyncMissingShipments(physicalCourseIds: Set<string>) {
  const { data: orders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select("id, user_id, amount_rial, ref_id, status, source, items, course_ids, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(300);

  if (ordersErr) {
    console.error("[admin-shipments] orders select:", ordersErr);
    return { created: 0, missing_address: 0, failed: 0, needs_shipping: 0 };
  }

  const relevant: any[] = [];
  for (const o of orders ?? []) {
    if (await needsShipping(o, physicalCourseIds)) relevant.push(o);
  }

  if (relevant.length === 0)
    return { created: 0, missing_address: 0, failed: 0, needs_shipping: 0 };

  const orderIds = relevant.map((o) => String(o.id));

  const { data: existing } = await supabaseAdmin
    .from("shipments")
    .select("order_id")
    .in("order_id", orderIds);

  const haveShipment = new Set(
    (existing ?? []).map((s: any) => String(s.order_id))
  );

  let created = 0;
  let missingAddress = 0;
  let failed = 0;

  for (const o of relevant) {
    if (haveShipment.has(String(o.id))) continue;

    const res = await createShipmentFromOrder(o);
    if (res.created) created++;
    else if (res.missing_address) missingAddress++;
    else failed++;
  }

  return {
    created,
    missing_address: missingAddress,
    failed,
    needs_shipping: relevant.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { token } = body;
    const action = body.action ?? "list";

    if (!token) return jsonResponse({ error: "توکن ارسال نشده" }, 401);

    const admin = await getAdminUser(token);
    if (!admin) return jsonResponse({ error: "دسترسی غیرمجاز — فقط مدیر" }, 403);

    // ── ثبت ارسال مرسوله ──
    if (action === "mark_sent") {
      const { shipment_id, tracking_code } = body;

      if (!shipment_id)
        return jsonResponse({ error: "شناسه‌ی مرسوله ارسال نشده" }, 400);

      const { error } = await supabaseAdmin
        .from("shipments")
        .update({
          status: "sent",
          tracking_code: String(tracking_code ?? "").trim() || null,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment_id);

      if (error) {
        console.error(error);
        return jsonResponse({ error: "خطا در ثبت ارسال" }, 500);
      }

      return jsonResponse({ success: true });
    }

    // ── همگام‌سازی دستی (همان خودترمیمی، با گزارش تعداد) ──
    let sync: any = null;
    if (action === "resync") {
      const physicalCourseIds = await loadPhysicalCourseIds();
      sync = await resyncMissingShipments(physicalCourseIds);
    }

    // ── فهرست مرسوله‌ها ──
    // قبل از خواندن، مرسوله‌های جامانده ساخته می‌شوند تا خریدهای قبلی هم دیده شوند
    const physicalCourseIds = await loadPhysicalCourseIds();
    await resyncMissingShipments(physicalCourseIds);

    const { data: shipments, error } = await supabaseAdmin
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      console.error(error);
      return jsonResponse({ error: "خطا در خواندن مرسوله‌ها" }, 500);
    }

    // سفارش‌های پستیِ paid برای تکمیل اطلاعات و پیدا کردن موارد ناقص
    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, amount_rial, ref_id, status, source, items, course_ids, created_at")
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(300);

    const physicalOrders: any[] = [];
    for (const o of paidOrders ?? []) {
      if (await needsShipping(o, physicalCourseIds)) physicalOrders.push(o);
    }

    const ordersById: Record<string, any> = Object.fromEntries(
      physicalOrders.map((o: any) => [String(o.id), o])
    );

    // مشتری‌ها (نام/موبایل) برای نمایش در کارت‌های ناقص
    const userIds = [
      ...new Set([
        ...(shipments ?? []).map((s: any) => String(s.user_id ?? "")),
        ...physicalOrders.map((o: any) => String(o.user_id)),
      ]),
    ].filter(Boolean);

    let usersById: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("site_users")
        .select("id, first_name, last_name, phone")
        .in("id", userIds);

      usersById = Object.fromEntries(
        (users ?? []).map((u: any) => [String(u.id), u])
      );
    }

    const itemTitles = (o: any) =>
      orderItems(o)
        .map((i: any) => i.title)
        .filter(Boolean);

    const orderIdsWithShipment = new Set(
      (shipments ?? []).map((s: any) => String(s.order_id))
    );

    const pickOrder = (orderId: any) => ordersById[String(orderId)] ?? {};

    const rows = (shipments ?? []).map((s: any) => {
      const o = pickOrder(s.order_id);
      const u = usersById[String(s.user_id ?? o.user_id)] ?? {};

      return {
        id: s.id,
        order_id: s.order_id,
        status: s.status ?? "pending",
        tracking_code: s.tracking_code ?? null,
        full_name: s.full_name,
        phone: s.phone,
        province: s.province,
        city: s.city,
        address: s.address,
        postal_code: s.postal_code,
        created_at: s.created_at,
        sent_at: s.sent_at ?? null,
        amount_rial: o.amount_rial ?? null,
        ref_id: o.ref_id ?? null,
        items: itemTitles(o),
        user_name:
          [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null,
        user_phone: u.phone ?? null,
        no_shipment: false,
      };
    });

    // سفارش‌های پستی که مرسوله‌شان ساخته نشده (مثلاً چون نشانی ثبت نشده)
    const orphans = physicalOrders
      .filter((o: any) => !orderIdsWithShipment.has(String(o.id)))
      .map((o: any) => {
        const u = usersById[String(o.user_id)] ?? {};
        return {
          id: null,
          order_id: o.id,
          status: "no_shipment",
          tracking_code: null,
          full_name:
            [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "—",
          phone: u.phone ?? "—",
          province: null,
          city: null,
          address: null,
          postal_code: null,
          created_at: o.created_at,
          sent_at: null,
          amount_rial: o.amount_rial ?? null,
          ref_id: o.ref_id ?? null,
          items: itemTitles(o),
          user_name:
            [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null,
          user_phone: u.phone ?? null,
          no_shipment: true,
        };
      });

    return jsonResponse({
      success: true,
      shipments: rows,
      missing_shipments: orphans,
      sync,
    });
  } catch (error: any) {
    console.error(error);
    return jsonResponse({ error: error?.message ?? "خطای سرور" }, 500);
  }
});
