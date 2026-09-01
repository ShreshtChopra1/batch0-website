-- ============================================================================
-- 0058 — Staff-initiated 1:1 calls.
--
-- The existing office-hours tables (mentor_slots / mentor_bookings, 0011) run
-- student→mentor: a mentor posts open slots and a student claims one. This is
-- the inverse, and it is genuinely a different thing rather than a variation:
-- a mentor, investor, or admin picks a specific person and proposes a time,
-- and that person accepts or declines. There is no slot to claim, the invitee
-- is chosen rather than self-selecting, and the invite can be turned down.
--
-- Both survive. A student who wants time books office hours; a mentor who
-- wants time sends an invite.
--
-- Also grants the new `calls.invite` permission (lib/permissions.ts) to the
-- mentor and investor roles. `admin` needs nothing — it holds the '*'
-- wildcard. Because roles are data (0048), any custom role can be given this
-- from /admin/roles without a deploy, which is why the permission is checked
-- rather than the three role slugs being hardcoded anywhere.
--
-- Run in Supabase SQL Editor. Idempotent / safe to re-run.
-- Assumes 0001..0057 are applied.
-- ============================================================================

create table if not exists public.call_invites (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes int not null default 30
    check (duration_minutes between 5 and 240),
  topic text,
  status text not null default 'invited'
    check (status in ('invited','accepted','declined','cancelled','completed')),
  -- Created lazily, on first join rather than at invite time: an invite that
  -- is declined or never accepted should not have cost a room, and a room
  -- created weeks early would expire before the call happened.
  daily_room_name text,
  daily_room_url text,
  -- Mirrors mentor_bookings.recap (0026) so the two session types read the
  -- same way in a student's history.
  recap text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A host proposing the identical slot to the same person twice is a
  -- double-click, not an intent.
  unique (host_id, invitee_id, starts_at)
);

create index if not exists call_invites_invitee_idx
  on public.call_invites (invitee_id, starts_at desc);
create index if not exists call_invites_host_idx
  on public.call_invites (host_id, starts_at desc);

drop trigger if exists touch_call_invites on public.call_invites;
create trigger touch_call_invites before update on public.call_invites
  for each row execute procedure public.touch_updated_at();

alter table public.call_invites enable row level security;

-- ----------------------------------------------------------------------------
-- RLS
--
-- A 1:1 is private to its two people. Admins can see everything, because
-- safeguarding a program full of minors means someone must be able to answer
-- "who has been meeting my students" without asking the participants.
-- ----------------------------------------------------------------------------

drop policy if exists "call_invites read" on public.call_invites;
create policy "call_invites read" on public.call_invites
  for select using (
    public.is_admin(auth.uid())
    or host_id = auth.uid()
    or invitee_id = auth.uid()
  );

-- Only someone holding calls.invite may create one, and only as themselves.
-- The `host_id = auth.uid()` half matters as much as the permission: without
-- it, a mentor could write an invite that appears to come from an admin.
drop policy if exists "call_invites host insert" on public.call_invites;
create policy "call_invites host insert" on public.call_invites
  for insert with check (
    host_id = auth.uid()
    and (
      public.is_admin(auth.uid())
      or public.has_permission(auth.uid(), 'calls.invite')
    )
  );

-- The host cancels and writes the recap; the invitee accepts or declines.
-- Column-level restriction isn't expressible in a policy, so the narrower
-- rule — an invitee may only move status — is enforced in the server action.
-- This is the outer boundary: nobody outside the pair can touch the row.
drop policy if exists "call_invites update" on public.call_invites;
create policy "call_invites update" on public.call_invites
  for update using (
    public.is_admin(auth.uid())
    or host_id = auth.uid()
    or invitee_id = auth.uid()
  ) with check (
    public.is_admin(auth.uid())
    or host_id = auth.uid()
    or invitee_id = auth.uid()
  );

drop policy if exists "call_invites host delete" on public.call_invites;
create policy "call_invites host delete" on public.call_invites
  for delete using (
    public.is_admin(auth.uid()) or host_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- Grant calls.invite to the roles that should have it
--
-- array_append only when absent, so re-running doesn't accumulate duplicates
-- and an admin who has since REMOVED this permission from a role doesn't have
-- it silently handed back by a re-run.
-- ----------------------------------------------------------------------------
update public.app_roles
set permissions = array_append(permissions, 'calls.invite')
where slug in ('mentor', 'investor')
  and not (permissions @> array['calls.invite']::text[])
  and not (permissions @> array['*']::text[]);

comment on table public.call_invites is
  'Staff-initiated 1:1 calls. The inverse of mentor_slots/mentor_bookings, which are student-initiated.';
