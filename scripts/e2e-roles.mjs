/**
 * End-to-end check of the role system against a running dev server.
 *
 *   npm run dev            # in another terminal
 *   npm run e2e-roles
 *
 * Creates two throwaway accounts (an intern and a full admin), mints real
 * Supabase sessions for them, and drives the app over HTTP as those users —
 * so this exercises the actual middleware, layout guards, and route handlers
 * rather than re-implementing the rules.
 *
 * The accounts are deleted in a finally block, including on failure.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("Missing Supabase env vars.");
  process.exit(1);
}

const projectRef = new URL(url).hostname.split(".")[0];
const COOKIE_NAME = `sb-${projectRef}-auth-token`;
const MAX_CHUNK = 3180;

const admHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

let failures = 0;
const created = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function createUser(email, password, role) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: admHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createUser ${email}: ${JSON.stringify(body)}`);
  created.push(body.id);
  // The on_auth_user_created trigger makes the profile; set the role on it.
  const patch = await fetch(`${url}/rest/v1/profiles?id=eq.${body.id}`, {
    method: "PATCH",
    headers: { ...admHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ role }),
  });
  const prof = await patch.json();
  if (!patch.ok) throw new Error(`set role: ${JSON.stringify(prof)}`);
  if (prof[0]?.role !== role) {
    throw new Error(`role did not stick for ${email}: ${JSON.stringify(prof)}`);
  }
  return body.id;
}

/** Sign in for real and encode the session the way @supabase/ssr expects. */
async function sessionCookie(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${JSON.stringify(session)}`);

  const value =
    "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");

  if (value.length <= MAX_CHUNK) return `${COOKIE_NAME}=${value}`;
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += MAX_CHUNK, n++) {
    parts.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX_CHUNK)}`);
  }
  return parts.join("; ");
}

/**
 * Invoke a Next.js server action directly over HTTP.
 *
 * This is the layer a page guard can't protect: server actions are their own
 * entry point, callable by anyone who knows the action id, so the id is
 * deliberately taken from the build manifest rather than clicked in a UI.
 */
async function callAction(cookie, path, actionId, args) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      cookie,
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
}

async function roleOf(userId) {
  const res = await fetch(`${url}/rest/v1/profiles?select=role&id=eq.${userId}`, {
    headers: admHeaders,
  });
  const rows = await res.json();
  return rows?.[0]?.role ?? null;
}

/** One request, no redirect following, so we can assert on the redirect itself. */
async function get(cookie, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const location = res.headers.get("location");
  const body =
    res.status === 200 && res.headers.get("content-type")?.includes("text")
      ? await res.text()
      : "";
  return {
    status: res.status,
    // Next emits absolute URLs in Location; compare on pathname only.
    to: location ? new URL(location, BASE).pathname : null,
    body,
  };
}

const stamp = process.env.E2E_STAMP ?? String(process.pid);
const INTERN_EMAIL = `e2e-intern-${stamp}@example.invalid`;
const ADMIN_EMAIL = `e2e-admin-${stamp}@example.invalid`;
const PASSWORD = "e2e-Test-Password-9271";

