import "server-only";
import { findActiveSessionUser } from "./session-user.js";

export async function findActiveAdmin(supabase, token) {
  const result = await findActiveSessionUser(supabase, token, "id, role");
  return {
    ...result,
    admin: result.user?.role === "admin" ? result.user : null,
  };
}
