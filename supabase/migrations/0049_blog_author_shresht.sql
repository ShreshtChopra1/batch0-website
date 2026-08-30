-- ============================================================================
-- 0049 — Rename blog author key 'taran' -> 'shresht'.
--
-- The founding roster changed: Taran Bethi is no longer a co-founder; Shresht
-- Chopra takes that seat. The author roster lives in lib/blog-shared.ts, and
-- 0037_blog_posts.sql pinned author_key to a check constraint. This migration
-- keeps the DB in step: it reassigns any admin-authored posts written under the
-- old key and swaps the constraint's allowed set. File-based posts are handled
-- separately in their markdown frontmatter.
--
-- Run in the Supabase SQL Editor. Idempotent / safe to re-run.
-- ============================================================================

-- Drop the old constraint so existing rows can be migrated without tripping it.
alter table public.blog_posts
  drop constraint if exists blog_posts_author_key_check;

-- Reassign any posts still on the old key.
update public.blog_posts
  set author_key = 'shresht'
  where author_key = 'taran';

-- Re-add the constraint with the new allowed set.
alter table public.blog_posts
  add constraint blog_posts_author_key_check
  check (author_key in ('rishabh', 'shresht', 'team'));

notify pgrst, 'reload schema';
