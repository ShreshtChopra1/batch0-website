"use client";
import { useEffect } from "react";

/**
 * Registers public/sw.js. Rendered once, from the /app layout.
 *
 * Registration is deliberately gated on production. In `next dev` the worker
 * would sit in front of the dev server's HMR navigations for the rest of the
 * session, and an unregister is not something you remember to do — you just
 * lose an afternoon to a page that won't update.
 *
 * The registration itself is fire-and-forget: everything in this app works
 * without a service worker, so a failure here is not worth surfacing to the
 * user. It is logged, because the one thing you want to know when "Install
 * app" doesn't appear on Android is whether the worker registered.
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.error("[pwa] service worker registration failed", err));
  }, []);
  return null;
}
