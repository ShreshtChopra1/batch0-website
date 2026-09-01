"use client";
import { useEffect, useRef } from "react";
import { MicOff, VideoOff } from "lucide-react";

/**
 * One person's video.
 *
 * Takes a `MediaStream` rather than a provider participant object so the same
 * tile renders the local self-view today and a remote track later — swapping
 * the video layer doesn't reach into this file.
 */
export function VideoTile({
  stream,
  name,
  label,
  cameraOn = true,
  micOn = true,
  /** Self-view is mirrored; remote video never is. */
  mirrored = false,
  /** Local audio must stay muted or the room howls with feedback. */
  muted = false,
  speaking = false,
  className = "",
}: {
  stream?: MediaStream | null;
  name: string;
  label?: string;
  cameraOn?: boolean;
  micOn?: boolean;
  mirrored?: boolean;
  muted?: boolean;
  speaking?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== (stream ?? null)) {
      el.srcObject = stream ?? null;
    }
    if (stream) {
      // Autoplay can still be refused (Safari, or a tab that was never
      // interacted with). Nothing useful to do about it beyond not throwing.
      el.play?.().catch(() => {});
    }
  }, [stream]);

  const showVideo = !!stream && cameraOn;

  return (
    <div
      className={`relative isolate aspect-video overflow-hidden rounded-xl border bg-ink-900 transition-colors ${
        speaking ? "border-phosphor" : "border-line"
      } ${className}`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${showVideo ? "" : "invisible"} ${
          mirrored ? "-scale-x-100" : ""
        }`}
      />

      {!showVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-wash font-display text-2xl text-ink-soft">
              {initials(name)}
            </div>
            {!cameraOn && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
                <VideoOff className="h-3 w-3" /> Camera off
              </span>
            )}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <span className="truncate text-xs font-medium text-[#fff]">
          {name}
          {label && (
            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-[#fff]/60">
              {label}
            </span>
          )}
        </span>
        {!micOn && (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-500/90"
            title="Muted"
          >
            <MicOff className="h-3.5 w-3.5 text-[#fff]" />
            <span className="sr-only">Muted</span>
          </span>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
