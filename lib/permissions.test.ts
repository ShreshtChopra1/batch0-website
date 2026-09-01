import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_AREA_PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_BY_KEY,
  canAccessAdmin,
  canViewAdminPath,
  capabilitiesFrom,
  can,
} from "./permissions.ts";

// Run with `npm test`.
//
// These guard the derivation that decides who gets into /admin. `canAccessAdmin`
// is "holds ANY admin-area permission", and admin-area is computed by
// subtracting a hand-maintained list of non-admin permissions from the whole
// catalog. That means the DEFAULT for a newly added permission is "this opens
// the admin panel" — a footgun that is invisible at the call site and only
// shows up as a mentor wandering into the payments page.

const NON_ADMIN = ["mentor.panel", "investor.panel", "student.dashboard", "calls.invite"] as const;

test("the non-admin capabilities do not grant admin-area access", () => {
  for (const perm of NON_ADMIN) {
    const caps = capabilitiesFrom("custom", [perm]);
    assert.equal(
      canAccessAdmin(caps),
      false,
      `${perm} alone must not open /admin`,
    );
  }
});

test("calls.invite does not open the admin area", () => {
  // Called out on its own because migration 0059 grants it to the mentor and
  // investor roles. If it ever lands in ADMIN_AREA_PERMISSIONS, both roles
  // gain the entire admin panel the moment that migration runs.
  const mentor = capabilitiesFrom("mentor", ["mentor.panel", "calls.invite"]);
  assert.equal(canAccessAdmin(mentor), false);
  assert.equal(canViewAdminPath(mentor, "/admin/payments"), false);
  assert.equal(canViewAdminPath(mentor, "/admin/calls"), false);
  // …but they DO hold the capability itself, which is what /mentor/calls checks.
  assert.equal(can(mentor, "calls.invite"), true);
});

test("an admin-area permission does open the admin area", () => {
  const caps = capabilitiesFrom("ops", ["payments.view"]);
  assert.equal(canAccessAdmin(caps), true);
  assert.equal(canViewAdminPath(caps, "/admin/payments"), true);
  // …but only the page it names.
  assert.equal(canViewAdminPath(caps, "/admin/roles"), false);
});

test("the wildcard reaches every admin route", () => {
  const caps = capabilitiesFrom("admin", ["*"]);
  assert.equal(canAccessAdmin(caps), true);
  for (const path of ["/admin", "/admin/calls", "/admin/roles", "/admin/payments"]) {
    assert.equal(canViewAdminPath(caps, path), true, path);
  }
});

test("a signed-out viewer reaches nothing", () => {
  assert.equal(canAccessAdmin(null), false);
  assert.equal(canViewAdminPath(null, "/admin"), false);
});

test("every permission is renderable at /admin/roles", () => {
  // A key missing from PERMISSION_GROUPS is a permission nobody can grant —
  // the module warns in dev, but a warning in a log is not a test.
  const missing = ALL_PERMISSIONS.filter((k) => !PERMISSION_BY_KEY.has(k));
  assert.deepEqual(missing, []);
});

test("admin-area permissions are exactly the catalog minus the non-admin set", () => {
  const expected = ALL_PERMISSIONS.filter(
    (p) => !(NON_ADMIN as readonly string[]).includes(p),
  );
  assert.deepEqual([...ADMIN_AREA_PERMISSIONS], expected);
});
