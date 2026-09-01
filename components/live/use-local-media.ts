"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The viewer's own camera and microphone.
 *
 * This is deliberately plain `getUserMedia` and not part of any video SDK.
 * Device permission, the self-view, and the "is my mic actually picking me up"
 * check are the same work whichever provider we end up on, and they're the
 * part students get wrong — so they're worth owning rather than inheriting.
 * It also means the pre-join screen is fully functional before a single line
 * of provider code exists.
 *
 * Lifecycle: acquiring a stream is a permission prompt, so it happens once and
 * the tracks are then muted/unmuted in place. Re-acquiring on every toggle
 * would flash the camera light and, in Safari, re-prompt.
 */

export type MediaStatus =
  | "idle"
  /** Prompt is on screen — the browser is waiting on the user. */
  | "requesting"
  | "ready"
  | "denied"
  /** No camera/mic on the machine at all. */
  | "missing"
  /** Secure-context or unsupported-browser failure. */
  | "unsupported"
  | "error";

export type LocalMedia = {
  stream: MediaStream | null;
  status: MediaStatus;
  error: string | null;
  cameraOn: boolean;
  micOn: boolean;
  toggleCamera: () => void;
  toggleMic: () => void;
  /** 0–1, smoothed. Drives the mic meter. */
  level: number;
  start: () => void;
  stop: () => void;
};

export function useLocalMedia({
  autoStart = false,
}: { autoStart?: boolean } = {}): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [level, setLevel] = useState(0);

  // Held in refs, not state: the cleanup path must be able to tear these down
  // without depending on a render having happened first.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Closing the context is what actually releases the audio graph; without
    // it Chrome keeps the tab's "in use" indicator lit after leaving a call.
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setLevel(0);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;

    // getUserMedia is undefined outside a secure context, which is the single
    // most common local-dev surprise: https://localhost works, http://192.168.x
    // from your phone does not.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setError(
        "This browser can't open a camera here. Live video needs HTTPS — use localhost rather than a LAN IP address.",
      );
      return;
    }

    setStatus("requesting");
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = s;
      setStream(s);
      setStatus("ready");
      // Adopt whatever the toggles were set to before the stream existed, so
      // joining with the camera pre-disabled doesn't briefly show a face.
      s.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
      s.getAudioTracks().forEach((t) => (t.enabled = micOn));
      attachMeter(s);
    } catch (err: any) {
      const name = err?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setError(
          "Camera and microphone are blocked. Allow them in your browser's address bar, then try again.",
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("missing");
        setError("No camera or microphone found on this device.");
      } else {
        setStatus("error");
        setError(err?.message ?? "Could not start your camera.");
      }
    }
    // cameraOn/micOn are read to seed track state; re-creating `start` when a
    // toggle flips would be pointless since it early-returns once a stream
    // exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** RMS level off an analyser node, smoothed so the meter doesn't strobe. */
  function attachMeter(s: MediaStream) {
    try {
      const Ctx =
        window.AudioContext ??
        (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // Speech RMS sits well under 0.5, so scale up before clamping or the
        // meter never leaves the first bar.
        const scaled = Math.min(1, rms * 4);
        smoothed = smoothed * 0.8 + scaled * 0.2;
        setLevel(smoothed);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // A missing AudioContext costs us the meter, nothing else. The call
      // still works, so this is not worth surfacing to the user.
    }
  }

  const toggleCamera = useCallback(() => {
    setCameraOn((on) => {
      const next = !on;
      streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  }, []);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      const next = !on;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    // Always release the devices on unmount, however the page was left.
    return () => stop();
  }, [autoStart, start, stop]);

  return {
    stream,
    status,
    error,
    cameraOn,
    micOn,
    toggleCamera,
    toggleMic,
    level,
    start: () => void start(),
    stop,
  };
}
