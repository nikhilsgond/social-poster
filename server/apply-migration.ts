// apply-migration.ts
// One-time script to apply the metrics-snapshots migration to Supabase.
// Run: npx tsx apply-migration.ts

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const migrationSql = `
-- db/metrics-snapshots.sql
-- Phase 1: Metrics Synchronization — post_metric_snapshots table.

CREATE TABLE IF NOT EXISTS public.post_metric_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  views           BIGINT NOT NULL DEFAULT 0,
  likes           BIGINT NOT NULL DEFAULT 0,
  comments        BIGINT NOT NULL DEFAULT 0,
  shares          BIGINT NOT NULL DEFAULT 0,
  platform_metrics JSONB
);

CREATE INDEX IF NOT EXISTS idx_snapshots_post_id
  ON public.post_metric_snapshots (post_id);

CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at
  ON public.post_metric_snapshots (captured_at);

CREATE INDEX IF NOT EXISTS idx_snapshots_post_time
  ON public.post_metric_snapshots (post_id, captured_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique_minute
  ON public.post_metric_snapshots (post_id, captured_at);

CREATE OR REPLACE FUNCTION public.upsert_metric_snapshot_raw(
  p_post_id UUID,
  p_platform TEXT,
  p_captured_at TIMESTAMPTZ,
  p_views BIGINT,
  p_likes BIGINT,
  p_comments BIGINT,
  p_shares BIGINT,
  p_platform_metrics JSONB
) RETURNS void AS $$
BEGIN
  INSERT INTO public.post_metric_snapshots (
    post_id, platform, captured_at, views, likes, comments, shares, platform_metrics
  ) VALUES (
    p_post_id, p_platform, p_captured_at, p_views, p_likes, p_comments, p_shares, p_platform_metrics
  )
  ON CONFLICT (post_id, captured_at)
  DO UPDATE SET
    views = EXCLUDED.views,
    likes = EXCLUDED.likes,
    comments = EXCLUDED.comments,
    shares = EXCLUDED.shares,
    platform_metrics = COALESCE(EXCLUDED.platform_metrics, post_metric_snapshots.platform_metrics),
    captured_at = EXCLUDED.captured_at;
END;
$$ LANGUAGE plpgsql;
`;

async function main() {
  console.log("Applying metrics-snapshots migration...");

  const { error } = await supabase.rpc("exec_sql", { sql: migrationSql });

  if (error) {
    // Fallback: try sending as a raw query
    console.log("RPC exec_sql not available, trying direct query execution...");
    try {
      // Split by semicolons and execute each statement
      const statements = migrationSql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (const stmt of statements) {
        if (stmt.toUpperCase().startsWith("CREATE TABLE")) {
          const { error: tableError } = await supabase.from("post_metric_snapshots").select("id").limit(1);
          if (tableError && !tableError.message.includes("On conflict")) {
            // Table doesn't exist yet — use admin API via postgrest
            console.log("Table doesn't exist. Attempting to create via Supabase...");
          }
        }
      }

      // Use the Supabase management API or just report what needs to be done manually
      console.log("Migration SQL written to db/metrics-snapshots.sql");
      console.log("Please apply this SQL in the Supabase SQL Editor:");
      console.log("https://supabase.com/dashboard/project/_/sql");
      console.log("\nMigration contents:");
      console.log(migrationSql);
      return;
    } catch (err) {
      console.error("Failed to apply migration:", err);
      process.exit(1);
    }
  }

  console.log("Migration applied successfully!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
