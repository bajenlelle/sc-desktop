"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isWatchedPosition } from "@scoutable/shared/lib/clip-timing";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";

/**
 * Playback for the watch view: a queue over the playlist's items that
 * advances on `ended` (clips) or on a timer (text cards), and reports a clip
 * as watched once playback passes the shared threshold. Clips are pre-cut
 * files, so a clip plays by swapping the source; nothing seeks into a game.
 * The source is set and played in the same call, inside the tap that asked
 * for it: iPhone Safari lets a player play with sound only from a gesture,
 * and after one, the queue can advance on its own. The listeners read the
 * queue's position from refs, so they are attached once per element.
 */
export function useWatchQueue({
  video,
  videoRef,
  items,
  onWatched,
}: {
  /** The element, to listen to. */
  video: HTMLVideoElement | null;
  /** The same element, to change. */
  videoRef: RefObject<HTMLVideoElement | null>;
  items: WatchItem[];
  /** Called once per play of a clip when it counts as watched. */
  onWatched: (matchId: string, eventId: number) => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [isQueueActive, setQueueActive] = useState(false);
  /** A text card's timer can be paused like footage. */
  const [cardPaused, setCardPaused] = useState(false);

  const itemsRef = useRef(items);
  const onWatchedRef = useRef(onWatched);
  useLayoutEffect(() => {
    itemsRef.current = items;
    onWatchedRef.current = onWatched;
  });

  const indexRef = useRef(-1);
  const activeRef = useRef(false);
  const watchedRef = useRef(false);
  const textTimerRef = useRef<number | null>(null);
  /** When the running card's timer fires, or how much of it is left while paused. */
  const cardDeadlineRef = useRef(0);
  const cardRemainingRef = useRef(0);
  /** The latest playIndex, for the card timer and the `ended` listener. */
  const playIndexRef = useRef<(i: number) => void>(() => {});

  const clearTextTimer = useCallback(() => {
    if (textTimerRef.current !== null) window.clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
  }, []);

  const armCardTimer = useCallback(
    (ms: number) => {
      clearTextTimer();
      cardDeadlineRef.current = Date.now() + ms;
      textTimerRef.current = window.setTimeout(() => {
        textTimerRef.current = null;
        playIndexRef.current(indexRef.current + 1);
      }, ms);
    },
    [clearTextTimer],
  );

  const stop = useCallback(() => {
    clearTextTimer();
    activeRef.current = false;
    indexRef.current = -1;
    setQueueActive(false);
    setActiveKey(null);
    setCardPaused(false);
    videoRef.current?.pause();
  }, [videoRef, clearTextTimer]);

  const playIndex = useCallback(
    (i: number) => {
      const item = itemsRef.current[i];
      if (!item) {
        stop();
        return;
      }
      clearTextTimer();
      indexRef.current = i;
      activeRef.current = true;
      setQueueActive(true);
      setActiveKey(item.key);
      setCardPaused(false);
      if (item.kind === "text") {
        videoRef.current?.pause();
        armCardTimer(item.card.durationSeconds * 1000);
        return;
      }
      watchedRef.current = false;
      setSrc(item.r2Url);
      const video = videoRef.current;
      if (!video) return;
      // Same file again (replaying the only clip): no reload.
      if (video.getAttribute("src") === item.r2Url) video.currentTime = 0;
      else video.src = item.r2Url;
      // Refused without a gesture (iPhone, before the player has been
      // played by hand): the controls stay up with Play ready.
      video.play().catch(() => {});
    },
    [videoRef, stop, clearTextTimer, armCardTimer],
  );
  useLayoutEffect(() => {
    playIndexRef.current = playIndex;
  });

  // Media → queue.
  useEffect(() => {
    if (!video) return;
    const markIfWatched = () => {
      if (watchedRef.current || !activeRef.current) return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== "clip") return;
      if (!isWatchedPosition(video.currentTime, video.duration)) return;
      watchedRef.current = true;
      onWatchedRef.current(item.matchId, item.event.eventId);
    };
    const onEnded = () => {
      markIfWatched();
      if (!activeRef.current) return;
      playIndexRef.current(indexRef.current + 1);
    };
    video.addEventListener("timeupdate", markIfWatched);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", markIfWatched);
      video.removeEventListener("ended", onEnded);
    };
  }, [video]);

  useEffect(() => clearTextTimer, [clearTextTimer]);

  const playFrom = useCallback(
    (key: string) => {
      const i = itemsRef.current.findIndex((item) => item.key === key);
      playIndex(i >= 0 ? i : 0);
    },
    [playIndex],
  );

  const position = activeKey ? items.findIndex((i) => i.key === activeKey) : -1;

  const prev = useCallback(() => {
    if (indexRef.current > 0) playIndex(indexRef.current - 1);
  }, [playIndex]);
  const next = useCallback(() => {
    if (indexRef.current >= 0 && indexRef.current < itemsRef.current.length - 1) playIndex(indexRef.current + 1);
  }, [playIndex]);
  const replay = useCallback(() => {
    if (indexRef.current < 0) return;
    const item = itemsRef.current[indexRef.current];
    const video = videoRef.current;
    if (item?.kind === "clip" && video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    } else if (item) {
      playIndex(indexRef.current);
    }
  }, [videoRef, playIndex]);

  /** Play/pause while a text card shows: holds or resumes its timer. */
  const toggleCard = useCallback(() => {
    if (textTimerRef.current !== null) {
      cardRemainingRef.current = Math.max(0, cardDeadlineRef.current - Date.now());
      clearTextTimer();
      setCardPaused(true);
    } else if (itemsRef.current[indexRef.current]?.kind === "text") {
      armCardTimer(cardRemainingRef.current);
      setCardPaused(false);
    }
  }, [clearTextTimer, armCardTimer]);

  const activeItem = position >= 0 ? items[position] : null;

  return {
    activeKey,
    activeItem,
    src,
    isQueueActive,
    position,
    canPrev: isQueueActive && position > 0,
    canNext: isQueueActive && position >= 0 && position < items.length - 1,
    cardPaused,
    toggleCard,
    playFrom,
    playIndex,
    prev,
    next,
    replay,
    stop,
  };
}
