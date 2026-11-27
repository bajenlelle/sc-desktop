/**
 * Makes the player's highlight video from the Highlights page: the plan (shared highlight-render.ts), its graphics
 * (highlight-painter.ts), then the app's own export at 9:16 with hard cuts and no music. Returns the saved file's
 * path, or null when the save panel was cancelled.
 */
import type { MyGame } from "@scoutable/shared/lib/highlight-games";
import {
  finalScore,
  HIGHLIGHT_END_CARD_SECONDS,
  highlightRenderPlan,
  type HighlightPlanGame,
  type HighlightPlanInput,
} from "@scoutable/shared/lib/highlight-render";
import type { MyPlayer } from "@scoutable/shared/lib/my-player-db";
import { exportPlaylist, type ExportOptions, type ExportSegment } from "@/lib/export";
import { highlightEndCardPng, highlightOverlayPng } from "@/lib/highlight-painter";
import type { Framing, HighlightPlay } from "@/lib/use-highlights";

/** The end card's line, read with the wordmark under it. */
export const END_CARD_LINE = "Clipped automatically with";

export interface CreateHighlightArgs {
  plays: HighlightPlay[];
  framing: Map<string, Framing>;
  mine: MyGame[];
  player: MyPlayer;
  watermark: boolean;
  opts?: Pick<ExportOptions, "onProgress" | "signal" | "onPathChosen">;
}

/** The video's segments: every play with its graphics, then the end card. Throws when no play can be placed. */
export async function buildHighlightSegments({ plays, framing, mine, player }: Omit<CreateHighlightArgs, "watermark" | "opts">): Promise<{ segments: ExportSegment[]; clips: number; seconds: number }> {
  const inputs: HighlightPlanInput[] = plays.flatMap((p) => {
    const f = framing.get(p.candidate.key);
    const ready = f?.state === "ready" ? f.clip : null;
    const window = ready?.window ?? p.window;
    if (!window) return [];
    return [{ candidate: p.candidate, window, cropKeyframes: ready?.keyframes ?? [] }];
  });
  const games = new Map<string, HighlightPlanGame>();
  for (const p of plays) {
    const m = p.match;
    if (games.has(m.id) || !m.syncPoint || !m.videoUrl) continue;
    games.set(m.id, {
      id: m.id,
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      videoPath: m.videoUrl,
      syncPoint: m.syncPoint,
      line: mine.find((g) => g.id === m.id)?.line ?? "",
      finalScore: finalScore(m.events),
    });
  }
  const plan = highlightRenderPlan(inputs, games, player);
  if (plan.length === 0) throw new Error("None of these plays can be found in their game's video.");

  const overlays = await Promise.all(plan.map((c) => highlightOverlayPng(c.overlay)));
  const endCard = await highlightEndCardPng(END_CARD_LINE);
  const segments: ExportSegment[] = [
    ...plan.map((c, i): ExportSegment => ({
      kind: "clip",
      videoPath: c.videoPath,
      matchId: c.matchId,
      event: c.anchor,
      syncPoint: c.syncPoint,
      preRollOffset: c.preRollOffset,
      postRollOffset: c.postRollOffset,
      cropKeyframes: c.cropKeyframes,
      overlays: [{ pngBase64: overlays[i] }],
    })),
    { kind: "image", pngBase64: endCard, durationSeconds: HIGHLIGHT_END_CARD_SECONDS },
  ];
  const seconds = plan.reduce((s, c) => s + c.preRollOffset + c.postRollOffset, HIGHLIGHT_END_CARD_SECONDS);
  return { segments, clips: plan.length, seconds };
}

/** The file's name and the share's title. */
export const highlightVideoName = (player: MyPlayer) => `${player.name} highlights`;

export async function createHighlightVideo({ watermark, opts, ...args }: CreateHighlightArgs): Promise<{ path: string | null; clips: number; seconds: number }> {
  const { segments, clips, seconds } = await buildHighlightSegments(args);
  const path = await exportPlaylist(segments, 0, 0, highlightVideoName(args.player), watermark, true, { ...opts, hardCuts: true });
  return { path, clips, seconds };
}
