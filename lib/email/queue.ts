import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailSettings } from "@/lib/email/settings";
import { sendQueuedRow, enqueueEmail, baseVariables, type QueuedRow } from "@/lib/email/dispatch";
import { evaluateCondition } from "@/lib/email/conditions";
import { isMissingTable } from "@/lib/email/store";
import { parseCron, wasDue, CronParseError } from "@/lib/email/cron";
import { resolveAudience, audienceAddresses } from "@/lib/email/audience";
import { isAudienceSegment } from "@/lib/email/catalog";

/**
 * The drainer, run by /api/cron/email-queue.
 *
 * Two passes per tick:
 *
 *   1. Scheduled automations — anything whose cron came due since it last ran
 *      fans out to its audience and lands in the outbox.
 *   2. The outbox itself — everything due is gated, rendered, and sent.
 *
 * Doing the fan-out into the queue rather than sending it inline is what
 * bounds a tick: a Monday-morning automation to 800 people writes 800 rows
 * fast and then drains at `max_sends_per_run` per tick, instead of trying to
 * make 800 SMTP round trips inside one serverless invocation and timing out
 * somewhere in the middle with no record of where.
 */

const MAX_ATTEMPTS = 3;
// Exponential-ish backoff between retries, in minutes.
const RETRY_DELAY_MINUTES = [5, 30];

export type DrainReport = {
  scheduledFired: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
  paused: boolean;
  errors: string[];
};

