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
import { PlayerStage, type PlayerStageHandle } from "@/components/editor/player-stage";
import { usePersistentVideo } from "@/components/editor/use-persistent-video";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { useReducedMotionSafe } from "@/lib/motion";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { cn } from "@/lib/utils";
import { WatchClipRow, WatchTextCardRow } from "./ClipRow";
import { togglePlayerMuted } from "@/lib/player-sound";
import { useWatchQueue, type WatchItem } from "./use-watch-queue";

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
 * Watching a shared playlist: the same stage and floating controls as the
 * editor, the clip list beside it (under it in a narrow window), and the
 * coach's note for the playing clip right under the footage, where the eye
 * already is.
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
}: {
  title: string;
  items: WatchItem[];
  /** The game a clip comes from, in multi-game playlists; undefined otherwise. */
  matchTitleFor: (matchId: string) => string | undefined;
  isWatched: (matchId: string, eventId: number) => boolean;
  onWatched: (matchId: string, eventId: number) => void;
  progress: { watched: number; total: number };
  /** Where Resume starts: the first clip not yet watched. */
  startKey: string | null;
  /** Opened with Resume: start playing straight away. */
  autoplay: boolean;
}) {
  const video = usePersistentVideo();
  const stageRef = useRef<PlayerStageHandle | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionSafe();
  const [speed, setSpeedState] = useState(readSpeed);
  const [duration, setDuration] = useState<number | null>(null);
  const playerFs = usePlayerFullscreen();

  const setSpeed = useCallback((next: number) => {
    setSpeedState(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // Remembering the speed is a convenience.
    }
  }, []);

  const q = useWatchQueue({ video, items, onWatched });
  const activeClip = q.activeItem?.kind === "clip" ? q.activeItem : null;
  const activeCard = q.activeItem?.kind === "text" ? q.activeItem.card : null;

  const resume = useCallback(() => {
    if (items.length === 0) return;
    q.playFrom(startKey ?? items[0].key);
  }, [items, startKey, q]);

  // Opened with Resume: start once, on arrival.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!autoplay || startedRef.current || items.length === 0) return;
    startedRef.current = true;
    resume();
  }, [autoplay, items.length, resume]);

  // Each clip is its own file, so the scrubber spans the whole file.
  useEffect(() => {
    const update = () => setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("durationchange", update);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("durationchange", update);
    };
  }, [video]);

  const hasStage = q.src !== null || q.isQueueActive;
  const toggleFullscreen = useCallback(() => {
    if (!playerFs.active && !hasStage) return;
    playerFs.toggle();
  }, [playerFs, hasStage]);

  // View › Enter Full Screen Player (⌘⇧F) arrives as a window event.
  useEffect(() => {
    const onToggle = () => toggleFullscreen();
    window.addEventListener("player-fullscreen-toggle", onToggle);
    return () => window.removeEventListener("player-fullscreen-toggle", onToggle);
  }, [toggleFullscreen]);

  // Leaving the playlist leaves the player's full screen with it (and only
  // that: a window the user made full screen stays so).
  const fsRef = useRef(playerFs);
  fsRef.current = playerFs;
  useEffect(
    () => () => {
      if (fsRef.current.active) void fsRef.current.exit();
    },
    [],
  );

  useKeyScope("watch", true);
  useHotkeys("watch", (e) => {
    const action = resolvePlayerKey(e);
    if (!action) return;
    const nudge = (delta: number) => {
      if (!activeClip || duration === null) return;
      video.currentTime = clamp(video.currentTime + delta, 0, Math.max(0, duration - 0.05));
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
        stageRef.current?.togglePlay();
        return;
      case "toggle-mute":
        e.preventDefault();
        togglePlayerMuted({ announce: true });
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
        // WebKit has no reverse playback; stepping back is the honest version.
        e.preventDefault();
        nudge(-5);
        return;
      case "shuttle-pause":
        e.preventDefault();
        video.pause();
        return;
      case "shuttle-forward":
        e.preventDefault();
        setSpeed(nextShuttleRate(speed));
        if (activeClip && video.paused) video.play().catch(() => {});
        return;
      case "fullscreen":
        e.preventDefault();
        toggleFullscreen();
        return;
      case "escape":
        if (playerFs.active) {
          e.preventDefault();
          void playerFs.exit();
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
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @min-[860px]:flex-row @min-[860px]:overflow-hidden">
        {/* Footage and what's playing */}
        <div className="flex flex-col gap-3 p-4 @min-[860px]:min-w-0 @min-[860px]:flex-1 @min-[860px]:overflow-y-auto">
          <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
            {/* Stacked (narrow window), the stage stops short of the window's
                height so the list stays in reach. */}
            <div
              className={
                playerFs.active
                  ? "relative min-h-0 flex-1"
                  : "relative mx-auto w-full max-w-[calc((100vh-12rem)*16/9)] @min-[860px]:max-w-none"
              }
            >
              <PlayerStage
                handleRef={stageRef}
                video={video}
                src={q.src}
                fullscreen={playerFs.active}
                onToggleFullscreen={toggleFullscreen}
                onExitFullscreen={() => void playerFs.exit()}
                title={title}
                position={q.position >= 0 ? { index: q.position, total: items.length } : null}
                clipWindow={activeClip && duration !== null ? { start: 0, end: duration } : null}
                onSeek={(t) => {
                  if (duration !== null) video.currentTime = clamp(t, 0, Math.max(0, duration - 0.05));
                }}
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
              >
                {activeCard && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="px-8 text-center text-4xl font-semibold text-white">{activeCard.text}</p>
                  </div>
                )}
                {!q.isQueueActive && q.src === null && items.length > 0 && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resume();
                      }}
                      className="dark flex items-center gap-2 rounded-full bg-black/55 px-5 py-2.5 text-sm font-medium text-white shadow-menu ring-1 ring-white/15 backdrop-blur-xl transition-[background-color,transform] duration-100 hover:bg-black/70 active:scale-[0.97]"
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
            <div className="flex flex-col gap-2 px-1">
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
        <div className="flex flex-col border-separator @min-[860px]:w-[340px] @min-[860px]:shrink-0 @min-[860px]:border-l">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
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
          <div ref={listRef} className="flex flex-col pb-4 @min-[860px]:min-h-0 @min-[860px]:flex-1 @min-[860px]:overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-callout text-muted-foreground">
                Nothing to watch yet. Clips appear here once your coach has uploaded them.
              </p>
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
