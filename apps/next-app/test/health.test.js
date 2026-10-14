import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route.js";

test("GET /api/health returns an uncached liveness response", async () => {
  const response = GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "next-api",
  });
});
