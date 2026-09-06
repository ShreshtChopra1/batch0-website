"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, FieldError } from "@/components/ui/input";
import { LocalTime } from "@/components/ui/local-time";
import { getActionError } from "@/lib/action-error";
import {
  requestInterview,
  cancelInterviewRequest,
} from "@/app/calls/interview-actions";
import type { InterviewRequest } from "@/lib/interview-requests";
import { CalendarClock, CheckCircle, Clock, Sparkles, X } from "lucide-react";

/**
 * The student's "getting to know you" interview request (migration 0061).
 *
 * One component, three states, so a student sees the same thing whether they
 * land on it from the calls page, the dashboard home, or the enrolled page:
 *
 *  - no live request  → a prompt with an inline form to ask
 *  - requested        → "waiting on the team", with a way to withdraw
 *  - scheduled        → "booked", pointing at 1:1 calls to accept the time
 *
 * `variant` only tunes the chrome: "full" leads with a heading (the calls
 * page and enrolled page give it room), "compact" is the tighter card the
 * dashboard home drops into a column.
 */
export function InterviewRequestCard({
  request,
  variant = "full",
}: {
  request: InterviewRequest | null;
  variant?: "full" | "compact";
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const [preferred, setPreferred] = useState(defaultStart());
  const [alt, setAlt] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    setError(undefined);
    start(async () => {
      try {
        await requestInterview({
          preferredAt: new Date(preferred).toISOString(),
          altAt: alt ? new Date(alt).toISOString() : null,
          note: note.trim() || null,
        });
        setComposing(false);
        setAlt("");
        setNote("");
        router.refresh();
      } catch (err: any) {
        setError(getActionError(err));
      }
    });
  }

  function withdraw() {
    if (!request) return;
    setError(undefined);
    start(async () => {
      try {
        await cancelInterviewRequest(request.id);
        router.refresh();
      } catch (err: any) {
        setError(getActionError(err));
      }
    });
  }

  const shell =
    "rounded-xl border border-line bg-wash p-5" +
    (variant === "compact" ? "" : " md:p-6");

  // ---- Scheduled -----------------------------------------------------------
  if (request?.status === "scheduled") {
    return (
      <div className={shell}>
        <Eyebrow icon={CheckCircle}>Interview booked</Eyebrow>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Your getting-to-know-you interview is on the calendar. Head to your
          1:1 calls to confirm the time and join when it starts.
        </p>
        <Link
          href="/dashboard/calls"
          className="press mt-4 inline-flex items-center gap-2 rounded-md bg-phosphor px-4 py-2 text-sm font-semibold text-on-phosphor shadow-cta hover:bg-phosphor-200"
        >
          <CalendarClock className="h-4 w-4" /> Open 1:1 calls
        </Link>
      </div>
    );
  }

  // ---- Requested (waiting) -------------------------------------------------
  if (request?.status === "requested") {
    return (
      <div className={shell}>
        <Eyebrow icon={Clock}>Interview requested</Eyebrow>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          The batch0 team has your request and will confirm a time soon. You
          asked for{" "}
          <span className="font-medium text-ink">
            <LocalTime value={request.preferredAt} mode="datetime-short" />
          </span>
          {request.altAt && (
            <>
              {" "}
              or{" "}
              <span className="font-medium text-ink">
                <LocalTime value={request.altAt} mode="datetime-short" />
              </span>
            </>
          )}
          .
        </p>
        {request.note && (
          <p className="mt-2 text-sm text-ink-faint">&ldquo;{request.note}&rdquo;</p>
        )}
        <button
          type="button"
          onClick={withdraw}
          disabled={pending}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-faint underline underline-offset-2 hover:text-ink disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Withdraw request
        </button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  // ---- No request: prompt + inline form ------------------------------------
  return (
    <div className={shell}>
      <Eyebrow icon={Sparkles}>Before kickoff</Eyebrow>
      <p
        className={
          "mt-2 font-medium text-ink " +
          (variant === "compact" ? "text-[15px]" : "text-base")
        }
      >
        Request a getting-to-know-you interview
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        A short, no-pressure video call with the batch0 team before your cohort
        starts. Tell us when you&rsquo;re free and we&rsquo;ll confirm a time.
      </p>

      {!composing ? (
        <Button className="mt-4" onClick={() => setComposing(true)}>
          Request an interview
        </Button>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Preferred time</Label>
              <Input
                type="datetime-local"
                value={preferred}
                onChange={(e) => setPreferred(e.target.value)}
              />
            </div>
            <div>
              <Label>Alternate time (optional)</Label>
              <Input
                type="datetime-local"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Anything you&rsquo;d like us to know (optional)</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you're building, what you'd love to talk about…"
            />
          </div>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex gap-2">
            <Button disabled={pending || !preferred} onClick={submit}>
              {pending ? "Sending…" : "Send request"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setComposing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Eyebrow({
  icon: Icon,
  children,
}: {
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-phosphor-ink">
      <Icon className="h-3.5 w-3.5" /> {children}
    </p>
  );
}

/** Tomorrow at the next round hour — a sane default that is never in the past. */
function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
