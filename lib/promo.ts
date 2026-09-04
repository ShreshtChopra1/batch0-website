// The 40%-off tuition promotion.
//
// This module exists so the promo has exactly ONE end date. The previous
// version of this push was a hand-edited string in the root layout with a
// comment asking a human to remember to take it out — which is the failure
// mode where a site advertises an expired sale for a month because nobody
// redeployed. Everything date-dependent reads `activePromo()` instead, so the
// offer disappears from the site on its own.
//
// DEPENDENCY-FREE on purpose: imported by metadata builders that run during
// static generation, so it must not reach for a database or an environment.

/**
 * End of the promotion — 11:59:59 PM Eastern on September 9, 2026.
 *
 * Written with an explicit offset rather than a bare date: "until Sept 9" to a
 * U.S. audience means the end of that evening, and a plain `2026-09-10T00:00Z`
 * would have cut the offer off at 8 PM Eastern on the 9th, killing the last
 * night of a deadline-driven push.
 */
export const PROMO_ENDS_AT = "2026-09-09T23:59:59-04:00";

/** Percentage off the list price. Display only — see the note in `Promo`. */
export const PROMO_PERCENT = 40;

/**
 * schema.org `priceValidUntil` for the Offer node. Exported separately from
 * `activePromo()` because the root layout builds its JSON-LD at module scope,
 * where there is no request and therefore no meaningful "now".
 */
export const PROMO_VALID_UNTIL = "2026-09-09";

/**
 * The list tuition this promotion was declared against, in cents — the value
 * `cohorts.price_cents` is expected to hold while the sale runs.
 *
 * Used only by the fail-safe in `promoPriceCents()`; the discount itself is
 * computed from whatever base it is handed, so regional prices still get the
 * full percentage. Update it alongside a genuine change to list price.
 */
export const PROMO_LIST_PRICE_CENTS = 12999;

/**
 * What this promo charges for its declared list price — $78 off $129.99.
 * Exported because it is the exact value that was written into
 * `cohorts.price_cents` by hand, and `listPriceCents()` has to recognise it.
 */
export const PROMO_SALE_PRICE_CENTS = 7800;

/**
 * The LIST price for a cohort row, repairing one known-bad value.
 *
 * `cohorts.price_cents` is supposed to hold list price. During this promo it
 * was set to the SALE price by hand instead, which made the site discount an
 * already-discounted number. `promoPriceCents()` stops that from producing $47
 * — but a guard alone is not enough, because it only fixes the price WHILE the
 * sale runs. On September 10 the promo stops discounting anything, the row
 * still says 7800, and the price silently stays $78 forever instead of
 * reverting to $130. That is the failure this function exists to prevent, and
 * it is the one nobody would notice, because it looks like nothing happened.
 *
 * So a row holding exactly the sale price is read as the list price it was
 * derived from. The site is then correct in BOTH states with no database edit:
 * $78 while the sale runs, $130 the moment it ends.
 *
 * SCOPE, and when to delete this. This is data repair living in code, and it
 * carries one real cost: a cohort deliberately priced at exactly $78 would be
 * read as $130. That ambiguity is exactly what the bad row created, and it is
 * resolved in favour of the overwhelmingly likelier case. Once
 * `cohorts.price_cents` is back to 12999, this function is dead weight —
 * delete it, and the tests named for it, along with the promo itself.
 */
export function listPriceCents(rowCents: number): number {
  return rowCents === PROMO_SALE_PRICE_CENTS ? PROMO_LIST_PRICE_CENTS : rowCents;
}

export type Promo = {
  percent: number;
  /** "Sept 9" — the deadline, for a title tag with ~60 characters to spend. */
  shortDeadline: string;
  /** "September 9" — the deadline where there is room to spell it out. */
  longDeadline: string;
  /** "2026-09-09" — schema.org `priceValidUntil` format. */
  validUntil: string;
};

const PROMO: Promo = {
  percent: PROMO_PERCENT,
  shortDeadline: "Sept 9",
  longDeadline: "September 9",
  validUntil: "2026-09-09",
};

