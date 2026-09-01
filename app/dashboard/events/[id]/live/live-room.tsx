"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type DailyIframe from "@daily-co/daily-js";
import type { DailyCall } from "@daily-co/daily-js";
import { PreJoin } from "@/components/live/pre-join";
import { LiveDot } from "@/components/live/call-stage";
import { QAPanel } from "@/components/live/qa-panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { canSeeRoster, type LiveRole, type WebinarQuestion } from "@/lib/live";
import { AlertTriangle } from "lucide-react";

type Phase = "prejoin" | "joining" | "joined" | "left" | "error";

/**
 * A live room, on batch0.org.
 *
 * Two halves. Ours is the green room (device check before anyone is watching)
 * and the chrome around the call; Daily Prebuilt is the call itself, mounted
 * into the container below. We deliberately don't rebuild the grid, screen
 * share, and chat — Prebuilt does those well, and the interesting decisions
 * are all in what we configure it with.
 *
 * The token arrives already minted by the server, after the permission and
 * RLS checks. This component never asks for one and cannot widen what it was
 * given: a viewer token stays a viewer token no matter what happens here.
 */
export function LiveRoom({
  title,
  roomUrl,
  token,
  role,
  backHref,
  qa,
}: {
  title: string;
  roomUrl: string;
  token: string;
  role: LiveRole;
  backHref: string;
  // Present for webinars, absent for 1:1 calls. When set, the room is a
  // hosted webinar: the audience is hidden, Daily's chat is off, and questions
  // flow through our own Q&A panel instead. A 1:1 has no audience to hide and
  // keeps Daily's built-in chat, so it passes no `qa`.
  qa?: { eventId: string; initialQuestions: WebinarQuestion[] };
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const [phase, setPhase] = useState<Phase>("prejoin");
  const [error, setError] = useState<string | null>(null);

  const destroy = useCallback(() => {
    const call = callRef.current;
    callRef.current = null;
    // destroy() releases the camera and tears the iframe out. Skipping it on
    // unmount leaves the device light on after navigating away, which reads
    // as the site still watching you.
    call?.destroy().catch(() => {});
  }, []);

  useEffect(() => destroy, [destroy]);

  const join = useCallback(
    async ({ cameraOn, micOn }: { cameraOn: boolean; micOn: boolean }) => {
      if (!containerRef.current || callRef.current) return;
      setPhase("joining");
      setError(null);
      try {
        // Imported here rather than at module scope: daily-js reaches for
        // browser globals as it loads, so a static import would run during
        // SSR and break the page before it ever reached a browser.
        const { default: Daily } = (await import("@daily-co/daily-js")) as {
          default: typeof DailyIframe;
        };

        const call = Daily.createFrame(containerRef.current, {
          url: roomUrl,
          token,
          showLeaveButton: true,
          showFullscreenButton: true,
          // The audience-privacy requirement, at the Prebuilt layer.
          //
          // Viewers must not be able to tell how many people are watching, so
          // they get no participants bar. This is the third of three layers —
          // our own UI hides the roster (canSeeRoster), the meeting token sets
          // hasPresence:false so viewers are absent from everyone else's
          // participant list, and this stops Prebuilt's own chrome from
          // showing what the other two withheld.
          showParticipantsBar: canSeeRoster(role),
          showUserNameChangeUI: false,
          iframeStyle: {
            width: "100%",
            height: "100%",
            border: "0",
            borderRadius: "12px",
          },
        });
        callRef.current = call;

        call.on("left-meeting", () => {
          setPhase("left");
          destroy();
        });
        call.on("error", (e: any) => {
          setError(e?.errorMsg ?? "The call ended unexpectedly.");
          setPhase("error");
        });

        await call.join({
          url: roomUrl,
          token,
          // Honour what they chose in the green room. A viewer has no devices
          // to start in the first place — owner_only_broadcast means the room
          // itself refuses them media — so this only affects hosts.
          startVideoOff: role !== "host" || !cameraOn,
          startAudioOff: role !== "host" || !micOn,
        });
        setPhase("joined");
      } catch (err: any) {
        setError(err?.message ?? "Could not connect to the room.");
        setPhase("error");
        destroy();
      }
    },
    [roomUrl, token, role, destroy],
  );

  if (phase === "left") {
    return (
      <Centered title="You've left the call">
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => router.refresh()}>Rejoin</Button>
          <ButtonLink variant="secondary" href={backHref}>
            Back
          </ButtonLink>
        </div>
      </Centered>
    );
  }

  if (phase === "error") {
    return (
      <Centered title="Couldn't join">
        <div className="mx-auto mb-4 flex max-w-md items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-400/10 p-3 text-left">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-ink-soft">{error}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => router.refresh()}>Try again</Button>
          <ButtonLink variant="secondary" href={backHref}>
            Back
          </ButtonLink>
        </div>
      </Centered>
    );
  }

  return (
    <div className={qa ? "mx-auto max-w-6xl" : "mx-auto max-w-5xl"}>
      {/*
        The container is mounted at all times, not conditionally. Daily needs a
        real element to attach to at the moment createFrame runs, and mounting
        it only once phase === "joining" means the ref is still null when the
        click handler fires.
      */}
      <div className={phase === "prejoin" ? "hidden" : "block"}>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="truncate font-display text-lg font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {phase === "joined" && <LiveDot />}
        </header>
        {/*
          Webinar: video and the Q&A panel side by side on desktop, stacked on
          mobile. 1:1: video only, full width. The container itself is the same
          element in both — only what sits next to it changes.
        */}
        <div className="flex flex-col gap-3 lg:flex-row">
          <div
            ref={containerRef}
            className="h-[60vh] min-h-[360px] w-full flex-1 overflow-hidden rounded-xl border border-line bg-ink-900 lg:h-[70vh]"
          />
          {qa && phase !== "prejoin" && (
            <div className="h-[60vh] min-h-[360px] w-full shrink-0 lg:h-[70vh] lg:w-80">
              <QAPanel
                eventId={qa.eventId}
                role={role}
                initialQuestions={qa.initialQuestions}
              />
            </div>
          )}
        </div>
        {phase === "joining" && (
          <p className="mt-3 text-center text-xs text-ink-faint">Connecting…</p>
        )}
      </div>

      {phase === "prejoin" && (
        <PreJoin
          title={title}
          subtitle={
            role === "host"
              ? "You're the host — your camera and mic will be live."
              : "You'll be able to watch and use the chat."
          }
          role={role}
          onJoin={join}
          joinLabel={role === "host" ? "Start" : "Join"}
        />
      )}
    </div>
  );
}

function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h1>
      <div className="mt-5">{children}</div>
    </div>
  );
}
