"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether the visitor is signed in, resolved in the browser.
 *
 * `getSession()` on the @supabase/ssr browser client reads the `sb-*-auth-token`
 * cookie that is already on the document — it is a local read, not a network
 * round trip. That is what makes this cheap enough to do on a page that is
 * otherwise static HTML off the CDN.
 *
 * Always false on the server and on the first client render, so the SSR output
 * and the hydrated output agree. It flips one tick later for signed-in
 * visitors.
 */
export function useIsAuthed(): boolean {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    let live = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (live) setAuthed(!!data.session);
      })
      // A malformed or expired cookie just means "signed out" here. The worst
      // case is a visitor seeing "Apply" and being redirected by /home.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return authed;
}

/**
 * A CTA label that reads "Dashboard" once we know the visitor is signed in.
 *
 * The signed-out label is rendered invisibly underneath at all times, so the
 * element's width is fixed by the *longer* of the two strings and the swap
 * cannot move anything around it. batch0's CLS is a perfect 0 in production
 * and trading that away for one word would be a bad deal — a layout shift is
 * a worse experience than a slightly-late label.
 */
export function AuthLabel({
  signedOut,
  signedIn = "Dashboard",
}: {
  signedOut: string;
  signedIn?: string;
}) {
  const authed = useIsAuthed();
  return (
    <span className="inline-grid">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {signedOut}
      </span>
      <span className="col-start-1 row-start-1">
        {authed ? signedIn : signedOut}
      </span>
    </span>
  );
}
