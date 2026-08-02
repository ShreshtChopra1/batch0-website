import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { capabilitiesForRole, getRole } from "@/lib/roles";
import {
  can,
  canAccessAdmin,
  canViewAdminPath,
  resolveHome,
  type Capabilities,
  type Permission,
} from "@/lib/permissions";
import type { Profile, Role } from "@/lib/types";

/**
 * Each role has a "home" — the area it owns and where role-mismatches send
 * it. Since migration 0048 that's `app_roles.home_path`, falling back to
 * whatever the role's permissions can actually reach (so a role that loses
 * `mentor.panel` stops being sent to /mentor).
 *
 * Kept in sync with the inline copy in lib/supabase/middleware.ts, which
 * can't import this module — see the note there.
 */
export async function roleHome(role: Role): Promise<string> {
  const row = await getRole(role);
  const caps = await capabilitiesForRole(role);
  return resolveHome(caps, row?.home_path ?? null);
}

export async function getUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) return profile as Profile;

  // Self-heal: profile row is missing (migration trigger didn't fire,
  // profile was deleted, etc.). Create one with the service role client
  // so RLS doesn't block, and so the dashboard never has to redirect
  // back to /login (which would cause an infinite redirect loop with
  // the middleware that bounces signed-in users away from /login).
  try {
    const admin = createAdminClient();
    const { data: created } = await admin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email ?? "",
          full_name:
            (user.user_metadata?.full_name as string | undefined) ?? "",
        },
        { onConflict: "id" },
      )
      .select("*")
      .maybeSingle();
    if (created) return created as Profile;
  } catch (err) {
    console.error("[auth] profile self-heal failed:", err);
  }

  // Last-resort synthesized profile so the UI can render and the user
  // sees the app instead of a redirect loop. The DB is the source of
  // truth — this only fires if the DB is unreachable or the schema is
  // missing, which an admin needs to fix.
  return {
    id: user.id,
    email: user.email ?? "",
    full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    role: "student",
    stripe_customer_id: null,
    referral_code: null,
    ai_context: null,
    theme: "dark",
    discord_user_id: null,
    discord_username: null,
    discord_avatar: null,
    discord_linked_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type Viewer = {
  profile: Profile;
  caps: Capabilities;
};

/**
 * The signed-in user plus their resolved permissions, or null when signed
 * out. Request-cached, so the layout, the sidebar, and the page body all
 * share one resolution — and can never disagree about what the viewer can do.
 */
export const getViewer = cache(async function getViewer(): Promise<Viewer | null> {
  const profile = await getProfile();
  if (!profile) return null;
  return { profile, caps: await capabilitiesForRole(profile.role) };
});

/** Permissions only. Convenience for call sites that don't need the profile. */
export async function getCapabilities(): Promise<Capabilities | null> {
  return (await getViewer())?.caps ?? null;
}

/** Non-throwing permission check for the signed-in user. */
export async function viewerCan(permission: Permission): Promise<boolean> {
  return can(await getCapabilities(), permission);
}

/** Signed in, with permissions resolved. Redirects to /login otherwise. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/**
 * Gate a page on one permission. Anyone without it goes to their own home
 * rather than seeing a 403 they can't act on.
 */
export async function requirePermission(permission: Permission): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!can(viewer.caps, permission)) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer;
}

/**
 * Gate on "belongs in /admin at all". Per-page permissions are enforced by
 * app/admin/layout.tsx, which knows the pathname; pages call this to state
 * that they're admin-area pages and to get the viewer.
 */
export async function requireAdminArea(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!canAccessAdmin(viewer.caps)) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer;
}

/** Gate on the permission that the given admin path requires. */
export async function requireAdminPath(path: string): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!canViewAdminPath(viewer.caps, path)) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer;
}

// ---------------------------------------------------------------------------
// Legacy role guards
// ---------------------------------------------------------------------------

export async function requireStudent() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  // /dashboard is the participant area — anyone whose role doesn't include it
  // goes to their own home rather than bouncing back here in a loop. Admins
  // are let through by the wildcard.
  if (!can(viewer.caps, "student.dashboard")) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer.profile;
}

/**
 * Full-power admin — the wildcard grant, not merely admin-area access. Use
 * this only where the operation genuinely has no narrower permission; prefer
 * `requirePermission("…")` everywhere else.
 */
export async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.caps.superAdmin) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer.profile;
}

export async function requireMentor() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!can(viewer.caps, "mentor.panel")) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer.profile;
}

export async function requireInvestor() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!can(viewer.caps, "investor.panel")) {
    redirect(await roleHome(viewer.profile.role));
  }
  return viewer.profile;
}
