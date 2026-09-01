/**
 * Shared vocabulary for live video — webinars and 1:1 calls.
 *
 * Deliberately provider-agnostic. Nothing here knows about Daily (or LiveKit,
 * or whatever we land on): a room is a name and a URL, and a participant is
 * either allowed to broadcast or not. When the provider gets wired up, it
 * fills `roomName`/`roomUrl` in and mints a token off `LiveRole` — none of
 * these types change.
 *
 * Pure module, no imports, no `next/headers`. Safe from server components,
 * client components, and tests alike.
 */

/**
 * What a person may do inside a room.
 *
 * `host` gets camera, mic, and screen share. `viewer` watches and uses chat.
 * For a webinar that split is the whole feature (it maps to Daily's
 * `owner_only_broadcast`); for a 1:1 both people are hosts.
 */
export type LiveRole = "host" | "viewer";

/** Where a live session lives — an external link, or a room batch0 owns. */
export type LiveMode = "external" | "hosted";

export type CallInviteStatus =
  | "invited"
  | "accepted"
  | "declined"
  | "cancelled"
  | "completed";

export type LiveRoom = {
  /** Provider-side room identifier. Null until a room has been created. */
  roomName: string | null;
  roomUrl: string | null;
};

export type LiveEvent = {
  id: string;
  title: string;
  description: string | null;
  type: "demo_day" | "office_hours" | "workshop" | "other";
  startsAt: string;
  endsAt: string | null;
  /** Free text — "Virtual", or a physical address for in-person events. */
  location: string | null;
  liveMode: LiveMode;
  /** The pasted external link, used when `liveMode === "external"`. */
  externalUrl: string | null;
  recordingUrl: string | null;
  hostName: string | null;
} & LiveRoom;

export type CallInvite = {
  id: string;
  hostName: string;
  hostRole: string;
  inviteeName: string;
  startsAt: string;
  durationMinutes: number;
  topic: string | null;
  status: CallInviteStatus;
} & LiveRoom;

// ---------------------------------------------------------------------------
// Join window
// ---------------------------------------------------------------------------

/**
 * How early someone may enter the room, and how long it stays open past the
 * end. The early window exists so a host can set up before an audience
 * arrives; the late window covers calls that run over.
 */
export const JOIN_OPENS_MINUTES_BEFORE = 15;
export const JOIN_CLOSES_MINUTES_AFTER = 30;

/** Assumed length of an event with no explicit end time. */
export const DEFAULT_EVENT_MINUTES = 60;

export type JoinState =
  /** Too early — show a countdown, not a button. */
  | "early"
  /** Open, but not started yet. */
  | "open"
  /** Scheduled time has passed and it's still within the window. */
  | "live"
  /** Window has closed. */
  | "ended";

const MINUTE = 60_000;

/**
 * Whether a session can be joined right now, and why not when it can't.
 *
 * The `now` parameter is injectable rather than read from the clock so this
 * stays a pure function — the tests pin it, and a server render can pass the
 * request time so every card on a page agrees with itself.
 *
 * This is the same gate the server must apply before minting a token. Doing it
 * here too is not duplication: this one decides what the UI shows, that one
 * decides what is actually allowed, and a token minted for an event three
 * weeks out is a live door standing open in the meantime.
 */
export function joinState(
  startsAt: string | Date,
  endsAt: string | Date | null,
  now: Date = new Date(),
): JoinState {
  const start = new Date(startsAt).getTime();
  const end = endsAt
    ? new Date(endsAt).getTime()
    : start + DEFAULT_EVENT_MINUTES * MINUTE;
  const t = now.getTime();

  if (t < start - JOIN_OPENS_MINUTES_BEFORE * MINUTE) return "early";
  if (t > end + JOIN_CLOSES_MINUTES_AFTER * MINUTE) return "ended";
  return t < start ? "open" : "live";
}

export function canJoin(state: JoinState): boolean {
  return state === "open" || state === "live";
}

/** End time for an invite, derived from its duration. */
export function inviteEndsAt(invite: CallInvite): string {
  return new Date(
    new Date(invite.startsAt).getTime() + invite.durationMinutes * MINUTE,
  ).toISOString();
}

/**
 * "in 3 minutes" / "2 hours ago" — a coarse relative label for join buttons
 * and countdowns.
 *
 * Uses Intl.RelativeTimeFormat so it localises for free. Callers should render
 * this on the client only (like `LocalTime` does): a server render would bake
 * in the build machine's idea of "now" and the label would be wrong by the
 * time anyone read it.
 */
export function relativeTime(
  target: string | Date,
  now: Date = new Date(),
): string {
  const diffMs = new Date(target).getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 24 * 60 * MINUTE],
    ["hour", 60 * MINUTE],
    ["minute", MINUTE],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return rtf.format(Math.round(diffMs / 1000), "second");
}
