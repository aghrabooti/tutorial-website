import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString?.trim()) {
  console.error("Missing MIGRATION_DATABASE_URL (or DATABASE_URL for local migration runs).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString.trim(),
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: "tutorial-website-migrations",
  options: "-c timezone=UTC",
});

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        filename text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();

    if (files.length === 0) {
      console.log("No PostgreSQL migrations found.");
      return;
    }

    for (const filename of files) {
      const version = filename.slice(0, filename.indexOf("_"));
      const sql = await readFile(join(migrationsDir, filename), "utf8");
      const digest = checksum(sql);
      const existing = await client.query(
        "SELECT checksum FROM public.schema_migrations WHERE version = $1",
        [version]
      );

      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== digest) {
          throw new Error(
            `Applied migration ${filename} was modified. Add a new migration instead of editing it.`
          );
        }
        console.log(`Already applied: ${filename}`);
        continue;
      }

      console.log(`Applying: ${filename}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public.schema_migrations (version, filename, checksum)
           VALUES ($1, $2, $3)`,
          [version, filename, digest]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

try {
  await run();
} catch (error) {
  // Do not print connection details: a PostgreSQL URI can contain credentials.
  console.error("PostgreSQL migration failed:", error?.message ?? "Unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
