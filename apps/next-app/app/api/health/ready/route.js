import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { query } from "../../../../lib/postgres.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const checks = { postgres: "error", storage: "error" };
  let ready = true;

  try {
    const { rows } = await query(
      `SELECT to_regclass('public.site_users') IS NOT NULL AS users_ready,
              to_regclass('public.courses') IS NOT NULL AS courses_ready`
    );
    if (rows[0]?.users_ready && rows[0]?.courses_ready) checks.postgres = "ok";
    else ready = false;
  } catch {
    ready = false;
  }

  const storageRoot = process.env.STORAGE_ROOT?.trim();
  if (storageRoot) {
    const probePath = join(storageRoot, `.readiness-${randomUUID()}`);
    try {
      await mkdir(storageRoot, { recursive: true });
      const handle = await open(probePath, "wx", 0o600);
      await handle.close();
      await unlink(probePath);
      checks.storage = "ok";
    } catch {
      ready = false;
      try {
        await unlink(probePath);
      } catch {
        // A failed readiness probe may not have created the file.
      }
    }
  } else {
    ready = false;
  }

  return Response.json(
    { status: ready ? "ready" : "not_ready", checks },
    { status: ready ? 200 : 503, headers }
  );
}
