import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  createAdminClient,
  createPublicReadClient,
} from "@/lib/supabase/admin";
import { getRegionalPrice } from "@/lib/pricing";

// Single source of truth for public, admin-editable site facts (active
// cohort + branding). The admin can change anything here from
// /admin/cohorts or /admin/settings and every page that reads via these
// helpers will reflect it on the next request.

export type ActiveCohort = {
  id: string;
  name: string;
  cohortNumber: number | null;
  startsOn: string | null;
  endsOn: string | null;
  capacity: number;
  priceCents: number;
  status: string;
  applicationsCloseAt: string | null;
};

export type SiteSettings = {
  contactEmail: string;
  discordUrl: string;
  applicationsOpen: boolean;
  applicationsClosedMessage: string;
  demoDayDate: string | null;
  maintenanceMode: boolean;
  referralsEnabled: boolean;
  /**
   * Whether a founder pass holder may apply while `applicationsOpen` is false.
   *
   * Exists because `applicationsOpen` conflates two different states: "not
   * open to the public yet" and "closed for good". Early access is only
   * meaningful in the first, so this is the admin's switch for the pre-launch
   * window — on before launch, off once the cohort genuinely ends. Without it
   * the pass would be a permanent way into a finished cohort.
   */
  founderPassEarlyAccess: boolean;
};

export type SiteConfig = {
  cohort: ActiveCohort | null;
  settings: SiteSettings;
  // Derived fields for marketing surfaces.
  derived: {
    /** "Cohort 1" — falls back to "" if no number is set. */
    cohortLabel: string;
    /** "Fall 2026" — the cohort's name (season label). */
    cohortName: string;
    /** "Cohort 1 · Fall 2026" — combined label with separator. */
    cohortHeadline: string;
    /** "Jun 15 → Jul 13" — date range, or "" if dates are missing. */
    dateRangeLabel: string;
    /** "97" — integer-rounded dollar price (no $ prefix), regional. */
    priceDollars: string;
    /** "$97" — convenience formatted price for the visitor's region. */
    priceLabel: string;
    /** Price in cents the visitor will actually be charged. */
    priceCents: number;
    /** Default (non-regional) price label, e.g. "$130". */
    basePriceLabel: string;
    /** True when the visitor's region has a price override applied. */
    isRegionalPrice: boolean;
    /** ISO-3166-1 alpha-2 country code we resolved for this visitor. */
    country: string | null;
    /** Capacity as a string, e.g. "24". */
    capacityLabel: string;
    /**
     * Number of enrolled students in the active cohort, or 0 when there
     * isn't one yet. Resolved at request time so the landing page can
     * show a live "X of N spots filled" signal without admins touching
     * anything.
     */
    enrolledCount: number;
    /** Remaining capacity. Floored at 0 even if enrollment overshoots. */
    spotsLeft: number;
    /**
     * "8 of 24 spots filled" / "Cohort full" / "" (when no cohort).
     * Empty string when the data isn't meaningful to show.
     */
    spotsLabel: string;
    /**
     * "Applications close in 4 days" / "Apply by Jun 1" / "" depending on
     * whether the active cohort has an explicit close date and how far
     * out it is. Empty when there's no signal worth showing.
     */
    applicationsCountdownLabel: string;
  };
};

const FALLBACK_SETTINGS: SiteSettings = {
  contactEmail: "hello@batch0.org",
  discordUrl: "",
  applicationsOpen: true,
  applicationsClosedMessage:
    "Applications are currently closed. Check back soon for the next cohort.",
  demoDayDate: null,
  maintenanceMode: false,
  referralsEnabled: true,
  // Fails CLOSED, unlike the other fallbacks here. If Supabase is unreachable
  // we must not hand pass holders a way past a closed applications gate on the
  // strength of a guess — "no early access" is the state that can't be wrong
  // in a damaging direction.
  founderPassEarlyAccess: false,
};

// Mirrors the real Cohort 1 row so a Supabase outage can't make the marketing
// site display stale facts.
//
// This only helps if it actually matches the row — it had drifted to the
// cohort's original Jul 30 → Sep 13 dates while the real row moved to
// Aug 17 → Oct 18, so an outage would have shown dates 5 weeks out of date.
// Re-check these against /admin/cohorts whenever the cohort row changes.
// Last verified against the DB: 2026-07-16.
const FALLBACK_COHORT: ActiveCohort = {
  id: "",
  name: "Fall 2026",
  cohortNumber: 1,
  startsOn: "2026-08-17",
  endsOn: "2026-10-18",
  capacity: 50,
  priceCents: 12999,
  status: "upcoming",
  applicationsCloseAt: "2026-08-10T23:59:00+00:00",
};

function formatDateRange(startsOn: string | null, endsOn: string | null) {
  if (!startsOn || !endsOn) return "";
  // Render in US locale, short month, no year (the cohort name carries the
  // year). Parse as UTC midnight so a 2026-06-15 string doesn't shift due
  // to the server's timezone.
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  return `${fmt(startsOn)} → ${fmt(endsOn)}`;
}

