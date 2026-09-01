import { createClient } from "@/lib/supabase/server";
import { requireUser, getProfile } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { getStudentAccess } from "@/lib/access";
import { LockedFeature } from "@/components/dashboard/locked-feature";
import { EventCard } from "@/components/live/event-card";
import type { LiveEvent } from "@/lib/live";

export const metadata = { title: "Events · batch0" };

/**
 * DB row -> the shape EventCard renders.
 *
 * Kept explicit rather than passing the row through, so a column rename shows
 * up as a type error here instead of an empty card in front of a student.
 */
function toLiveEvent(e: any): LiveEvent {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    type: e.type,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    location: e.location,
    // Rows written before migration 0057 have no live_mode; they are all
    // external by definition, so default rather than render them broken.
    liveMode: e.live_mode === "hosted" ? "hosted" : "external",
    externalUrl: e.zoom_url,
    recordingUrl: e.recording_url,
    hostName: null,
    roomName: e.daily_room_name ?? null,
    roomUrl: e.daily_room_url ?? null,
  };
}

export default async function StudentEventsPage() {
  await requireUser();
  const profile = await getProfile();
  const access = await getStudentAccess(profile?.role ?? "student");
  if (!access.enrolled) {
    return (
      <LockedFeature
        title="Events"
        applicationStatus={access.applicationStatus}
      />
    );
  }
  const supabase = createClient();

  const now = new Date().toISOString();
  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .gte("starts_at", now)
      .order("starts_at", { ascending: true }),
    supabase
      .from("events")
      .select("*")
      .lt("starts_at", now)
      .order("starts_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight">Events</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Demo Day, office hours, workshops.
      </p>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-phosphor-ink">
          Upcoming
        </h2>
        {(upcoming?.length ?? 0) === 0 ? (
          <Card>
            <p className="text-sm text-ink-faint">Nothing scheduled yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {(upcoming ?? []).map((e: any) => (
              <EventCard key={e.id} event={toLiveEvent(e)} upcoming />
            ))}
          </div>
        )}
      </section>

      {(past?.length ?? 0) > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Past
          </h2>
          <div className="space-y-3">
            {(past ?? []).map((e: any) => (
              <EventCard key={e.id} event={toLiveEvent(e)} upcoming={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
