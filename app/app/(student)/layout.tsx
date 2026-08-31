import { redirect } from "next/navigation";
import { requireViewer, roleHome } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AppShell } from "@/components/app/frame";
import type { Tab } from "@/components/app/tab-bar";

/**
 * The four things a student does from a phone.
 *
 * Getting to four was the whole design problem. The student sidebar carries 17
 * links; most are things you do once (billing, referrals, settings) or things
 * that want a keyboard and a big screen (the AI co-founder, file uploads, the
 * pitch coach). What is left — where am I, what's this week, log my week, and a
 * door to everything else — is what a phone is actually good for.
 *
 * Announcements and Events are deliberately NOT tabs even though they are read
 * often. They are read, not acted on, so they surface on Home where you already
 * are, and live as full screens under More. A fifth tab would have cost every
 * screen ~20% of the tab bar's width to save one tap on a page nobody opens
 * twice a day.
 */
const STUDENT_TABS: Tab[] = [
  { href: "/app/home", label: "Home", icon: "Home", exact: true },
  { href: "/app/course", label: "Course", icon: "PlayCircle" },
  { href: "/app/checkin", label: "Check in", icon: "CheckCircle" },
  { href: "/app/more", label: "More", icon: "MoreHorizontal" },
];

export default async function StudentAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same gate as /dashboard: the participant area is `student.dashboard`.
  // Admins hold the wildcard and pass, which is what makes the "Student view"
  // link in /app/admin/more work.
  const { profile, caps } = await requireViewer();
  if (!can(caps, "student.dashboard")) {
    redirect(await roleHome(profile.role));
  }
  return <AppShell tabs={STUDENT_TABS}>{children}</AppShell>;
}
