import { Resend } from "resend";
import { env } from "@/lib/env";

/**
 * Everything the Resend API will tell us about this account, pulled in one go.
 *
 * The webhook table (`email_events`) only knows what happened *after* someone
 * pointed Resend at our endpoint, and only for the event types that endpoint is
 * subscribed to. That leaves the two most common questions on this page
 * unanswerable from the database alone:
 *
 *   - "Is anything actually being delivered?" — answered here by the provider's
 *     own `last_event` per message, which exists whether or not a webhook does.
 *   - "Why are all the numbers zero?" — answered here by reading the domain's
 *     tracking flags and the webhook's subscribed events as *facts* instead of
 *     inferring them from an absence of rows.
 *
 * Every call is optional. A missing key, a plan that doesn't expose an
 * endpoint, a network blip — each degrades to an entry in `errors` and the rest
 * of the page renders. Nothing in here is allowed to take the metrics page down;
 * it is a dashboard, not a checkout.
 */

const TIMEOUT_MS = 8_000;
const CACHE_MS = 60_000;
/** 100 per page is the API maximum; ten pages is a month of our volume. */
const EMAIL_PAGE_SIZE = 100;
const EMAIL_MAX_PAGES = 10;
/** How far back the funnel can see. Shown to the reader when it's the binding limit. */
export const EMAIL_PAGE_CAP = EMAIL_PAGE_SIZE * EMAIL_MAX_PAGES;

export type ProviderEmail = {
  id: string;
  created_at: string;
  from: string;
  to: string[];
  subject: string;
  last_event: string;
  scheduled_at: string | null;
};

export type DomainInsight = {
  id: string;
  name: string;
  status: string;
  region: string;
  created_at: string;
  openTracking: boolean | null;
  clickTracking: boolean | null;
  trackingSubdomain: string | null;
  sending: string | null;
  receiving: string | null;
  records: {
    record: string;
    name: string;
    type: string;
    status: string;
    value: string;
    priority?: number;
  }[];
};

export type WebhookInsight = {
  id: string;
  endpoint: string;
  status: string;
  events: string[];
  createdAt: string;
  /** True when this endpoint points back at this deployment. */
  isOurs: boolean;
};

export type BroadcastInsight = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  sentAt: string | null;
};

export type ApiCallInsight = {
  id: string;
  created_at: string;
  endpoint: string;
  method: string;
  status: number;
};

export type SegmentInsight = { id: string; name: string; createdAt: string; contacts: number | null };

export type ResendInsights = {
  available: boolean;
  /** Why there is no data, when there isn't any. */
  reason: string | null;
  fetchedAt: string;
  domains: DomainInsight[];
  webhooks: WebhookInsight[];
  emails: ProviderEmail[];
  /** True when the account has more mail than we paged through. */
  emailsTruncated: boolean;
  broadcasts: BroadcastInsight[];
  apiCalls: ApiCallInsight[];
  segments: SegmentInsight[];
  errors: { source: string; message: string }[];
};

const EMPTY = (reason: string | null): ResendInsights => ({
  available: false,
  reason,
  fetchedAt: new Date().toISOString(),
  domains: [],
  webhooks: [],
  emails: [],
  emailsTruncated: false,
  broadcasts: [],
  apiCalls: [],
  segments: [],
  errors: [],
});

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)),
        TIMEOUT_MS,
      ),
    ),
  ]);
}

function message(err: unknown): string {
  if (err && typeof err === "object" && "message" in err)
    return String((err as any).message);
  return String(err);
}

/**
 * The Resend SDK returns `{ data, error }` for API-level failures and throws
 * for transport ones. Collapse both into "value or a recorded error" so a
 * single dead endpoint can't reject the whole `Promise.all`.
 */
async function attempt<T>(
  source: string,
  errors: { source: string; message: string }[],
  run: () => Promise<{ data: T | null; error: { message: string } | null }>,
): Promise<T | null> {
  try {
    const { data, error } = await withTimeout(run(), source);
    if (error) {
      errors.push({ source, message: error.message });
      return null;
    }
    return data;
  } catch (err) {
    errors.push({ source, message: message(err) });
    return null;
  }
}

let cache: { at: number; value: ResendInsights } | null = null;
/**
 * In-flight dedupe. The metrics page renders half a dozen independent Suspense
 * boundaries off this one call; without this they all miss the cache in the
 * same tick and fire six identical fans of API requests, which is both slow and
 * a good way to meet Resend's rate limiter.
 */
let pending: Promise<ResendInsights> | null = null;

