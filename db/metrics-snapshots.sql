-- db/metrics-snapshots.sql
-- Phase 1: Metrics Synchronization — post_metric_snapshots table.
--
-- Creates a historical snapshot table for social media metrics.
-- One snapshot per post per minute (upsert strategy to avoid duplicates
-- when Sync All is clicked multiple times within the same minute).
--
-- Run this in the Supabase SQL Editor to apply.
--
-- Requirements:
--   - PostgreSQL 14+ / Supabase (date_trunc, date_bin both available)
--   - The posts table must already exist.
--   - RLS is NOT enabled on this table by default.
--     Add RLS policies in a later phase when authentication is set up.

-- ── Snapshot Table ──
-- Stores periodic metric snapshots for trend analysis and analytics graphs.
CREATE TABLE IF NOT EXISTS public.post_metric_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to the post this snapshot belongs to
  post_id         UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,

  -- Platform identifier (yt, ig, fb, th)
  platform        TEXT NOT NULL,

  -- When this snapshot was captured (UTC)
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Current metric values at capture time
  -- These mirror the posts table but stored historically
  views           BIGINT NOT NULL DEFAULT 0,
  likes           BIGINT NOT NULL DEFAULT 0,
  comments        BIGINT NOT NULL DEFAULT 0,
  shares          BIGINT NOT NULL DEFAULT 0,

  -- Platform-specific metrics in JSONB for forward compatibility
  -- Example: { "saved": 120, "reach": 5000, "reactionsLove": 45, "videoViews": 1200 }
  platform_metrics JSONB
);

-- ── Indexes ──

-- Fast lookup of all snapshots for a given post
CREATE INDEX IF NOT EXISTS idx_snapshots_post_id
  ON public.post_metric_snapshots (post_id);

-- Time-series queries (e.g. "show me metrics for this post over the last 30 days")
CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at
  ON public.post_metric_snapshots (captured_at);

-- Composite index for the most common query pattern:
-- "get all snapshots for post X ordered by time"
CREATE INDEX IF NOT EXISTS idx_snapshots_post_time
  ON public.post_metric_snapshots (post_id, captured_at);

-- ── Unique constraint: one snapshot per post per minute ──
-- captured_at is already minute-truncated by the sync service's minuteBoundary()
-- function, so a plain unique index on (post_id, captured_at) enforces
-- one-snapshot-per-post-per-minute without needing date_trunc/date_bin in the index
-- expression (which would fail the IMMUTABLE requirement on timestamptz).
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique_minute
  ON public.post_metric_snapshots (post_id, captured_at);

-- ── Auto-update captured_at? NO.
-- Unlike the posts table, we WANT captured_at to reflect the actual snapshot time.
-- The trigger on posts (update_updated_at) does NOT apply here.
-- Each snapshot's captured_at is set at insert time.

-- ── Row Level Security ──
-- Not enabled in this phase. Add RLS policies in a later phase when
-- user authentication is implemented.
-- ALTER TABLE public.post_metric_snapshots ENABLE ROW LEVEL SECURITY;

-- ── Example queries ──

-- Get all snapshots for a post ordered by time:

-- ── RPC Function for snapshot upsert ──
-- Used by the metrics sync service to upsert snapshots with duplicate protection.
-- Creates the function if it doesn't exist.
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

-- ── Migration Notes ──
-- SELECT captured_at, views, likes, comments, shares, platform_metrics
-- FROM post_metric_snapshots
-- WHERE post_id = '<uuid>'
-- ORDER BY captured_at ASC;

-- Get the latest snapshot for each post in the last 7 days:
-- SELECT DISTINCT ON (post_id)
--   post_id, captured_at, views, likes, comments, shares
-- FROM post_metric_snapshots
-- WHERE captured_at >= now() - interval '7 days'
-- ORDER BY post_id, captured_at DESC;

-- Get total views across all posts per day (last 30 days):
-- SELECT
--   date_trunc('day', captured_at)::date AS day,
--   SUM(views) AS total_views,
--   SUM(likes) AS total_likes,
--   SUM(comments) AS total_comments
-- FROM post_metric_snapshots
-- WHERE captured_at >= now() - interval '30 days'
-- GROUP BY day
-- ORDER BY day ASC;
