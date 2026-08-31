"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/server-guards";
import { logAudit } from "@/lib/audit";
import { drainEmailQueue } from "@/lib/email/queue";

/**
 * Outbox controls.
 *
 * The queue is the one place an admin can still change their mind — once a
 * row leaves it, the email is in somebody's inbox and no amount of admin UI
 * gets it back. So cancelling is the primary action here, and it's available
 * on anything still pending.
 */

export async function cancelQueued(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertPermission("email.send");
  const admin = createAdminClient();
  // `.eq("status","pending")` is the guard, not the UI: between the page
  // render and the click, the drainer may have already picked this row up.
  // Better a no-op than marking a sent email as cancelled.
  const { data, error } = await admin
    .from("email_outbox")
    .update({
      status: "canceled",
      last_error: "Cancelled by an admin",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, to_email");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Too late — that one already left the queue." };
  }

  await logAudit({
    action: "email.outbox_canceled",
    targetType: "email_outbox",
    targetId: id,
    payload: { to: data[0].to_email },
  });
  revalidatePath("/admin/email/outbox");
  return { ok: true };
}

/** Cancel everything still pending. The panic button. */
export async function cancelAllPending(): Promise<{
  ok: boolean;
  message: string;
}> {
  await assertPermission("email.send");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_outbox")
    .update({
      status: "canceled",
      last_error: "Bulk cancelled by an admin",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, message: error.message };

  const count = data?.length ?? 0;
  await logAudit({
    action: "email.outbox_bulk_canceled",
    targetType: "email_outbox",
    payload: { count },
  });
  revalidatePath("/admin/email/outbox");
  return {
    ok: true,
    message:
      count === 0
        ? "Nothing was waiting."
        : `Cancelled ${count} queued email${count === 1 ? "" : "s"}.`,
  };
}

/** Put a failed or cancelled row back in the queue. */
export async function retryQueued(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertPermission("email.send");
  const admin = createAdminClient();
  const { error } = await admin
    .from("email_outbox")
    .update({
      status: "pending",
      // Reset the counter — this is a deliberate human retry, and it
      // shouldn't inherit the automatic retry budget the row already spent.
      attempts: 0,
      last_error: null,
      send_after: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["failed", "canceled", "skipped"]);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/email/outbox");
  return { ok: true };
}

/**
 * Drain the queue now, without waiting for cron.
 *
 * Mostly for the first five minutes after setting something up, when waiting
 * a cron interval to find out whether it works is the difference between
 * confidence and a support ticket.
 */
export async function runQueueNow(): Promise<{ ok: boolean; message: string }> {
  await assertPermission("email.send");
  const report = await drainEmailQueue();
  await logAudit({
    action: "email.queue_run_manual",
    targetType: "email_outbox",
    payload: report as any,
  });
  revalidatePath("/admin/email/outbox");

  if (report.paused) {
    return {
      ok: false,
      message: "Automated sending is paused — nothing was sent.",
    };
  }
  const parts = [
    `${report.sent} sent`,
    report.failed > 0 ? `${report.failed} failed` : null,
    report.skipped > 0 ? `${report.skipped} skipped by a condition` : null,
    report.queued > 0 ? `${report.queued} newly queued` : null,
  ].filter(Boolean);
  return {
    ok: report.errors.length === 0,
    message:
      parts.join(", ") +
      (report.errors.length > 0 ? ` — ${report.errors.join("; ")}` : ""),
  };
}
