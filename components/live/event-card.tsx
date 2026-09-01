"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { LiveDot } from "@/components/live/call-stage";
import {
  canJoin,
  joinState,
  relativeTime,
  type LiveEvent,
} from "@/lib/live";
import { CalendarDays, MapPin, Video, ExternalLink } from "lucide-react";

/**
 * An event on the student events page.
 *
 * Replaces the inline card in app/dashboard/events/page.tsx. The difference
 * that matters is the join affordance: a `hosted` event links inward to
 * /dashboard/events/<id>/live and shows a live state, while an `external` one
 * keeps the old behaviour of opening a pasted Zoom link in a new tab. Both
 * stay supported — switching every event to hosted at once isn't necessary and
 * wouldn't be reversible mid-cohort.
 */
export function EventCard({
  event,
  upcoming,
}: {
  event: LiveEvent;
  upcoming: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const state = now ? joinState(event.startsAt, event.endsAt, now) : null;
  const hosted = event.liveMode === "hosted";
  const joinable = !!state && canJoin(state);
  const live = state === "live";
  const startsAt = new Date(event.startsAt);

  return (
    <div className="rounded-2xl border border-line bg-wash p-6">
      <div className="flex items-start gap-4">
        {/*
          Renders UTC on the server and on the first client paint, then swaps
          to the viewer's zone once `now` is set — the same two-step LocalTime
          uses. Doing this in one place matters: the chip and the timestamp
          below it are the same instant, and formatting one in UTC while the
          other is local produced a card headed "Sep 1" over the words
          "Aug 31, 9:55 PM".
        */}
        <div
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-phosphor/10 text-phosphor-ink"
          suppressHydrationWarning
        >
          <span className="text-[10px] font-bold uppercase">
            {startsAt.toLocaleString("en-US", {
              month: "short",
              ...(now ? {} : { timeZone: "UTC" }),
            })}
          </span>
          <span className="text-base font-bold leading-none">
            {now ? startsAt.getDate() : startsAt.getUTCDate()}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">{event.title}</h3>
            <span className="font-mono text-[10px] uppercase tracking-wider text-phosphor-ink/80">
              {event.type.replace("_", " ")}
            </span>
            {live && <LiveDot />}
          </div>

          {event.description && (
            <p className="mt-1 text-sm text-ink-soft">{event.description}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              <LocalTime value={event.startsAt} />
            </span>
            {event.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {event.location}
              </span>
            )}
            {event.hostName && <span>Hosted by {event.hostName}</span>}
            {upcoming && (
              <Link
                href={`/api/events/${event.id}/ics`}
                className="text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                Add to calendar
              </Link>
            )}
            {event.recordingUrl && !upcoming && (
              <a
                href={event.recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-phosphor-ink hover:underline"
              >
                Watch recording →
              </a>
            )}
          </div>

          {/*
            The join affordance is driven by the join WINDOW, not by which
            section (Upcoming/Past) the event was filed under. An event that
            has already started sorts as "past" by start time — but that is
            exactly when the Join button needs to be here. Gating this on
            `upcoming` used to make the button vanish the moment a webinar went
            live, which is the one moment it matters. So it shows whenever the
            room is joinable, and additionally carries the pre-start countdown
            for events still in the Upcoming section.
          */}
          {(joinable || upcoming) && (
            <div className="mt-4">
              {hosted ? (
                joinable ? (
                  <ButtonLink
                    href={`/dashboard/events/${event.id}/live`}
                    size="sm"
                  >
                    <Video className="h-4 w-4" />
                    {live ? "Join now" : "Join webinar"}
                  </ButtonLink>
                ) : (
                  <p className="text-xs text-ink-faint">
                    Opens 15 minutes before it starts
                    {now && <> · {relativeTime(event.startsAt, now)}</>}
                  </p>
                )
              ) : event.externalUrl ? (
                <a
                  href={event.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-phosphor-ink hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Join on Zoom
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
