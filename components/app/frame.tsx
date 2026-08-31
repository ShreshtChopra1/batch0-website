import Link from "next/link";
import { TabBar, type Tab } from "./tab-bar";

/**
 * The chrome every screen in the installed app sits inside.
 *
 * The header is deliberately NOT part of this component even though it looks
 * like it belongs here. It lives in each page instead, because a Next layout
 * cannot know its child page's title, and threading one through would mean
 * either a context provider (a client boundary around the whole app, to render
 * a string) or a `usePathname` lookup table that silently goes stale the day
 * someone adds a route. A page rendering its own <AppHeader> is one line and
 * cannot drift. The header still sticks to the viewport from inside <main>,
 * since <main> is not a scroll container.
 *
 * Two measurements here are not decoration:
 *
 *   `pb-[calc(3.5rem+var(--safe-bottom)+1rem)]` on <main> — the tab bar is
 *   `fixed`, so it takes no layout space. 3.5rem is its height, the inset is the
 *   home indicator, and the extra 1rem stops the final row of a list from
 *   sitting flush against the bar. Change the bar's height and this must move
 *   with it.
 *
 *   `min-h-[100dvh]`, not `100vh` — on iOS Safari `vh` is the *largest* viewport
 *   height, so a full-height screen is always taller than what you can see and
 *   the page scrolls a little for no reason.
 *
 * `max-w-lg` throughout: this surface is designed for a phone and is not a
 * responsive re-flow of the desktop panels. On a tablet or a desktop browser it
 * stays a centred phone-width column rather than stretching into a layout
 * nobody designed — the full /dashboard and /admin remain the wide surfaces.
 */
export function AppShell({
  tabs,
  children,
}: {
  tabs: Tab[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-paper text-ink">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-lg pb-[calc(3.5rem+var(--safe-bottom)+1rem)]"
      >
        {children}
      </main>
      <TabBar tabs={tabs} />
    </div>
  );
}

/**
 * The per-screen header.
 *
 * `pt-[var(--safe-top)]` is required, not cosmetic: under `display: standalone`
 * there is no browser chrome above the document, so the OS status bar sits
 * directly on top of it and an un-inset title renders behind the clock.
 */
export function AppHeader({
  title,
  eyebrow,
  action,
}: {
  title: string;
  /** Small uppercase line above the title — cohort name, week, role. */
  eyebrow?: string;
  /** Optional control on the right of the header. */
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-px border-b border-line bg-paper/95 pt-[var(--safe-top)] backdrop-blur">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-ink-faint">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-0.5 truncate font-display text-2xl leading-none tracking-[-0.01em] text-ink">
            {title}
          </h2>
        </div>
        {action}
      </div>
    </header>
  );
}

/** The padded body under the header. Every screen wraps its content in this. */
export function AppBody({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pt-5">{children}</div>;
}

/** Section heading. Uppercase mono label over a hairline, matching the panels. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7 first:mt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-ink-faint">
          {title}
        </h3>
        {action && (
          <Link
            href={action.href}
            prefetch={false}
            className="press shrink-0 text-xs text-phosphor-ink hover:underline"
          >
            {action.label} →
          </Link>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The empty state. One sentence, no illustration, no call to action it can't honour. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-soft">
      {children}
    </p>
  );
}

/**
 * A big number with a label. Tapping it goes somewhere when there is somewhere
 * to go — a count with no destination stays a plain div rather than a link that
 * does nothing, which on a touch screen is indistinguishable from a broken one.
 */
export function Stat({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: "default" | "accent" | "warn";
}) {
  const valueTone =
    tone === "accent"
      ? "text-phosphor-ink"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-300"
        : "text-ink";
  const body = (
    <>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
        {label}
      </p>
      <p
        className={`mt-1.5 text-3xl font-semibold leading-none tracking-tight tabular-nums ${valueTone}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{hint}</p>}
    </>
  );
  const cls = "rounded-xl border border-line bg-wash px-4 py-3.5";
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link
      href={href}
      prefetch={false}
      className={`press block hover:border-ink/30 active:scale-[0.99] ${cls}`}
    >
      {body}
    </Link>
  );
}

/**
 * A list row. `href` makes the whole row the tap target rather than the label
 * inside it — on a phone, a 300px-wide row with a 60px hit area is the single
 * most common reason a screen feels broken.
 */
export function Row({
  label,
  value,
  meta,
  href,
  right,
  muted,
}: {
  label: string;
  value?: string;
  meta?: string;
  href?: string;
  right?: React.ReactNode;
  muted?: boolean;
}) {
  const body = (
    <div className="flex min-h-[54px] items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[15px] leading-tight ${
            muted ? "text-ink-soft" : "text-ink"
          }`}
        >
          {label}
        </p>
        {value && (
          <p className="mt-1 truncate text-[13px] leading-tight text-ink-soft">
            {value}
          </p>
        )}
        {meta && (
          <p className="mt-1 truncate font-mono text-[11px] tabular-nums text-ink-faint">
            {meta}
          </p>
        )}
      </div>
      {right}
    </div>
  );
  if (!href) return <div className="border-b border-line last:border-0">{body}</div>;
  return (
    <Link
      href={href}
      prefetch={false}
      className="press -mx-2 block border-b border-line px-2 last:border-0 active:bg-wash"
    >
      {body}
    </Link>
  );
}

/** Attention band — a fee due, a blocked student, funds wired. */
export function Alert({
  tone,
  title,
  children,
  action,
}: {
  tone: "warn" | "good" | "info";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const tones = {
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    info: "border-phosphor/30 bg-phosphor/[0.06] text-phosphor-ink",
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${tones[tone]}`}>
      <p className="text-[13px] font-medium">{title}</p>
      {children && (
        <div className="mt-1 text-[12px] leading-relaxed text-ink-soft">{children}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