/** Drop the cache — used by the page's refresh action. */
export function invalidateResendInsights() {
  cache = null;
}

export async function getResendInsights(): Promise<ResendInsights> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (pending) return pending;
  pending = loadResendInsights()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function loadResendInsights(): Promise<ResendInsights> {
  if (!env.resendApiKey)
    return EMPTY(
      "RESEND_API_KEY isn't set in this environment, so nothing can be read back from the provider.",
    );

  const resend = new Resend(env.resendApiKey);
  const errors: { source: string; message: string }[] = [];

  const [domainList, webhookList, emails, broadcastList, logList, segmentList] =
    await Promise.all([
      attempt("domains", errors, () => resend.domains.list() as any),
      attempt("webhooks", errors, () => resend.webhooks.list() as any),
      listAllEmails(resend, errors),
      attempt("broadcasts", errors, () => resend.broadcasts.list() as any),
      attempt("logs", errors, () => resend.logs.list({ limit: 100 }) as any),
      attempt("segments", errors, () => resend.segments.list() as any),
    ]);

  // The list endpoint omits DNS records and the tracking flags — the two things
  // this page most needs — so each domain is re-fetched individually. There is
  // one sending domain in practice; the cap is there so a shared key belonging
  // to an account with fifty of them doesn't turn one page load into fifty
  // round trips.
  const domains: DomainInsight[] = [];
  for (const d of ((domainList as any)?.data ?? []).slice(0, 10)) {
    const detail = await attempt(`domain:${d.name}`, errors, () =>
      resend.domains.get(d.id) as any,
    );
    const src: any = detail ?? d;
    domains.push({
      id: src.id,
      name: src.name,
      status: src.status,
      region: src.region,
      created_at: src.created_at,
      openTracking: src.open_tracking ?? null,
      clickTracking: src.click_tracking ?? null,
      trackingSubdomain: src.tracking_subdomain ?? null,
      sending: src.capabilities?.sending ?? null,
      receiving: src.capabilities?.receiving ?? null,
      records: (src.records ?? []).map((r: any) => ({
        record: r.record,
        name: r.name,
        type: r.type,
        status: r.status,
        value: r.value,
        priority: r.priority,
      })),
    });
  }

  // Match on host rather than the full URL: preview deployments and the custom
  // domain are the same endpoint as far as "is this ours" goes, and a trailing
  // slash shouldn't decide whether the page says the webhook is wired up.
  let ourHost = "";
  try {
    ourHost = new URL(env.siteUrl).host;
  } catch {
    /* siteUrl is misconfigured; every webhook simply reads as third-party */
  }

  const webhooks: WebhookInsight[] = ((webhookList as any)?.data ?? []).map(
    (w: any) => {
      let host = "";
      try {
        host = new URL(w.endpoint).host;
      } catch {
        /* leave blank; a webhook with an unparseable endpoint isn't ours */
      }
      return {
        id: w.id,
        endpoint: w.endpoint,
        status: w.status,
        events: w.events ?? [],
        createdAt: w.created_at,
        isOurs: Boolean(host) && host === ourHost,
      };
    },
  );

  const broadcasts: BroadcastInsight[] = ((broadcastList as any)?.data ?? [])
    .map((b: any) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      createdAt: b.created_at,
      scheduledAt: b.scheduled_at ?? null,
      sentAt: b.sent_at ?? null,
    }))
    .sort((a: BroadcastInsight, b: BroadcastInsight) =>
      (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt),
    );

  const apiCalls: ApiCallInsight[] = ((logList as any)?.data ?? []).map(
    (l: any) => ({
      id: l.id,
      created_at: l.created_at,
      endpoint: l.endpoint,
      method: l.method,
      status: l.response_status,
    }),
  );

  const segments: SegmentInsight[] = [];
  for (const s of ((segmentList as any)?.data ?? []).slice(0, 10)) {
    // Contact counts aren't in the segment payload, so this is a head-count by
    // pagination. Capped at one page: the exact size of a 5,000-person list is
    // not worth fifty requests on a dashboard render, and "100+" says enough.
    const page = await attempt(`segment:${s.name}`, errors, () =>
      resend.contacts.list({ segmentId: s.id, limit: 100 }) as any,
    );
    segments.push({
      id: s.id,
      name: s.name,
      createdAt: s.created_at,
      contacts: page ? ((page as any).data?.length ?? 0) : null,
    });
  }

  return {
    // "Available" means we got a usable answer out of the provider — not that
    // every endpoint worked. An account on a plan without the Logs API should
    // still see its domains and its delivery funnel.
    available: domains.length > 0 || emails.rows.length > 0 || webhooks.length > 0,
    reason:
      domains.length === 0 && emails.rows.length === 0 && webhooks.length === 0
        ? errors[0]?.message ??
          "The API key is set, but this account has no domains, webhooks, or sent mail."
        : null,
    fetchedAt: new Date().toISOString(),
    domains,
    webhooks,
    emails: emails.rows,
    emailsTruncated: emails.truncated,
    broadcasts,
    apiCalls,
    segments,
    errors,
  };
}

