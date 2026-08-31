import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { drainEmailQueue } from "@/lib/email/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The drain sends up to `max_sends_per_run` emails over the network. The
// default 10s would cut a large batch off mid-flight, leaving rows claimed as
// `sending` with nothing to finish them.
export const maxDuration = 60;

/**
 * Drains the email outbox and fires any scheduled automation that came due.
 *
 * Runs hourly, via 24 separate once-a-day entries in vercel.json rather than
 * one `0 * * * *`. That looks absurd until you hit the reason: this project is
 * on a Vercel Hobby plan, which rejects any cron expression that fires more
 * than once a day. Twenty-four daily expressions are each legal on their own
 * and add up to the hourly drain the queue actually needs. Collapse them back
 * into a single hourly expression — or a five-minute one — the moment this
 * account moves to Pro.
 *
 * Hourly is coarse, and the design already absorbs it: the schedule matcher
 * asks "were you due at any point since you last ran?" rather than "are you
 * due this minute?" (see `wasDue` in lib/email/cron.ts), so a 14:30 schedule
 * still fires exactly once — on the 15:00 drain. What an admin gives up is
 * punctuality, not delivery.
 *
 * Transactional email does not wait for any of this. A zero-delay step sends
 * inline at the moment the event fires; the queue only holds delayed and
 * scheduled mail. And /admin/email/outbox has a "Run queue now" button for
 * anyone who doesn't want to wait for the hour.
 */
export async function GET(req: Request) {
  // Fail closed when CRON_SECRET isn't configured. An open endpoint here
  // doesn't just burn CPU — it sends real email to real people on demand.
  if (!env.cronSecret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const report = await drainEmailQueue();
  if (report.errors.length > 0) {
    console.error("[cron/email-queue]", report.errors.join("; "));
  }
  return NextResponse.json(report);
}
