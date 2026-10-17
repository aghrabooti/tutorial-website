export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "next-api" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
