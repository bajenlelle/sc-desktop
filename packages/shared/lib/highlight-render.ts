/**
 * What a player's highlight video contains, before anything is painted: the plays in the order the player set,
 * each clip's window in its game's video and its 9:16 framing, what is drawn over each clip, and the end card.
 *
 * The shape (2026-11-27, from the hand-made template in player-highlights/): the first play is the hook and
 * carries the player's line and name from frame 0; every other play carries a small label like its row in the app
 * ("Q1 05:43 · 2PT made · 13–15"); the video ends on a short end card. Hard cuts, no music.
 *
 * Pure: the desktop paints the overlays (lib/highlight-painter.ts) and renders with its export.
 */
import type { PlayByPlayEvent, SyncPoint } from "../types/match";
import { computeVideoTime } from "./clip-timing";
import type { CropKeyframe } from "./crop-path";
import { formatGameClock, periodLabel, playerName } from "./events";
import type { HighlightCandidate, HighlightKind } from "./highlight-picks";

export type HighlightOverlay =
  | { kind: "hook"; line: string; who: string }
  | { kind: "label"; clock: string; play: string; score: string | null; kindOf: HighlightKind };

export interface HighlightClipPlan {
  key: string;
  matchId: string;
  videoPath: string;
  /** The play the clip is timed from; the window is set with offsets around it (preRoll and postRoll are 0). */
  anchor: PlayByPlayEvent;
  syncPoint: SyncPoint;
  preRollOffset: number;
  postRollOffset: number;
  cropKeyframes: CropKeyframe[];
  overlay: HighlightOverlay;
}

export interface HighlightPlanGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  videoPath: string;
  syncPoint: SyncPoint;
  /** The player's line in the game: "22 pts · 6 reb". */
  line: string;
  /** The final score, "76–59", when the feed has one. */
  finalScore: string | null;
}

export interface HighlightPlanInput {
  candidate: HighlightCandidate;
  /** The clip's window in source seconds (the framing's tighter one when it has one). */
  window: { start: number; end: number };
  cropKeyframes: CropKeyframe[];
}

/** "Dunk", "3PT made", "Steal + layup": what a label says the play is. */
export function playLabel(c: HighlightCandidate): string {
  const shot = c.kind === "dunk" ? "Dunk" : c.kind === "three" ? "3PT made" : c.kind === "two" ? "2PT made" : c.kind === "block" ? "Block" : "Steal";
  const name = c.events.length > 1 ? `Steal + ${shot === "Dunk" ? "dunk" : "basket"}` : shot;
  return c.andOne ? `${name}, and one` : name;
}

/** The score after the play, the player's team's side first: "13–15" becomes "15–13" for the away team. */
export function playScore(e: PlayByPlayEvent): string | null {
  if (e.scoreHome == null || e.scoreAway == null) return null;
  const away = e.player?.teamNumber === 2;
  return away ? `${e.scoreAway}–${e.scoreHome}` : `${e.scoreHome}–${e.scoreAway}`;
}

/** The last running score in a game's plays, "home–away". */
export function finalScore(events: PlayByPlayEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.scoreHome != null && e.scoreAway != null && (e.scoreHome > 0 || e.scoreAway > 0)) return `${e.scoreHome}–${e.scoreAway}`;
  }
  return null;
}

const firstWord = (team: string) => team.split(" ")[0];

/**
 * The clips in the video's order. Plays without a window, or whose game has no sync point, are left out; the first
 * clip left is the hook.
 */
export function highlightRenderPlan(
  plays: HighlightPlanInput[],
  games: Map<string, HighlightPlanGame>,
  player: { name: string; number: string | null },
): HighlightClipPlan[] {
  const out: HighlightClipPlan[] = [];
  for (const p of plays) {
    const g = games.get(p.candidate.matchId);
    if (!g) continue;
    const anchor = p.candidate.anchor;
    const t = computeVideoTime(anchor, g.syncPoint);
    if (t == null || !(p.window.end > p.window.start)) continue;
    const hook = out.length === 0;
    const overlay: HighlightOverlay = hook
      ? {
          kind: "hook",
          line: g.line,
          who: [`${player.number ? `#${player.number} ` : ""}${player.name || playerName(anchor)}`, `${firstWord(g.homeTeam)} ${g.finalScore ?? "–"} ${firstWord(g.awayTeam)}`].join(" · "),
        }
      : {
          kind: "label",
          clock: `${periodLabel(anchor.period)} ${formatGameClock(anchor.gameClockTime ?? "")}`.trim(),
          play: playLabel(p.candidate),
          score: playScore(anchor),
          kindOf: p.candidate.kind,
        };
    out.push({
      key: p.candidate.key,
      matchId: g.id,
      videoPath: g.videoPath,
      anchor,
      syncPoint: g.syncPoint,
      preRollOffset: t - p.window.start,
      postRollOffset: p.window.end - t,
      cropKeyframes: p.cropKeyframes,
      overlay,
    });
  }
  return out;
}

/** How long the end card shows. */
export const HIGHLIGHT_END_CARD_SECONDS = 2;