function derive(
  cohort: ActiveCohort | null,
  enrolledCount: number,
  applicationsOpen: boolean,
  countryCode: string | null,
): SiteConfig["derived"] {
  const c = cohort ?? FALLBACK_COHORT;
  const cohortLabel =
    c.cohortNumber != null ? `Cohort ${c.cohortNumber}` : "";
  const cohortName = c.name;
  const cohortHeadline = cohortLabel
    ? `${cohortLabel} · ${cohortName}`
    : cohortName;
  const baseCents = c.priceCents ?? 0;
  const regional = getRegionalPrice(baseCents, countryCode);
  const dollars = Math.round(regional.amountCents / 100);
  const baseDollars = Math.round(baseCents / 100);

  const spotsLeft = Math.max(0, (c.capacity ?? 0) - enrolledCount);
  let spotsLabel = "";
  if (cohort && c.capacity > 0) {
    if (spotsLeft === 0) {
      spotsLabel = "Cohort full";
    } else if (spotsLeft < 10) {
      // Only surface the count when it creates real urgency — single
      // digits left. Above that, an early-cohort "20 of 24 spots left"
      // reads like there's no demand, which isn't the message we want.
      spotsLabel = `${spotsLeft} spots left`;
    }
  }

  // Countdown only fires when applications are open AND we have a real
  // close date AND it's in the future-but-not-too-far. Past that
  // horizon the label drops to "Apply by <date>" which is calmer.
  let applicationsCountdownLabel = "";
  if (applicationsOpen && cohort && c.applicationsCloseAt) {
    const close = new Date(c.applicationsCloseAt);
    const ms = close.getTime() - Date.now();
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days <= 0) {
      applicationsCountdownLabel = "Applications closed";
    } else if (days === 1) {
      applicationsCountdownLabel = "Applications close in 1 day";
    } else if (days <= 14) {
      applicationsCountdownLabel = `Applications close in ${days} days`;
    } else {
      const label = close.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      applicationsCountdownLabel = `Apply by ${label}`;
    }
  }

  return {
    cohortLabel,
    cohortName,
    cohortHeadline,
    dateRangeLabel: formatDateRange(c.startsOn, c.endsOn),
    priceDollars: String(dollars),
    priceLabel: `$${dollars}`,
    priceCents: regional.amountCents,
    basePriceLabel: `$${baseDollars}`,
    isRegionalPrice: regional.isRegional,
    country: regional.country,
    capacityLabel: String(c.capacity),
    enrolledCount,
    spotsLeft,
    spotsLabel,
    applicationsCountdownLabel,
  };
}

/**
 * Resolve the public site config. Reads `site_settings` and the "active"
 * cohort (admin-pinned, or the next upcoming/active one) in a single
 * round-trip. Always returns a config — never throws — so callers don't
 * need to guard the marketing site against a Supabase outage.
 *
 * Pass `countryCode` (ISO-3166-1 alpha-2) to apply regional tuition
 * pricing — see `lib/pricing.ts`. When omitted, the cohort's default
 * price is used.
 */
/**
 * Request-cached, but NOT cached across requests: this still reads through
 * the no-store admin client, because the gating flags it carries
 * (`applications_open`, `founder_pass_early_access`, `referrals_enabled`)
 * decide what a signed-in person is allowed to do and must never be stale.
 *
 * The React cache matters because the /dashboard tree resolves this twice in
 * one render — once in the layout for `referralsEnabled`, once in the page —
 * and without it each resolution would repeat the same queries.
 */
const loadPrivateData = cache(() => loadSiteConfigData(createAdminClient()));

export async function getSiteConfig(
  opts: { countryCode?: string | null } = {},
): Promise<SiteConfig> {
  return assemble(await loadPrivateData(), opts.countryCode ?? null);
}

/**
 * The same config, read through a cacheable client and memoised across
 * requests. This is what public marketing pages call.
 *
 * Two things have to be true at once for a marketing page to prerender, and
 * this function is one of them (the other is not touching cookies()):
 *
 *  1. The read must not be `no-store` — hence createPublicReadClient(). Do NOT
 *     "fix" this by wrapping the no-store client in unstable_cache: the route
 *     then prerenders, the DynamicServerError is thrown onto a *copy* of the
 *     static-generation store where nothing reads it, postgrest swallows it as
 *     a failed request, and getSiteConfig quietly returns FALLBACK_COHORT. You
 *     get a green build serving hardcoded prices with the "N spots left" and
 *     "Applications close in N days" signals silently gone.
 *  2. unstable_cache gives it a tag, so an admin editing settings or a cohort
 *     publishes immediately instead of waiting out `revalidate`. See
 *     revalidateTag(SITE_CONFIG_TAG) in the admin actions.
 *
 * Country is applied per-request on top of the cached data — `derive()` is
 * pure, so regional pricing costs nothing and isn't baked into the cache.
 */
export const SITE_CONFIG_TAG = "site-config";

const loadPublicData = unstable_cache(
  async () => loadSiteConfigData(createPublicReadClient()),
  ["site-config-public"],
  { revalidate: 300, tags: [SITE_CONFIG_TAG] },
);

