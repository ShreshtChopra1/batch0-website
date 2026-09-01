/**
 * Centralized env helpers. Returns undefined for optional services so
 * the app keeps working when integrations aren't configured yet.
 */
export const env = {
  siteUrl:
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://batch0.org",
  contactEmail:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@batch0.org",

  // Supabase (required)
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,

  // Stripe (required for payment flow)
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

  // Optional integrations — code that uses them must no-op when unset.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  cronSecret: process.env.CRON_SECRET,

  // Email (Resend). Optional — the app falls back to a console-log stub
  // when these aren't set, so local dev keeps working without a key.
  resendApiKey: process.env.RESEND_API_KEY,
  // The verified `From:` address Resend sends as. Must be on a domain
  // verified in the Resend dashboard — batch0.org is, and its DKIM
  // (resend._domainkey), SPF and the send.batch0.org MX are all published.
  // The default is the real address rather than onboarding@resend.dev so a
  // missing env var degrades to "correct sender" instead of "email from a
  // stranger's domain".
  resendFrom: process.env.RESEND_FROM ?? "batch0 <hello@batch0.org>",
  // Svix signing secret from the Resend webhooks dashboard. Looks like
  // "whsec_xxx". When unset, /api/resend/webhook returns 400 — we
  // refuse to ingest unsigned events because the table is service-role
  // writable and an open endpoint would be a denial-of-service vector.
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,

  // Daily (live video — webinars and 1:1 calls). Optional: every helper in
  // lib/daily.ts no-ops when unset, so an environment without a key degrades
  // to "hosting unavailable" and the rest of the site is unaffected.
  //
  // dailyApiKey is server-only and must NEVER gain a NEXT_PUBLIC_ prefix. It
  // can create rooms and mint owner tokens for ANY room on the domain, so in
  // the browser it is a key to every call the site will ever host — including
  // 1:1s it was not issued for.
  dailyApiKey: process.env.DAILY_API_KEY,
  // The domain rooms live on, e.g. "batch0.daily.co". Public by design: it
  // appears in every room URL the client connects to. On its own it grants
  // nothing, because rooms are private and joining needs a minted token.
  dailyDomain: process.env.NEXT_PUBLIC_DAILY_DOMAIN,
  // Cloud recording is a PAID Daily feature — a free plan rejects room and
  // token creation outright if `enable_recording: "cloud"` is set. Off by
  // default so webinars work on any plan; set DAILY_ENABLE_RECORDING=true once
  // the account is on a plan that includes recording, and hosts can record.
  dailyRecording: process.env.DAILY_ENABLE_RECORDING === "true",

  discordBotToken: process.env.DISCORD_BOT_TOKEN,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  discordRoleStudent: process.env.DISCORD_ROLE_STUDENT,
  discordAnnouncementsWebhook: process.env.DISCORD_ANNOUNCEMENTS_WEBHOOK,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
  // Hex-encoded Ed25519 public key from the Discord developer portal —
  // used to verify Interaction (slash command) requests.
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY,
} as const;

export function ensure(key: keyof typeof env, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
