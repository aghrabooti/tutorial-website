import { query } from "../../../../lib/postgres.js";
import { findActivePostgresSessionUser, isValidSessionToken, jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ success: false, error: "invalid request body" }, 400);
  }

  const token = body?.token;
  if (!isValidSessionToken(token)) {
    return jsonNoStore({ success: false, error: "token missing" }, 400);
  }

  try {
    const sessionResult = await findActivePostgresSessionUser(token);
    if (sessionResult.error && !sessionResult.expired) throw sessionResult.error;
    if (!sessionResult.session) {
      return jsonNoStore(
        { success: false, error: sessionResult.expired ? "session expired" : "invalid session" },
        401
      );
    }
    if (sessionResult.userError) throw sessionResult.userError;
    if (!sessionResult.user) return jsonNoStore({ success: false, error: "user not found" }, 404);

    const { rows } = await query(
      `SELECT ci.id AS cart_item_id,
              ci.created_at,
              c.id AS course_id,
              c.title AS course_title,
              c.description AS course_description,
              c.price AS course_price,
              c.discount_price AS course_discount_price,
              c.image_url AS course_image_url,
              c.grade AS course_grade,
              c.category AS course_category,
              c.type AS course_type,
              c.major AS course_major
       FROM public.cart_items AS ci
       INNER JOIN public.courses AS c ON c.id = ci.course_id
       WHERE ci.user_id = $1
       ORDER BY ci.created_at DESC`,
      [sessionResult.user.id]
    );

    const items = rows.map((row) => ({
      id: row.cart_item_id,
      created_at: row.created_at,
      courses: {
        id: row.course_id,
        title: row.course_title,
        description: row.course_description,
        price: row.course_price,
        discount_price: row.course_discount_price,
        image_url: row.course_image_url,
        grade: row.course_grade,
        category: row.course_category,
        type: row.course_type,
        major: row.course_major,
      },
    }));

    let totalPrice = 0;
    let totalDiscount = 0;
    for (const item of items) {
      const course = item.courses;
      const price = Number(course.discount_price ?? course.price ?? 0);
      totalPrice += price;
      if (course.discount_price && course.price) {
        totalDiscount += Number(course.price) - Number(course.discount_price);
      }
    }

    return jsonNoStore({
      success: true,
      items,
      total_price: totalPrice,
      total_discount: totalDiscount,
      count: items.length,
    });
  } catch (error) {
    const missingConfig = String(error?.message ?? "").startsWith(
      "Missing server environment variable:"
    );
    console.error("[api/functions/get-cart] PostgreSQL request failed:", error?.message ?? error);
    return jsonNoStore(
      {
        success: false,
        error: missingConfig ? "Cart service is not configured" : error?.message ?? "Server error",
      },
      missingConfig ? 503 : 500
    );
  }
}