try {
  console.log(`\nBase URL: ${BASE}\nCreating throwaway accounts…\n`);
  await createUser(INTERN_EMAIL, PASSWORD, "intern");
  await createUser(ADMIN_EMAIL, PASSWORD, "admin");

  const intern = await sessionCookie(INTERN_EMAIL, PASSWORD);
  const admin = await sessionCookie(ADMIN_EMAIL, PASSWORD);

  // Sanity: the cookie actually authenticates. /login bounces signed-in users
  // to their role home, which also proves home_path resolution works.
  console.log("session + role home\n");
  const internLogin = await get(intern, "/login");
  check(
    "intern session is recognised, /login → /admin",
    internLogin.status === 307 && internLogin.to === "/admin",
    `${internLogin.status} → ${internLogin.to}`,
  );
  const adminLogin = await get(admin, "/login");
  check(
    "admin session is recognised, /login → /admin",
    adminLogin.status === 307 && adminLogin.to === "/admin",
    `${adminLogin.status} → ${adminLogin.to}`,
  );

  console.log("\nintern: pages the role grants\n");
  for (const path of [
    "/admin",
    "/admin/challenges",
    "/admin/resources",
    "/admin/events",
    "/admin/announcements",
    "/admin/students",
    "/admin/applications",
    "/admin/pulse",
  ]) {
    const r = await get(intern, path);
    check(`GET ${path} → 200`, r.status === 200, `${r.status}${r.to ? ` → ${r.to}` : ""}`);
  }

  console.log("\nintern: pages the role does NOT grant\n");
  for (const path of [
    "/admin/settings",
    "/admin/roles",
    "/admin/payments",
    "/admin/charges",
    "/admin/audit",
    "/admin/blog",
    "/admin/cohorts",
    "/admin/teams",
    "/admin/email/blast",
    "/admin/discord",
  ]) {
    const r = await get(intern, path);
    check(
      `GET ${path} → redirected to /admin`,
      r.status === 307 && r.to === "/admin",
      `${r.status}${r.to ? ` → ${r.to}` : ""}`,
    );
  }

  console.log("\nintern: other panels\n");
  const internDash = await get(intern, "/dashboard");
  check(
    "GET /dashboard → /admin (no student.dashboard)",
    internDash.status === 307 && internDash.to === "/admin",
    `${internDash.status} → ${internDash.to}`,
  );
  const internMentor = await get(intern, "/mentor");
  check(
    "GET /mentor → /admin (no mentor.panel)",
    internMentor.status === 307 && internMentor.to === "/admin",
    `${internMentor.status} → ${internMentor.to}`,
  );
  const internInvestor = await get(intern, "/investor");
  check(
    "GET /investor → /admin (no investor.panel)",
    internInvestor.status === 307 && internInvestor.to === "/admin",
    `${internInvestor.status} → ${internInvestor.to}`,
  );

  console.log("\nintern: sidebar reflects the permissions\n");
  const overview = await get(intern, "/admin");
  check("sidebar shows Challenges", overview.body.includes("Challenges"));
  check("sidebar shows Resources", overview.body.includes("Resources"));
  check("sidebar hides Roles & permissions", !overview.body.includes("Roles &amp; permissions"));
  check("sidebar hides Email blast", !overview.body.includes("Email blast"));
  check("sidebar hides Fees &amp; fines", !overview.body.includes("Fees &amp; fines"));
  check("sidebar hides Audit log", !overview.body.includes("Audit log"));
  check(
    "overview hides the Revenue tile (no payments.view)",
    !overview.body.includes("Revenue"),
  );
  check(
    'overview hides "View as" links the role cannot use',
    !overview.body.includes("Student view") && !overview.body.includes("Mentor view"),
  );

  console.log("\nintern: admin API routes\n");
  const exportPeople = await get(intern, "/api/admin/export/people");
  check(
    "GET /api/admin/export/people → 200 (has people.view)",
    exportPeople.status === 200,
    String(exportPeople.status),
  );
  for (const [path, why] of [
    ["/api/admin/export/payments", "payments.view"],
    ["/api/admin/export/charges", "charges.manage"],
    ["/api/admin/resend-domain", "settings.manage"],
  ]) {
    const r = await get(intern, path);
    check(`GET ${path} → 403 (no ${why})`, r.status === 403, String(r.status));
  }

  console.log("\nadmin: the wildcard still reaches everything\n");
  for (const path of [
    "/admin",
    "/admin/roles",
    "/admin/roles/new",
    "/admin/roles/intern",
    "/admin/settings",
    "/admin/payments",
    "/admin/audit",
  ]) {
    const r = await get(admin, path);
    check(`GET ${path} → 200`, r.status === 200, `${r.status}${r.to ? ` → ${r.to}` : ""}`);
  }

  const rolesPage = await get(admin, "/admin/roles");
  check("roles page lists the intern role", rolesPage.body.includes("Intern"));
  check("roles page lists the built-ins", rolesPage.body.includes("Mentor"));
  check(
    "roles page offers assignment by email",
    rolesPage.body.includes("Give someone a role"),
  );

  const internRolePage = await get(admin, "/admin/roles/intern");
  check(
    "intern detail page shows the editable form",
    internRolePage.body.includes("What they can do"),
  );
  check(
    "intern detail page shows a danger zone (deletable)",
    internRolePage.body.includes("Danger zone"),
  );

  const adminRolePage = await get(admin, "/admin/roles/admin");
  check(
    "admin role is protected from being narrowed",
    adminRolePage.body.includes("Full access") &&
      !adminRolePage.body.includes("Danger zone"),
  );

  console.log("\nadmin: sidebar is complete\n");
  const adminOverview = await get(admin, "/admin");
  for (const label of [
    "Roles &amp; permissions",
    "Email blast",
    "Audit log",
    "Fees &amp; fines",
  ]) {
    check(`sidebar shows ${label}`, adminOverview.body.includes(label));
  }
  check("overview shows the Revenue tile", adminOverview.body.includes("Revenue"));

  // ---------------------------------------------------------------------
  // Server actions.
  //
  // Page guards don't cover these — an action is reachable by anyone who can
  // POST its id. `changeUserRole` is the sharpest case available: it lives on
  // /admin/students, which the intern *can* load (people.view), but it
  // requires people.roles, which the intern does not have. So a rejection
  // here can only come from the action's own guard.
  //
  // Needs a production build, because dev and prod generate different action
  // ids; skipped automatically when the id can't be resolved.
  // ---------------------------------------------------------------------
  const candidates = (process.env.E2E_CHANGE_ROLE_ACTION ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    console.log(
      "\nserver actions\n\n  skip  set E2E_CHANGE_ROLE_ACTION to test the action layer\n",
    );
  } else {
    console.log("\nserver actions\n");
    const victimId = await createUser(
      `e2e-victim-${stamp}@example.invalid`,
      PASSWORD,
      "student",
    );

    // /admin/students exports two actions and their ids aren't labelled in
    // the manifest. Find changeUserRole by running the positive control as a
    // full admin and seeing which one actually moves the role.
    let actionId = null;
    for (const id of candidates) {
      await callAction(admin, "/admin/students", id, [victimId, "mentor"]);
      if ((await roleOf(victimId)) === "mentor") {
        actionId = id;
        break;
      }
    }
    check(
      "resolved the changeUserRole action id from the build manifest",
      !!actionId,
      actionId ? actionId.slice(0, 12) + "…" : `tried ${candidates.length}`,
    );

    if (actionId) {
      // Reset, then the real test: the intern can load /admin/students
      // (people.view) but must not be able to run this action (people.roles).
      await fetch(`${url}/rest/v1/profiles?id=eq.${victimId}`, {
        method: "PATCH",
        headers: admHeaders,
        body: JSON.stringify({ role: "student" }),
      });

      const denied = await callAction(intern, "/admin/students", actionId, [
        victimId,
        "admin",
      ]);
      const afterIntern = await roleOf(victimId);
      check(
        "intern calling changeUserRole is rejected",
        denied.status >= 400,
        `status ${denied.status}`,
      );
      check(
        "…and the target's role is unchanged in the database",
        afterIntern === "student",
        `role is now "${afterIntern}"`,
      );

      // Positive control, so the rejection above can't be a malformed request
      // failing for the wrong reason.
      const allowed = await callAction(admin, "/admin/students", actionId, [
        victimId,
        "intern",
      ]);
      const afterAdmin = await roleOf(victimId);
      check(
        "admin calling the same action succeeds",
        allowed.status < 400,
        `status ${allowed.status}`,
      );
      check(
        "…and the target's role actually changed",
        afterAdmin === "intern",
        `role is now "${afterAdmin}"`,
      );
    }
  }
} catch (err) {
  console.error("\nE2E run threw:", err);
  failures++;
} finally {
  console.log("\ncleanup\n");
  for (const id of created) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: admHeaders,
    });
    check(`deleted test user ${id.slice(0, 8)}…`, res.ok, res.ok ? "" : String(res.status));
  }
}

console.log(
  failures === 0 ? "\nAll end-to-end checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
