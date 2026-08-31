import type { MetadataRoute } from "next";

/**
 * The web app manifest — what turns batch0.org into a home-screen app.
 *
 * `start_url` is /app rather than / on purpose: someone who installs this is
 * installing the *product*, not the marketing site. Launching straight into
 * the signed-in shell is the whole difference between "a bookmark" and "an
 * app". /app resolves the viewer server-side and routes students and staff to
 * their own surface, so one icon serves both sides.
 *
 * `display: standalone` (not fullscreen) keeps the OS status bar, which the
 * layout's safe-area padding already accounts for. Fullscreen would hide the
 * clock and battery — wrong for a tool people dip into for thirty seconds.
 *
 * Icons are the existing brand PNGs, declared `any` only. They are NOT
 * declared maskable: these are unpadded marks, and claiming maskable on an
 * unpadded icon tells Android it may crop ~20% off every edge, which eats the
 * wordmark. A dedicated padded maskable icon is the right follow-up.
 *
 * This file is a metadata route, so it is prerendered — it must never read
 * cookies, headers, or the database.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "batch0",
    short_name: "batch0",
    description:
      "Your batch0 cohort on your phone — what's due, what's next, and who needs an answer.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches the dark `--background` token in globals.css, so the launch
    // splash and the app's own first paint are the same colour.
    background_color: "#0c0c0d",
    theme_color: "#0c0c0d",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      {
        name: "Weekly check-in",
        short_name: "Check in",
        url: "/app/checkin",
      },
      {
        name: "Review applications",
        short_name: "Review",
        url: "/app/admin/review",
      },
    ],
  };
}
