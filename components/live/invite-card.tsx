"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/card";
import { LocalTime } from "@/components/ui/local-time";
import { LiveDot } from "@/components/live/call-stage";
import {
  canJoin,
  joinState,
  inviteEndsAt,
  relativeTime,
  type CallInvite,
} from "@/lib/live";
import { CalendarPlus, Clock, User } from "lucide-react";

/**
 * One 1:1 invite.
 *
 * The same card serves both sides of the invite — a host reviewing what they
 * sent, and a student deciding whether to accept — because the information is
 * identical and only the actions differ. `perspective` picks the verbs.
 */
export function InviteCard({
  invite,
  perspective,
  onAccept,
  onDecline,
  onCancel,
  pending = false,
}: {
  invite: CallInvite;
  perspective: "host" | "invitee";
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  onCancel?: (id: string) => void;
  pending?: boolean;
}) {
  // The join window depends on the current time, which the server doesn't
  // share with the client. Rendering it only after mount keeps SSR and the
  // first client paint identical — the same trick `LocalTime` uses.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const state = now
    ? joinState(invite.startsAt, inviteEndsAt(invite), now)
    : null;
  const joinable =
    !!state && canJoin(state) && invite.status === "accepted";
  const live = state === "live" && invite.status === "accepted";
  const other = perspective === "host" ? invite.inviteeName : invite.hostName;

  return (
    <div className="rounded-2xl border border-line bg-wash p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {invite.topic || "1:1 call"}
            </h3>
            {live ? <LiveDot /> : <StatusBadge status={invite.status} />}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              {perspective === "host" ? "With" : "From"} {other}
              {perspective === "invitee" && (
                <span className="font-mono uppercase tracking-wider text-ink-faint/80">
                  {invite.hostRole}
                </span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <LocalTime value={invite.startsAt} mode="datetime-short" />
              <span aria-hidden>·</span>
              {invite.durationMinutes} min
            </span>
            {now && state === "early" && (
              <span suppressHydrationWarning>
                {relativeTime(invite.startsAt, now)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {invite.status === "invited" && perspective === "invitee" && (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => onAccept?.(invite.id)}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => onDecline?.(invite.id)}
              >
                Decline
              </Button>
            </>
          )}

          {joinable && (
            <ButtonLink size="sm" href={`/dashboard/calls/${invite.id}/live`}>
              {live ? "Join now" : "Join"}
            </ButtonLink>
          )}

          {invite.status === "accepted" && !joinable && (
            <Link
              href={`/api/calls/${invite.id}/ics`}
              className="inline-flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Add to calendar
            </Link>
          )}

          {perspective === "host" &&
            (invite.status === "invited" || invite.status === "accepted") && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => onCancel?.(invite.id)}
              >
                Cancel
              </Button>
            )}
        </div>
      </div>
    </div>
  );
}

/** A list of invites with an empty state, used on every calls page. */
export function InviteList({
  invites,
  perspective,
  emptyMessage,
  onAccept,
  onDecline,
  onCancel,
  pending,
}: {
  invites: CallInvite[];
  perspective: "host" | "invitee";
  emptyMessage: string;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  onCancel?: (id: string) => void;
  pending?: boolean;
}) {
  if (invites.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center">
        <p className="text-sm text-ink-faint">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {invites.map((i) => (
        <InviteCard
          key={i.id}
          invite={i}
          perspective={perspective}
          onAccept={onAccept}
          onDecline={onDecline}
          onCancel={onCancel}
          pending={pending}
        />
      ))}
    </div>
  );
}
