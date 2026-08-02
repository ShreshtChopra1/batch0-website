import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { BlastForm } from "./blast-form";
import { STATUS_RANK, pickParentEmail } from "./shared";

export const metadata = { title: "Email blast · Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Blast sends go out via Resend's batch API (1 request / 100 emails),
// but give the action segment breathing room for big lists anyway.
export const maxDuration = 60;

export type BlastRecipient = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  /** Best (furthest-along) application status, or null if never applied. */
  appStatus: string | null;
  /** Names of cohorts the user is enrolled in. */
  cohorts: string[];
  /**
   * Parent / guardian address from their application, if they gave one. The
   * question is optional (and only asked of under-18s), so plenty of people
   * won't have one — the form says so rather than silently dropping them.
   *
   * Display only: sendBlast re-resolves this server-side from the profile id,
   * so a tampered request can't redirect a blast to an arbitrary address.
   */
  parentEmail: string | null;
};

export default async function AdminEmailBlastPage() {
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select(
      "id, email, full_name, role, applications!applications_user_id_fkey(status, parent_email, created_at), enrollments!enrollments_user_id_fkey(cohort:cohorts(name))",
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  const recipients: BlastRecipient[] = (profiles ?? [])
    .filter((p: any) => p.email)
    .map((p: any) => {
      const statuses: string[] = (p.applications ?? []).map(
        (a: any) => a.status,
      );
      const appStatus =
        statuses.length > 0
          ? statuses.reduce((best, s) =>
              (STATUS_RANK[s] ?? -1) > (STATUS_RANK[best] ?? -1) ? s : best,
            )
          : null;
      const cohorts: string[] = (p.enrollments ?? [])
        .map((e: any) =>
          Array.isArray(e.cohort) ? e.cohort[0]?.name : e.cohort?.name,
        )
        .filter(Boolean);
      return {
        id: p.id,
        email: p.email,
        name: p.full_name || null,
        role: p.role,
        appStatus,
        cohorts,
        parentEmail: pickParentEmail(p.applications ?? []),
      };
    });

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-ink">Email blast</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Compose a branded email and send it to any set of students — or to
          their parents. Pick the group with the filters, then choose whether
          it reaches the student, the parent / guardian on their application,
          or both.
        </p>
      </div>
      <BlastForm recipients={recipients} siteUrl={env.siteUrl} />
    </div>
  );
}
