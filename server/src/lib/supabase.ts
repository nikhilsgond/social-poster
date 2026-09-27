// server/src/lib/supabase.ts
// Server-side Supabase client using the service-role key.
// This client bypasses RLS and has full database access.
// NEVER expose the service-role key to the frontend.
// Lazy initialization: client is created after dotenv.config() is called.

import { createClient } from "@supabase/supabase-js";

let _supabaseClient: ReturnType<typeof createClient> | null = null;

export function ensureClient() {
  if (_supabaseClient) return _supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing Supabase server environment variables. " +
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env"
    );
  }

  _supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabaseClient;
}

// Lazy proxy so .from() works after dotenv.config() initializes the env
export const supabaseServer = new Proxy({} as any, {
  get(_target, prop) {
    return (ensureClient() as any)[prop as string];
  },
});
