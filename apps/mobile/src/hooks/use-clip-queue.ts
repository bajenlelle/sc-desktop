/**
 * Playback for the watch screen: the web's use-watch-queue
 * (apps/web/src/components/playlist/use-watch-queue.ts) on expo-video. A
 * queue over the playlist's items advances when a clip ends or a text card's
 * time is up, and reports a clip as watched once playback passes the shared
 * threshold. One player is fed each clip's own file in turn; nothing seeks
 * into a game. The listeners read the queue's position from refs, so they
 * never see a stale closure.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useVideoPlayer } from "expo-video";
import { useEventListener } from "expo";
import { isWatchedPosition } from "@scoutable/shared/lib/clip-timing";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/** The speed a player last chose, kept across playlists and launches (the web keeps it too). */
const SPEED_KEY = "scoutable_watch_speed";

export function useClipQueue({
  items,
  onWatched,
}: {
  items: WatchItem[];
  /** Called once per play of a clip when it counts as watched. */
  onWatched: (matchId: string, eventId: number) => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isQueueActive, setQueueActive] = useState(false);
  const [paused, setPaused] = useState(true);
  /** A text card's timer can be paused like footage. */
  const [cardPaused, setCardPaused] = useState(false);
  /** The playing clip's file couldn't be loaded. */
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  /** The loaded clip's length; null until its file has loaded. */
  const [duration, setDuration] = useState<number | null>(null);
  const [speed, setSpeedState] = useState(1);

  const itemsRef = useRef(items);
  const onWatchedRef = useRef(onWatched);
  useLayoutEffect(() => {
    itemsRef.current = items;
    onWatchedRef.current = onWatched;
  });

  const indexRef = useRef(-1);
  const activeRef = useRef(false);
  /** This play of the clip has been reported. */
  const watchedRef = useRef(false);
  /**
   * Stale-event gate: disarmed whenever a clip starts, re-armed only by a
   * time near the START of playback (or the new file reporting ready), which
   * only the new play can produce. Events still in flight from the previous
   * clip carry near-end positions and would mark the new one watched.
   */
  const watchArmedRef = useRef(false);
  /** play() while the file is loading is a no-op: this plays it once ready. */
  const pendingPlayRef = useRef(false);
  const speedRef = useRef(1);
  const sourceRef = useRef<string | null>(null);
  const textTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the running card's timer fires, or how much of it is left while held. */
  const cardDeadlineRef = useRef(0);
  const cardRemainingRef = useRef(0);
  /** A running card held because the app went to the background (not by the player). */
  const backgroundCardRef = useRef(false);
  /** The latest playIndex, for the card timer and the player's events. */
  const playIndexRef = useRef<(i: number) => void>(() => {});
  // Native events and pending replaceAsync continuations can arrive after
  // useVideoPlayer has released the player on unmount; touching it then
  // throws, so each of those paths checks this first. Set on mount as well
  // as cleared on cleanup, so a remount doesn't leave playback disabled.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const player = useVideoPlayer(null, (p) => {
    // Ten a second: the watched rule and the scrubber's time readout (tenths).
    p.timeUpdateEventInterval = 0.1;
    p.loop = false;
  });

  const clearTextTimer = useCallback(() => {
    if (textTimerRef.current !== null) clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
  }, []);

  const armCardTimer = useCallback(
    (ms: number) => {
      clearTextTimer();
      cardDeadlineRef.current = Date.now() + ms;
      textTimerRef.current = setTimeout(() => {
        textTimerRef.current = null;
        if (isMountedRef.current) playIndexRef.current(indexRef.current + 1);
      }, ms);
    },
    [clearTextTimer],
  );

  const stop = useCallback(() => {
    clearTextTimer();
    activeRef.current = false;
    indexRef.current = -1;
    pendingPlayRef.current = false;
    backgroundCardRef.current = false;
    setQueueActive(false);
    setActiveKey(null);
    setCardPaused(false);
    setFailed(false);
    if (isMountedRef.current) player.pause();
  }, [player, clearTextTimer]);

  const playIndex = useCallback(
    (i: number) => {
      if (!isMountedRef.current) return;
      const item = itemsRef.current[i];
      if (!item) {
        stop();
        return;
      }
      clearTextTimer();
      indexRef.current = i;
      activeRef.current = true;
      backgroundCardRef.current = false;
      setQueueActive(true);
      setActiveKey(item.key);
      setCardPaused(false);
      setFailed(false);
      if (item.kind === "text") {
        pendingPlayRef.current = false;
        player.pause();
        armCardTimer(item.card.durationSeconds * 1000);
        return;
      }
      watchedRef.current = false;
      watchArmedRef.current = false;
      // The same file again (the playing clip's row tapped): restart it, no reload.
      if (sourceRef.current === item.r2Url && player.status === "readyToPlay") {
        player.currentTime = 0;
        player.playbackRate = speedRef.current;
        player.play();
        return;
      }
      sourceRef.current = item.r2Url;
      setDuration(null);
      pendingPlayRef.current = true;
      const src = item.r2Url;
      player
        .replaceAsync(src)
        .then(() => {
          if (!isMountedRef.current || sourceRef.current !== src) return;
          // Rate belongs to the player: set it again after every swap.
          player.playbackRate = speedRef.current;
          // Already loaded: play now. Otherwise statusChange plays it on readyToPlay.
          if (pendingPlayRef.current && player.status === "readyToPlay") {
            pendingPlayRef.current = false;
            player.play();
          }
        })
        .catch(() => {
          if (!isMountedRef.current || sourceRef.current !== src) return;
          pendingPlayRef.current = false;
          setFailed(true);
        });
    },
    [player, stop, clearTextTimer, armCardTimer],
  );
  useLayoutEffect(() => {
    playIndexRef.current = playIndex;
  });

  // -- player → queue -----------------------------------------------------------

  const report = useCallback(() => {
    if (watchedRef.current || !activeRef.current) return;
    const item = itemsRef.current[indexRef.current];
    if (!item || item.kind !== "clip") return;
    watchedRef.current = true;
    onWatchedRef.current(item.matchId, item.event.eventId);
  }, []);

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (!isMountedRef.current) return;
    if (!watchArmedRef.current) {
      if (currentTime > 1) return; // a straggler from the previous clip
      watchArmedRef.current = true;
    }
    // Watched = playback reached the shared threshold (isWatchedPosition).
    if (isWatchedPosition(currentTime, player.duration)) report();
  });

  useEventListener(player, "playToEnd", () => {
    // The same gate: an end from the outgoing clip, delivered after a skip,
    // would mark the incoming clip AND advance twice.
    if (!isMountedRef.current || !watchArmedRef.current) return;
    report();
    if (activeRef.current) playIndexRef.current(indexRef.current + 1);
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isMountedRef.current) setPaused(!isPlaying);
  });

  useEventListener(player, "sourceLoad", ({ duration: d }) => {
    if (isMountedRef.current && d > 0) setDuration(d);
  });

  useEventListener(player, "statusChange", ({ status, error }) => {
    if (!isMountedRef.current) return;
    setLoading(status === "loading");
    if (status === "readyToPlay") {
      // The new file has loaded: anything from the previous clip has been
      // delivered by now. (Also covers clips too short for a timeUpdate.)
      watchArmedRef.current = true;
      if (player.duration > 0) setDuration(player.duration);
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        player.playbackRate = speedRef.current;
        player.play();
      }
    } else if (status === "error") {
      // Shown on the footage, as on the web; the player can retry or move on.
      console.warn("[queue] source error:", error?.message);
      pendingPlayRef.current = false;
      if (activeRef.current) setFailed(true);
    }
  });

  // To the background: pause, and hold a running text card with its time left.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!isMountedRef.current) return;
      if (state !== "active") {
        player.pause();
        if (textTimerRef.current !== null) {
          cardRemainingRef.current = Math.max(0, cardDeadlineRef.current - Date.now());
          clearTextTimer();
          backgroundCardRef.current = true;
        }
      } else if (backgroundCardRef.current) {
        backgroundCardRef.current = false;
        armCardTimer(cardRemainingRef.current);
      }
    });
    return () => sub.remove();
  }, [player, clearTextTimer, armCardTimer]);

  useEffect(() => clearTextTimer, [clearTextTimer]);

  // The remembered speed, once it's read.
  useEffect(() => {
    AsyncStorage.getItem(SPEED_KEY)
      .then((v) => {
        const s = Number(v);
        if (!isMountedRef.current || !PLAYBACK_SPEEDS.includes(s)) return;
        speedRef.current = s;
        setSpeedState(s);
        player.playbackRate = s;
      })
      .catch(() => {});
  }, [player]);

  // -- controls -----------------------------------------------------------------

  const playFrom = useCallback(
    (key: string) => {
      const i = itemsRef.current.findIndex((item) => item.key === key);
      playIndex(i >= 0 ? i : 0);
    },
    [playIndex],
  );

  const prev = useCallback(() => {
    if (indexRef.current > 0) playIndex(indexRef.current - 1);
  }, [playIndex]);

  const next = useCallback(() => {
    if (indexRef.current >= 0 && indexRef.current < itemsRef.current.length - 1) playIndex(indexRef.current + 1);
  }, [playIndex]);

  const replay = useCallback(() => {
    if (indexRef.current < 0) return;
    const item = itemsRef.current[indexRef.current];
    if (item?.kind === "clip" && !failed) {
      watchArmedRef.current = false;
      player.currentTime = 0;
      player.play();
    } else if (item) {
      playIndex(indexRef.current);
    }
  }, [player, playIndex, failed]);

  /** Play/pause while a text card shows: holds or resumes its timer. */
  const toggleCard = useCallback(() => {
    if (textTimerRef.current !== null) {
      cardRemainingRef.current = Math.max(0, cardDeadlineRef.current - Date.now());
      clearTextTimer();
      setCardPaused(true);
    } else if (itemsRef.current[indexRef.current]?.kind === "text") {
      backgroundCardRef.current = false;
      armCardTimer(cardRemainingRef.current);
      setCardPaused(false);
    }
  }, [clearTextTimer, armCardTimer]);

  /** Play/pause the footage; a clip that failed to load is tried again. */
  const togglePlayback = useCallback(() => {
    if (!activeRef.current) return;
    if (failed) {
      playIndex(indexRef.current);
      return;
    }
    if (player.playing) player.pause();
    else player.play();
  }, [player, failed, playIndex]);

  const setSpeed = useCallback(
    (s: number) => {
      speedRef.current = s;
      setSpeedState(s);
      player.playbackRate = s;
      AsyncStorage.setItem(SPEED_KEY, String(s)).catch(() => {
        // Remembering the speed is a convenience.
      });
    },
    [player],
  );

  const position = activeKey ? items.findIndex((i) => i.key === activeKey) : -1;
  const activeItem = position >= 0 ? items[position] : null;

  return {
    player,
    activeKey,
    activeItem,
    isQueueActive,
    position,
    canPrev: isQueueActive && position > 0,
    canNext: isQueueActive && position >= 0 && position < items.length - 1,
    /** The footage is paused (or nothing is playing). */
    paused,
    cardPaused,
    failed,
    loading,
    duration,
    speed,
    setSpeed,
    playFrom,
    playIndex,
    prev,
    next,
    replay,
    stop,
    toggleCard,
    togglePlayback,
  };
}
