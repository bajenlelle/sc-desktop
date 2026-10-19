"use client";

import { Play } from "lucide-react";
import { PlayerStage } from "@/components/player/player-stage";
import { CardImage } from "@/components/stats-card/card-image";
import { ClipTrimmer } from "./clip-trimmer";
import type { EditorPlayback } from "./use-editor-playback";

/**
 * The editor's stage: the owner's cloud copies played as windows through
 * the watch queue, a card over black footage while it shows (a stats card
 * painted as it exports), Play when
 * nothing is up, and the trim bar in the chrome while a clip's ends are on
 * handles. The playlist's keys arrive through the stage's handle.
 */
export function EditorPlayer({ playback, title, playableCount, onPlayAll, className }: { playback: EditorPlayback; title: string; playableCount: number; onPlayAll: () => void; className?: string }) {
  const { q, video, activePlay, activeWindow, activeCard, trim } = playback;
  return (
    <PlayerStage
      handleRef={playback.stageHandle}
      attachVideo={playback.attachVideo}
      video={video}
      videoRef={playback.videoRef}
      stageRef={playback.setStage}
      stage={playback.stage}
      src={q.src}
      duration={activePlay ? (activeWindow ? activeWindow.end - activeWindow.start : playback.duration) : null}
      clipWindow={activeWindow ? { start: activeWindow.start, end: activeWindow.end } : null}
      onSeek={playback.seek}
      fullscreen={playback.fullscreen}
      title={title}
      position={q.position >= 0 ? { index: q.position, total: playback.items.length } : null}
      transport={{
        canPrev: q.canPrev,
        canNext: q.canNext,
        isQueueActive: q.isQueueActive,
        onPrev: q.prev,
        onNext: q.next,
        onReplay: q.replay,
        onStop: q.stop,
        onPlayAll,
      }}
      speed={playback.speed}
      onSpeedChange={playback.setSpeed}
      playback={activeCard ? { paused: q.cardPaused, toggle: q.toggleCard } : undefined}
      trimBar={
        trim && video ? (
          <ClipTrimmer
            key={trim.key}
            video={video}
            eventTime={trim.eventTime}
            initial={{ start: trim.start, end: trim.end }}
            onCancel={() => playback.endTrim(null)}
            onDone={(w) => playback.endTrim(w)}
          />
        ) : undefined
      }
      className={className}
    >
      {activeCard && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black" onClick={(e) => e.stopPropagation()}>
          {/* A stats card is drawn as it exports (the players' watch view draws it the same); a text card is its line. */}
          {activeCard.card ? (
            <CardImage source={activeCard} aspect="16:9" className="size-full" />
          ) : (
            <p className="px-8 text-center text-2xl font-semibold text-white sm:text-4xl">{activeCard.text}</p>
          )}
        </div>
      )}
      {/* Narrow, the controls' own centre button plays instead. */}
      {!q.isQueueActive && !trim && q.src === null && playableCount > 0 && (
        <div className="absolute inset-0 z-30 flex items-center justify-center @max-[559px]/stage:hidden">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayAll();
            }}
            className="dark flex items-center gap-2 rounded-full bg-black/55 px-5 py-2.5 text-sm font-medium text-white shadow-menu ring-1 ring-white/15 backdrop-blur-xl transition-[background-color,transform] duration-100 hover:bg-black/70 active:scale-[0.97] pointer-coarse:px-6 pointer-coarse:py-3"
          >
            <Play className="size-4 fill-current" />
            Play
          </button>
        </div>
      )}
    </PlayerStage>
  );
}
