import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { GET as getHealth } from "../app/api/health/route.js";
import { GET as getReady } from "../app/api/health/ready/route.js";
import {
  installPostgresPoolForTests,
  resetPostgresPoolForTests,
} from "../lib/postgres.js";

const envKeys = ["DATABASE_URL", "STORAGE_ROOT"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let tempStorage;

afterEach(async () => {
  resetPostgresPoolForTests();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  if (tempStorage) {
    await rm(tempStorage, { recursive: true, force: true });
    tempStorage = undefined;
  }
});

test("GET /api/health returns an uncached liveness response", async () => {
  const response = getHealth();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "next-api",
  });
});

test("GET /api/health/ready checks migrated PostgreSQL tables and writable storage", async () => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  tempStorage = await mkdtemp(join(tmpdir(), "tutorial-storage-ready-"));
  process.env.STORAGE_ROOT = tempStorage;
  installPostgresPoolForTests({
    async query(text) {
      assert.match(text, /to_regclass\('public\.site_users'\)/);
      return { rows: [{ users_ready: true, courses_ready: true }], rowCount: 1 };
    },
  });

  const response = await getReady();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ready",
    checks: { postgres: "ok", storage: "ok" },
  });
});

test("GET /api/health/ready fails closed when PostgreSQL and storage are not configured", async () => {
  delete process.env.DATABASE_URL;
  delete process.env.STORAGE_ROOT;
  resetPostgresPoolForTests();

  const response = await getReady();

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "not_ready",
    checks: { postgres: "error", storage: "error" },
  });
});
