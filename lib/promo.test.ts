import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROMO_ENDS_AT,
  PROMO_PERCENT,
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

test("the sale price is always a whole dollar", () => {
  // 40% off $129.99 is $77.994. Billing that literally puts "$77.99" on a card
  // statement under a headline promising $78.
  for (const list of [US_LIST, IN_LIST, 9700, 13000, 4999]) {
    assert.equal(
      promoPriceCents(list, DURING) % 100,
      0,
      `${list} produced a fractional-dollar sale price`,
    );
  }
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
