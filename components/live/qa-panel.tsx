"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { LocalTime } from "@/components/ui/local-time";
import {
  normalizeQuestion,
  MAX_QUESTION_LENGTH,
  type LiveRole,
  type WebinarQuestion,
  type QuestionStatus,
} from "@/lib/live";
import {
  askQuestion,
  fetchQuestions,
  setQuestionStatus,
} from "@/app/dashboard/events/[id]/live/actions";
import { Check, MessageCircleQuestion, X } from "lucide-react";

/**
 * Webinar Q&A, beside the video.
 *
 * This is the channel a hidden viewer actually has. Daily's chat can't serve
 * them — a hidden participant may read it but not send — so questions come
 * here, to batch0, and never to the room. The host reads them live and answers
 * on camera.
 *
 * The privacy split is not styled here; it is fetched here. A viewer's
 * `fetchQuestions` only ever returns their own questions (the server decides,
 * by the same permission that decides who broadcasts), so there is no roster,
 * no count, and no other student's words for a viewer to see — even in
 * devtools. A host gets the whole queue.
 */
export function QAPanel({
  eventId,
  role,
  initialQuestions,
}: {
  eventId: string;
  role: LiveRole;
  initialQuestions: WebinarQuestion[];
}) {
  const isHost = role === "host";
  const [questions, setQuestions] = useState<WebinarQuestion[]>(
    initialQuestions,
  );

  // Poll for the live view. The host wants new questions as they arrive; a
  // viewer wants to see their own question's status change when the host
  // answers it. Five seconds is responsive enough for a talk and cheap enough
  // to leave running for the length of one.
  const refresh = useCallback(async () => {
    try {
      const next = await fetchQuestions(eventId);
      setQuestions(next);
    } catch {
      // A dropped poll is not worth surfacing — the next one will catch up.
    }
  }, [eventId]);

  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <aside className="flex h-full flex-col rounded-xl border border-line bg-wash">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <MessageCircleQuestion className="h-4 w-4 text-phosphor-ink" />
        <h2 className="text-sm font-semibold text-ink">
          {isHost ? "Audience questions" : "Ask a question"}
        </h2>
        {isHost && questions.length > 0 && (
          <span className="ml-auto rounded-full bg-phosphor/15 px-2 py-0.5 text-xs font-medium text-phosphor-ink">
            {questions.filter((q) => q.status === "open").length} open
          </span>
        )}
      </header>

      {isHost ? (
        <HostQueue
          questions={questions}
          onModerate={async (id, status) => {
            // Optimistic: move it now, reconcile on the next poll.
            setQuestions((qs) =>
              qs.map((q) => (q.id === id ? { ...q, status } : q)),
            );
            await setQuestionStatus(id, status);
            refresh();
          }}
        />
      ) : (
        <ViewerColumn
          eventId={eventId}
          questions={questions}
          onAsked={(q) => setQuestions((qs) => [...qs, q])}
        />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

function ViewerColumn({
  eventId,
  questions,
  onAsked,
}: {
  eventId: string;
  questions: WebinarQuestion[];
  onAsked: (q: WebinarQuestion) => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const valid = normalizeQuestion(draft) !== null;

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await askQuestion(eventId, draft);
      onAsked(created);
      setDraft("");
      taRef.current?.focus();
    } catch (err: any) {
      setError(err?.message ?? "Couldn't send that — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line p-3">
        <Textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter for a newline, like every chat.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type your question for the host…"
          rows={2}
          className="min-h-16 resize-none text-sm"
          aria-label="Your question"
          disabled={pending}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-faint">Only the host sees this.</p>
          <Button size="sm" onClick={submit} disabled={!valid || pending}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {questions.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-faint">
            Your questions will show up here.
          </p>
        ) : (
          <ul className="space-y-2">
            {questions.map((q) => (
              <li
                key={q.id}
                className="rounded-lg border border-line bg-paper px-3 py-2"
              >
                <p className="text-sm text-ink">{q.body}</p>
                <div className="mt-1 flex items-center gap-2">
                  <QuestionStatusBadge status={q.status} />
                  <span className="text-[11px] text-ink-faint">
                    <LocalTime value={q.createdAt} mode="time" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

function HostQueue({
  questions,
  onModerate,
}: {
  questions: WebinarQuestion[];
  onModerate: (id: string, status: QuestionStatus) => void;
}) {
  // Open questions first and oldest-first within that, so the host works a
  // queue top-to-bottom; resolved ones sink to the bottom for reference.
  const sorted = [...questions].sort((a, b) => {
    const openA = a.status === "open" ? 0 : 1;
    const openB = b.status === "open" ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-faint">
          No questions yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((q) => (
            <li
              key={q.id}
              className={`rounded-lg border px-3 py-2 ${
                q.status === "open"
                  ? "border-line bg-paper"
                  : "border-line/60 bg-wash opacity-60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-soft">
                  {q.askerName}
                </span>
                <span className="text-[11px] text-ink-faint">
                  <LocalTime value={q.createdAt} mode="time" />
                </span>
              </div>
              <p className="mt-1 text-sm text-ink">{q.body}</p>
              <div className="mt-2 flex items-center gap-2">
                {q.status === "open" ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onModerate(q.id, "answered")}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Answered
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onModerate(q.id, "dismissed")}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <QuestionStatusBadge status={q.status} />
                    <button
                      type="button"
                      onClick={() => onModerate(q.id, "open")}
                      className="text-[11px] text-ink-faint hover:text-ink"
                    >
                      Reopen
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionStatusBadge({ status }: { status: QuestionStatus }) {
  const label =
    status === "answered"
      ? "Answered"
      : status === "dismissed"
        ? "Dismissed"
        : "Sent";
  const tone =
    status === "answered"
      ? "bg-phosphor/15 text-phosphor-ink"
      : status === "dismissed"
        ? "bg-ink/10 text-ink-faint"
        : "bg-ink/5 text-ink-soft";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
