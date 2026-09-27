-- db/posts.sql
-- Supabase posts table schema for the Social Planner.
-- Run this in the Supabase SQL Editor to create the complete schema.
--
-- Phase 3: Database foundation only.
-- Phase 4: React app will connect to this schema via PostContext.
-- Cloudinary is used for media storage (NOT Supabase Storage).

-- ── Platform Enum ──
-- Constrained enum to reject invalid platform values.
-- Matches the existing TypeScript Platform type.
CREATE TYPE planner_platform AS ENUM (
  'yt', 'ig', 'fb', 'th', 'li', 'x'
);

-- ── Status Enum ──
-- Supports current and future publishing workflow.
-- Current: draft, scheduled, posted, failed
-- Future: publishing, published
-- Matches the expanded PostStatus type.
CREATE TYPE planner_status AS ENUM (
  'draft', 'scheduled', 'publishing', 'published', 'failed'
);

-- ── Posts Table ──
-- Central table for all scheduled and published social media posts.
CREATE TABLE IF NOT EXISTS public.posts (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core scheduling
  date DATE NOT NULL,
  time TIME NOT NULL DEFAULT '00:00:00',
  scheduled_at TIMESTAMPTZ,

  -- Platform & content type
  platform planner_platform NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'Other',

  -- Content fields (nullable — not all platforms require all fields)
  title TEXT,
  topic TEXT,
  content TEXT,
  caption TEXT,
  description TEXT,

  -- Media (Cloudinary references, NOT Supabase Storage)
  media_url TEXT,
  cloudinary_public_id TEXT,
  social_url TEXT,
  media_cleaned_at TIMESTAMPTZ,

  -- Publishing fields (nullable, populated by future phases)
  platform_post_id TEXT,
  published_at TIMESTAMPTZ,
  error_message TEXT,

  -- Status and lifecycle
  status planner_status NOT NULL DEFAULT 'draft',
  attempts INTEGER NOT NULL DEFAULT 0,

  -- Metrics (BIGINT for large social media counts)
  views BIGINT NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  metrics_updated_at TIMESTAMPTZ,

  -- Source identification (for bulk import deduplication)
  source_id TEXT,
  permalink TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Content-Type Validation Note ──
-- Content types are platform-specific and stored as TEXT to allow
-- flexibility without restrictive global enums. Platform/content-type
-- compatibility is validated at the application layer (Phase 4).
-- See web/src/lib/contentTypes.ts for the full platform/content type map.
--
-- YouTube:   Video, Short, Live, Community Post, Other
-- Instagram: Reel, Post, Carousel, Story, Live, Other
-- Facebook:  Reel, Video, Image, Text, Story, Link, Other
-- Threads:   Text, Image, Video, GIF, Link, Other
-- LinkedIn:  Text, Image, Video, Document, Article, Poll, Event, Other
-- X:         Text, Image, Video, GIF, Link, Thread, Other

-- ── Indexes ──
-- Optimize for planner queries and future scheduler worker.

-- Index for listing posts by platform
CREATE INDEX IF NOT EXISTS idx_posts_platform ON public.posts (platform);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_posts_status ON public.posts (status);

-- Index for scheduling queries (future: find due posts)
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON public.posts (scheduled_at);

-- Index for creation time sorting
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts (created_at);

-- Composite index for the scheduler worker:
-- SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= now()
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled ON public.posts (status, scheduled_at);

-- Index for metrics queries
CREATE INDEX IF NOT EXISTS idx_posts_metrics ON public.posts (views, likes, comments);

-- ── Auto-Updated-At Trigger ──
-- Ensures updated_at is always current without relying on the client.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ── Row Level Security ──
-- RLS enabled to prevent anonymous public access.
-- Phase 4 will add per-user policies after authentication is implemented.
-- Currently NO permissive policies are created — this ensures the table
-- is not publicly writable while authentication is not yet set up.

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Security note: No policies are created yet.
-- This means no client can read or write until Phase 4 adds authenticated policies.
-- To avoid locking out the application during development, create a
-- permissive policy only in the Supabase dev environment, not production.
--
-- Example Phase 4 policy (NOT created here):
-- CREATE POLICY "Authenticated users can read" ON public.posts
--   FOR SELECT USING (auth.role() = 'authenticated');
--
-- CREATE POLICY "Authenticated users can insert" ON public.posts
--   WITH CHECK (auth.role() = 'authenticated');

-- ── TypeScript ↔ Supabase Column Mapping ──
--
-- TypeScript field          → Supabase column       → Type
-- ─────────────────────────────────────────────────────────
-- id                        → id                    → UUID
-- platform                  → platform              → planner_platform
-- contentType               → content_type          → TEXT
-- title                     → title                 → TEXT (nullable)
-- topic                     → topic                 → TEXT (nullable)
-- content                   → content               → TEXT (nullable)
-- description               → description           → TEXT (nullable)
-- caption                   → caption               → TEXT (nullable)
-- date                      → date                  → DATE (NOT NULL)
-- time                      → time                  → TIME (NOT NULL)
-- scheduledAt               → scheduled_at          → TIMESTAMPTZ
-- mediaUrl                  → media_url             → TEXT (nullable)
-- status                    → status                → planner_status
-- platformPostId            → platform_post_id      → TEXT (nullable)
-- errorMessage              → error_message         → TEXT (nullable)
-- attempts                  → attempts              → INTEGER
-- publishedAt               → published_at          → TIMESTAMPTZ (nullable)
-- metrics.views             → views                 → BIGINT
-- metrics.likes             → likes                 → BIGINT
-- metrics.comments          → comments              → BIGINT
-- metricsUpdatedAt          → metrics_updated_at    → TIMESTAMPTZ (nullable)
-- sourceId                  → source_id             → TEXT (nullable)
-- permalink                 → permalink             → TEXT (nullable)
-- cloudinaryPublicId        → cloudinary_public_id  → TEXT (nullable)
-- socialUrl                 → social_url            → TEXT (nullable)
-- mediaCleanedAt            → media_cleaned_at      → TIMESTAMPTZ (nullable)
-- createdAt                 → created_at            → TIMESTAMPTZ (DEFAULT now())
-- updatedAt                 → updated_at            → TIMESTAMPTZ (trigger)
