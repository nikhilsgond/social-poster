// src/lib/supabase.ts
// Supabase client — Phase 4: Connected to Supabase database.
// The browser uses only the publishable key.
// Never put service-role keys or database passwords in frontend code.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
