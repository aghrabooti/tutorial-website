import "server-only";
import { Pool } from "pg";

const POOL_KEY = Symbol.for("tutorial-website.postgres-pool");

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Missing server environment variable: DATABASE_URL");
  return value;
}

function poolOptions() {
  const parsedMax = Number.parseInt(process.env.DB_POOL_MAX ?? "10", 10);
  const max = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 10;
  const options = {
    connectionString: requiredDatabaseUrl(),
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "tutorial-website-next",
    options: "-c timezone=UTC",
  };

  // Same-VPS Compose uses the private Docker network without TLS. For an
  // external PostgreSQL endpoint, opt in to TLS and verify its certificate.
  if (process.env.DATABASE_SSL === "true") {
    options.ssl = { rejectUnauthorized: true };
  }

  return options;
}

export function getPostgresPool() {
  if (!globalThis[POOL_KEY]) globalThis[POOL_KEY] = new Pool(poolOptions());
  return globalThis[POOL_KEY];
}

export async function query(text, values = []) {
  return getPostgresPool().query(text, values);
}

export async function withTransaction(work) {
  if (typeof work !== "function") throw new TypeError("Transaction callback is required");

  const client = await getPostgresPool().connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[postgres] Transaction rollback failed:", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool() {
  const pool = globalThis[POOL_KEY];
  if (!pool) return;
  delete globalThis[POOL_KEY];
  await pool.end();
}

// Test-only dependency injection. Production routes never call these helpers.
export function installPostgresPoolForTests(pool) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("A test PostgreSQL pool cannot be installed in production");
  }
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A pool-like query object is required");
  }
  globalThis[POOL_KEY] = pool;
}

export function resetPostgresPoolForTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("A test PostgreSQL pool cannot be reset in production");
  }
  delete globalThis[POOL_KEY];
}
