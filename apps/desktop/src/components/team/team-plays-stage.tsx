import { Plus, Tag } from "lucide-react";
import { describePlay, playClock } from "@scoutable/shared/lib/events";
import type { Label } from "@scoutable/shared/types/labels";
import type { ClipBrowserLabelHandlers } from "@/components/editor/clip-browser-panel";
import { PlayerStage } from "@/components/editor/player-stage";
import { LabelPickerPopover } from "@/components/labels/LabelPickerPopover";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { gameTitle } from "./team-play-list";
import type { useCrossGamePlayback } from "./use-cross-game-playback";

/**
 * Plays' stage: the play's video with the opponent and clock over it, and
 * under it the play in words with Label (G) and Add (A), as the game view's
 * now bar has them.
 */
export function TeamPlaysStage({
  video,
  playback,
  why,
  speed,
  onSpeedChange,
  labels,
  assigned,
  labelHandlers,
  labelOpen,
  onLabelOpenChange,
  onAdd,
  added,
}: {
  video: HTMLVideoElement;
  playback: ReturnType<typeof useCrossGamePlayback>;
  /** Why the play shown can't play here, if it can't. */
  why: "ok" | "video" | "sync" | null;
  speed: number;
  onSpeedChange: (speed: number) => void;
  labels: readonly Label[];
  /** The labels on the play shown. */
  assigned: ReadonlySet<string>;
  labelHandlers: ClipBrowserLabelHandlers;
  labelOpen: boolean;
  onLabelOpenChange: (open: boolean) => void;
  onAdd: (anchor: HTMLElement) => void;
  /** The play shown is in the target playlist already. */
  added: boolean;
}) {
  const cur = playback.current;
  return (
    <>
      <div className="relative">
        <PlayerStage
          video={video}
          src={why === "ok" || why === null ? playback.src : null}
          title={cur ? `${gameTitle(cur.game)} · ${playClock(cur.event)}` : undefined}
          clipWindow={playback.clipWindow}
          onSeek={(t) => {
            video.currentTime = t;
          }}
          transport={{
            isQueueActive: playback.running,
            canPrev: playback.running,
            canNext: playback.running,
            onPrev: playback.previous,
            onNext: playback.next,
            onReplay: playback.replay,
            onStop: playback.stop,
            onPlayAll: playback.playAll,
          }}
          speed={speed}
          onSpeedChange={onSpeedChange}
        >
          {cur && (
            <div className="pointer-events-none absolute top-2.5 left-3 z-[11] rounded-md bg-black/55 px-2 py-0.5 text-subheadline text-white nums">
              {cur.game.home ? "vs" : "at"} {cur.game.opponentName} · {playClock(cur.event)}
            </div>
          )}
          {cur && why && why !== "ok" && (
            <div className="absolute inset-0 z-[12] flex items-center justify-center bg-black/85 px-6 text-center text-sm text-white">
              {why === "video" ? "This game's video isn't on this computer." : "This game isn't synced yet."}
            </div>
          )}
        </PlayerStage>
      </div>
      {cur ? (
        <div className="flex items-center gap-2 rounded-lg bg-fill-1 px-3 py-2 ring-1 ring-separator">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium nums">
              {playClock(cur.event)} · {describePlay(cur.event)}
            </p>
            <p className="truncate text-subheadline text-muted-foreground nums">{gameTitle(cur.game)}</p>
          </div>
          <LabelPickerPopover
            open={labelOpen}
            onOpenChange={onLabelOpenChange}
            trigger={
              <Button size="sm" variant="outline" title="Label (G)">
                <Tag />
                Label
                <Kbd>G</Kbd>
              </Button>
            }
            labels={[...labels]}
            assignedAllIds={new Set(assigned)}
            assignedSomeIds={new Set()}
            onToggle={(labelId, state) => labelHandlers.onToggleClip(cur.game.gameId, cur.event.eventId, labelId, state)}
            onCreate={labelHandlers.onCreate}
            onRename={labelHandlers.onRename}
            onRecolor={labelHandlers.onRecolor}
            onDelete={labelHandlers.onDelete}
            onSetKey={labelHandlers.onSetKey}
            onSeedDefaults={labelHandlers.onSeedDefaults}
          />
          <Button size="sm" onClick={(e) => onAdd(e.currentTarget)} disabled={added} title={added ? "In the playlist" : "Add to the playlist (A)"}>
            <Plus />
            {added ? "Added" : "Add"}
            {!added && <Kbd className="bg-white/20 text-current">A</Kbd>}
          </Button>
        </div>
      ) : (
        <p className="px-1 text-subheadline text-muted-foreground">Choose a play to watch it. Plays run on from one game into the next.</p>
      )}
    </>
  );
}
