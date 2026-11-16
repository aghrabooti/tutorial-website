import "server-only";
import { findActiveSession } from "./session-token.js";

// columns must be a server-defined select string; never take it from a request.
export async function findActiveSessionUser(database, token, columns = "id") {
  const result = await findActiveSession(database, token);
  if (!result.session) return { ...result, user: null, userError: null };

  const { data: user, error: userError } = await database
    .from("site_users")
    .select(columns)
    .eq("id", result.session.user_id)
    .maybeSingle();

  return { ...result, user: user ?? null, userError };
}
