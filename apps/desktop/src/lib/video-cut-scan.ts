/**
 * The hard cuts in a game's local recording, found in the background
 * (docs/game-view.md, "Jumps in the video"). After an import, when a game
 * opens in the game view, and when the app starts with a search left
 * unfinished, a recording is looked up by its fingerprint among the scans
 * coaches have shared (video_cut_scans); one nobody has searched is read
 * here, fifteen minutes of video at a time, one recording at a time, with
 * the progress kept on this computer so a search cut short by quitting picks
 * up where it stopped. A finished search is shared.
 *
 * Nothing waits on it: the game view warns about jumps once the cuts are in.
 */
import { useEffect, useSyncExternalStore } from "react";
import { CUT_THRESHOLD, findVideoCutScan, saveVideoCutScan } from "@scoutable/shared/lib/video-cut-scans-db";
import type { VideoFingerprint } from "@scoutable/shared/lib/video-fingerprint";
import { isolatedCuts } from "@scoutable/shared/lib/video-jumps";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { isLocalPath } from "@/lib/stream";
import { createClient } from "@/lib/supabase/client";
import { computeVideoFingerprint } from "@/lib/video-fingerprint";
import { findCuts } from "@/lib/video-frames";

/** How much video one ffmpeg run reads (find_cuts' own limit): a quit loses at most this much work. */
const CHUNK_S = 900;
/** Recordings whose search isn't finished, by path, so the next start picks them up. */
const PENDING_KEY = "scoutable_cut_scans_pending";
/** One recording's search, by its fingerprint: how far it has read, the cuts so far, and whether it is shared yet. */
const progressKey = (fpKey: string) => `scoutable_cut_scan:${fpKey}`;

interface Progress {
  doneTo: number;
  duration: number;
  cuts: number[];
  shared: boolean;
}

type State = { kind: "scanning" } | { kind: "done"; cuts: number[] } | { kind: "failed" };

const states = new Map<string, State>();
const listeners = new Set<() => void>();
const queue: string[] = [];
let running = false;

function set(path: string, state: State) {
  states.set(path, state);
  for (const l of listeners) l();
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the search still runs; it just starts over after a quit.
  }
}

function pending(): string[] {
  const list = readJson<unknown>(PENDING_KEY);
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
}

function setPending(path: string, on: boolean) {
  const list = pending().filter((p) => p !== path);
  writeJson(PENDING_KEY, on ? [...list, path] : list);
}

/** Cuts from two neighbouring chunks, or a retried one, counted once. */
function merged(cuts: number[]): number[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > 0.5);
}

async function share(fp: VideoFingerprint, progress: Progress) {
  try {
    await saveVideoCutScan(createClient(), fp, progress.cuts, CUT_THRESHOLD);
    writeJson(progressKey(fp.key), { ...progress, shared: true });
  } catch (e) {
    // Kept here unshared: the next look at this recording tries again.
    Sentry.captureException(e, { tags: { feature: "video_cut_scan", step: "share" } });
  }
}

async function scan(path: string) {
  set(path, { kind: "scanning" });
  setPending(path, true);
  const { fingerprint: fp, probe } = await computeVideoFingerprint(path);
  const duration = probe.durationMs / 1000;
  const saved = readJson<Progress>(progressKey(fp.key));

  // Finished here before: use it, and share it if that didn't go through.
  if (saved && saved.doneTo >= saved.duration) {
    if (!saved.shared) await share(fp, saved);
    setPending(path, false);
    return set(path, { kind: "done", cuts: saved.cuts });
  }
  // Searched by someone already: nothing to read.
  try {
    const found = await findVideoCutScan(createClient(), fp);
    if (found) {
      trackEvent("video_cut_scan_done", { source: "shared", cuts: found.cuts.length, jumps: isolatedCuts(found.cuts).length });
      writeJson(progressKey(fp.key), { doneTo: duration, duration, cuts: found.cuts, shared: true } satisfies Progress);
      setPending(path, false);
      return set(path, { kind: "done", cuts: found.cuts });
    }
  } catch (e) {
    // Offline or the lookup failed: search here; the result is shared when it can be.
    Sentry.captureException(e, { tags: { feature: "video_cut_scan", step: "lookup" } });
  }

  const progress: Progress = saved && saved.duration === duration ? saved : { doneTo: 0, duration, cuts: [], shared: false };
  const startedAt = performance.now();
  while (progress.doneTo < duration) {
    const span = Math.min(CHUNK_S, duration - progress.doneTo);
    const cuts = await findCuts(path, progress.doneTo, span);
    progress.cuts = merged([...progress.cuts, ...cuts]);
    progress.doneTo = Math.min(duration, progress.doneTo + span);
    writeJson(progressKey(fp.key), progress);
  }
  trackEvent("video_cut_scan_done", {
    source: "local",
    cuts: progress.cuts.length,
    jumps: isolatedCuts(progress.cuts).length,
    seconds: Math.round((performance.now() - startedAt) / 1000),
  });
  await share(fp, progress);
  setPending(path, false);
  set(path, { kind: "done", cuts: progress.cuts });
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const path = queue.shift()!;
      try {
        await scan(path);
      } catch (e) {
        // A file that can't be read (moved, deleted) is dropped, not retried forever.
        setPending(path, false);
        set(path, { kind: "failed" });
        Sentry.captureException(e, { tags: { feature: "video_cut_scan", step: "scan" } });
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Headless UI only (docs/headless-ui.md): a spec hands the cuts in through an
 * exposed function, since its videos are not files ffmpeg can read here.
 */
function headlessCuts(): ((path: string) => Promise<number[] | null>) | null {
  if (import.meta.env.MODE !== "headless") return null;
  return (window as unknown as { __headlessCutsFn?: (path: string) => Promise<number[] | null> }).__headlessCutsFn ?? null;
}

/** Starts finding a recording's cuts, unless it is known or on its way. Only for a file on this computer. */
export function scanVideoCuts(path: string | null | undefined) {
  if (!path) return;
  const given = headlessCuts();
  if (given) {
    if (states.has(path)) return;
    set(path, { kind: "scanning" });
    void given(path).then((cuts) => set(path, cuts ? { kind: "done", cuts } : { kind: "failed" }));
    return;
  }
  if (!isLocalPath(path)) return;
  const state = states.get(path);
  if (state && state.kind !== "failed") return;
  if (queue.includes(path)) return;
  queue.push(path);
  set(path, { kind: "scanning" });
  void drain();
}

/** The searches a quit cut short: on again from where they stopped. */
export function resumePendingScans() {
  for (const path of pending()) scanVideoCuts(path);
}

/** A recording's cuts, once found; null while they are being looked for, or when they can't be. Starts the search. */
export function useVideoCuts(path: string | null | undefined): { cuts: number[] | null; scanning: boolean } {
  useEffect(() => scanVideoCuts(path), [path]);
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (path ? states.get(path) : undefined),
  );
  return { cuts: state?.kind === "done" ? state.cuts : null, scanning: state?.kind === "scanning" };
}
