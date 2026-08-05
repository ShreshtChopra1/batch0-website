/**
 * Search-snippet copy, as pure functions.
 *
 * This module has ZERO imports on purpose. The strings it produces are the
 * highest-stakes copy on the site — a wrong meta description told Google for
 * weeks that Cohort 1 ran "Jul 30–Sep 13" while the page body said Sep 14,
 * i.e. it advertised a cohort that had already ended to every student who
 * searched for us. Keeping this logic free of Next.js, Supabase and module
 * aliases means it can be unit-tested directly with `node --test`, with no
 * build step and no mocking. See lib/seo-meta.test.ts.
 *
 * lib/site-config.ts is the only consumer; it adapts the live cohort record
 * onto these primitives.
 */

/**
 * Google truncates the description around 155–160 characters on desktop and
 * shorter on mobile. We budget to 155 so the closing clause — the part that
 * says "free to apply, no equity taken", which is the actual objection
 * handler — survives the cut.
 */
export const META_DESCRIPTION_MAX = 155;

/**
 * "Sep 14 – Nov 13, 2026".
 *
 * Distinct from the "→" range used in the on-page stat block: an arrow glyph
 * in a search result reads as an encoding error, and a snippet has no visual
 * context to make it obvious it's a date range. Ranges that cross a year
 * boundary carry the year on both ends.
 *
 * Dates are parsed as UTC midnight so a "2026-09-14" string can't slide a day
 * backwards when the server happens to run west of Greenwich.
 */
export function formatDateSentence(
  startsOn: string | null,
  endsOn: string | null,
  opts: { year?: boolean } = {},
): string {
  if (!startsOn || !endsOn) return "";
  const start = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    });

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  // A range that straddles New Year is ambiguous without both years, so the
  // `year: false` request is only honoured when the span sits inside one year.
  if (!sameYear) return `${fmt(start, true)} – ${fmt(end, true)}`;
  const withYear = opts.year ?? true;
  return `${fmt(start, false)} – ${fmt(end, withYear)}`;
}

/** "Sep 10" — the application deadline, short form. "" when unset/invalid. */
export function formatApplyBy(applicationsCloseAt: string | null): string {
  if (!applicationsCloseAt) return "";
  const d = new Date(applicationsCloseAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type MetaDescriptionInput = {
  /** "Cohort 1", or "" when the cohort has no number. */
  cohortLabel: string;
  /** ISO date the cohort starts, e.g. "2026-09-14". */
  startsOn: string | null;
  /** ISO date the cohort ends, e.g. "2026-11-13". */
  endsOn: string | null;
  /** ISO timestamp the application window closes, or null. */
  applicationsCloseAt: string | null;
  /** "$130" — the base, non-regional price. */
  basePriceLabel: string;
  /** Injectable for tests. */
  now?: Date;
};

/**
 * Build the marketing meta description from live cohort facts.
 *
 * Three rules, each of which exists because of a real failure mode:
 *
 *  1. Never advertise a deadline that has passed. Once `applicationsCloseAt`
 *     is behind us the "apply by" clause is dropped rather than shown — a
 *     snippet reading "apply by Sep 10" on Sep 11 costs us the click AND the
 *     credibility.
 *  2. Stay under META_DESCRIPTION_MAX, degrading in a deliberate order (see
 *     the candidate ladder below) rather than letting Google cut mid-word.
 *  3. Say "high schoolers", not "U.S. high schoolers". The FAQ tells students
 *     they can join from anywhere and lib/pricing.ts ships regional tuition,
 *     so the old wording disqualified international applicants in the exact
 *     sentence where they decide whether the program is for them.
 */
export function buildMetaDescription(input: MetaDescriptionInput): string {
  const {
    cohortLabel,
    startsOn,
    endsOn,
    applicationsCloseAt,
    basePriceLabel,
    now = new Date(),
  } = input;

  const base =
    "batch0 is a live, online startup accelerator for high schoolers.";
  const tail = `${basePriceLabel} tuition, free to apply, no equity taken.`;
  const label = cohortLabel || "Next cohort";

  const withYear = formatDateSentence(startsOn, endsOn);
  const noYear = formatDateSentence(startsOn, endsOn, { year: false });

  // Rule 1: a missing close date is treated as closed, not as open-forever.
  // Fail in the direction that understates rather than overpromises.
  const deadlinePassed = applicationsCloseAt
    ? new Date(applicationsCloseAt).getTime() <= now.getTime()
    : true;
  const applyBy = formatApplyBy(applicationsCloseAt);
  const applyClause = !deadlinePassed && applyBy ? `, apply by ${applyBy}` : "";

  // Rule 2: the degradation ladder, richest first.
  //
  // The ordering encodes a judgement call. At the real Cohort 1 values the
  // fully-specified string is 158 characters — three over budget — so
  // something has to go, and the two candidates are the year and the
  // deadline. The deadline wins: "apply by Sep 10" is the clause that makes
  // a student act today, while "2026" is inferable from a result Google is
  // already showing as current. So the year is dropped first.
  const candidates = withYear
    ? [
        `${base} ${label}: ${withYear}${applyClause}. ${tail}`,
        `${base} ${label}: ${noYear}${applyClause}. ${tail}`,
        `${base} ${label}: ${withYear}. ${tail}`,
        `${base} ${label}: ${noYear}. ${tail}`,
        `${base} ${tail}`,
      ]
    : [`${base} ${tail}`];

  for (const candidate of candidates) {
    if (candidate.length <= META_DESCRIPTION_MAX) return candidate;
  }

  // Every candidate blew the budget — only reachable if `basePriceLabel` is
  // pathological. Return the shortest rather than throwing: a long
  // description is a bad snippet, but a throw here would 500 the homepage.
  return candidates[candidates.length - 1];
}
