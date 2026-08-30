import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { getAllRoles } from "@/lib/roles";
import { can, covers } from "@/lib/permissions";
import { StudentsBulkList } from "./bulk-list";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Role } from "@/lib/types";

export const metadata = { title: "People · Admin" };
// Without this the router cache can serve a stale RSC payload when an
// admin navigates back to /admin/students after enrolling/disabling
// users — they'd see a partial list until a hard reload refreshed it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 100;

function parsePage(raw: string | undefined): number {
  const n = Number(raw ?? "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: { role?: string; page?: string };
}) {
  const { caps } = await requirePermission("people.view");
  const admin = createAdminClient();

  // Filter tabs come from the roles table, so a role created at /admin/roles
  // shows up here — with its own tab and count — without a code change.
  const roles = await getAllRoles();
  const filter =
    searchParams.role && roles.some((r) => r.slug === searchParams.role)
      ? searchParams.role
      : "all";
  const page = parsePage(searchParams.page);
  const offset = (page - 1) * PAGE_SIZE;

  // Paged rather than a one-shot 5000-row fetch: the directory grows without
  // bound and every row used to ride the RSC payload into the client list.
  // count:'exact' drives the pager; role filtering stays in SQL.
  let q = admin
    .from("profiles")
    .select(
      "id, email, full_name, role, created_at, applications!applications_user_id_fkey(status), enrollments!enrollments_user_id_fkey(cohort_id, cohort:cohorts(name))",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (filter !== "all") q = q.eq("role", filter);

  // Tab counts are head-only count queries — one per role plus the "all"
  // total — so no profile rows are transferred just to be counted, and all
  // of them ride alongside the page query instead of after it.
  const [
    { data: profiles, count: filteredCount },
    { count: allCount },
    roleCounts,
  ] = await Promise.all([
    q,
    admin.from("profiles").select("id", { count: "exact", head: true }),
    Promise.all(
      roles.map((r) =>
        admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", r.slug),
      ),
    ),
  ]);
  const countBySlug = new Map(
    roles.map((r, i) => [r.slug, roleCounts[i].count ?? 0]),
  );
  const roleCount = (slug: string) => countBySlug.get(slug) ?? 0;

  const totalCount = filteredCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Role tab links carry no page param, so switching tabs lands on page 1.
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("role", filter);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/students?${qs}` : "/admin/students";
  };

  // Assignable roles are capped by what the viewer holds — the same rule the
  // server action enforces, surfaced early so the picker never offers an
  // option that would be rejected.
  const canChangeRoles = can(caps, "people.roles");
  const roleOptions = roles
    .filter((r) => covers(caps, r.permissions))
    .map((r) => ({ slug: r.slug, label: r.label, color: r.color }));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-ink">People</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {canChangeRoles ? (
              <>
                Everyone with an account. Change a role inline to grant or
                revoke access — no application needed.{" "}
                <Link
                  href="/admin/roles"
                  className="text-phosphor-ink hover:underline"
                >
                  Manage roles →
                </Link>
              </>
            ) : (
              <>Everyone with an account.</>
            )}
          </p>
        </div>
        <a
          href="/api/admin/export/people"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-wash px-3 py-1.5 text-xs font-medium text-ink hover:border-ink/30 hover:bg-ink/[0.04]"
        >
          Export CSV
        </a>
      </div>

      {/* Role tabs with counts */}
      <div className="mt-6 flex flex-wrap gap-2">
        {[{ slug: "all", label: "All" }, ...roles].map((f) => {
          const active = filter === f.slug;
          const count = f.slug === "all" ? allCount ?? 0 : roleCount(f.slug);
          // Hide empty tabs for custom roles so the row doesn't grow a tail of
          // zeroes; the built-ins always show so their absence isn't confusing.
          const isBuiltIn =
            f.slug === "all" || roles.find((r) => r.slug === f.slug)?.is_system;
          if (!isBuiltIn && count === 0 && !active) return null;
          return (
            <Link
              key={f.slug}
              href={
                f.slug === "all"
                  ? "/admin/students"
                  : `/admin/students?role=${f.slug}`
              }
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider transition ${
                active
                  ? "border-phosphor/30 bg-phosphor/10 text-phosphor-ink"
                  : "border-line text-ink-soft hover:border-ink/30 hover:text-ink"
              }`}
            >
              {f.label} · {count}
            </Link>
          );
        })}
      </div>

      <Card className="mt-6 !p-0 overflow-hidden">
        <StudentsBulkList
          canChangeRoles={canChangeRoles}
          roleOptions={roleOptions}
          rows={(profiles ?? []).map((p: any) => {
            const latestApp = (p.applications ?? [])[0];
            const enrollment = (p.enrollments ?? [])[0];
            const cohort = Array.isArray(enrollment?.cohort)
              ? enrollment?.cohort[0]
              : enrollment?.cohort;
            return {
              id: p.id,
              email: p.email,
              full_name: p.full_name,
              role: p.role as Role,
              created_at: p.created_at,
              latest_app_status: latestApp?.status ?? null,
              cohort_name: cohort?.name ?? null,
            };
          })}
        />
      </Card>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-xs text-ink-soft">
        <span>
          Page {page} of {totalPages} · showing{" "}
          {Math.min(offset + 1, totalCount)}–
          {Math.min(offset + PAGE_SIZE, totalCount)}
        </span>
        <div className="flex gap-1">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 hover:bg-wash"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-ink-faint">
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </span>
          )}
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 hover:bg-wash"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-ink-faint">
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
