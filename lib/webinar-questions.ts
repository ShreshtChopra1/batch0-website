import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WebinarQuestion } from "@/lib/live";

/**
 * Reads for webinar Q&A (`webinar_questions`, migration 0059).
 *
 * Service-role reads with explicit filters, so one query can join the asker's
 * name — but the caller decides the scope and passes it in. RLS is still the
 * backstop on the table; these filters are what keep the backstop from ever
 * being the thing that saves us.
 *
 * The scope split is the audience-privacy rule made concrete: a host reads
 * every question for the event, a viewer reads only their own. There is
 * deliberately no function that returns "everyone's questions" to a viewer.
 */

const SELECT = `
  id, event_id, asker_id, body, status, created_at,
  asker:profiles!webinar_questions_asker_id_fkey(full_name)
`;

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function toQuestion(row: any): WebinarQuestion {
  const asker = one<any>(row.asker);
  return {
    id: row.id,
    eventId: row.event_id,
    askerId: row.asker_id,
    askerName: asker?.full_name || "A student",
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Every question for one event — the host's live view. Oldest first, so the
 *  queue reads top-to-bottom in the order people asked. */
export async function listQuestionsForEvent(
  eventId: string,
): Promise<WebinarQuestion[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("webinar_questions")
    .select(SELECT)
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .limit(500);
  return (data ?? []).map(toQuestion);
}

/** One viewer's own questions for one event — all they are ever shown. */
export async function listQuestionsForAsker(
  eventId: string,
  askerId: string,
): Promise<WebinarQuestion[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("webinar_questions")
    .select(SELECT)
    .eq("event_id", eventId)
    .eq("asker_id", askerId)
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []).map(toQuestion);
}
