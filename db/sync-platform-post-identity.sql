-- Required before enabling platform discovery sync.
-- This migration is intentionally non-destructive: it refuses to create the
-- unique index when duplicate platform identities already exist.

DO $$
DECLARE
  duplicate_groups INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_groups
  FROM (
    SELECT platform, platform_post_id
    FROM public.posts
    WHERE platform_post_id IS NOT NULL
    GROUP BY platform, platform_post_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot create idx_posts_platform_post_identity: % duplicate (platform, platform_post_id) group(s) exist. Review them before rerunning this migration.',
      duplicate_groups;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_platform_post_identity
  ON public.posts (platform, platform_post_id)
  WHERE platform_post_id IS NOT NULL;