/**
 * The promo if it is still running, otherwise null.
 *
 * IMPORTANT: this governs what the site *advertises*, not what Stripe charges.
 * The amount billed comes from the `cohorts.price_cents` row, which does not
 * revert on its own — when this returns null the marketing copy goes back to
 * list price, but the cohort row must be set back to 12999 by hand in
 * /admin/cohorts or checkout will keep charging the sale price.
 */
export function activePromo(now: Date = new Date()): Promo | null {
  return now.getTime() <= new Date(PROMO_ENDS_AT).getTime() ? PROMO : null;
}

/**
 * What this promo charges for a given list price, in cents.
 *
 * Rounded to whole dollars, so the number advertised and the number charged
 * are the same number — the entire point of computing this in one place.
 *
 * Applied on top of regional pricing, never inside it — see lib/pricing.ts.
 * That ordering is what makes the discount reach every region equally
 * ($129.99 -> $78 in the U.S., $115 -> $69 in India) without anyone
 * hand-syncing a table.
 *
 * Returns `baseCents` unchanged once the promo has ended, which is what makes
 * expiry a no-op rather than a cleanup task.
 */
export function promoPriceCents(baseCents: number, now: Date = new Date()): number {
  const promo = activePromo(now);
  if (!promo) return baseCents;

  // Fail safe against a list price that has already had the sale applied to
  // it. The cohorts.price_cents row is supposed to hold LIST price, and this
  // function is what discounts it — but the row is hand-edited in an admin
  // form, and someone entering the sale price there instead is not a
  // hypothetical: it happened, and it billed $47 (40% off $78) under a
  // headline promising $78.
  //
  // A base at or below what this promo charges for its declared list price has
  // almost certainly been discounted already, so it is charged as-is. That
  // makes the wrong row produce the RIGHT price rather than a doubled discount
  // — and because display and checkout both come through here, the two can
  // still never disagree.
  //
  // The tradeoff is deliberate: a cohort genuinely priced below the sale price
  // does not receive the promo. That errs toward charging list, which is
  // recoverable, over charging half of a discount nobody authorised.
  if (baseCents <= discount(PROMO_LIST_PRICE_CENTS, promo.percent)) {
    return baseCents;
  }

  return discount(baseCents, promo.percent);
}

/**
 * Whole-dollar sale price. Rounded because every price the site quotes is
 * whole dollars: 40% off $129.99 is $77.994, and billing that literally would
 * put "$77.99" on a card statement under a headline promising "$78".
 */
function discount(baseCents: number, percent: number): number {
  return Math.round((baseCents * (100 - percent)) / 100 / 100) * 100;
}

/**
 * The homepage <title> while the promo runs.
 *
 * Budgeted under 60 characters, which is roughly what Google renders.
 *
 * The BRAND leads, which reverses the convention in app/layout.tsx, and the
 * reason is query intent. That convention exists for discovery searches, where
 * "batch0" carries no meaning and the page has to be findable by what it is.
 * This title is aimed at the opposite case — someone typing "batch0" — and
 * Google is markedly more willing to keep a title whose opening words match the
 * query it is answering. A title that opens on a discount instead reads as
 * promotional boilerplate, which is one of the documented triggers for Google
 * discarding it and writing its own from the page.
 *
 * So the offer sits second: still inside the visible window, still the first
 * thing after the name being searched for, but no longer the opening claim.
 */
export function promoTitle(promo: Promo): string {
  return `batch0 — ${promo.percent}% Off Until ${promo.shortDeadline} — Startup Accelerator`;
}

/**
 * The homepage meta description while the promo runs.
 *
 * Replaces the cohort-dates snippet rather than prefixing it: the generated
 * description already spends its ~155 character budget, and Google truncates
 * the tail. The deadline is worth more than the cohort dates for as long as
 * the offer is live.
 */
export function promoMetaDescription(promo: Promo, salePrice: string, listPrice: string): string {
  return `${promo.percent}% off until ${promo.longDeadline}: tuition is ${salePrice}, not ${listPrice}. batch0 is a live, online startup accelerator for high schoolers. Free to apply, no equity taken.`;
}
