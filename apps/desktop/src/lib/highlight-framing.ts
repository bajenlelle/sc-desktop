/**
 * Frames a player's highlight clips against their local game videos: frames come from the ffmpeg sidecar
 * (`grab_frames`), the player's position and the rim from the `highlight-frame` edge function (Claude), and the
 * crop keyframes from `@scoutable/shared/lib/highlight-framing`. Only JPEG stills of the clips leave the machine.
 * Three clips at a time; each finished clip is reported as soon as it's ready, so the suggestion tiles fill in.
 */
import { cropWidthFrac } from "@scoutable/shared/lib/crop-path";
import { frameHighlight, SILENT_FRAME_ERRORS, type FramedClip } from "@scoutable/shared/lib/highlight-frame-client";
import { FRAME_SAMPLE_WIDTH } from "@scoutable/shared/lib/highlight-framing";
import type { HighlightCandidate } from "@scoutable/shared/lib/highlight-picks";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { createClient } from "@/lib/supabase/client";
import { grabFramesParallel, probeVideo, type VideoProbe } from "./video-frames";

const JPEG_QUALITY = 4;
const CONCURRENCY = 3;

export interface FrameJob {
  candidate: HighlightCandidate;
  videoPath: string;
  /** The clip's window in the source video (seconds), from the play-by-play sync. */
  window: { start: number; end: number };
  teams: { home: string; away: string; league?: string };
}

export type FrameOutcome = { key: string; ok: true; clip: FramedClip } | { key: string; ok: false; error: string };

export interface FrameAllOptions {
  signal?: AbortSignal;
  onClip?: (outcome: FrameOutcome) => void;
}

/** Frames every job, three at a time, and returns the outcomes in job order. Stops starting new ones when aborted. */
export async function frameHighlightClips(jobs: FrameJob[], opts: FrameAllOptions = {}): Promise<FrameOutcome[]> {
  const supabase = createClient();
  const probes = new Map<string, Promise<VideoProbe>>();
  const probe = (path: string) => {
    if (!probes.has(path)) probes.set(path, probeVideo(path));
    return probes.get(path)!;
  };
  const started = Date.now();
  const out: FrameOutcome[] = new Array(jobs.length);
  let next = 0;
  let stop: string | null = null;

  const runOne = async (job: FrameJob): Promise<FrameOutcome> => {
    const key = job.candidate.key;
    try {
      const p = await probe(job.videoPath);
      const res = await frameHighlight(
        {
          supabase,
          signal: opts.signal,
          grab: async (times) => {
            const frames = await grabFramesParallel(job.videoPath, times, { kind: "jpeg", width: FRAME_SAMPLE_WIDTH, quality: JPEG_QUALITY });
            return frames.map((f) => f.dataBase64);
          },
        },
        job.candidate,
        job.window,
        job.teams,
        cropWidthFrac(p.width, p.height),
      );
      if (res.ok) return { key, ok: true, clip: res.data };
      if (SILENT_FRAME_ERRORS.has(res.error)) stop = res.error; // off, or the daily limit: don't start more
      return { key, ok: false, error: res.error };
    } catch (err) {
      Sentry.captureException(err, { tags: { feature: "highlight_framing", step: "clip" } });
      return { key, ok: false, error: "grab_failed" };
    }
  };

  const worker = async () => {
    while (next < jobs.length && !opts.signal?.aborted && !stop) {
      const i = next++;
      const outcome = await runOne(jobs[i]);
      out[i] = outcome;
      opts.onClip?.(outcome);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  const done = out.filter(Boolean);
  const oks = done.filter((o): o is Extract<FrameOutcome, { ok: true }> => o.ok);
  trackEvent("highlight_framing_completed", {
    clips: jobs.length,
    ok: oks.length,
    failed: done.length - oks.length,
    checks: oks.filter((o) => o.clip.check).length,
    elapsed_ms: Date.now() - started,
    model: oks[0]?.clip.usage.model ?? null,
    fallback: oks.some((o) => o.clip.usage.fallback),
  });
  if (stop) trackEvent("highlight_framing_failed", { error: stop });
  return jobs.map((j, i) => out[i] ?? { key: j.candidate.key, ok: false, error: stop ?? "cancelled" });
}
