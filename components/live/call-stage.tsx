"use client";
import { useState } from "react";
import { VideoTile } from "@/components/live/video-tile";
import { CallControls } from "@/components/live/call-controls";
import { useLocalMedia } from "@/components/live/use-local-media";
import type { LiveRole } from "@/lib/live";
import { Radio, X, Send, Plug } from "lucide-react";

export type StageParticipant = {
  id: string;
  name: string;
  role: LiveRole;
  cameraOn?: boolean;
  micOn?: boolean;
};

/**
 * The in-call screen.
 *
 * This is the shell the video provider mounts into — the header, the layout,
 * the control bar, and the side panels are ours; the remote tracks are theirs.
 * Today the remote area renders a placeholder and the local self-view is a
 * real `getUserMedia` stream, so the whole surface is reviewable before any
 * provider account exists. Wiring Daily in means replacing the contents of
 * `<RemoteArea>` with its iframe (Prebuilt) or its tracks (custom) — the
 * surrounding chrome is already done.
 *
 * A webinar and a 1:1 are the same screen with different inputs: `role`
 * decides whether the control bar offers a camera at all, and `layout`
 * decides whether one speaker dominates or the tiles share space evenly.
 */
export function CallStage({
  title,
  role,
  participants,
  layout = "grid",
  onLeave,
  connected = false,
}: {
  title: string;
  role: LiveRole;
  participants: StageParticipant[];
  /** `spotlight` for webinars (one broadcaster), `grid` for small calls. */
  layout?: "grid" | "spotlight";
  onLeave: () => void;
  /** True once a real provider session is attached. */
  connected?: boolean;
}) {
  const canBroadcast = role === "host";
  const media = useLocalMedia({ autoStart: canBroadcast });
  const [panel, setPanel] = useState<"none" | "people" | "chat">("none");
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);

  const hosts = participants.filter((p) => p.role === "host");

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate font-display text-lg font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h1>
          <LiveDot />
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          {recording && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 font-mono uppercase tracking-wider text-red-600 dark:text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Recording
            </span>
          )}
          <span>
            {participants.length}{" "}
            {participants.length === 1 ? "person" : "people"}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1">
          {connected ? null : <NotWiredNotice />}

          {layout === "spotlight" ? (
            <div className="space-y-3">
              <RemoteArea
                name={hosts[0]?.name ?? "Host"}
                label="presenting"
                className="aspect-video w-full"
              />
              {canBroadcast && (
                <div className="w-48">
                  <VideoTile
                    stream={media.stream}
                    name="You"
                    label="host"
                    cameraOn={media.cameraOn}
                    micOn={media.micOn}
                    mirrored
                    muted
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {canBroadcast && (
                <VideoTile
                  stream={media.stream}
                  name="You"
                  cameraOn={media.cameraOn}
                  micOn={media.micOn}
                  mirrored
                  muted
                />
              )}
              {participants
                .filter((p) => p.name !== "You")
                .map((p) => (
                  <RemoteArea key={p.id} name={p.name} label={p.role} />
                ))}
            </div>
          )}
        </div>

        {panel !== "none" && (
          <aside className="hidden w-72 shrink-0 flex-col rounded-2xl border border-line bg-wash md:flex">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                {panel === "people" ? "People" : "Chat"}
              </h2>
              <button
                onClick={() => setPanel("none")}
                aria-label="Close panel"
                className="text-ink-faint hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {panel === "people" ? (
              <ul className="flex-1 overflow-y-auto p-2">
                {participants.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg px-2 py-2 text-sm"
                  >
                    <span className="truncate text-ink">{p.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                      {p.role}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4">
                  <p className="text-xs text-ink-faint">
                    Chat arrives with the video provider — messages will appear
                    here.
                  </p>
                </div>
                <div className="flex items-center gap-2 border-t border-line p-2">
                  <input
                    disabled
                    placeholder="Send a message…"
                    className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint disabled:opacity-60"
                  />
                  <button
                    disabled
                    aria-label="Send"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-phosphor text-on-phosphor disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      <CallControls
        micOn={media.micOn}
        cameraOn={media.cameraOn}
        onToggleMic={media.toggleMic}
        onToggleCamera={media.toggleCamera}
        onToggleScreen={
          canBroadcast ? () => setScreenSharing((s) => !s) : undefined
        }
        screenSharing={screenSharing}
        onToggleRecording={
          canBroadcast ? () => setRecording((r) => !r) : undefined
        }
        recording={recording}
        onToggleParticipants={() =>
          setPanel((p) => (p === "people" ? "none" : "people"))
        }
        onToggleChat={() => setPanel((p) => (p === "chat" ? "none" : "chat"))}
        participantCount={participants.length}
        canBroadcast={canBroadcast}
        onLeave={onLeave}
      />
    </div>
  );
}

/**
 * Where a remote participant's video goes. A labelled placeholder until the
 * provider is connected — deliberately not a spinner, because nothing is
 * loading and a spinner that never resolves is a lie.
 */
function RemoteArea({
  name,
  label,
  className = "aspect-video",
}: {
  name: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative grid place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-wash ${className}`}
    >
      <div className="px-6 text-center">
        <Plug className="mx-auto h-6 w-6 text-ink-faint" />
        <p className="mt-2 text-sm font-medium text-ink">{name}</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          Video appears here once the provider is connected
        </p>
      </div>
      {label && (
        <span className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          {label}
        </span>
      )}
    </div>
  );
}

function NotWiredNotice() {
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-line bg-wash px-3 py-2.5">
      <Plug className="mt-0.5 h-4 w-4 shrink-0 text-phosphor-ink" />
      <p className="text-xs text-ink-soft">
        <span className="font-medium text-ink">Interface preview.</span> Your own
        camera and mic are live and every control works. Remote video connects
        once the video provider is wired up.
      </p>
    </div>
  );
}

export function LiveDot() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-red-600 dark:text-red-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
      </span>
      <Radio className="h-2.5 w-2.5" />
      Live
    </span>
  );
}
