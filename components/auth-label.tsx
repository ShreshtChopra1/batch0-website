"use client";
import { useEffect, useState } from "react";

/**
 * The session cookie @supabase/ssr writes: `sb-<projectRef>-auth-token`, split
 * into `.0` / `.1` when it outgrows the cookie size limit. Its
 * DEFAULT_COOKIE_OPTIONS set `httpOnly: false`, so the document can see it.
 */
const AUTH_COOKIE = /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/;

/**
 * Whether the visitor is signed in, resolved in the browser.
 *
 * Deliberately a raw cookie test rather than `createBrowserClient().auth
 * .getSession()`. The SDK call is also a local read, but *importing* it drags
 * auth-js, postgrest-js, realtime-js, storage-js and functions-js into the
 * shared client chunk — measured at 243 KB raw / 54 KB brotli on a live blog
 * article, on pages whose entire reason for existing in this changeset is to
 * be fast. Nothing in the marketing tree needs a Supabase client; it needs one
 * boolean.
 *
 * Presence, not validity: an expired-but-present cookie reads as signed in.
 * That is safe here because it only chooses a word — the href is the constant
 * /home, which resolves the destination server-side either way.
 *
 * False on the server and on the first client render so SSR and hydration
 * agree; it flips one tick later.
 */
export function useIsAuthed(): boolean {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(AUTH_COOKIE.test(document.cookie));
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
