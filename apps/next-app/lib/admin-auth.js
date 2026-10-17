import "server-only";
import { findActivePostgresSessionUser } from "./session-token.js";

export async function findActivePostgresAdmin(token) {
  const result = await findActivePostgresSessionUser(token, ["id", "role"]);
  return {
    ...result,
    admin: result.user?.role === "admin" ? result.user : null,
  };
}
