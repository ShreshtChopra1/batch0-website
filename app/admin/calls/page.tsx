import { requirePermission } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { CallsPanel } from "@/components/live/calls-panel";
import { InviteList } from "@/components/live/invite-card";
import {
  listInvitesForHost,
  listAllInvites,
  listInvitableStudents,
} from "@/lib/calls";

export const metadata = { title: "1:1 calls · Admin" };

export default async function AdminCallsPage() {
  const viewer = await requirePermission("calls.invite");
  const [mine, all, students] = await Promise.all([
    listInvitesForHost(viewer.profile.id),
    listAllInvites(),
    listInvitableStudents(),
  ]);

  // Everything anyone else has booked. This is the safeguarding view: in a
  // programme of minors, someone has to be able to answer "who has been
  // meeting my students" without asking the participants. Read-only —
  // cancelling someone else's call is the host's or the student's to do.
  const others = all.filter((i) => !mine.some((m) => m.id === i.id));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-ink">
        1:1 calls
      </h1>
      <p className="mt-1 text-sm text-ink-faint">
        Invite a student to a private video call, and see every call mentors
        and investors have booked.
      </p>

      <Card className="mt-6">
        <CallsPanel invites={mine} students={students} />
      </Card>

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Booked by everyone else
        </h2>
        <InviteList
          invites={others}
          perspective="host"
          emptyMessage="Nobody else has booked a 1:1 yet."
        />
      </section>
    </div>
  );
}
