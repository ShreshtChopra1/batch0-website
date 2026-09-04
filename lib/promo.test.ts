import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROMO_ENDS_AT,
  PROMO_PERCENT,
  PROMO_LIST_PRICE_CENTS,
  activePromo,
  promoPriceCents,
  promoTitle,
  promoMetaDescription,
} from "./promo.ts";

// A promotion is the rare feature whose failure mode is legal rather than
// visual: advertise a discount the checkout does not honour, or keep
// advertising one after it ends, and the bug is a false price rather than a
// broken page. Nothing here touches a database or a network, because the
// module deliberately doesn't.

const DURING = new Date("2026-09-05T12:00:00-04:00");
const LAST_MINUTE = new Date("2026-09-09T23:59:00-04:00");
const AFTER = new Date("2026-09-10T00:00:30-04:00");

// The two list prices the site actually charges (lib/pricing.ts).
const US_LIST = 12999;
const IN_LIST = 11500;

test("the promo runs through the last minute of September 9, Eastern", () => {
  assert.ok(activePromo(DURING), "should be live mid-sale");
  assert.ok(
    activePromo(LAST_MINUTE),
    "11:59 PM Eastern on the 9th is still the 9th — a UTC deadline would " +
      "have cut this off at 8 PM and killed the last evening of the push",
  );
});

test("the promo is over immediately after its deadline", () => {
  assert.equal(activePromo(AFTER), null);
});

test("expiry makes every price revert with no cleanup", () => {
  // The whole design rests on this: after the deadline the discount function
  // is the identity, so nothing has to be un-edited by hand.
  assert.equal(promoPriceCents(US_LIST, AFTER), US_LIST);
  assert.equal(promoPriceCents(IN_LIST, AFTER), IN_LIST);
});

test("the discount reaches every region proportionally", () => {
  // Applied on top of the regional table rather than inside it, so one sale
  // discounts both without anyone hand-syncing lib/pricing.ts. A regression
  // here is what made India briefly more expensive than the U.S.
  assert.equal(promoPriceCents(US_LIST, DURING), 7800);
  assert.equal(promoPriceCents(IN_LIST, DURING), 6900);
  assert.ok(
    promoPriceCents(IN_LIST, DURING) < promoPriceCents(US_LIST, DURING),
    "the PPP-adjusted region must never cost more than the base region",
  );
});

test("a discounted price is always a whole dollar", () => {
  // 40% off $129.99 is $77.994. Billing that literally puts "$77.99" on a card
  // statement under a headline promising $78.
  //
  // Only prices the promo actually discounts are covered: a base below the
  // guard's floor is returned untouched, cents and all, because passing it
  // through unchanged is the entire point of the guard.
  for (const list of [US_LIST, IN_LIST, 9700, 13000]) {
    assert.ok(list > PROMO_LIST_PRICE_CENTS * 0.6, `${list} is below the floor`);
    assert.equal(
      promoPriceCents(list, DURING) % 100,
      0,
      `${list} produced a fractional-dollar sale price`,
    );
  }
});

test("a price below the floor is passed through exactly, cents included", () => {
  assert.equal(promoPriceCents(4999, DURING), 4999);
});

test("the discount never inverts or exceeds the price", () => {
  for (const list of [0, 1, 100, 4999, 12999, 50000]) {
    const sale = promoPriceCents(list, DURING);
    assert.ok(sale >= 0, `${list} produced a negative price`);
    assert.ok(sale <= list, `${list} produced a sale price ABOVE list`);
  }
});

test("the title fits inside what Google renders", () => {
  const promo = activePromo(DURING)!;
  const title = promoTitle(promo);
  // Google displays roughly the first 60 characters. The version this replaced
  // was 83 with the offer starting at 48 — entirely past the cutoff, so the
  // sale would never have been shown at all.
  assert.ok(
    [...title].length <= 60,
    `title is ${[...title].length} chars: ${title}`,
  );
  assert.ok(
    title.startsWith(`${PROMO_PERCENT}% Off`),
    "the offer has to lead, or truncation eats it",
  );
});

test("the meta description quotes two different prices", () => {
  const promo = activePromo(DURING)!;
  const desc = promoMetaDescription(promo, "$78", "$130");
  // Regression: this once rendered "tuition is $130, not $130" because the
  // sale price was read from a field holding the LIST price. Typechecking
  // cannot catch it — both arguments are strings.
  assert.match(desc, /\$78, not \$130/);
  assert.ok(
    [...desc].length <= 160,
    `description is ${[...desc].length} chars and will be truncated`,
  );
});

test("the deadline constant carries an explicit timezone offset", () => {
  // A bare date would be parsed as UTC and silently move the deadline.
  assert.match(PROMO_ENDS_AT, /[+-]\d{2}:\d{2}$/);
  assert.ok(!Number.isNaN(new Date(PROMO_ENDS_AT).getTime()));
});


// ---------------------------------------------------------------------------
// The double-discount guard
// ---------------------------------------------------------------------------

test("a row already holding the sale price is not discounted twice", () => {
  // The regression this exists for: cohorts.price_cents is meant to hold LIST
  // price, someone entered the sale price in the admin form instead, and the
  // site discounted it again — billing $47 under a headline promising $78.
  const sale = promoPriceCents(PROMO_LIST_PRICE_CENTS, DURING);
  assert.equal(sale, 7800);
  assert.equal(
    promoPriceCents(sale, DURING),
    sale,
    "applying the promo to its own output must be a no-op, not a second cut",
  );
});

test("the guard is idempotent for every list price the site uses", () => {
  for (const list of [US_LIST, IN_LIST, 13000]) {
    const once = promoPriceCents(list, DURING);
    const twice = promoPriceCents(once, DURING);
    assert.equal(twice, once, `${list} was discounted twice`);
  }
});

test("the guard errs toward list price, never toward a partial discount", () => {
  // A cohort genuinely priced below the sale price does not receive the promo.
  // That is the deliberate tradeoff: charging list is recoverable, charging
  // half of an unauthorised discount is not.
  const belowFloor = 5000;
  assert.equal(promoPriceCents(belowFloor, DURING), belowFloor);
});

test("the guard never blocks a legitimate regional discount", () => {
  // India's list price sits above the U.S. sale price, so it must still be
  // discounted in full — the guard must not quietly cancel regional pricing.
  assert.equal(promoPriceCents(IN_LIST, DURING), 6900);
  assert.ok(promoPriceCents(IN_LIST, DURING) < IN_LIST);
});
