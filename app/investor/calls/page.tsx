import { requirePermission } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { CallsPanel } from "@/components/live/calls-panel";
import { listInvitesForHost, listInvitableStudents } from "@/lib/calls";

export const metadata = { title: "1:1 calls · Investor" };

export default async function InvestorCallsPage() {
  const viewer = await requirePermission("calls.invite");
  const [invites, students] = await Promise.all([
    listInvitesForHost(viewer.profile.id),
    listInvitableStudents(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-ink">
        1:1 calls
      </h1>
      <p className="mt-1 text-sm text-ink-faint">
        Invite a founder to a private video call on batch0. They can accept or
        decline.
      </p>

      <Card className="mt-6">
        <CallsPanel invites={invites} students={students} />
      </Card>
    </div>
  );
}
