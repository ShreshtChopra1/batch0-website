import { requireUser, getProfile } from "@/lib/auth";
import { listInvitesForInvitee } from "@/lib/calls";
import { StudentCalls } from "./student-calls";

export const metadata = { title: "1:1 calls · batch0" };

export default async function StudentCallsPage() {
  await requireUser();
  const profile = await getProfile();
  const invites = profile ? await listInvitesForInvitee(profile.id) : [];

  // Deliberately not behind the enrolled gate that /dashboard/events uses.
  // An invite is addressed to one named person by someone who already decided
  // to reach them — an accepted applicant who is invited to a call should be
  // able to answer it, and hiding the page would leave them with an email and
  // nowhere to click.
  return <StudentCalls invites={invites} />;
}
