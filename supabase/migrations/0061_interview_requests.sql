-- ============================================================================
-- 0061 — "Getting to know you" interview requests.
--
-- The inverse direction again, but student-first this time. Migration 0059
-- (call_invites) is staff→student: a mentor or investor picks a person and
-- proposes a time. This is student→team: a newly enrolled student, in the
-- weeks BEFORE their cohort kicks off, asks the batch0 team for a short
-- getting-to-know-you interview and proposes when they're free.
--
-- Named `interview_requests`, NOT `intro_requests` — that name is already
-- taken (migration 0011) by the unrelated investor↔team intro feature. These
-- are pre-cohort onboarding interviews, a different thing entirely.
--
-- A request is deliberately NOT a call. It carries the student's preferred
-- time(s) and a note; a member of the team then SCHEDULES it, which writes a
-- normal `call_invites` row (0059) at the confirmed time and links it back
-- here. That way the actual meeting reuses everything calls already have —
-- the room, the join page, the accept flow, the audit trail — and this table
-- only adds the lightweight "someone asked" layer on top.
--
-- Handled by the same people who run 1:1s: the `calls.invite` permission (and
-- admins, who hold '*'). No new permission is minted — a getting-to-know-you
-- interview is a 1:1, and the team that books 1:1s books these.
--
-- Run in Supabase SQL Editor. Idempotent / safe to re-run.
-- Assumes 0001..0060 are applied.
-- ============================================================================

create table if not exists public.interview_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  -- The cohort the student is heading into, for the team's context when they
  -- pick these up. Nullable: a student whose cohort assignment is still being
  -- sorted out can still ask, and we don't want a missing FK to block that.
  cohort_id uuid references public.cohorts(id) on delete set null,
  -- The student's proposed times. `preferred_at` is their first choice; the
  -- alternate is optional. Both are suggestions — the team confirms the real
  -- time when they schedule, so neither is a hard commitment.
  preferred_at timestamptz,
  alt_at timestamptz,
  note text,
  status text not null default 'requested'
    check (status in ('requested','scheduled','declined','cancelled')),
  -- Set when the team schedules the interview: the call_invites row that
  -- carries the actual meeting. on delete set null so cancelling the call
  -- doesn't erase the record that the student once asked.
  call_invite_id uuid references public.call_invites(id) on delete set null,
  -- Who on the team acted on it (scheduled or declined).
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interview_requests_student_idx
  on public.interview_requests (student_id, created_at desc);
-- The team's queue: everything still waiting to be scheduled, newest first.
create index if not exists interview_requests_open_idx
  on public.interview_requests (created_at desc)
  where status = 'requested';

-- One open ask at a time. A student who's already waiting on the team
-- shouldn't be able to stack a second identical request; once it's scheduled,
-- declined, or cancelled they can ask again.
create unique index if not exists interview_requests_one_open_per_student
  on public.interview_requests (student_id)
  where status = 'requested';

drop trigger if exists touch_interview_requests on public.interview_requests;
create trigger touch_interview_requests before update on public.interview_requests
  for each row execute procedure public.touch_updated_at();

alter table public.interview_requests enable row level security;

-- ----------------------------------------------------------------------------
-- RLS
--
-- A request is the student's, and the team's to act on. Admins see everything
-- (the same safeguarding reasoning as call_invites); staff who can run 1:1s
-- see the queue.
-- ----------------------------------------------------------------------------

drop policy if exists "interview_requests read" on public.interview_requests;
create policy "interview_requests read" on public.interview_requests
  for select using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'calls.invite')
    or student_id = auth.uid()
  );

-- A student files their own request, as themselves. The `student_id =
-- auth.uid()` check is what stops one student filing on another's behalf.
drop policy if exists "interview_requests student insert" on public.interview_requests;
create policy "interview_requests student insert" on public.interview_requests
  for insert with check (student_id = auth.uid());

-- The outer boundary: the student (to cancel) and the team (to schedule or
-- decline) may update. Column- and status-level rules — a student may only
-- move their own request to 'cancelled', the team writes the schedule link —
-- live in the server actions, which RLS can't express.
drop policy if exists "interview_requests update" on public.interview_requests;
create policy "interview_requests update" on public.interview_requests
  for update using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'calls.invite')
    or student_id = auth.uid()
  ) with check (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'calls.invite')
    or student_id = auth.uid()
  );

comment on table public.interview_requests is
  'Student-initiated "getting to know you" interview requests, filed before kickoff. The team schedules each into a call_invites row. Unrelated to intro_requests (investor↔team intros, 0011).';
