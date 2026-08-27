import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isPreCohortAllowedPath,
  computePreCohort,
  isAcceptedStatus,
  type PreCohortCohort,
} from "@/lib/pre-cohort";
import {
  can,
  canAccessAdmin,
  canViewAdminPath,
  capabilitiesFrom,
  resolveHome,
  type Capabilities,
} from "@/lib/permissions";

type CookiesToSet = {
  name: string;
  value: string;
  options: CookieOptions;
}[];

/**
 * Permissions for the four system roles, without a database round trip.
 *
 * Only used when `app_roles` can't be read — migration 0048 not applied yet,
 * or a transient failure. Mirrors the seed in that migration and the fallback
 * in lib/roles.ts, so an un-migrated deploy gates exactly as it did before
 * roles became data rather than locking everyone out.
 */
const FALLBACK_PERMISSIONS: Record<string, string[]> = {
  student: ["student.dashboard"],
  admin: ["*"],
  mentor: ["mentor.panel"],
  investor: ["investor.panel"],
};

const FALLBACK_HOME: Record<string, string> = {
  student: "/dashboard",
  admin: "/admin",
  mentor: "/mentor",
  investor: "/investor",
};

/**
 * Paths that are now fully prerendered and read no session at all.
 *
 * Vercel runs middleware BEFORE the CDN cache lookup, so even a static HTML
 * hit pays for whatever happens in here. Since these routes stopped touching
 * cookies (that is what let them prerender), constructing a Supabase client
 * and validating a JWT for them is pure overhead on the site's highest-volume
 * traffic — 135 blog articles plus the legal pages.
 *
 * Everything else keeps going through updateSession, because that is what
 * refreshes an expiring access token; a route that reads the session and is
 * missing from the middleware would silently show a signed-in user as signed
 * out. Only add a path here once it genuinely reads no auth.
 */
const PUBLIC_STATIC_PREFIXES = [
  "/blog",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/sponsors",
];

function isPublicStatic(path: string): boolean {
  return PUBLIC_STATIC_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/"),
  );
}

