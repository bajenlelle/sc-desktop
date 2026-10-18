"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import {
  CLIP_POST_ROLL_SECONDS,
  DEFAULT_PRE_ROLL_SECONDS,
  clipBounds,
  computeVideoTime,
} from "@scoutable/shared/lib/clip-timing";
import { eventColors, eventLabel, formatGameClock, isBookkeepingEvent, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { clamp } from "@scoutable/shared/lib/motion-math";
import {
  NUDGE_FAR_SECONDS,
  NUDGE_SECONDS,
  nextShuttleRate,
  resolvePlayerKey,
} from "@scoutable/shared/lib/player-keys";
import type { PlayByPlayEvent, StoredMatch } from "@scoutable/shared/types/match";
import { PlayerStage, type PlayerStageHandle } from "@/components/player/player-stage";
import { useMediaDuration, useMediaElement } from "@/components/player/use-media";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { WatchClipRow } from "@/components/playlist/ClipRow";
import { Callout } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The same remembered speed as the playlist watch view. */
const SPEED_KEY = "scoutable_watch_speed";

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

type Family = "all" | "shots" | "made" | "rebounds" | "assists" | "defence" | "turnovers" | "fouls";

const FAMILIES: readonly { value: Family; label: string }[] = [
  { value: "all", label: "All plays" },
  { value: "shots", label: "Shots" },
  { value: "made", label: "Made shots" },
  { value: "rebounds", label: "Rebounds" },
  { value: "assists", label: "Assists" },
  { value: "defence", label: "Steals and blocks" },
  { value: "turnovers", label: "Turnovers" },
  { value: "fouls", label: "Fouls" },
];

function isShot(e: PlayByPlayEvent): boolean {
  return e.type === "2pt" || e.type === "3pt" || e.type === "freethrow";
}

function inFamily(e: PlayByPlayEvent, family: Family): boolean {
  switch (family) {
    case "all":
      return true;
    case "shots":
      return isShot(e);
    case "made":
      return isShot(e) && !!e.isSuccessful;
    case "rebounds":
      return e.type === "rebound";
    case "assists":
      return e.type === "assist";
    case "defence":
      return e.type === "steal" || e.type === "block";
    case "turnovers":
      return e.type === "turnover";
    case "fouls":
      return e.type === "foul" || e.type === "foulon";
  }
}

/** A play placed in the video: when it happens, and where its clip would start. */
interface Play {
  key: string;
  event: PlayByPlayEvent;
  time: number;
  start: number;
}

/**
 * A whole game from its cloud copy: the player over the full file, with the
 * play-by-play beside it. A row seeks to where that play's clip would start
 * (the desktop's default pre-roll before it); as the game runs, the row of
 * the latest play follows along. Quarter starts tick the timeline. The
 * layout is the playlist watch view's: player left and sticky, list right;
 * stacked on a phone.
 */
export function GameWatchView({
  match,
  src,
  startAt,
  onSourceStale,
}: {
  match: StoredMatch;
  /** The copy's play URL at page open; a later one comes through onSourceStale. */
  src: string;
  /** A deep-linked moment (?t=) to start at, in seconds. */
  startAt: number | null;
  /** The play URL ran out or failed: asks for a fresh one; null when the game is gone. */
  onSourceStale: () => Promise<string | null>;
}) {
  const { element: video, ref: videoRef, attach: attachVideo } = useMediaElement<HTMLVideoElement>();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageHandle = useRef<PlayerStageHandle | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionSafe();
  const [speed, setSpeedState] = useState(readSpeed);
  const duration = useMediaDuration(video);
  const fullscreen = useStageFullscreen(stage);
  const [family, setFamily] = useState<Family>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  /** A tapped play keeps its row until the play has happened, so the highlight doesn't fall back to the play before it during the pre-roll. */
  const pinnedRef = useRef<{ key: string; start: number; until: number } | null>(null);
  const refreshingRef = useRef(false);

  const sync = match.syncPoint ?? null;
  const plays = useMemo<Play[]>(() => {
    if (!sync) return [];
    const out: Play[] = [];
    for (const e of match.events) {
      if (isBookkeepingEvent(e)) continue;
      const time = computeVideoTime(e, sync);
      if (time === null) continue;
      out.push({
        key: `${match.id}:${e.eventId}`,
        event: e,
        time,
        start: clipBounds(time, DEFAULT_PRE_ROLL_SECONDS, CLIP_POST_ROLL_SECONDS).start,
      });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }, [match, sync]);
  const visible = useMemo(() => plays.filter((p) => inFamily(p.event, family)), [plays, family]);
  const visibleRef = useRef(visible);
  const onSourceStaleRef = useRef(onSourceStale);
  useLayoutEffect(() => {
    visibleRef.current = visible;
    onSourceStaleRef.current = onSourceStale;
  });

  /** Where each quarter's first play is: ticks on the timeline. */
  const periodMarkers = useMemo(() => {
    const first = new Map<number, number>();
    for (const p of plays) {
      const current = first.get(p.event.period);
      if (current === undefined || p.time < current) first.set(p.event.period, p.time);
    }
    return [...first.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  }, [plays]);

  // The game, starting at the deep-linked moment. The fragment is honoured
  // by every engine before the metadata is in; nothing plays until a tap.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.src = startAt !== null ? `${src}#t=${startAt.toFixed(3)}` : src;
  }, [video, videoRef, src, startAt]);

  const setSpeed = useCallback((next: number) => {
    setSpeedState(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // Remembering the speed is a convenience.
    }
  }, []);

  const seek = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el || duration === null) return;
      el.currentTime = clamp(t, 0, Math.max(0, duration - 0.05));
    },
    [videoRef, duration],
  );

  const playFromTime = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el) return;
      el.currentTime = t;
      el.play().catch(() => {});
      setStarted(true);
    },
    [videoRef],
  );

  const playPlay = useCallback(
    (p: Play) => {
      pinnedRef.current = { key: p.key, start: p.start, until: p.time };
      setActiveKey(p.key);
      playFromTime(p.start);
    },
    [playFromTime],
  );

  // Follow the game: the latest play passed is the active row, except right
  // after a tap, until that play has happened. A failed load (the 12-hour
  // URL ran out, the connection dropped) signs the game again and carries on
  // from the same second.
  useEffect(() => {
    if (!video) return;
    const onTimeUpdate = () => {
      const t = video.currentTime;
      const pinned = pinnedRef.current;
      if (pinned) {
        if (t >= pinned.start - 1 && t < pinned.until + 0.5) return;
        pinnedRef.current = null;
      }
      const list = visibleRef.current;
      let index = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].time <= t + 0.3) index = i;
        else break;
      }
      setActiveKey(index >= 0 ? list[index].key : null);
    };
    const onPlay = () => setStarted(true);
    const onError = async () => {
      if (refreshingRef.current || !video.getAttribute("src")) return;
      refreshingRef.current = true;
      const at = video.currentTime;
      const fresh = await onSourceStaleRef.current();
      if (fresh) {
        video.src = `${fresh}#t=${at.toFixed(3)}`;
        video.play().catch(() => {});
      }
      // One try per half minute: a dead connection shouldn't loop on the function.
      window.setTimeout(() => {
        refreshingRef.current = false;
      }, 30_000);
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("error", onError);
    };
  }, [video]);

  const position = activeKey ? visible.findIndex((p) => p.key === activeKey) : -1;
  const activePlay = position >= 0 ? visible[position] : null;

  const prev = useCallback(() => {
    if (position > 0) playPlay(visible[position - 1]);
  }, [position, visible, playPlay]);
  const next = useCallback(() => {
    if (position >= 0 && position < visible.length - 1) playPlay(visible[position + 1]);
    else if (position < 0 && visible.length > 0) playPlay(visible[0]);
  }, [position, visible, playPlay]);
  const replay = useCallback(() => {
    if (activePlay) playPlay(activePlay);
  }, [activePlay, playPlay]);
  const playAll = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (started) {
      el.play().catch(() => {});
      return;
    }
    if (startAt !== null) playFromTime(startAt);
    else if (visible.length > 0) playPlay(visible[0]);
    else playFromTime(0);
  }, [videoRef, started, startAt, visible, playFromTime, playPlay]);
  const pause = useCallback(() => videoRef.current?.pause(), [videoRef]);

  useKeyScope("game", true);
  useHotkeys("game", (e) => {
    const action = resolvePlayerKey(e);
    if (!action) return;
    const nudge = (delta: number) => {
      if (!video) return;
      seek(video.currentTime + delta);
    };
    switch (action) {
      case "next":
        e.preventDefault();
        next();
        return;
      case "prev":
        e.preventDefault();
        prev();
        return;
      case "first":
      case "last":
        if (visible.length === 0) return;
        e.preventDefault();
        playPlay(action === "first" ? visible[0] : visible[visible.length - 1]);
        return;
      case "toggle-play":
        e.preventDefault();
        stageHandle.current?.togglePlay();
        return;
      case "replay":
        e.preventDefault();
        replay();
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
        e.preventDefault();
        nudge(-5);
        return;
      case "shuttle-pause":
        e.preventDefault();
        pause();
        return;
      case "shuttle-forward":
        e.preventDefault();
        setSpeed(nextShuttleRate(speed));
        if (video?.paused) video.play().catch(() => {});
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

  // Keep the current play's row in view as the game runs.
  useEffect(() => {
    if (!activeKey) return;
    listRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [activeKey, reduced]);

  const activeColors = activePlay ? eventColors(activePlay.event) : null;

  return (
    <div className="@container/watch pb-[calc(var(--safe-bottom)+1.5rem)]">
      <div className="flex flex-col @min-[860px]/watch:flex-row @min-[860px]/watch:items-start @min-[860px]/watch:gap-6 @min-[860px]/watch:px-6 @min-[860px]/watch:pt-1">
        <div className="contents @min-[860px]/watch:sticky @min-[860px]/watch:top-[calc(var(--page-bar-height)+0.25rem)] @min-[860px]/watch:flex @min-[860px]/watch:min-w-0 @min-[860px]/watch:flex-1 @min-[860px]/watch:flex-col @min-[860px]/watch:gap-3">
          <div
            className={cn(
              "sticky top-[var(--page-bar-height)] z-20 bg-black @min-[860px]/watch:static @min-[860px]/watch:bg-transparent",
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
                src={src}
                duration={duration}
                markers={periodMarkers}
                onSeek={seek}
                canScrub
                fullscreen={fullscreen}
                title={match.title}
                position={position >= 0 ? { index: position, total: visible.length } : null}
                transport={{
                  canPrev: position > 0,
                  canNext: visible.length > 0 && position < visible.length - 1,
                  isQueueActive: started,
                  onPrev: prev,
                  onNext: next,
                  onReplay: replay,
                  onStop: pause,
                  onPlayAll: playAll,
                }}
                speed={speed}
                onSpeedChange={setSpeed}
                className="@min-[860px]/watch:rounded-lg"
              >
                {/* Narrow, the controls' own centre button plays instead. */}
                {!started && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center @max-[559px]/stage:hidden">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playAll();
                      }}
                      className="dark flex items-center gap-2 rounded-full bg-black/55 px-5 py-2.5 text-sm font-medium text-white shadow-menu ring-1 ring-white/15 backdrop-blur-xl transition-[background-color,transform] duration-100 hover:bg-black/70 active:scale-[0.97] pointer-coarse:px-6 pointer-coarse:py-3"
                    >
                      <Play className="size-4 fill-current" />
                      Play
                    </button>
                  </div>
                )}
              </PlayerStage>
            </div>
          </div>

          {activePlay && activeColors && (
            <div className="hidden flex-col gap-2 px-1 @min-[860px]/watch:flex">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-callout font-medium", activeColors.badge)}>
                  {eventLabel(activePlay.event)}
                </span>
                <span className="truncate text-title-3">{playerName(activePlay.event)}</span>
              </div>
              <p className="text-callout text-muted-foreground nums">
                {[periodLabel(activePlay.event.period), formatGameClock(activePlay.event.gameClockTime), activePlay.event.eventTeam?.teamName]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          )}
        </div>

        {/* The plays */}
        <div className="flex flex-col @min-[860px]/watch:w-[340px] @min-[860px]/watch:shrink-0">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 sm:px-6 @min-[860px]/watch:px-3 @min-[860px]/watch:pt-0">
            <span className="text-headline">Plays</span>
            {plays.length > 0 && (
              <PopUpButton aria-label="Show" align="end" size="sm" value={family} onValueChange={setFamily} options={FAMILIES} />
            )}
          </div>
          <div ref={listRef} className="flex flex-col sm:px-2 @min-[860px]/watch:px-0">
            {!sync ? (
              <div className="px-4 pb-2 sm:px-6 @min-[860px]/watch:px-0">
                <Callout>
                  This game isn&apos;t synced with its video yet, so its plays can&apos;t be placed. Set the sync on the game&apos;s page in the
                  desktop app.
                </Callout>
              </div>
            ) : visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-callout text-muted-foreground">
                {plays.length === 0 ? "This game has no play-by-play." : "No plays of this kind."}
              </p>
            ) : (
              visible.map((p, i) => {
                const newPeriod = i === 0 || visible[i - 1].event.period !== p.event.period;
                return (
                  <div key={p.key} className="contents">
                    {newPeriod && (
                      <div className="px-4 pt-3 pb-1 text-subheadline font-medium text-muted-foreground @min-[860px]/watch:px-3">
                        {periodLabel(p.event.period)}
                      </div>
                    )}
                    <WatchClipRow rowKey={p.key} event={p.event} watched={false} active={activeKey === p.key} onPlay={() => playPlay(p)} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
