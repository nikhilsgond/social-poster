-- Scheduling integrity migration.
-- Review deployed data before applying; this file intentionally makes no RLS changes.

-- 1. Inspect rows that must be repaired before validating the constraint.
SELECT id, platform, status, date, time, scheduled_at
FROM public.posts
WHERE status = 'scheduled' AND scheduled_at IS NULL;

-- 2. Prevent new invalid scheduled rows immediately. NOT VALID allows the
-- constraint to be installed even if legacy rows from the query above exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_scheduled_at_required'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_scheduled_at_required
      CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

-- 3. After repairing every row reported above, validate once:
-- ALTER TABLE public.posts VALIDATE CONSTRAINT posts_scheduled_at_required;
