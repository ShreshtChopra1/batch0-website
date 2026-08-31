"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  PlayCircle,
  CheckCircle,
  MoreHorizontal,
  LayoutDashboard,
  Inbox,
  Users,
} from "lucide-react";

/**
 * Every icon the two tab bars use, keyed by name.
 *
 * A named map rather than `import * as Icons from "lucide-react"`: the
 * namespace import is a barrel, and in a client component it drags the whole
 * icon set into the bundle because nothing can tree-shake a dynamic
 * `Icons[name]` lookup. This is the app's most-loaded component; it ships seven
 * icons.
 *
 * Passing the component itself down from the server layout would be the other
 * option, and is what lib/nav-config.ts does — but that couples the tab list to
 * a client-boundary rule that is easy to violate silently. A string key cannot
 * be got wrong at runtime without TypeScript saying so first.
 */
const ICONS = {
  Home,
  PlayCircle,
  CheckCircle,
  MoreHorizontal,
  LayoutDashboard,
  Inbox,
  Users,
} as const;

export type TabIcon = keyof typeof ICONS;

export type Tab = {
  href: string;
  label: string;
  icon: TabIcon;
  /** Match only this exact path. Set on the section root, which is a prefix of
   *  every sibling and would otherwise light up permanently. */
  exact?: boolean;
  /** Small count on the icon — pending reviews, unread announcements. */
  badge?: number;
};

/**
 * The bottom tab bar. This is the single navigational element of the installed
 * app, so a few of its properties are load-bearing rather than stylistic:
 *
 *   - `fixed` + `pb-[var(--safe-bottom)]` keeps the row clear of the iPhone
 *     home indicator. Without the inset the last 34px of the bar sit under it
 *     and the middle tabs stop being tappable.
 *   - Targets are 56px tall, above the 44px floor, because this is used one-
 *     handed and often in a hurry.
 *   - `prefetch={false}`. next.config.js sets staleTimes.dynamic = 0, so a
 *     prefetch of an authenticated page is re-fetched on click anyway; with
 *     four tabs always on screen, leaving it on means every screen pays for
 *     four dynamic renders it will mostly throw away. Same reasoning as the
 *     authed sidebars.
 *
 * The layout is responsible for reserving the height (see AppFrame's bottom
 * padding) — a fixed bar over unpadded content hides the last item of any list.
 */
export function TabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[var(--safe-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(tab.href + "/");
          const Icon = ICONS[tab.icon];
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={`press flex h-14 select-none flex-col items-center justify-center gap-1 active:scale-[0.97] ${
                  active ? "text-phosphor-ink" : "text-ink-faint"
                }`}
              >
                <span className="relative">
                  <Icon className="h-[18px] w-[18px]" />
                  {!!tab.badge && tab.badge > 0 && (
                    <span className="absolute -right-2 -top-1.5 min-w-[15px] rounded-full bg-phosphor px-1 text-center font-mono text-[9px] font-semibold leading-[15px] text-on-phosphor">
                      {tab.badge > 99 ? "99+" : tab.badge}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em]">
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
