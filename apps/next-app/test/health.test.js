import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route.js";

test("GET /api/health returns an uncached liveness response", async () => {
  const fetch = globalThis.fetch;
  process.env.DATABASE_API_URL = "http://db-api.test";
  globalThis.fetch = async () => Response.json([]);
  const response = await GET();
  globalThis.fetch = fetch;
  delete process.env.DATABASE_API_URL;

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "next-api",
  });
});
