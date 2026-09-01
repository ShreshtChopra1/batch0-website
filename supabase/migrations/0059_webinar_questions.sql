-- ============================================================================
-- 0059 — Webinar Q&A.
--
-- A hosted webinar (0057) hides its audience: viewers join with Daily's
-- `hasPresence: false`, so they are absent from every other client's
-- participant list and can neither see who else is watching nor how many.
-- That privacy is the whole point of the webinar mode — but it collides with
-- Daily Prebuilt's built-in chat, which lets a hidden participant *read* chat
-- and not *send* it. So "students can ask questions" cannot ride on Daily's
-- chat without un-hiding the audience.
--
-- This table is the answer: questions go to batch0, not to the room. A viewer
-- submits a question here; the host reads them all in the live view and
-- answers on camera. The audience stays hidden, and a question is a row we own
-- (persisted, moderatable, and — for a program with minors — a record of who
-- said what) rather than an ephemeral chat line in a third party.
--
-- A viewer only ever sees their OWN questions. Showing them the full stream
-- would leak exactly what the webinar mode hides: that other people are here,
-- and roughly how many.
--
-- Run in Supabase SQL Editor. Idempotent / safe to re-run.
-- Assumes 0001..0058 are applied.
-- ============================================================================

create table if not exists public.webinar_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  asker_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 500),
  status text not null default 'open'
    check (status in ('open', 'answered', 'dismissed')),
  -- Who moved it out of 'open'. Null while unanswered.
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The host's live view reads every question for one event, newest first.
create index if not exists webinar_questions_event_idx
  on public.webinar_questions (event_id, created_at desc);
-- A viewer's view reads their own questions for one event.
create index if not exists webinar_questions_asker_idx
  on public.webinar_questions (event_id, asker_id, created_at desc);

drop trigger if exists touch_webinar_questions on public.webinar_questions;
create trigger touch_webinar_questions before update on public.webinar_questions
  for each row execute procedure public.touch_updated_at();

alter table public.webinar_questions enable row level security;

-- ----------------------------------------------------------------------------
-- RLS
--
-- The server actions in app/dashboard/events/[id]/live/actions.ts are the gate
-- (they re-check the event's visibility and the join window before writing);
-- these policies are the backstop that makes the gate never the only thing
-- standing between a student and someone else's question.
-- ----------------------------------------------------------------------------

-- Read: the host sees the room (events.manage), an admin sees everything, and
-- an asker sees only their own questions. Deliberately no path for a viewer to
-- read another viewer's question — that is the audience privacy this whole
-- table exists to preserve.
drop policy if exists "webinar_questions read" on public.webinar_questions;
create policy "webinar_questions read" on public.webinar_questions
  for select using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'events.manage')
    or asker_id = auth.uid()
  );

-- Insert: only as yourself, only for a hosted event you may see, only while
-- the webinar is live, and only up to a per-asker cap.
--
-- The nested select against public.events runs under the asker's own RLS, so
-- the `events read` policy (0005) decides visibility — a student who can't see
-- the event can't attach a question to it, with no second rule to keep in sync.
--
-- The join-window and the spam cap are enforced HERE, not only in the
-- askQuestion server action, because the anon-key browser client
-- (lib/supabase/client.ts) carries the student's JWT and can write to this
-- table directly, skipping the action entirely. If those two guards lived only
-- in the action, a student in devtools could seed questions weeks out or flood
-- the host's panel. This policy is the guard that actually binds; the action's
-- copy is what gives a good error message.
--
-- The window mirrors joinState() in lib/live.ts: open from 15 minutes before
-- the start until 30 minutes past the end (or a 60-minute default when the
-- event has no end). The cap mirrors MAX_QUESTIONS_PER_ASKER in the action —
-- keep the two numbers in step.
drop policy if exists "webinar_questions insert" on public.webinar_questions;
create policy "webinar_questions insert" on public.webinar_questions
  for insert with check (
    asker_id = auth.uid()
    and exists (
      select 1 from public.events e
      where e.id = event_id
        and e.live_mode = 'hosted'
        and now() >= e.starts_at - interval '15 minutes'
        and now() <=
          coalesce(e.ends_at, e.starts_at + interval '60 minutes')
            + interval '30 minutes'
    )
    -- Counts existing rows only (the new one isn't visible to its own CHECK),
    -- so this admits up to the 40th question and refuses the 41st.
    and (
      select count(*) from public.webinar_questions w
      where w.event_id = event_id
        and w.asker_id = auth.uid()
    ) < 40
  );

-- Update: the host (or an admin) moves a question to answered/dismissed. A
-- viewer has no reason to edit a question after asking it, so they can't.
drop policy if exists "webinar_questions moderate" on public.webinar_questions;
create policy "webinar_questions moderate" on public.webinar_questions
  for update using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'events.manage')
  ) with check (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'events.manage')
  );

comment on table public.webinar_questions is
  'Audience questions for hosted webinars. Kept off Daily''s chat so the audience stays hidden: a viewer sees only their own questions, the host sees all.';
