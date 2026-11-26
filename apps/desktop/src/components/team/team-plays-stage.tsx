import { useRef } from "react";
import { playClock } from "@scoutable/shared/lib/events";
import type { Label } from "@scoutable/shared/types/labels";
import type { ClipBrowserLabelHandlers } from "@/components/editor/clip-browser-panel";
import { PLAYER_DOCK_HEIGHT, PlayerStage } from "@/components/editor/player-stage";
import { GameLabelKeys } from "@/components/game/game-label-keys";
import { GameNowBar } from "@/components/game/game-now-bar";
import type { CollectStatus } from "@/components/game/game-play-row";
import { LabelPickerPopover } from "@/components/labels/LabelPickerPopover";
import { gameTitle } from "./team-play-list";
import type { useCrossGamePlayback } from "./use-cross-game-playback";

/** Under the stage, in its column: the player's controls, then the Now bar with its air (the selection's pill floats over the list). */
export const TEAM_UNDER_STAGE = PLAYER_DOCK_HEIGHT + 52;

/**
 * Plays' stage: the play's video with the opponent and clock over it, and
 * under it the game view's Now bar: the play in words with its labels, the
 * same label again (⇧G), Label (G) and Add (A). Option held shows which label
 * each key puts on, over the corner of the footage, as in the game view.
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
  lastLabel,
  onLabelAgain,
  keysShown,
  onAdd,
  status,
  targetName,
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
  /** The label used last: one press puts it on the play, without the picker. */
  lastLabel: Label | null;
  onLabelAgain: () => void;
  /** Option is held: show which label each key puts on. */
  keysShown: boolean;
  onAdd: (anchor: HTMLElement | null) => void;
  /** Whether the play shown is in the target playlist. */
  status: CollectStatus;
  targetName: string | null;
}) {
  const cur = playback.current;
  const addRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <div className="relative w-full">
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
          {/* On the footage, clear of the controls under it. */}
          {keysShown && <GameLabelKeys labels={labels} on={cur ? assigned : undefined} />}
        </PlayerStage>
      </div>
      {cur ? (
        <GameNowBar
          play={{ key: cur.key, event: cur.event, time: 0, start: 0, reach: "in" }}
          footage
          moment={null}
          score={null}
          breakScore={null}
          details={[]}
          game={{ id: cur.game.gameId, title: cur.game.title ?? gameTitle(cur.game), label: gameTitle(cur.game) }}
          labels={labels.filter((l) => assigned.has(l.id))}
          collect={status}
          targetName={targetName}
          labelButton={(trigger) => (
            <LabelPickerPopover
              open={labelOpen}
              onOpenChange={onLabelOpenChange}
              trigger={trigger}
              side="top"
              align="end"
              labels={[...labels]}
              assignedAllIds={new Set(assigned)}
              onToggle={(labelId, state) => labelHandlers.onToggleClip(cur.game.gameId, cur.event.eventId, labelId, state)}
              onCreate={labelHandlers.onCreate}
              onRename={labelHandlers.onRename}
              onRecolor={labelHandlers.onRecolor}
              onDelete={labelHandlers.onDelete}
              onSetKey={labelHandlers.onSetKey}
              onSeedDefaults={labelHandlers.onSeedDefaults}
            />
          )}
          lastLabel={lastLabel}
          onLabelAgain={onLabelAgain}
          addRef={addRef}
          onAdd={() => onAdd(addRef.current)}
          onSkip={null}
        />
      ) : (
        <p className="flex h-11 shrink-0 items-center px-1 text-callout text-muted-foreground">
          Choose a play to watch it. Plays run on from one game into the next.
        </p>
      )}
    </>
  );
}
