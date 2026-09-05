/**
 * Existence probes for match video files, built on the stream:// protocol —
 * its handler answers 404 for a missing file, 403 for a permission problem,
 * and 206/204 with a Content-Range total for a readable one, so "is this
 * game's video on this computer?" costs one 1-byte local fetch and zero new
 * native code. The classic trigger is a machine switch: matches sync via
 * the DB, but video_url points at a path on the old computer.
 */
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import type { StoredMatch } from "@/types/match";

export type VideoFileStatus = "ok" | "missing" | "unreadable";

export interface VideoProbeResult {
  status: VideoFileStatus;
  /** Total file size in bytes, when the file exists and reports a range. */
  size?: number;
}

export async function probeVideoPath(path: string): Promise<VideoProbeResult> {
  try {
    const res = await fetch(streamFileSrc(path), {
      headers: { Range: "bytes=0-0" },
    });
    if (res.status === 404) return { status: "missing" };
    if (res.status === 403) return { status: "unreadable" };
    const range = res.headers.get("Content-Range");
    const total = range?.match(/\/(\d+)$/)?.[1];
    return { status: "ok", ...(total ? { size: Number(total) } : {}) };
  } catch {
    // WKWebView surfaces some protocol failures as network errors.
    return { status: "missing" };
  }
}

/**
 * Probe every match that references a LOCAL file. Remote (https) sources —
 * the demo game — and video-less matches are always "ok": there is nothing
 * on this machine to be missing.
 */
export async function probeMatches(
  matches: Pick<StoredMatch, "id" | "videoUrl">[],
): Promise<Map<string, VideoFileStatus>> {
  const entries = await Promise.all(
    matches.map(async (m): Promise<[string, VideoFileStatus]> => {
      if (!m.videoUrl || !isLocalPath(m.videoUrl)) return [m.id, "ok"];
      const { status } = await probeVideoPath(m.videoUrl);
      return [m.id, status];
    }),
  );
  return new Map(entries);
}

/**
 * Duration of a local video via an offscreen metadata load — ffprobe isn't in
 * the sidecar build, and the webview already reads these files over stream://.
 * Resolves null when the duration can't be determined (unsupported container,
 * timeout); callers must treat null as "unknown", never as an error.
 */
export function probeVideoDuration(path: string, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const done = (d: number | null) => {
      if (settled) return;
      settled = true;
      // Detach the source so WKWebView releases the decoder slot.
      video.removeAttribute("src");
      video.load();
      resolve(d);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    video.src = streamFileSrc(path);
  });
}

/** Basename of a stored local path — the signal bulk relink matches on. */
export function videoBasename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