/**
 * Pages through `emails.list()` newest-first.
 *
 * Stops at the page boundary rather than at a date, because the endpoint has no
 * date filter — trimming to the window is the caller's job. Bailing out on the
 * first failed page keeps a partial result instead of losing the pages that did
 * come back.
 */
async function listAllEmails(
  resend: Resend,
  errors: { source: string; message: string }[],
): Promise<{ rows: ProviderEmail[]; truncated: boolean }> {
  const rows: ProviderEmail[] = [];
  let after: string | undefined;
  let truncated = false;

  for (let page = 0; page < EMAIL_MAX_PAGES; page++) {
    const data = await attempt<any>(
      page === 0 ? "emails" : `emails:page${page + 1}`,
      errors,
      () =>
        resend.emails.list(
          after ? { limit: EMAIL_PAGE_SIZE, after } : { limit: EMAIL_PAGE_SIZE },
        ) as any,
    );
    if (!data) break;
    const batch = data.data ?? [];
    for (const e of batch) {
      rows.push({
        id: e.id,
        created_at: e.created_at,
        from: e.from,
        to: e.to ?? [],
        subject: e.subject,
        last_event: e.last_event,
        scheduled_at: e.scheduled_at ?? null,
      });
    }
    if (!data.has_more || batch.length === 0) break;
    after = batch[batch.length - 1]?.id;
    if (!after) break;
    if (page === EMAIL_MAX_PAGES - 1) truncated = true;
  }
  return { rows, truncated };
}

/**
 * The provider-side funnel: how many messages are currently in each state,
 * according to Resend rather than according to our webhook.
 *
 * `last_event` is a single current status, not a history — a message that was
 * delivered and then opened reports only "opened". So the funnel is cumulative:
 * anything opened was also delivered, anything delivered was also sent.
 */
export type ProviderFunnel = {
  total: number;
  byStatus: { status: string; count: number }[];
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  problems: number;
  windowStart: string | null;
};

const DOWNSTREAM_OF_DELIVERED = new Set(["delivered", "opened", "clicked", "complained"]);
const PROBLEM_STATES = new Set([
  "bounced",
  "failed",
  "complained",
  "suppressed",
  "canceled",
]);

export function providerFunnel(
  emails: ProviderEmail[],
  sinceIso?: string,
): ProviderFunnel {
  const rows = sinceIso
    ? emails.filter((e) => e.created_at >= sinceIso)
    : emails;

  const counts = new Map<string, number>();
  let queued = 0,
    delivered = 0,
    opened = 0,
    clicked = 0,
    problems = 0;

  for (const e of rows) {
    counts.set(e.last_event, (counts.get(e.last_event) ?? 0) + 1);
    if (e.last_event === "queued" || e.last_event === "scheduled") queued++;
    if (DOWNSTREAM_OF_DELIVERED.has(e.last_event)) delivered++;
    if (e.last_event === "opened" || e.last_event === "clicked") opened++;
    if (e.last_event === "clicked") clicked++;
    if (PROBLEM_STATES.has(e.last_event)) problems++;
  }

  return {
    total: rows.length,
    byStatus: Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    queued,
    // "Left Resend" excludes everything that never reached a mail server:
    // still waiting (queued/scheduled), cancelled before it went, rejected by
    // Resend (failed), or blocked by the suppression list. A bounce, by
    // contrast, *was* sent — the receiving server rejected it afterwards.
    sent: rows.filter(
      (e) =>
        !["queued", "scheduled", "canceled", "failed", "suppressed"].includes(
          e.last_event,
        ),
    ).length,
    delivered,
    opened,
    clicked,
    problems,
    windowStart: rows.length
      ? rows.reduce((min, e) => (e.created_at < min ? e.created_at : min), rows[0].created_at)
      : null,
  };
}

/** The event types this page's numbers depend on. */
export const REQUIRED_WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
] as const;

/** Nice to have — they power the failure and delay panels. */
export const OPTIONAL_WEBHOOK_EVENTS = [
  "email.failed",
  "email.delivery_delayed",
  "email.suppressed",
] as const;
