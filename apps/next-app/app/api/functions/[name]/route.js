import { jsonNoStore } from "../../../../lib/session-token.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retained only as a fail-closed compatibility route. Every browser-facing API
// has a dedicated implementation; there are no Edge-function proxy targets.
const EDGE_FUNCTIONS = new Set([]);

export async function POST(_request, context) {
  const { name } = await context.params;
  if (!EDGE_FUNCTIONS.has(name)) return jsonNoStore({ error: "function not found" }, 404);
  return jsonNoStore({ error: "function not found" }, 404);
}
