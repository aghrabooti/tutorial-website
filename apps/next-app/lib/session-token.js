import "server-only";
import { createHash } from "node:crypto";

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

export async function findActiveSession(supabase, token) {
  const { data: session, error } = await supabase
    .from("user_sessions")
    .select("id,user_id,expires_at")
    .eq("token_hash", hashSessionToken(token))
    .eq("is_active", true)
    .maybeSingle();

  if (error || !session) {
    return { session: null, expired: false, error };
  }

  if (new Date(session.expires_at) < new Date()) {
    const { error: deactivateError } = await supabase
      .from("user_sessions")
      .update({ is_active: false })
      .eq("id", session.id);

    return { session: null, expired: true, error: deactivateError };
  }

  return { session, expired: false, error: null };
}

export function jsonNoStore(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
