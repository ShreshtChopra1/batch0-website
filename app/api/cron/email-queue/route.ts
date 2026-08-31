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
 * Every five minutes, which is the trade: a delayed drip step lands within
 * five minutes of its scheduled moment (nobody notices), and a scheduled
 * automation fires within five minutes of its cron (which is why the matcher
 * asks "were you due since you last ran?" rather than "are you due right
 * now?" — see lib/email/cron.ts).
 *
 * Transactional email does not wait for this. A zero-delay step sends inline
 * at the moment the event fires; the queue is only for delayed and scheduled
 * mail.
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
