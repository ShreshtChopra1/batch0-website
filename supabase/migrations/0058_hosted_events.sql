-- ============================================================================
-- 0058 — Events that batch0 hosts itself, instead of linking out to Zoom.
--
-- Until now an event's video was a `zoom_url` an admin pasted in: students
-- clicked it, left the site, and whether they could get in had nothing to do
-- with whether they were enrolled. This adds the alternative — a room this
-- site creates, owns, and lets people into by the same rules that already
-- decide who can see the event at all.
--
-- Deliberately additive. `live_mode` defaults to 'external', so every event
-- that exists today keeps behaving exactly as it does now, and the two modes
-- coexist indefinitely: a guest AMA on someone else's Zoom is still a
-- perfectly good event, and mid-cohort is not the time to force a switch.
--
--   external — use `zoom_url`. The old behaviour, unchanged.
--   hosted   — use `daily_room_url`, joined at /dashboard/events/<id>/live.
--
-- No RLS changes. Who may read an event is already correct (the `events read`
-- policy from 0005), and that policy is precisely the gate on who gets handed
-- a meeting token — so hosting rides on access control that is already
-- written, reviewed, and in use rather than introducing a second system.
--
-- Run in Supabase SQL Editor. Idempotent / safe to re-run.
-- Assumes 0001..0057 are applied.
-- ============================================================================

alter table public.events
  add column if not exists live_mode text not null default 'external',
  -- Provider-side room identifier, used to delete the room when the event is
  -- deleted and to mint tokens against. Null for external events.
  add column if not exists daily_room_name text,
  add column if not exists daily_room_url text;

-- Added separately from the column so re-running the migration doesn't fail
-- on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_live_mode_check'
  ) then
    alter table public.events
      add constraint events_live_mode_check
      check (live_mode in ('external', 'hosted'));
  end if;
end $$;

-- The join page looks an event up by id and then asks "is there a room?", so
-- no new index is needed — but the admin list filters hosted events when
-- deciding what to clean up, and this keeps that cheap as the table grows.
create index if not exists events_hosted_idx
  on public.events (live_mode, starts_at desc)
  where live_mode = 'hosted';

comment on column public.events.live_mode is
  'external = pasted zoom_url (legacy, still supported); hosted = a Daily room batch0 owns.';
comment on column public.events.daily_room_name is
  'Daily room name. Used to mint meeting tokens and to delete the room with the event.';
