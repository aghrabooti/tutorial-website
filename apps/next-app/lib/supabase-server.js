import "server-only";
import { createClient } from "@supabase/supabase-js";

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function createServerClient(key) {
  return createClient(requiredEnv("SUPABASE_URL"), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Use this only for data that the current public anon client can already read.
export function createPublicSupabaseClient() {
  return createServerClient(requiredEnv("SUPABASE_ANON_KEY"));
}

// Elevated client: keep imports server-only and use only in fixed, narrowly
// scoped server routes. Never accept a table, filter, or mutation from a caller.
export function createServiceSupabaseClient() {
  return createServerClient(requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
}
