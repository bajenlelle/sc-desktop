/**
 * Typed client for the `highlight-frame` edge function, which finds a player, the release and the rim in a clip's
 * frames with Claude, and the one routine that frames a highlight clip end to end: sample the frames, ask, and turn
 * the answer into crop keyframes (`highlight-framing.ts`). Frame grabbing is injected, so this stays free of
 * platform code (the desktop passes its `grab_frames` command). Same invoke/error-token pattern as
 * `tipoff-detect-client.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayByPlayEvent } from "../types/match";
import type { CropKeyframe } from "./crop-path";
import { eventLabel, playClock, playerName } from "./events";
import type { HighlightCandidate } from "./highlight-picks";
import {
  needsCheck,
  observationToKeyframes,
  sampleTimes,
  suggestedWindow,
  type ClipObservation,
} from "./highlight-framing";

export type HighlightFrameResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface FrameUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  fallback: boolean;
}

export interface FrameClipRequest {
  frames: { jpegBase64: string }[];
  /** Who to follow: "#78 Alex Berg of Fryshuset Basketbollklubb". */
  target: string;
  /** The teams and what the play-by-play says about the clip. */
  context: string;
  /** The clip ends in the target's made basket: also find the release and the rim. */
  shot: boolean;
}

export interface FrameClipResponse {
  observation: ClipObservation;
  usage: FrameUsage;
}

/** Errors the page doesn't report: the feature switched off, or the daily limit reached. */
export const SILENT_FRAME_ERRORS = new Set(["framing_disabled", "too_many_requests", "framing_unavailable"]);

export async function frameClip(supabase: SupabaseClient, req: FrameClipRequest): Promise<HighlightFrameResult<FrameClipResponse>> {
  const { data, error } = await supabase.functions.invoke("highlight-frame", { body: req });
  if (error) {
    let token = "request_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        token = (await ctx.json())?.error ?? token;
      } catch {
        // keep the generic token
      }
    }
    return { ok: false, error: token };
  }
  return { ok: true, data: data as FrameClipResponse };
}

/** "#78 Alex Berg of Fryshuset Basketbollklubb": who Claude follows. */
export function framingTarget(anchor: PlayByPlayEvent, teams: { home: string; away: string }): string {
  const p = anchor.player;
  const team = p?.teamNumber === 2 ? teams.away : teams.home;
  return `${p?.pno ? `#${p.pno} ` : ""}${playerName(anchor)} of ${team}`;
}

/** The teams and the play-by-play lines of the clip, as the measured test phrased them. */
export function framingContext(c: HighlightCandidate, teams: { home: string; away: string; league?: string }): string {
  const lines = c.events.map((e) => {
    const who = e.player ? `${e.player.pno ? `#${e.player.pno} ` : ""}${playerName(e)}` : "";
    const score = e.scoreHome != null && e.scoreAway != null && (e.type === "2pt" || e.type === "3pt") ? ` (score ${e.scoreHome}-${e.scoreAway})` : "";
    return `${playClock(e)}: ${eventLabel(e)}${who ? ` by ${who}` : ""}${score}`;
  });
  return `${teams.home} (home) vs ${teams.away} (away)${teams.league ? `, ${teams.league}` : ""}. Play-by-play for this clip: ${lines.join("; ")}.`;
}

export interface FramedClip {
  keyframes: CropKeyframe[];
  /** A tighter start and end around the shot, in source seconds; null to keep the window as it was. */
  window: { start: number; end: number } | null;
  /** Show "Check" on the tile: Claude was unsure, or lost the player for long. */
  check: boolean;
  observation: ClipObservation;
  usage: FrameUsage;
}

export interface FrameHighlightDeps {
  supabase: SupabaseClient;
  /** JPEG frames (base64) of the source video at these times, 960 px wide, in the same order. */
  grab: (times: number[]) => Promise<string[]>;
  signal?: AbortSignal;
}

/**
 * Frames one candidate: samples its window at 4 frames a second, asks Claude, and returns crop keyframes for a
 * 9:16 window of `cropWFrac` (crop-path's `cropWidthFrac` of the source). A made basket also gets the pan to the
 * rim and a tighter window.
 */
export async function frameHighlight(
  deps: FrameHighlightDeps,
  c: HighlightCandidate,
  window: { start: number; end: number },
  teams: { home: string; away: string; league?: string },
  cropWFrac: number,
): Promise<HighlightFrameResult<FramedClip>> {
  const times = sampleTimes(window.start, window.end);
  const frames = await deps.grab(times);
  if (deps.signal?.aborted) return { ok: false, error: "cancelled" };
  if (frames.length !== times.length) return { ok: false, error: "grab_failed" };
  const shot = c.anchor.type === "2pt" || c.anchor.type === "3pt";
  const res = await frameClip(deps.supabase, {
    frames: frames.map((jpegBase64) => ({ jpegBase64 })),
    target: framingTarget(c.anchor, teams),
    context: framingContext(c, teams),
    shot,
  });
  if (!res.ok) return res;
  const { observation, usage } = res.data;
  return {
    ok: true,
    data: {
      keyframes: observationToKeyframes(times, observation, cropWFrac, shot),
      window: shot ? suggestedWindow(times, observation) : null,
      check: needsCheck(observation, times.length),
      observation,
      usage,
    },
  };
}
