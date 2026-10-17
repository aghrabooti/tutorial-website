import "server-only";
import { createHash } from "node:crypto";
import { query } from "./postgres.js";

export const MAX_SESSION_TOKEN_LENGTH = 512;

export function isValidSessionToken(token) {
  return (
    typeof token === "string" &&
    token.trim().length > 0 &&
    token.length <= MAX_SESSION_TOKEN_LENGTH
  );
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const SITE_USER_COLUMNS = new Set([
  "id",
  "phone",
  "password_hash",
  "role",
  "is_active",
  "created_at",
  "updated_at",
  "last_login",
  "first_name",
  "last_name",
  "grade",
  "major",
]);

// PostgreSQL-backed counterpart used by routes as they are migrated in batches.
// expires_at is a timestamp without time zone in the source schema and is treated as UTC.
export async function findActivePostgresSession(token) {
  let session;
  try {
    const result = await query(
      `SELECT id, user_id, expires_at,
              expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS expired
       FROM public.user_sessions
       WHERE token_hash = $1 AND is_active IS TRUE
       LIMIT 1`,
      [hashSessionToken(token)]
    );
    session = result.rows[0] ?? null;
  } catch (error) {
    if (String(error?.message ?? "").startsWith("Missing server environment variable:")) {
      throw error;
    }
    return { session: null, expired: false, error };
  }

  if (!session) return { session: null, expired: false, error: null };
  if (session.expired) {
    try {
      await query(
        "UPDATE public.user_sessions SET is_active = false WHERE id = $1",
        [session.id]
      );
      return { session: null, expired: true, error: null };
    } catch (error) {
      return { session: null, expired: true, error };
    }
  }

  const { expired, ...activeSession } = session;
  return { session: activeSession, expired: false, error: null };
}

export async function findActivePostgresSessionUser(token, columns = ["id"]) {
  const selected = Array.isArray(columns) ? columns : String(columns).split(",");
  const safeColumns = selected.map((column) => String(column).trim()).filter(Boolean);
  if (
    safeColumns.length === 0 ||
    safeColumns.some((column) => !SITE_USER_COLUMNS.has(column))
  ) {
    throw new TypeError("Invalid site_users projection");
  }

  const result = await findActivePostgresSession(token);
  if (!result.session) return { ...result, user: null, userError: null };

  try {
    const { rows } = await query(
      `SELECT ${safeColumns.join(", ")} FROM public.site_users WHERE id = $1 LIMIT 1`,
      [result.session.user_id]
    );
    return { ...result, user: rows[0] ?? null, userError: null };
  } catch (userError) {
    return { ...result, user: null, userError };
  }
}

export function jsonNoStore(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
