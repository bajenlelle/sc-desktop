/**
 * The playlist queue engine — a port of the web watch view's queue logic
 * (apps/web .../my-playlists/page.tsx startQueue/advanceQueue/startTextCard)
 * onto expo-video. One player instance is fed clip sources sequentially;
 * text cards pause the player and advance on a timer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useVideoPlayer } from "expo-video";
import { useEventListener } from "expo";
import type { PlayByPlayEvent, PlaylistTextCard } from "@scoutable/shared/types/match";
import { isWatchedPosition } from "@scoutable/shared/lib/clip-timing";

export interface QueueClip {
  type: "clip";
  event: PlayByPlayEvent;
  matchId: string;
  r2Url: string;
  note?: string;
}

export type PlaybackItem = QueueClip | PlaylistTextCard;

export function isTextCard(i: PlaybackItem): i is PlaylistTextCard {
  return i.type === "text";
}

export function itemKey(i: PlaybackItem): string {
  return isTextCard(i) ? `text:${i.id}` : `${i.matchId}:${i.event.eventId}`;
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function useClipQueue({
  playlistId,
  playableQueue,
  recordWatched,
}: {
  playlistId: string | null;
  playableQueue: PlaybackItem[];
  recordWatched: (playlistId: string, matchId: string, eventId: number) => void;
}) {
  const [isQueueActive, setIsQueueActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeItem, setActiveItem] = useState<PlaybackItem | null>(null);
  const [speed, setSpeedState] = useState(1);

  // Refs mirror state so player-event handlers never read stale closures
  // (same discipline as the web page).
  const queueRef = useRef<PlaybackItem[]>([]);
  const queueIdxRef = useRef(0);
  const activeItemRef = useRef<PlaybackItem | null>(null);
  // play() during "loading" is a no-op — this arms a retry once the player
  // reports readyToPlay (the expo-video twin of web's canplay+pendingPlayRef).
  const pendingPlayRef = useRef(false);
  const speedRef = useRef(1);
  const playlistIdRef = useRef(playlistId);
  const textCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textCardDeadlineRef = useRef<number | null>(null);
  const textCardRemainingRef = useRef<number | null>(null);

  useEffect(() => {
    playlistIdRef.current = playlistId;
  }, [playlistId]);

  const player = useVideoPlayer(null, (p) => {
    // timeUpdate is disabled by default (interval 0) — the watched rule needs it.
    p.timeUpdateEventInterval = 0.25;
    p.loop = false;
  });

  const clearTextCardTimer = useCallback(() => {
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    textCardDeadlineRef.current = null;
    textCardRemainingRef.current = null;
  }, []);

  // -- queue ops --------------------------------------------------------------

  const advanceRef = useRef<(fromIdx: number) => void>(() => {});

  const startClip = useCallback(
    async (clip: QueueClip) => {
      clearTextCardTimer();
      setActiveItem(clip);
      activeItemRef.current = clip;
      try {
        pendingPlayRef.current = true;
        await player.replaceAsync(clip.r2Url);
        // Rate is a player-level property — re-apply after every source swap.
        player.playbackRate = speedRef.current;
        // If the source is already ready this starts playback; otherwise the
        // statusChange listener fires it on readyToPlay.
        if (player.status === "readyToPlay") {
          pendingPlayRef.current = false;
          player.play();
        }
      } catch {
        // Source failed to load (network, deleted file) — skip ahead.
        pendingPlayRef.current = false;
        advanceRef.current(queueIdxRef.current);
      }
    },
    [player, clearTextCardTimer]
  );

  const armTextCardTimer = useCallback((ms: number) => {
    textCardDeadlineRef.current = Date.now() + ms;
    textCardTimerRef.current = setTimeout(() => {
      textCardTimerRef.current = null;
      textCardDeadlineRef.current = null;
      advanceRef.current(queueIdxRef.current);
    }, ms);
  }, []);

  const startTextCard = useCallback(
    (card: PlaylistTextCard) => {
      setActiveItem(card);
      activeItemRef.current = card;
      pendingPlayRef.current = false;
      player.pause();
      clearTextCardTimer();
      armTextCardTimer(card.durationSeconds * 1000);
    },
    [player, clearTextCardTimer, armTextCardTimer]
  );

  const advance = useCallback(
    (fromIdx: number) => {
      const queue = queueRef.current;
      const nextIdx = fromIdx + 1;
      if (nextIdx >= queue.length) {
        setIsQueueActive(false);
        queueRef.current = [];
        clearTextCardTimer();
        return;
      }
      queueIdxRef.current = nextIdx;
      const next = queue[nextIdx];
      if (isTextCard(next)) startTextCard(next);
      else void startClip(next);
    },
    [startClip, startTextCard, clearTextCardTimer]
  );
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  const startQueue = useCallback(
    (queue: PlaybackItem[], startIdx = 0) => {
      const sliced = queue.slice(startIdx);
      if (sliced.length === 0) return;
      queueRef.current = sliced;
      queueIdxRef.current = 0;
      setIsQueueActive(true);
      const first = sliced[0];
      if (isTextCard(first)) startTextCard(first);
      else void startClip(first);
    },
    [startClip, startTextCard]
  );

  const stop = useCallback(() => {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsQueueActive(false);
    setActiveItem(null);
    activeItemRef.current = null;
    pendingPlayRef.current = false;
    clearTextCardTimer();
    player.pause();
  }, [player, clearTextCardTimer]);

  // -- watched marking ----------------------------------------------------------

  const markIfWatched = useCallback(
    (currentTime: number) => {
      const item = activeItemRef.current;
      const plId = playlistIdRef.current;
      if (!item || isTextCard(item) || !plId) return;
      // Watched = playback reached 3s before clip end (post-roll) — shared
      // rule, isWatchedPosition.
      if (isWatchedPosition(currentTime, player.duration)) {
        recordWatched(plId, item.matchId, item.event.eventId);
      }
    },
    [player, recordWatched]
  );

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    markIfWatched(currentTime);
  });

  useEventListener(player, "playToEnd", () => {
    const item = activeItemRef.current;
    const plId = playlistIdRef.current;
    if (item && !isTextCard(item) && plId) {
      recordWatched(plId, item.matchId, item.event.eventId);
    }
    advanceRef.current(queueIdxRef.current);
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    setIsPaused(!isPlaying);
  });

  useEventListener(player, "statusChange", ({ status, error }) => {
    if (status === "readyToPlay" && pendingPlayRef.current) {
      pendingPlayRef.current = false;
      player.playbackRate = speedRef.current;
      player.play();
    } else if (status === "error") {
      // Unplayable source (network drop, deleted file) — skip ahead.
      console.warn("[queue] source error:", error?.message);
      pendingPlayRef.current = false;
      advanceRef.current(queueIdxRef.current);
    }
  });

  // Pause on background; text-card timers freeze and resume with their
  // remaining time.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        player.pause();
        if (textCardTimerRef.current && textCardDeadlineRef.current) {
          const remaining = Math.max(0, textCardDeadlineRef.current - Date.now());
          clearTimeout(textCardTimerRef.current);
          textCardTimerRef.current = null;
          textCardDeadlineRef.current = null;
          textCardRemainingRef.current = remaining;
        }
      } else if (textCardRemainingRef.current !== null) {
        const remaining = textCardRemainingRef.current;
        textCardRemainingRef.current = null;
        armTextCardTimer(remaining);
      }
    });
    return () => sub.remove();
  }, [player, armTextCardTimer]);

  useEffect(() => clearTextCardTimer, [clearTextCardTimer]);

  // -- derived + controls -------------------------------------------------------

  const activeKey = activeItem ? itemKey(activeItem) : null;
  const activeTextCard = activeItem && isTextCard(activeItem) ? activeItem : null;

  const listPosition = useMemo(() => {
    if (!activeKey) return -1;
    return playableQueue.findIndex((i) => itemKey(i) === activeKey);
  }, [playableQueue, activeKey]);

  const canPrev = isQueueActive && listPosition > 0;
  const canNext = isQueueActive && listPosition >= 0 && listPosition < playableQueue.length - 1;

  const playItem = useCallback(
    (item: PlaybackItem) => {
      const idx = playableQueue.findIndex((i) => itemKey(i) === itemKey(item));
      startQueue(playableQueue, idx >= 0 ? idx : 0);
    },
    [playableQueue, startQueue]
  );

  const playAll = useCallback(() => startQueue(playableQueue, 0), [playableQueue, startQueue]);

  const prev = useCallback(() => {
    if (listPosition <= 0) return;
    playItem(playableQueue[listPosition - 1]);
  }, [listPosition, playableQueue, playItem]);

  const next = useCallback(() => {
    if (listPosition < 0 || listPosition >= playableQueue.length - 1) return;
    playItem(playableQueue[listPosition + 1]);
  }, [listPosition, playableQueue, playItem]);

  const replay = useCallback(() => {
    const item = queueRef.current[queueIdxRef.current];
    if (!item) return;
    if (isTextCard(item)) {
      startTextCard(item);
    } else {
      player.currentTime = 0;
      player.play();
    }
  }, [player, startTextCard]);

  const togglePlayPause = useCallback(() => {
    if (!isQueueActive) {
      playAll();
      return;
    }
    if (activeItemRef.current && isTextCard(activeItemRef.current)) return;
    if (player.playing) player.pause();
    else player.play();
  }, [isQueueActive, playAll, player]);

  const setSpeed = useCallback(
    (s: number) => {
      speedRef.current = s;
      setSpeedState(s);
      player.playbackRate = s;
    },
    [player]
  );

  return {
    player,
    isQueueActive,
    isPaused,
    activeKey,
    activeTextCard,
    speed,
    setSpeed,
    listPosition,
    canPrev,
    canNext,
    playAll,
    playItem,
    prev,
    next,
    replay,
    stop,
    togglePlayPause,
    startQueue,
  };
}
