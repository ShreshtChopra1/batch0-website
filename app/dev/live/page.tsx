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
 * Development only. This is not behind a permission check — it is behind not
 * existing in production at all, which is the only guarantee worth having for
 * a route that deliberately skips every guard the real pages apply.
 */
export const metadata = {
  title: "Live video preview · batch0",
  robots: { index: false, follow: false },
};

export default function LivePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LivePreview />;
}