export async function getPublicSiteConfig(
  opts: { countryCode?: string | null } = {},
): Promise<SiteConfig> {
  const data = await loadPublicData();
  if (!data.cohort && process.env.NODE_ENV === "production") {
    // Loud on purpose. A null cohort here means the marketing site is serving
    // FALLBACK_COHORT — dates and price hand-synced on a date in the past —
    // and every other symptom of that is invisible.
    console.error(
      "[site-config] public read returned no cohort; marketing pages are on FALLBACK_COHORT",
    );
  }
  return assemble(data, opts.countryCode ?? null);
}

type SiteConfigData = {
  cohort: ActiveCohort | null;
  settings: SiteSettings;
  enrolledCount: number;
};

function assemble(
  data: SiteConfigData,
  countryCode: string | null,
): SiteConfig {
  return {
    cohort: data.cohort,
    settings: data.settings,
    derived: derive(
      data.cohort,
      data.enrolledCount,
      data.settings.applicationsOpen,
      countryCode,
    ),
  };
}

async function loadSiteConfigData(
  admin: ReturnType<typeof createAdminClient>,
): Promise<SiteConfigData> {
  // One parallel wave. The unfiltered settings scan already carries the
  // active_cohort_id row, so the pinned id never needs a query of its own,
  // and the fallback cohort candidate (next upcoming/active by start date)
  // rides alongside with its enrollment count embedded. Only an admin pin
  // pointing somewhere other than that candidate costs a second trip.
  const [settingsRes, fallbackCohortRes] = await Promise.all([
    admin.from("site_settings").select("key, value"),
    admin
      .from("cohorts")
      .select("*, enrollments(count)")
      .in("status", ["upcoming", "active"])
      .order("starts_on", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const raw: Record<string, any> = {};
  for (const r of settingsRes.data ?? []) raw[r.key] = r.value;

  const settings: SiteSettings = {
    contactEmail:
      typeof raw.contact_email === "string"
        ? raw.contact_email
        : FALLBACK_SETTINGS.contactEmail,
    discordUrl:
      typeof raw.discord_url === "string"
        ? raw.discord_url
        : FALLBACK_SETTINGS.discordUrl,
    applicationsOpen:
      typeof raw.applications_open === "boolean"
        ? raw.applications_open
        : FALLBACK_SETTINGS.applicationsOpen,
    applicationsClosedMessage:
      typeof raw.applications_closed_message === "string"
        ? raw.applications_closed_message
        : FALLBACK_SETTINGS.applicationsClosedMessage,
    demoDayDate:
      typeof raw.demo_day_date === "string" ? raw.demo_day_date : null,
    maintenanceMode:
      typeof raw.maintenance_mode === "boolean"
        ? raw.maintenance_mode
        : FALLBACK_SETTINGS.maintenanceMode,
    referralsEnabled:
      typeof raw.referrals_enabled === "boolean"
        ? raw.referrals_enabled
        : FALLBACK_SETTINGS.referralsEnabled,
    founderPassEarlyAccess:
      typeof raw.founder_pass_early_access === "boolean"
        ? raw.founder_pass_early_access
        : FALLBACK_SETTINGS.founderPassEarlyAccess,
  };

  const pinnedId =
    typeof raw.active_cohort_id === "string"
      ? (raw.active_cohort_id as string)
      : null;

  // Resolve the active cohort: pinned id wins, otherwise the next
  // upcoming/active cohort by start date. We `select("*")` so the read
  // tolerates a missing `cohort_number` column — matches the pattern in
  // 0008_discord_integration where the app tolerates the migration
  // landing later than the code.
  function toCohort(data: any): ActiveCohort {
    return {
      id: data.id,
      name: data.name,
      cohortNumber:
        typeof data.cohort_number === "number" ? data.cohort_number : null,
      startsOn: data.starts_on,
      endsOn: data.ends_on,
      capacity: data.capacity,
      priceCents: data.price_cents,
      status: data.status,
      applicationsCloseAt:
        typeof data.applications_close_at === "string"
          ? data.applications_close_at
          : null,
    };
  }

  let cohortRow: any = fallbackCohortRes.data ?? null;
  if (pinnedId && pinnedId !== cohortRow?.id) {
    // A pin may point at a cohort of any status (that is the point of
    // pinning), so the upcoming/active candidate can't stand in for it.
    // A pin that resolves to nothing falls back to the candidate.
    const { data } = await admin
      .from("cohorts")
      .select("*, enrollments(count)")
      .eq("id", pinnedId)
      .maybeSingle();
    if (data) cohortRow = data;
  }
  const cohort = cohortRow ? toCohort(cohortRow) : null;

  // Live enrollment count, read off the embedded count(*) aggregate — no
  // per-row read. Reads as 0 (rather than erroring) when there's no
  // cohort or the embed is missing for any reason.
  const embeddedCount = cohortRow?.enrollments?.[0]?.count;
  const enrolledCount = typeof embeddedCount === "number" ? embeddedCount : 0;

  return { cohort, settings, enrolledCount };
}
