import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { RegisterSW } from "@/components/app/register-sw";

/**
 * /app — the installable surface.
 *
 * This is not a responsive re-skin of /dashboard and /admin. Those are the
 * complete panels: ~60 admin routes and ~25 student ones, which is the right
 * shape at a desk and the wrong shape entirely on a phone, where the honest
 * question is "what do I need to know or decide in the next thirty seconds".
 * Everything here earns its place against that question, and every screen keeps
 * a way through to the full panel for the things it deliberately omits.
 *
 * The auth gate is here rather than repeated per page: /app is entirely
 * authenticated, and middleware bounces signed-out visitors before they arrive
 * (see `protectedPath` in lib/supabase/middleware.ts). This is the server-side
 * backstop for anything that reaches a page without passing middleware.
 * Per-side permission checks live in the (student) and admin layouts.
 */
export const metadata: Metadata = {
  title: "batch0",
  // Next injects <link rel="manifest"> for app/manifest.ts automatically, but
  // naming it here is what guarantees it on THIS subtree specifically — the
  // one subtree whose whole point is being installable.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "batch0",
    // "black-translucent" lets the page paint under the status bar, which is
    // why AppHeader carries `pt-[var(--safe-top)]`. The two go together: drop
    // the padding and the title renders behind the clock.
    statusBarStyle: "black-translucent",
  },
  // An installed app is a private tool. Nothing under /app should ever be in
  // an index, and every route here is authenticated anyway.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Locks the standalone window to its intended width. The root layout sets
  // viewportFit; repeating it here keeps the safe-area insets resolving if this
  // subtree's viewport ever diverges from the site's.
  viewportFit: "cover",
  // Unlike the marketing site, the app shell does not follow the OS preference
  // in its browser chrome — it is a single dark-first product surface.
  themeColor: "#0c0c0d",
};

export default async function InstalledAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=%2Fapp");
  return (
    <>
      {children}
      <RegisterSW />
    </>
  );
}
