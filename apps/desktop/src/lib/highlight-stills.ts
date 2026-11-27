/**
 * The Highlights page's stills, from the player's own game videos with ffmpeg (`grab_frames`), three at a time:
 * a 16:9 still for a play that isn't in the video yet, and a 9:16 still cropped where the framing put the window
 * for one that is. Kept for the session by key (path, time, crop); one that failed isn't asked for again.
 * Same pattern as report-frames.ts.
 */
import { useEffect, useSyncExternalStore } from "react";
import { grabFrames } from "@/lib/video-frames";

type Entry = { state: "pending" } | { state: "ready"; url: string } | { state: "failed" };

export interface StillRequest {
  path: string;
  /** Source seconds. */
  at: number;
  /** A 9:16 window: its centre (0..1 of the width) and width (cropWidthFrac); null for the whole frame. */
  crop: { cx: number; w: number } | null;
}

const JPEG_QUALITY = 5;
const AT_ONCE = 3;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queue: { key: string; req: StillRequest }[] = [];
let running = 0;

const keyOf = (r: StillRequest) =>
  `${r.path}|${r.at.toFixed(2)}|${r.crop ? `${r.crop.cx.toFixed(3)}:${r.crop.w.toFixed(4)}` : "full"}`;

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function settle(key: string, entry: Entry) {
  entries.set(key, entry);
  for (const notify of listeners) notify();
}

async function grab(r: StillRequest): Promise<string> {
  const crop = r.crop
    ? { x: Math.min(1 - r.crop.w, Math.max(0, r.crop.cx - r.crop.w / 2)), y: 0, w: r.crop.w, h: 1 }
    : null;
  // Tiles are about 150 px (9:16) and 220 px (16:9) wide: twice that for a sharp still on a Retina screen.
  const width = r.crop ? 300 : 440;
  const [frame] = await grabFrames(r.path, { kind: "times", times: [r.at] }, { kind: "jpeg", width, quality: JPEG_QUALITY, crop });
  if (!frame) throw new Error("no frame");
  return `data:image/jpeg;base64,${frame.dataBase64}`;
}

function pump() {
  while (running < AT_ONCE && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    grab(job.req)
      .then((url) => settle(job.key, { state: "ready", url }))
      .catch(() => settle(job.key, { state: "failed" }))
      .finally(() => {
        running--;
        pump();
      });
  }
}

/** The still's URL once it's ready; null until then, or when there is none. */
export function useHighlightStill(req: StillRequest | null): string | null {
  const key = req ? keyOf(req) : null;
  useEffect(() => {
    if (!req || !key || entries.has(key)) return;
    entries.set(key, { state: "pending" });
    queue.push({ key, req });
    pump();
    // The key stands for the request.
  }, [key]);
  const entry = useSyncExternalStore(subscribe, () => (key ? entries.get(key) : undefined));
  return entry?.state === "ready" ? entry.url : null;
}
