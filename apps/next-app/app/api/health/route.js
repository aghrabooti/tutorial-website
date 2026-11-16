import { createDatabase } from "../../../lib/database.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { error } = await createDatabase().from("courses").select("id").limit(1);
    if (!error) return Response.json({ status: "ok", service: "next-api" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/health]", error);
  }
  return Response.json({ status: "unavailable", service: "next-api" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
