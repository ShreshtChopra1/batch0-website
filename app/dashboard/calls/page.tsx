import { requireUser, getProfile } from "@/lib/auth";
import { listInvitesForInvitee } from "@/lib/calls";
import { getInterviewRequestForStudent } from "@/lib/interview-requests";
import { getStudentAccess } from "@/lib/access";
import type { Role } from "@/lib/types";
import { StudentCalls } from "./student-calls";

export const metadata = { title: "1:1 calls · batch0" };

export default async function StudentCallsPage() {
  await requireUser();
  const profile = await getProfile();
  const access = await getStudentAccess((profile?.role as Role) ?? "student");
  const [invites, interviewRequest] = await Promise.all([
    profile ? listInvitesForInvitee(profile.id) : Promise.resolve([]),
    profile ? getInterviewRequestForStudent(profile.id) : Promise.resolve(null),
  ]);

  // The getting-to-know-you request is a pre-kickoff onboarding step for
  // enrolled students, so the form to ask only shows to an enrolled student
  // before their cohort starts. A request that's already in flight (requested
  // / scheduled) keeps showing whatever the phase, so a student never loses
  // track of one they filed.
  const showInterviewRequest =
    (access.enrolled && access.preCohort) || interviewRequest != null;

  // Deliberately not behind the enrolled gate that /dashboard/events uses.
  // An invite is addressed to one named person by someone who already decided
  // to reach them — an accepted applicant who is invited to a call should be
  // able to answer it, and hiding the page would leave them with an email and
  // nowhere to click.
  return (
    <StudentCalls
      invites={invites}
      interviewRequest={interviewRequest}
      showInterviewRequest={showInterviewRequest}
    />
  );
}
