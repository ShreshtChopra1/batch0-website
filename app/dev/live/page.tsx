import { notFound } from "next/navigation";
import { LivePreview } from "./preview";

/**
 * Interface preview for the live-video work.
 *
 * Every screen in the feature, rendered against fixed mock data with no auth,
 * no database, and no video provider — so the UI can be reviewed and iterated
 * on before any of that exists. Your real camera and microphone do work here,
 * because those are plain `getUserMedia` and owe nothing to a provider.
 *
 * This is not behind a permission check — it is behind not existing on the
 * live site at all, which is the only guarantee worth having for a route that
 * deliberately skips every guard the real pages apply.
 *
 * The gate is VERCEL_ENV, not NODE_ENV. Vercel builds *every* deployment with
 * NODE_ENV=production, preview branches included, so a NODE_ENV check would
 * 404 the preview too and leave nowhere to review this but localhost.
 * VERCEL_ENV distinguishes them:
 *
 *   undefined    → local `next dev`                        → renders
 *   "preview"    → a branch deployment                     → renders
 *   "production" → batch0.org / app.batch0.org             → 404
 *
 * So this can be looked at on a branch URL and cannot appear on the real site,
 * including if this branch is ever merged to main. To close the preview door
 * as well, change the check to `!== undefined`.
 */
export const metadata = {
  title: "Live video preview · batch0",
  robots: { index: false, follow: false },
};

export default function LivePreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <LivePreview />;
}
