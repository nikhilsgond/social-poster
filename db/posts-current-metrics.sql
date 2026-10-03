-- Run manually before deploying the Content Analysis dashboard, then Sync All.
-- Current metrics belong to posts. Existing snapshot storage is unchanged.
BEGIN;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS shares BIGINT;
ALTER TABLE public.posts
  ALTER COLUMN views DROP NOT NULL, ALTER COLUMN views DROP DEFAULT,
  ALTER COLUMN likes DROP NOT NULL, ALTER COLUMN likes DROP DEFAULT,
  ALTER COLUMN comments DROP NOT NULL, ALTER COLUMN comments DROP DEFAULT;
ALTER TABLE public.posts ALTER COLUMN shares DROP NOT NULL, ALTER COLUMN shares DROP DEFAULT;
UPDATE public.posts SET shares = NULL WHERE platform = 'yt';
-- Old Facebook likes counted LIKE only. Clear these until total reactions sync.
UPDATE public.posts SET likes = NULL WHERE platform = 'fb';
COMMIT;
