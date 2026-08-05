import { test } from "node:test";
import assert from "node:assert/strict";
import {
  META_DESCRIPTION_MAX,
  buildMetaDescription,
  formatApplyBy,
  formatDateSentence,
} from "./seo-meta.ts";

// Run with `npm test`. No test framework, no transpile step — Node strips the
// types natively, which is why lib/seo-meta.ts is kept import-free.

// The real Cohort 1 record as of 2026-08-05. Kept here as a regression anchor:
// this is the exact data that produced the wrong production snippet.
const COHORT_1 = {
  cohortLabel: "Cohort 1",
  startsOn: "2026-09-14",
  endsOn: "2026-11-13",
  applicationsCloseAt: "2026-09-10T23:59:00+00:00",
  basePriceLabel: "$130",
};

// ---------- formatDateSentence ----------

test("formatDateSentence renders an en-dashed range with a single year", () => {
  assert.equal(
    formatDateSentence("2026-09-14", "2026-11-13"),
    "Sep 14 – Nov 13, 2026",
  );
});

test("formatDateSentence carries the year on both ends across a boundary", () => {
  assert.equal(
    formatDateSentence("2026-12-01", "2027-02-05"),
    "Dec 1, 2026 – Feb 5, 2027",
  );
});

test("formatDateSentence never emits the on-page arrow glyph", () => {
  // A "→" in a SERP snippet reads as a mojibake bug to a searcher.
  assert.ok(!formatDateSentence("2026-09-14", "2026-11-13").includes("→"));
});

test("formatDateSentence does not shift dates west of UTC", () => {
  // Regression guard: parsing "2026-09-14" as local time in a US timezone
  // yields Sep 13. The cohort start date must survive the server's TZ.
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    assert.ok(formatDateSentence("2026-09-14", "2026-11-13").startsWith("Sep 14"));
  } finally {
    process.env.TZ = original;
  }
});

test("formatDateSentence and formatApplyBy degrade to empty, never to junk", () => {
  assert.equal(formatDateSentence(null, "2026-11-13"), "");
  assert.equal(formatDateSentence("2026-09-14", null), "");
  assert.equal(formatDateSentence("not-a-date", "2026-11-13"), "");
  assert.equal(formatApplyBy(null), "");
  assert.equal(formatApplyBy("not-a-date"), "");
});

// ---------- buildMetaDescription ----------

test("live cohort snippet names the dates and the deadline", () => {
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.match(out, /Cohort 1: Sep 14 – Nov 13/);
  assert.match(out, /apply by Sep 10/);
  assert.match(out, /no equity taken/);
});

test("when the budget binds, the deadline outranks the year", () => {
  // At real Cohort 1 values the fully-specified string is 158 chars. The
  // ladder must sacrifice "2026" rather than "apply by Sep 10" — the deadline
  // is what makes a student act today; the year is inferable.
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.match(out, /apply by Sep 10/);
  assert.ok(!out.includes("Nov 13, 2026"), `year should have been dropped: ${out}`);
});

test("the year comes back once the deadline clause is gone", () => {
  // Budget freed up — spend it on precision rather than leaving it unused.
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-09-11T12:00:00Z"),
  });
  assert.match(out, /Sep 14 – Nov 13, 2026/);
  assert.ok(out.length <= META_DESCRIPTION_MAX);
});

test("snippet fits Google's truncation budget", () => {
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.ok(
    out.length <= META_DESCRIPTION_MAX,
    `description is ${out.length} chars, budget is ${META_DESCRIPTION_MAX}: ${out}`,
  );
});

test("the closing objection-handler survives truncation", () => {
  // The tail is the whole point: "free to apply, no equity taken" is what
  // converts a skeptical parent. If the budget ever forces a cut, it must
  // take the dates, not this.
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.ok(out.trimEnd().endsWith("free to apply, no equity taken."));
});

test("a passed deadline is dropped, not advertised", () => {
  // THE regression this whole module exists for. On 2026-09-11 the snippet
  // must not still be telling students to "apply by Sep 10".
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-09-11T12:00:00Z"),
  });
  assert.ok(!out.includes("apply by"), `still advertising a dead deadline: ${out}`);
  // Dates stay — the cohort itself is still real and still worth describing.
  assert.match(out, /Sep 14 – Nov 13, 2026/);
});

test("the deadline is live right up to the closing instant", () => {
  const justBefore = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-09-10T23:58:00Z"),
  });
  const exactly = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-09-10T23:59:00Z"),
  });
  assert.match(justBefore, /apply by Sep 10/);
  assert.ok(!exactly.includes("apply by"));
});

test("a missing close date fails closed", () => {
  // No deadline data must never render as "applications open forever".
  const out = buildMetaDescription({
    ...COHORT_1,
    applicationsCloseAt: null,
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.ok(!out.includes("apply by"));
});

test("no cohort data still yields a valid, truthful snippet", () => {
  const out = buildMetaDescription({
    cohortLabel: "",
    startsOn: null,
    endsOn: null,
    applicationsCloseAt: null,
    basePriceLabel: "$130",
  });
  assert.ok(out.length <= META_DESCRIPTION_MAX);
  assert.match(out, /startup accelerator for high schoolers/);
  // Must not invent a cohort clause out of empty strings.
  assert.ok(!out.includes("::"));
  assert.ok(!out.includes(": ."));
  assert.ok(!/:\s*\./.test(out));
});

test("an unnumbered cohort still reads as English", () => {
  const out = buildMetaDescription({
    ...COHORT_1,
    cohortLabel: "",
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.match(out, /Next cohort: Sep 14 – Nov 13/);
});

test("a cross-year cohort always keeps both years", () => {
  // Ambiguity here would be worse than truncation: "Dec 1 – Feb 5" without
  // years could mean a cohort that already happened.
  const out = buildMetaDescription({
    ...COHORT_1,
    startsOn: "2026-12-01",
    endsOn: "2027-02-05",
    applicationsCloseAt: "2026-11-20T23:59:00+00:00",
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.match(out, /Dec 1, 2026 – Feb 5, 2027/);
});

test("formatDateSentence honours year:false only within one year", () => {
  assert.equal(
    formatDateSentence("2026-09-14", "2026-11-13", { year: false }),
    "Sep 14 – Nov 13",
  );
  assert.equal(
    formatDateSentence("2026-12-01", "2027-02-05", { year: false }),
    "Dec 1, 2026 – Feb 5, 2027",
  );
});

test("audience wording stays global", () => {
  // The FAQ tells students they can join from anywhere and lib/pricing.ts
  // ships regional tuition. "U.S. high schoolers" in the snippet contradicts
  // both and disqualifies international applicants at first contact.
  const out = buildMetaDescription({
    ...COHORT_1,
    now: new Date("2026-08-05T12:00:00Z"),
  });
  assert.ok(!/U\.?S\.?\s+high schoolers/i.test(out));
});

test("a long price label degrades gracefully instead of overflowing", () => {
  const out = buildMetaDescription({
    ...COHORT_1,
    basePriceLabel: "$1,300,000 (introductory founding-cohort rate)",
    now: new Date("2026-08-05T12:00:00Z"),
  });
  // Can't always fit, but must never throw and must never keep the longest
  // candidate when a shorter one fits.
  assert.ok(typeof out === "string" && out.length > 0);
  assert.ok(!out.includes("apply by"));
});