export async function updateSession(request: NextRequest) {
  if (isPublicStatic(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // Stamp the request pathname onto a header so downstream server
  // components (admin layout, page-level guards) can read it via
  // next/headers without parsing the URL on their own. Next.js doesn't
  // expose pathname to RSC by default.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-pathname", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: reqHeaders } });

  // Middleware reads per-user state (role, pending fines, etc.) on every
  // request. Next.js otherwise caches GET fetches inside middleware,
  // which makes a freshly-changed `profiles.role` look stale until the
  // user signs back in. Force every Supabase fetch to bypass cache.
  const noStoreFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, cache: "no-store" });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // Re-issue the response with our augmented headers — passing the
          // bare `request` here would lose the x-pathname header we just
          // set above.
          response = NextResponse.next({ request: { headers: reqHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
      global: { fetch: noStoreFetch },
    },
  );

  // IMPORTANT: do not put logic between createServerClient and getUser().
  // getUser() also refreshes the session if needed, which writes new cookies
  // onto `response` via setAll above. Any redirect we return must carry
  // those cookies forward or the user will be silently logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const protectedPath =
    path.startsWith("/dashboard") ||
    path.startsWith("/admin") ||
    path.startsWith("/mentor") ||
    path.startsWith("/investor") ||
    path.startsWith("/notifications") ||
    path.startsWith("/apply");
  const authPath = path === "/login" || path === "/signup";

  function redirectTo(pathname: string, search?: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = search ?? "";
    const redirect = NextResponse.redirect(url);
    // Carry over any auth cookies that getUser() may have refreshed,
    // otherwise the session is dropped on every redirect.
    response.cookies.getAll().forEach((c) => {
      redirect.cookies.set(c.name, c.value, c);
    });
    return redirect;
  }

  // Bounce legacy /professor URLs to the new /mentor area.
  if (path === "/professor" || path.startsWith("/professor/")) {
    const rest = path.slice("/professor".length);
    return redirectTo(`/mentor${rest}`, request.nextUrl.search);
  }

  if (protectedPath && !user) {
    // /apply is the marketing funnel entry — most unauth visitors here are
    // brand-new and need an account first. Route them to /signup. All other
    // protected routes (admin/dashboard/mentor/investor) are returning-user
    // surfaces, so keep /login as the default.
    const dest = path === "/apply" || path.startsWith("/apply/") ? "/signup" : "/login";
    // Preserve the full path INCLUDING query (e.g. `?ref=CODE`) so a referral
    // code survives the auth bounce — otherwise a logged-out referred visitor
    // loses their referrer on the way through signup.
    return redirectTo(
      dest,
      `?next=${encodeURIComponent(path + request.nextUrl.search)}`,
    );
  }

  /**
   * Role + permissions for the signed-in user, resolved once and reused by
   * every gate below. Roles are data since migration 0048, so "what can this
   * person reach" is a permission lookup rather than a slug comparison —
   * that's what lets a custom role like `intern` into part of /admin.
   */
  type Resolved = { caps: Capabilities; home: string };
  let resolved: Resolved | null = null;
  async function loadCapabilities(userId: string): Promise<Resolved> {
    if (resolved) return resolved;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const role = (profile?.role as string) ?? "student";
    const { data: roleRow, error } = await supabase
      .from("app_roles")
      .select("permissions, home_path")
      .eq("slug", role)
      .maybeSingle();
    const caps =
      error || !roleRow
        ? capabilitiesFrom(role, FALLBACK_PERMISSIONS[role] ?? [])
        : capabilitiesFrom(role, roleRow.permissions as string[]);
    const storedHome =
      error || !roleRow
        ? (FALLBACK_HOME[role] ?? null)
        : ((roleRow.home_path as string) ?? null);
    resolved = { caps, home: resolveHome(caps, storedHome) };
    return resolved;
  }

  if (authPath && user) {
    // Send signed-in users to their role home rather than always /dashboard,
    // since /dashboard is now participant-only and would otherwise bounce again.
    const { home } = await loadCapabilities(user.id);
    return redirectTo(home);
  }

  // Hard-block: any signed-in user with a pending fine can only reach the
  // pay-fine screen + billing + signout until it's paid or waived. Full
  // admins bypass so they can still hit /admin to waive.
  if (
    user &&
    (path.startsWith("/dashboard") ||
      path.startsWith("/apply") ||
      path.startsWith("/mentor") ||
      path.startsWith("/investor")) &&
    !path.startsWith("/dashboard/billing") &&
    !path.startsWith("/dashboard/pay-fine") &&
    !path.startsWith("/auth")
  ) {
    const { data: pendingFine } = await supabase
      .from("user_charges")
      .select("id")
      .eq("user_id", user.id)
      .eq("kind", "fine")
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (pendingFine) {
      const { caps } = await loadCapabilities(user.id);
      if (!caps.superAdmin) {
        return redirectTo("/dashboard/pay-fine");
      }
    }
  }

  if (
    (path.startsWith("/dashboard") ||
      path.startsWith("/admin") ||
      path.startsWith("/mentor") ||
      path.startsWith("/investor")) &&
    user
  ) {
    const { caps, home } = await loadCapabilities(user.id);

    // /dashboard is the participant area, gated by `student.dashboard`.
    // Mentors and investors get bounced to their own panel — they have no
    // business in the student view. Admins hold the wildcard and are allowed
    // through as an opt-in (the admin sidebar has a "Student view" link), but
    // their default home stays /admin. Billing + pay-fine are shared per-user
    // views every role can reach.
    if (
      path.startsWith("/dashboard") &&
      !path.startsWith("/dashboard/pay-fine") &&
      !path.startsWith("/dashboard/billing") &&
      !can(caps, "student.dashboard") &&
      // Never bounce /dashboard at /dashboard. A role with no permissions at
      // all resolves its home to /dashboard, and redirecting there would spin
      // forever; the dashboard layout renders bare chrome for these viewers
      // instead, which is a dead end rather than a loop.
      home !== "/dashboard"
    ) {
      return redirectTo(home);
    }
    // /admin is permission-gated per route: `canViewAdminPath` first checks
    // the person belongs in the admin area at all, then that they hold the
    // specific permission that route needs (see ADMIN_ROUTE_PERMISSIONS).
    // The admin layout re-checks the same predicate server-side.
    if (path.startsWith("/admin") && !canViewAdminPath(caps, path)) {
      // Someone who belongs in /admin but not on this page lands on the
      // overview, which they can always read — bouncing them out of the
      // panel entirely would be a dead end.
      return redirectTo(canAccessAdmin(caps) ? "/admin" : home);
    }
    if (path.startsWith("/mentor") && !can(caps, "mentor.panel")) {
      return redirectTo(home);
    }
    if (path.startsWith("/investor") && !can(caps, "investor.panel")) {
      return redirectTo(home);
    }

    // Pre-cohort lockdown: an accepted (or already-enrolled) student whose
    // cohort hasn't started yet can only load the personal pages — home,
    // application, resources, billing, referrals, settings (+ pay-fine).
    // Every other /dashboard route bounces home. The sidebar hides the
    // links too; this is the hard server-side gate, so a typed URL, a
    // stale link, or a prefetch can't reach past the designated pages.
    // Decision logic is shared with lib/access.ts via lib/pre-cohort.ts.
    // Staff previewing the student view are exempt.
    if (
      path.startsWith("/dashboard") &&
      !canAccessAdmin(caps) &&
      !isPreCohortAllowedPath(path)
    ) {
      // Two parallel queries; the cohort rows ride along as embeds. On any
      // query error, fail open — a transient DB blip must not lock a
      // mid-cohort student out of the course (the page-level guards still
      // hold the enrollment line).
      const [appsRes, enrollsRes] = await Promise.all([
        supabase
          .from("applications")
          .select("status, cohort_id, cohort:cohorts(starts_on, status)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("enrollments")
          .select("cohort_id, cohort:cohorts(starts_on, status)")
          .eq("user_id", user.id),
      ]);
      if (!appsRes.error && !enrollsRes.error) {
        const app = appsRes.data?.[0] ?? null;
        const accepted = !!app && isAcceptedStatus(app.status);
        const enrollRows = enrollsRes.data ?? [];
        if (accepted || enrollRows.length > 0) {
          const seen = new Set<string>();
          const cohorts: PreCohortCohort[] = [];
          const rows = accepted && app ? [...enrollRows, app] : enrollRows;
          for (const row of rows) {
            const c = Array.isArray(row.cohort) ? row.cohort[0] : row.cohort;
            if (row.cohort_id && c && !seen.has(row.cohort_id)) {
              seen.add(row.cohort_id);
              cohorts.push(c);
            }
          }
          if (computePreCohort(true, cohorts)) {
            return redirectTo("/dashboard");
          }
        }
      }
    }
  }

  return response;
}
