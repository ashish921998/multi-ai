import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Service-role client used by every Edge Function (bypasses RLS). */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Public URL of the deployed browser app, used to build join links. */
export function appBaseUrl(): string {
  return (Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173").replace(/\/$/, "");
}
