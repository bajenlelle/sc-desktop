/**
 * After a game's sync changes, the coach's own playlist clips of that game
 * follow it: each vertical pan moves with its clip's cut, and every shared
 * clip whose cut moved is cut again where the video can be cut (the desktop,
 * with its local file), the new file replacing the old only once it is
 * uploaded. A moved clip that can't be cut here is hidden instead, so
 * "Upload missing clips" offers it: a shared clip never keeps playing the
 * wrong moment. The cutting is injected (SyncFollowDeps); the host shows
 * progress and the outcome.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayByPlayEvent, SyncPoint } from "../types/match";
import { computeVideoTime } from "./clip-timing";
import { shiftKeyframes, type CropKeyframe } from "./crop-path";
import { clearShippedClip, listOwnClipsForMatch, updateClip, type OwnMatchClip } from "./playlists-db";
import { reportDbError } from "./report";
import { planSyncRecut } from "./sync-recut";

/** What changed on one playlist clip, for an open editor to patch its copy. */
export interface ClipPatch {
  playlistId: string;
  matchId: string;
  eventId: number;
  /** A new upload's URL, or null when the clip was hidden. */
  r2Url?: string | null;
  cropKeyframes?: CropKeyframe[];
}

/** One playlist's moved clips that were cut at the same length: one cut-and-upload run. */
export interface RecutGroup {
  playlistId: string;
  playlistName: string;
  rolls: { pre: number; post: number };
  rows: OwnMatchClip[];
}

export interface RecutOutcome {
  shipped: number;
  failedEventIds: number[];
  uploaded: Array<{ matchId: string; eventId: number; r2Url: string }>;
  aborted: boolean;
}

export interface SyncFollowDeps {
  /** Whether the game's video can be cut where this runs (the desktop: a local path that probes ok; headless: false). */
  canCut(videoUrl: string | undefined): Promise<boolean>;
  /**
   * Cut and upload one group again, replacing each old file only once the
   * new one is up; `done` of `total` clips were resolved before it. Throws
   * when the whole group can't be cut.
   */
  recut(group: RecutGroup, done: number, total: number, signal: AbortSignal): Promise<RecutOutcome>;
  onPatches?(patches: ClipPatch[]): void;
}

export type SyncFollowResult =
  | { kind: "nothing" }
  | { kind: "hidden"; hidden: number }
  | { kind: "recut"; shipped: number; failed: number; hidden: number; playlists: number }
  | { kind: "aborted" };

export type SyncedGame = { id: string; title: string; videoUrl?: string; events: PlayByPlayEvent[]; syncPoint?: SyncPoint };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Stop serving clips that still hold the old cut; returns the patches announced. */
async function hideClips(sb: SupabaseClient, rows: OwnMatchClip[], deps: SyncFollowDeps): Promise<ClipPatch[]> {
  const patches: ClipPatch[] = [];
  for (const row of rows) {
    try {
      await clearShippedClip(sb, row.playlistId, row.clip.matchId, row.clip.eventId, row.clip.r2Url);
      patches.push({ playlistId: row.playlistId, matchId: row.clip.matchId, eventId: row.clip.eventId, r2Url: null });
    } catch (e) {
      reportDbError("followSyncChange.hide", { message: message(e) });
    }
  }
  if (patches.length > 0) deps.onPatches?.(patches);
  return patches;
}

/**
 * Bring the game's clips in the coach's playlists in line with its new sync
 * (`match.syncPoint`; `before` is the sync they were made with). Safe to
 * call when nothing moved: it then does nothing. Throws only when the clips
 * can't be listed.
 */
export async function followSyncChange(
  sb: SupabaseClient,
  match: SyncedGame,
  before: SyncPoint | undefined,
  signal: AbortSignal,
  deps: SyncFollowDeps,
): Promise<SyncFollowResult> {
  const after = match.syncPoint;
  if (!after) return { kind: "nothing" };
  const rows = await listOwnClipsForMatch(sb, match.id);
  if (rows.length === 0) return { kind: "nothing" };
  if (signal.aborted) return { kind: "aborted" };
  const eventById = new Map(match.events.map((e) => [e.eventId, e]));

  // Pans: keyframes are absolute video seconds, so they move with the cut.
  if (before) {
    const patches: ClipPatch[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const kfs = row.clip.cropKeyframes;
        const event = eventById.get(row.clip.eventId);
        if (!kfs?.length || !event) return;
        const was = computeVideoTime(event, before);
        const now = computeVideoTime(event, after);
        if (was === null || now === null || Math.abs(now - was) < 0.001) return;
        const moved = shiftKeyframes(kfs, now - was);
        try {
          await updateClip(sb, row.playlistId, row.clip.matchId, row.clip.eventId, { cropKeyframes: moved });
          row.clip.cropKeyframes = moved;
          patches.push({ playlistId: row.playlistId, matchId: row.clip.matchId, eventId: row.clip.eventId, cropKeyframes: moved });
        } catch (e) {
          reportDbError("followSyncChange.pan", { message: message(e) });
        }
      }),
    );
    if (patches.length > 0) deps.onPatches?.(patches);
  }

  // Shared clips whose cut moved.
  const canCut = await deps.canCut(match.videoUrl);
  if (signal.aborted) return { kind: "aborted" };
  const plan = planSyncRecut(rows, eventById, after, canCut);
  if (plan.hide.length > 0) {
    const hidden = await hideClips(sb, plan.hide, deps);
    return { kind: "hidden", hidden: hidden.length };
  }
  if (plan.recut.length === 0) return { kind: "nothing" };

  // One run per playlist and roll pair: a clip keeps the length it was cut at.
  const groups = new Map<string, typeof plan.recut>();
  for (const item of plan.recut) {
    const key = `${item.row.playlistId}|${item.rolls.pre}|${item.rolls.post}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const total = plan.recut.length;
  let done = 0;
  let shipped = 0;
  const failedRows: OwnMatchClip[] = [];
  for (const group of groups.values()) {
    if (signal.aborted) break;
    const { row: first, rolls } = group[0];
    const groupRows = group.map((g) => g.row);
    const start = done;
    let outcome: RecutOutcome;
    try {
      outcome = await deps.recut({ playlistId: first.playlistId, playlistName: first.playlistName, rolls, rows: groupRows }, start, total, signal);
    } catch (e) {
      // The whole group couldn't be cut (e.g. the file went away mid-run).
      reportDbError("followSyncChange.recut", { message: message(e) });
      failedRows.push(...groupRows);
      done = start + groupRows.length;
      continue;
    }
    done = start + groupRows.length;
    shipped += outcome.shipped;
    const failedIds = new Set(outcome.failedEventIds);
    failedRows.push(...groupRows.filter((r) => failedIds.has(r.clip.eventId)));
    if (outcome.uploaded.length > 0) {
      deps.onPatches?.(outcome.uploaded.map((u) => ({ playlistId: first.playlistId, matchId: u.matchId, eventId: u.eventId, r2Url: u.r2Url })));
    }
    if (outcome.aborted) break;
  }
  if (signal.aborted) return { kind: "aborted" };
  const hidden = failedRows.length > 0 ? await hideClips(sb, failedRows, deps) : [];
  return {
    kind: "recut",
    shipped,
    failed: failedRows.length,
    hidden: hidden.length,
    playlists: new Set(plan.recut.map((r) => r.row.playlistId)).size,
  };
}
