-- Run once in the Supabase SQL Editor before using Facebook Multiple Images.
-- Existing single-media rows and media_url remain unchanged.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_urls TEXT[];
NOTIFY pgrst, 'reload schema';
