"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { eventColors, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import { clamp } from "@scoutable/shared/lib/motion-math";
import {
  NUDGE_FAR_SECONDS,
  NUDGE_SECONDS,
  nextShuttleRate,
  resolvePlayerKey,
} from "@scoutable/shared/lib/player-keys";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";
import { PlayerStage, type PlayerStageHandle } from "@/components/player/player-stage";
import { useMediaDuration, useMediaElement } from "@/components/player/use-media";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WatchClipRow, WatchTextCardRow } from "./ClipRow";
import { useWatchQueue } from "./use-watch-queue";

const SPEED_KEY = "scoutable_watch_speed";

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * Watching a shared playlist: the player, what's playing (with the coach's
 * note right under the footage, where the eye already is), and the clip
 * list. Beside each other on a wide screen, where the player stays put
 * while the list scrolls; stacked on a phone, where the player sticks under
 * the navigation bar and the list scrolls beneath it.
 */
export function WatchView({
  title,
  items,
  matchTitleFor,
  isWatched,
  onWatched,
  progress,
  startKey,
  autoplay,
  onAutoplayStarted,
  emptyText,
}: {
  title: string;
  items: WatchItem[];
  /** The game a clip comes from, in multi-game playlists; undefined otherwise. */
  matchTitleFor: (matchId: string) => string | undefined;
  isWatched: (matchId: string, eventId: number) => boolean;
  onWatched: (matchId: string, eventId: number) => void;
  progress: { watched: number; total: number };
  /** Where Play and Resume start: the first clip not yet watched. */
  startKey: string | null;
  /** Opened with Resume: start playing straight away. */
  autoplay: boolean;
  onAutoplayStarted: () => void;
  emptyText: string;
}) {
  const { element: video, ref: videoRef, attach: attachVideo } = useMediaElement<HTMLVideoElement>();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageHandle = useRef<PlayerStageHandle | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionSafe();
  const [speed, setSpeedState] = useState(readSpeed);
  const duration = useMediaDuration(video);
  const fullscreen = useStageFullscreen(stage);

  const setSpeed = useCallback((next: number) => {
    setSpeedState(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // Remembering the speed is a convenience.
    }
  }, []);

  const q = useWatchQueue({ video, videoRef, items, onWatched });
  const activeClip = q.activeItem?.kind === "clip" ? q.activeItem : null;
  const activeCard = q.activeItem?.kind === "text" ? q.activeItem.card : null;

  const { playFrom } = q;
  const resume = useCallback(() => {
    if (items.length === 0) return;
    playFrom(startKey ?? items[0].key);
  }, [items, startKey, playFrom]);

  // Opened with Resume: start once, on arrival (once the player exists).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!autoplay || startedRef.current || !video || items.length === 0) return;
    startedRef.current = true;
    resume();
    onAutoplayStarted();
  }, [autoplay, video, items.length, resume, onAutoplayStarted]);

  const seek = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (el && duration !== null) el.currentTime = clamp(t, 0, Math.max(0, duration - 0.05));
    },
    [videoRef, duration],
  );

  useKeyScope("watch", true);
  useHotkeys("watch", (e) => {
    const action = resolvePlayerKey(e);
    if (!action) return;
    const nudge = (delta: number) => {
      if (!activeClip || !video) return;
      seek(video.currentTime + delta);
    };
    switch (action) {
      case "next":
      case "prev": {
        e.preventDefault();
        if (items.length === 0) return;
        if (q.position < 0) q.playIndex(action === "next" ? 0 : items.length - 1);
        else if (action === "next") q.next();
        else q.prev();
        return;
      }
      case "first":
      case "last":
        if (items.length === 0) return;
        e.preventDefault();
        q.playIndex(action === "first" ? 0 : items.length - 1);
        return;
      case "toggle-play":
        e.preventDefault();
        stageHandle.current?.togglePlay();
        return;
      case "replay":
        e.preventDefault();
        q.replay();
        return;
      case "nudge-back":
        e.preventDefault();
        nudge(-NUDGE_SECONDS);
        return;
      case "nudge-forward":
        e.preventDefault();
        nudge(NUDGE_SECONDS);
        return;
      case "nudge-back-far":
        e.preventDefault();
        nudge(-NUDGE_FAR_SECONDS);
        return;
      case "nudge-forward-far":
        e.preventDefault();
        nudge(NUDGE_FAR_SECONDS);
        return;
      case "shuttle-back":
        // Browsers have no reverse playback; stepping back is the honest version.
        e.preventDefault();
        nudge(-5);
        return;
      case "shuttle-pause":
        e.preventDefault();
        video?.pause();
        return;
      case "shuttle-forward":
        e.preventDefault();
        setSpeed(nextShuttleRate(speed));
        if (activeClip && video?.paused) video.play().catch(() => {});
        return;
      case "fullscreen":
        e.preventDefault();
        fullscreen.toggle();
        return;
      case "escape":
        if (fullscreen.active) {
          e.preventDefault();
          void fullscreen.exit();
        }
        return;
      default:
        return;
    }
  });

  // Keep the playing row in view as the queue advances.
  useEffect(() => {
    if (!q.activeKey) return;
    listRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(q.activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [q.activeKey, reduced]);

  const pct = progress.total > 0 ? (progress.watched / progress.total) * 100 : 0;
  const activeColors = activeClip ? eventColors(activeClip.event) : null;

  return (
    <div className="@container/watch pb-[calc(var(--safe-bottom)+1.5rem)]">
      <div className="flex flex-col @min-[860px]/watch:flex-row @min-[860px]/watch:items-start @min-[860px]/watch:gap-6 @min-[860px]/watch:px-6 @min-[860px]/watch:pt-1">
        {/* The player and what's playing. Stacked, this box steps aside
            (display: contents) so the player's sticky range is the whole
            column, list included; side by side, it is the sticky column. */}
        <div className="contents @min-[860px]/watch:sticky @min-[860px]/watch:top-[calc(var(--page-bar-height)+0.25rem)] @min-[860px]/watch:flex @min-[860px]/watch:min-w-0 @min-[860px]/watch:flex-1 @min-[860px]/watch:flex-col @min-[860px]/watch:gap-3">
          {/* Stacked, the player sticks under the bar while the list scrolls
              beneath it, and stops short of the screen's height. */}
          <div
            className={cn(
              // Above the rows (their contents sit at z-10), under the toolbar.
              "sticky top-[var(--page-bar-height)] z-20 bg-black @min-[860px]/watch:static @min-[860px]/watch:bg-transparent",
              // The full-window layer lives inside this box: lift the box
              // above the toolbar and the list, or they paint over it.
              fullscreen.layer && "z-[60]",
            )}
          >
            <div className="mx-auto w-full max-w-[calc(55dvh*16/9)] @min-[860px]/watch:max-w-[calc((100dvh-var(--page-bar-height)-10rem)*16/9)]">
              <PlayerStage
                handleRef={stageHandle}
                attachVideo={attachVideo}
                video={video}
                videoRef={videoRef}
                stageRef={setStage}
                stage={stage}
                src={q.src}
                duration={activeClip ? duration : null}
                onSeek={seek}
                fullscreen={fullscreen}
                title={title}
                position={q.position >= 0 ? { index: q.position, total: items.length } : null}
                transport={{
                  canPrev: q.canPrev,
                  canNext: q.canNext,
                  isQueueActive: q.isQueueActive,
                  onPrev: q.prev,
                  onNext: q.next,
                  onReplay: q.replay,
                  onStop: q.stop,
                  onPlayAll: resume,
                }}
                speed={speed}
                onSpeedChange={setSpeed}
                playback={activeCard ? { paused: q.cardPaused, toggle: q.toggleCard } : undefined}
                className="@min-[860px]/watch:rounded-lg"
              >
                {activeCard && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="px-8 text-center text-2xl font-semibold text-white sm:text-4xl">{activeCard.text}</p>
                  </div>
                )}
                {/* Narrow, the controls' own centre button plays instead. */}
                {!q.isQueueActive && q.src === null && items.length > 0 && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center @max-[559px]/stage:hidden">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resume();
                      }}
                      className="dark flex items-center gap-2 rounded-full bg-black/55 px-5 py-2.5 text-sm font-medium text-white shadow-menu ring-1 ring-white/15 backdrop-blur-xl transition-[background-color,transform] duration-100 hover:bg-black/70 active:scale-[0.97] pointer-coarse:px-6 pointer-coarse:py-3"
                    >
                      <Play className="size-4 fill-current" />
                      {progress.watched > 0 && progress.watched < progress.total ? "Resume" : "Play"}
                    </button>
                  </div>
                )}
              </PlayerStage>
            </div>
          </div>

          {activeClip && activeColors && (
            <div className="flex flex-col gap-2 px-4 pt-3 sm:px-6 @min-[860px]/watch:px-1 @min-[860px]/watch:pt-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-callout font-medium", activeColors.badge)}>
                  {eventLabel(activeClip.event)}
                </span>
                <span className="truncate text-title-3">{playerName(activeClip.event)}</span>
              </div>
              <p className="text-callout text-muted-foreground nums">
                {[
                  `Q${activeClip.event.period}`,
                  formatGameClock(activeClip.event.gameClockTime),
                  activeClip.event.eventTeam?.teamName,
                  matchTitleFor(activeClip.matchId),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {activeClip.note && (
                <figure className="rounded-window bg-fill-1 px-3.5 py-2.5">
                  <figcaption className="text-subheadline text-muted-foreground">Note from your coach</figcaption>
                  <blockquote className="mt-0.5 whitespace-pre-wrap text-body text-foreground">{activeClip.note}</blockquote>
                </figure>
              )}
            </div>
          )}
        </div>

        {/* The list */}
        <div className="flex flex-col @min-[860px]/watch:w-[340px] @min-[860px]/watch:shrink-0">
          <div className="flex items-center gap-3 px-4 pt-4 pb-2 sm:px-6 @min-[860px]/watch:px-3 @min-[860px]/watch:pt-0">
            <span className="text-headline">Clips</span>
            {progress.total > 0 && (
              <>
                <ProgressBar percent={pct} className="h-1 flex-1" />
                <span className="shrink-0 text-subheadline text-muted-foreground nums">
                  {progress.watched} of {progress.total} watched
                </span>
              </>
            )}
          </div>
          <div ref={listRef} className="flex flex-col sm:px-2 @min-[860px]/watch:px-0">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-callout text-muted-foreground">{emptyText}</p>
            ) : (
              items.map((item) =>
                item.kind === "text" ? (
                  <WatchTextCardRow
                    key={item.key}
                    rowKey={item.key}
                    card={item.card}
                    active={q.activeKey === item.key}
                    onPlay={() => q.playFrom(item.key)}
                  />
                ) : (
                  <WatchClipRow
                    key={item.key}
                    rowKey={item.key}
                    event={item.event}
                    matchTitle={matchTitleFor(item.matchId)}
                    note={item.note}
                    watched={isWatched(item.matchId, item.event.eventId)}
                    active={q.activeKey === item.key}
                    onPlay={() => q.playFrom(item.key)}
                  />
                ),
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
