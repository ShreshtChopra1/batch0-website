"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/server-guards";
import { logAudit } from "@/lib/audit";
import { syncMemberRoles } from "@/lib/discord";
import { getRole } from "@/lib/roles";
import { covers } from "@/lib/permissions";
import type { Role } from "@/lib/types";

/**
 * Roles are rows in `public.app_roles` since migration 0048, so "is this a
 * valid role" is a lookup rather than a hard-coded list — that's what lets a
 * custom role like `intern` be assigned here the moment it's created.
 *
 * Note what this action does NOT require: an application, an acceptance, a
 * cohort, or a payment. Somebody signs up, an admin picks their role, done.
 */
async function guardRoleChange(role: Role) {
  const actor = await assertPermission("people.roles");
  const target = await getRole(role);
  if (!target) throw new Error(`"${role}" isn't a role.`);
  // You can't hand out access you don't hold yourself — the same rule the
  // roles page enforces. Full admins hold the wildcard and skip it.
  if (!covers(actor.caps, target.permissions)) {
    throw new Error(
      `You can't assign "${target.label}" — it holds permissions you don't have.`,
    );
  }
  return actor;
}

export async function changeUserRole(userId: string, role: Role) {
  const actor = await guardRoleChange(role);
  const actorId = actor.userId;
  // Nobody re-roles themselves. Previously this only blocked an admin
  // downgrading their own admin bit; now that any role can carry
  // `people.roles`, self-service in either direction is a way to escape the
  // "can't grant what you don't hold" rule above.
  if (userId === actorId && role !== actor.role) {
    throw new Error("You can't change your own role. Ask another admin.");
  }
  const admin = createAdminClient();
  // Read the core columns first — those are guaranteed to exist.
  const { data: prev } = await admin
    .from("profiles")
    .select("role, email")
    .eq("id", userId)
    .single();
  const { error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  await logAudit({
    action: "user.role_changed",
    targetType: "profile",
    targetId: userId,
    payload: { from: prev?.role ?? null, to: role, email: prev?.email },
  });

  // Best-effort Discord sync. discord_user_id is added by migration 0008 —
  // tolerate the column being absent so admin role changes still succeed.
  // Custom roles have no Discord role mapped; syncMemberRoles then just
  // strips the managed ones, which is the correct outcome.
  try {
    const { data: link, error: linkErr } = await admin
      .from("profiles")
      .select("discord_user_id")
      .eq("id", userId)
      .maybeSingle();
    if (!linkErr && (link as any)?.discord_user_id) {
      await syncMemberRoles((link as any).discord_user_id, role).catch(
        () => {},
      );
    }
  } catch {
    // ignore — column doesn't exist
  }
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${userId}`);
  revalidatePath("/admin/roles");
}

export async function bulkChangeUserRole(input: {
  userIds: string[];
  role: Role;
}): Promise<{ succeeded: number; failed: number; skipped: number }> {
  const actor = await guardRoleChange(input.role);
  const actorId = actor.userId;
  if (input.userIds.length === 0) {
    return { succeeded: 0, failed: 0, skipped: 0 };
  }
  if (input.userIds.length > 200) {
    throw new Error("Cap bulk role changes at 200 users per run.");
  }
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const id of input.userIds) {
    if (id === actorId) {
      skipped++;
      continue;
    }
    try {
      await changeUserRole(id, input.role);
      succeeded++;
    } catch {
      failed++;
    }
  }
  revalidatePath("/admin/students");
  return { succeeded, failed, skipped };
}
