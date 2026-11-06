/**
 * The stills the scouting report's tiles show until they play: each clip's
 * first frame (reportFirstFrame in @scoutable/shared/lib/report-clip-source).
 *
 * Only the playing tile holds a <video> (WKWebView purges paused videos under
 * memory pressure, see release-video.ts), so the others show images:
 *   - from the game's own video, with ffmpeg (grab_frames), three at a time;
 *   - from the clip's uploaded copy when the video isn't on this computer,
 *     one at a time, through a hidden video drawn on a canvas and let go at
 *     once (the media host sends Access-Control-Allow-Origin *, so the canvas
 *     can be read).
 * Stills are kept for the session by key; a trim, a sync change or a new
 * upload makes a new key. One that failed isn't asked for again.
 */
import { useEffect, useSyncExternalStore } from "react";
import { reportFrameKey, type ReportFrameRequest } from "@scoutable/shared/lib/report-clip-source";
import { releaseVideo } from "@/lib/release-video";
import { grabFrames } from "@/lib/video-frames";

type Entry = { state: "pending" } | { state: "ready"; url: string } | { state: "failed" };
type LocalFrame = Extract<ReportFrameRequest, { kind: "local" }>;
type SharedFrame = Extract<ReportFrameRequest, { kind: "shared" }>;

/** The tiles are about 320 px wide: twice that for a sharp still on a Retina screen. */
const WIDTH = 640;
/** ffmpeg's JPEG quality, 2 (best) to 31. */
const JPEG_QUALITY = 5;
const LOCAL_AT_ONCE = 3;
const SHARED_TIMEOUT_MS = 15_000;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const localQueue: { key: string; request: LocalFrame }[] = [];
const sharedQueue: { key: string; request: SharedFrame }[] = [];
let localRunning = 0;
let sharedRunning = false;

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

async function grabLocal(request: LocalFrame): Promise<string> {
  const [frame] = await grabFrames(request.path, { kind: "times", times: [request.at] }, { kind: "jpeg", width: WIDTH, quality: JPEG_QUALITY, crop: null });
  if (!frame) throw new Error("no frame");
  return `data:image/jpeg;base64,${frame.dataBase64}`;
}

/** A frame of an uploaded clip: a hidden video in the page for as long as it takes, drawn on a canvas, then let go. */
function grabShared(request: SharedFrame): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    let done = false;
    const finish = (url: string | null, error?: unknown) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.remove();
      releaseVideo(video);
      if (url) resolve(url);
      else reject(error ?? new Error("no frame"));
    };
    const timer = window.setTimeout(() => finish(null, new Error("timed out")), SHARED_TIMEOUT_MS);
    const draw = () => {
      try {
        const height = video.videoWidth > 0 ? Math.round((WIDTH * video.videoHeight) / video.videoWidth) : Math.round((WIDTH * 9) / 16);
        const canvas = document.createElement("canvas");
        canvas.width = WIDTH;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(video, 0, 0, WIDTH, height);
        canvas.toBlob((blob) => finish(blob ? URL.createObjectURL(blob) : null), "image/jpeg", 0.8);
      } catch (e) {
        finish(null, e);
      }
    };
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(request.at, Number.isFinite(video.duration) ? video.duration / 2 : request.at);
    }, { once: true });
    video.addEventListener("seeked", () => {
      // The frame must be decoded before it can be drawn.
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) draw();
      else video.addEventListener("loadeddata", draw, { once: true });
    }, { once: true });
    video.addEventListener("error", () => finish(null, video.error), { once: true });
    document.body.appendChild(video);
    video.src = request.url;
  });
}

function pump() {
  while (localRunning < LOCAL_AT_ONCE && localQueue.length > 0) {
    const job = localQueue.shift()!;
    localRunning++;
    grabLocal(job.request)
      .then((url) => settle(job.key, { state: "ready", url }))
      .catch(() => settle(job.key, { state: "failed" }))
      .finally(() => {
        localRunning--;
        pump();
      });
  }
  if (!sharedRunning && sharedQueue.length > 0) {
    const job = sharedQueue.shift()!;
    sharedRunning = true;
    grabShared(job.request)
      .then((url) => settle(job.key, { state: "ready", url }))
      .catch(() => settle(job.key, { state: "failed" }))
      .finally(() => {
        sharedRunning = false;
        pump();
      });
  }
}

function request(key: string, frame: ReportFrameRequest) {
  if (entries.has(key)) return;
  entries.set(key, { state: "pending" });
  if (frame.kind === "local") localQueue.push({ key, request: frame });
  else sharedQueue.push({ key, request: frame });
  pump();
}

/**
 * A report tile's still, once `wanted` (the tile is near the screen): its URL
 * when ready, null until then or when there is none.
 */
export function useReportFrame(frame: ReportFrameRequest | null, wanted: boolean): string | null {
  const key = frame ? reportFrameKey(frame) : null;
  useEffect(() => {
    if (frame && key && wanted) request(key, frame);
    // The key stands for the request: a new one is a new key.
  }, [key, wanted]);
  const entry = useSyncExternalStore(subscribe, () => (key ? entries.get(key) : undefined));
  return entry?.state === "ready" ? entry.url : null;
}
