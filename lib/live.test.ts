import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canJoin,
  canSeeRoster,
  joinState,
  inviteEndsAt,
  JOIN_OPENS_MINUTES_BEFORE,
  JOIN_CLOSES_MINUTES_AFTER,
  DEFAULT_EVENT_MINUTES,
  type CallInvite,
  type LiveRole,
} from "./live.ts";

// Run with `npm test`. No framework, no transpile step — Node strips the types
// natively, which is why lib/live.ts is kept import-free.

const MINUTE = 60_000;
const START = new Date("2026-09-01T18:00:00Z");
const END = new Date("2026-09-01T19:00:00Z");

/** `minutes` relative to the event start. */
function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * MINUTE);
}

// ---------------------------------------------------------------------------
// Audience privacy
// ---------------------------------------------------------------------------
//
// This is the requirement most likely to be undone by accident — it is one
// boolean standing between a student and "there are 3 people watching". So it
// gets tested by role exhaustively rather than by example, and the negative
// case is the one that matters.

test("viewers can never see the roster", () => {
  assert.equal(canSeeRoster("viewer"), false);
});

test("hosts can see the roster", () => {
  assert.equal(canSeeRoster("host"), true);
});

test("no role other than host is granted roster visibility", () => {
  const ALL_ROLES: LiveRole[] = ["host", "viewer"];
  const granted = ALL_ROLES.filter(canSeeRoster);
  assert.deepEqual(
    granted,
    ["host"],
    "a new LiveRole must default to hidden — add it to this test deliberately",
  );
});

// ---------------------------------------------------------------------------
// Join window
// ---------------------------------------------------------------------------
//
// The server applies this same rule before minting a room token, so an
// off-by-one here is a door left open, not a cosmetic glitch.

test("too early to join", () => {
  assert.equal(
    joinState(START, END, at(-JOIN_OPENS_MINUTES_BEFORE - 1)),
    "early",
  );
});

test("the early window opens exactly on the boundary", () => {
  assert.equal(joinState(START, END, at(-JOIN_OPENS_MINUTES_BEFORE)), "open");
});

test("open before the start, live after it", () => {
  assert.equal(joinState(START, END, at(-1)), "open");
  assert.equal(joinState(START, END, at(0)), "live");
  assert.equal(joinState(START, END, at(30)), "live");
});

test("stays live through the grace window after the end", () => {
  assert.equal(joinState(START, END, at(60)), "live");
  assert.equal(joinState(START, END, at(60 + JOIN_CLOSES_MINUTES_AFTER)), "live");
});

test("closes once the grace window passes", () => {
  assert.equal(
    joinState(START, END, at(60 + JOIN_CLOSES_MINUTES_AFTER + 1)),
    "ended",
  );
});

test("an event with no end time is assumed to run the default length", () => {
  // Still open at the assumed end plus grace…
  assert.equal(
    joinState(START, null, at(DEFAULT_EVENT_MINUTES + JOIN_CLOSES_MINUTES_AFTER)),
    "live",
  );
  // …and closed one minute later.
  assert.equal(
    joinState(
      START,
      null,
      at(DEFAULT_EVENT_MINUTES + JOIN_CLOSES_MINUTES_AFTER + 1),
    ),
    "ended",
  );
});

test("only open and live are joinable", () => {
  assert.equal(canJoin("open"), true);
  assert.equal(canJoin("live"), true);
  assert.equal(canJoin("early"), false);
  assert.equal(canJoin("ended"), false);
});

test("joinState accepts ISO strings as well as Dates", () => {
  assert.equal(
    joinState(START.toISOString(), END.toISOString(), at(10)),
    "live",
  );
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

test("an invite ends its duration after it starts", () => {
  const invite = {
    id: "i1",
    hostName: "Priya",
    hostRole: "investor",
    inviteeName: "Ana",
    startsAt: START.toISOString(),
    durationMinutes: 45,
    topic: null,
    status: "accepted",
    roomName: null,
    roomUrl: null,
  } satisfies CallInvite;

  assert.equal(inviteEndsAt(invite), at(45).toISOString());
});