export async function drainEmailQueue(): Promise<DrainReport> {
  const report: DrainReport = {
    scheduledFired: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    paused: false,
    errors: [],
  };

  const settings = await getEmailSettings();
  if (!settings.configured) {
    report.errors.push("Email tables not found — run migration 0052.");
    return report;
  }

  // Scheduled fan-out runs even when paused would be wrong: paused means "no
  // mail leaves", and queueing a week of Monday digests to release in a burst
  // when someone unpauses is not what the switch is for.
  if (settings.automationsPaused) {
    report.paused = true;
    return report;
  }

  const admin = createAdminClient();

  // ---- Pass 1: scheduled automations -------------------------------------
  try {
    const { data: automations, error } = await admin
      .from("email_automations")
      .select("*, steps:email_automation_steps(*)")
      .eq("trigger_type", "schedule")
      .eq("enabled", true);
    if (error && !isMissingTable(error)) report.errors.push(error.message);

    const now = new Date();
    for (const automation of (automations ?? []) as any[]) {
      try {
        const parsed = parseCron(automation.schedule_cron ?? "");
        const last = automation.last_run_at ? new Date(automation.last_run_at) : null;
        if (!wasDue(parsed, last, now)) continue;

        const queued = await fanOutScheduled(automation, now);
        report.queued += queued;
        report.scheduledFired++;

        await admin
          .from("email_automations")
          .update({ last_run_at: now.toISOString(), last_error: null })
          .eq("id", automation.id);
      } catch (err: any) {
        const message =
          err instanceof CronParseError
            ? `Bad schedule: ${err.message}`
            : (err?.message ?? "Scheduled run failed");
        report.errors.push(`${automation.name}: ${message}`);
        // Stamp last_run_at anyway. A broken automation that never advances
        // its clock re-fails on every tick and fills the error list; the
        // failure is already recorded on the row for the admin to see.
        await admin
          .from("email_automations")
          .update({ last_run_at: now.toISOString(), last_error: message })
          .eq("id", automation.id);
      }
    }
  } catch (err: any) {
    report.errors.push(`Scheduled pass failed: ${err?.message ?? err}`);
  }

  // ---- Pass 2: retries ---------------------------------------------------
  try {
    const { data: retryable } = await admin
      .from("email_outbox")
      .select("id, attempts, updated_at")
      .eq("status", "failed")
      .lt("attempts", MAX_ATTEMPTS)
      .order("updated_at", { ascending: true })
      .limit(100);
    const now = Date.now();
    for (const row of (retryable ?? []) as any[]) {
      const wait = RETRY_DELAY_MINUTES[Math.min(row.attempts - 1, RETRY_DELAY_MINUTES.length - 1)] ?? 30;
      if (now - new Date(row.updated_at).getTime() < wait * 60_000) continue;
      await admin
        .from("email_outbox")
        .update({ status: "pending", send_after: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "failed");
      report.retried++;
    }
  } catch {
    /* retries are best-effort */
  }

  // ---- Pass 3: send what's due -------------------------------------------
  try {
    const limit = settings.maxSendsPerRun;
    const { data: due, error } = await admin
      .from("email_outbox")
      .select("id")
      .eq("status", "pending")
      .lte("send_after", new Date().toISOString())
      .order("send_after", { ascending: true })
      .limit(limit);
    if (error) {
      if (!isMissingTable(error)) report.errors.push(error.message);
      return report;
    }

    const ids = (due ?? []).map((r: any) => r.id);
    if (ids.length === 0) return report;

    // Claim before sending. The `.eq("status","pending")` in the update is
    // the lock: two overlapping cron invocations both select the same ids,
    // but only one update matches, so only one of them gets rows back.
    const { data: claimed } = await admin
      .from("email_outbox")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "pending")
      .select(
        "id, template_id, to_email, to_name, user_id, variables, subject_override, html_override, automation_id, step_id, attempts, created_at",
      );

    for (const row of (claimed ?? []) as any[]) {
      const verdict = await gate(row);
      if (!verdict.send) {
        await admin
          .from("email_outbox")
          .update({
            status: "skipped",
            last_error: verdict.reason,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        report.skipped++;
        continue;
      }
      await admin
        .from("email_outbox")
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id);
      const ok = await sendQueuedRow(row as QueuedRow);
      if (ok) report.sent++;
      else report.failed++;
    }
  } catch (err: any) {
    report.errors.push(`Send pass failed: ${err?.message ?? err}`);
  }

  return report;
}

/** The step's condition, if this row came from an automation step. */
async function gate(row: any) {
  if (!row.step_id) return { send: true as const };
  try {
    const admin = createAdminClient();
    const { data: step } = await admin
      .from("email_automation_steps")
      .select("condition, enabled")
      .eq("id", row.step_id)
      .maybeSingle();
    if (!step) return { send: true as const };
    // A step disabled while its mail was in flight should not go out — that's
    // what an admin means when they untick it mid-drip.
    if (!(step as any).enabled) {
      return { send: false as const, reason: "Step was disabled before it sent" };
    }
    return evaluateCondition((step as any).condition, {
      userId: row.user_id ?? null,
      queuedAt: row.created_at ?? null,
    });
  } catch {
    return { send: true as const };
  }
}

/**
 * Queue one scheduled automation's steps for its whole audience.
 *
 * The dedupe key pins each send to the run's UTC minute, so two ticks racing
 * on the same due minute (a retried cron invocation, an overlapping manual
 * run) produce one email per person, not two.
 */
export async function fanOutScheduled(
  automation: any,
  now: Date,
): Promise<number> {
  const audience = automation.audience ?? {};
  const segment = isAudienceSegment(audience.segment) ? audience.segment : "students";
  const members = await resolveAudience({
    segment,
    cohortId: audience.cohortId ?? null,
    includeParents: Boolean(audience.includeParents),
  });
  const addresses = audienceAddresses(members, Boolean(audience.includeParents));
  const runStamp = Math.floor(now.getTime() / 60_000);

  const steps = [...(automation.steps ?? [])]
    .filter((s: any) => s.enabled)
    .sort((a: any, b: any) => a.step_index - b.step_index);

  let queued = 0;
  for (const person of addresses) {
    for (const step of steps) {
      const id = await enqueueEmail({
        automationId: automation.id,
        stepId: step.id,
        templateId: step.template_id,
        to: person.email,
        toName: person.name,
        userId: person.userId,
        vars: baseVariables({ email: person.email, name: person.name }),
        sendAfter: new Date(now.getTime() + step.delay_minutes * 60_000),
        dedupeKey: `sched:${automation.id}:${step.id}:${person.email.toLowerCase()}:${runStamp}`,
      });
      if (id) queued++;
    }
  }
  return queued;
}
