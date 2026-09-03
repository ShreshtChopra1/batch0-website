"use client";

import React from "react";
import Link from "next/link";
import { PROMO_ENDS_AT, PROMO_PERCENT, activePromo } from "@/lib/promo";

/**
 * The sale bar — the site-wide announcement of the tuition promotion.
 *
 * WHY THIS IS A CLIENT COMPONENT. The root layout is statically generated, so
 * an `activePromo()` check rendered there would be frozen at build time and
 * would keep announcing the sale after it ended until somebody redeployed.
 * Evaluating the deadline in the browser instead means the bar disappears at
 * the deadline for every visitor, on every route — including the 135
 * prerendered blog posts, which are exactly the pages nobody would think to
 * rebuild.
 *
 * It renders on the server too (the same constant is true at build time during
 * the sale), so there is no flash of missing banner and no layout shift on
 * first paint. The client pass only ever REMOVES it.
 *
 * The countdown is deliberately mount-gated: rendering a live "2d 14h" string
 * on the server would hydrate against a different value a second later. The
 * server renders the static deadline, and the ticking clock replaces it after
 * mount.
 */
export function SaleBanner() {
  const [expired, setExpired] = React.useState(false);
  const [remaining, setRemaining] = React.useState<string | null>(null);

  React.useEffect(() => {
    const endsAt = new Date(PROMO_ENDS_AT).getTime();

    const tick = () => {
      const ms = endsAt - Date.now();
      if (ms <= 0) {
        setExpired(true);
        setRemaining(null);
        return;
      }
      const totalMinutes = Math.floor(ms / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;
      // Days drop off the label in the last 24 hours so the number that is
      // actually moving is the one a reader sees.
      setRemaining(
        days > 0 ? `${days}d ${hours}h left` : `${hours}h ${minutes}m left`,
      );
    };

    tick();
    // A minute is the smallest unit displayed, so a minute is how often this
    // needs to run. A per-second timer would repaint 60x for nothing.
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Build-time truth for the server pass, wall-clock truth after mount.
  if (expired || !activePromo()) return null;

  return (
    <aside
      // aria-label rather than a heading: this is an announcement region, and
      // a real <h2> here would land above the page's own <h1> in the outline.
      aria-label="Tuition sale"
      className="border-b border-on-phosphor/15 bg-phosphor text-on-phosphor"
    >
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-5 py-2 text-center font-mono text-[12px] uppercase leading-tight tracking-[0.12em] sm:px-6">
        <span className="font-semibold">{PROMO_PERCENT}% off tuition</span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <span>Ends September 9</span>
        {remaining && (
          <>
            <span aria-hidden className="opacity-40">
              ·
            </span>
            {/* aria-live is deliberately absent: a countdown that announces
                itself every minute is a screen-reader trap. The deadline above
                is the accessible fact; this is a visual urgency cue. */}
            <span aria-hidden className="tabular-nums font-semibold">
              {remaining}
            </span>
          </>
        )}
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <Link
          href="/apply"
          className="underline decoration-on-phosphor/40 underline-offset-4 transition-colors hover:decoration-on-phosphor"
        >
          Apply now
        </Link>
      </div>
    </aside>
  );
}
