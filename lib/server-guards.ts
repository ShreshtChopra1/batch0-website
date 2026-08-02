import { createClient } from "@/lib/supabase/server";
import { capabilitiesForRole } from "@/lib/roles";
import {
  can,
  canAccessAdmin,
  type Capabilities,
  type Permission,
} from "@/lib/permissions";
import type { Role } from "@/lib/types";

/**
 * Server-action / route-handler guards. These throw `Error` so server
 * actions can let the error bubble up to the client transition.
 *
 * `assertPermission("area.verb")` is the one to reach for: it names the
 * capability the action needs, which is the same string an admin ticks for a
 * role at /admin/roles. The older role-shaped guards below are kept for the
 * handful of places where the check really is "is this person an admin" or
 * "is this person mentor-or-above".
 *
 * A page-level guard is not enough on its own — server actions are their own
 * entry point and are callable by anyone who can guess the action id, so
 * every mutation re-checks here.
 */

async function getActor(): Promise<{
  userId: string;
  role: Role;
  caps: Capabilities;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (profile?.role as Role) ?? "student";
  return { userId: user.id, role, caps: await capabilitiesForRole(role) };
}

/** The signed-in user's capabilities. Throws when signed out. */
export async function requireActor(): Promise<{
  userId: string;
  role: Role;
  caps: Capabilities;
}> {
  return getActor();
}

/**
 * The main write guard. Throws "Forbidden" unless the actor's role carries
 * `permission` (or the '*' wildcard).
 */
export async function assertPermission(permission: Permission): Promise<{
  userId: string;
  role: Role;
  caps: Capabilities;
}> {
  const actor = await getActor();
  if (!can(actor.caps, permission)) throw new Error("Forbidden");
  return actor;
}

/** Throws unless the actor holds every one of `permissions`. */
export async function assertAllPermissions(
  permissions: readonly Permission[],
): Promise<{ userId: string; role: Role; caps: Capabilities }> {
  const actor = await getActor();
  for (const p of permissions) {
    if (!can(actor.caps, p)) throw new Error("Forbidden");
  }
  return actor;
}

/** Throws unless the actor belongs in the admin area at all. */
export async function assertAdminArea(): Promise<{
  userId: string;
  role: Role;
  caps: Capabilities;
}> {
  const actor = await getActor();
  if (!canAccessAdmin(actor.caps)) throw new Error("Forbidden");
  return actor;
}

/**
 * Full-power admin — the '*' wildcard, not merely admin-area access. Reserve
 * for operations with no narrower permission; prefer `assertPermission`.
 */
export async function assertAdmin(): Promise<{ userId: string }> {
  const actor = await getActor();
  if (!actor.caps.superAdmin) throw new Error("Forbidden");
  return { userId: actor.userId };
}

/** Mentor-or-above: write access to program content and student feedback. */
export async function assertStaff(): Promise<{
  userId: string;
  role: Role;
}> {
  const actor = await getActor();
  if (!can(actor.caps, "mentor.panel")) throw new Error("Forbidden");
  return { userId: actor.userId, role: actor.role };
}

export async function assertSelf(): Promise<{ userId: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { userId: user.id };
}
