"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isWatchedPosition } from "@scoutable/shared/lib/clip-timing";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";

/** A clip played out of the whole game's copy: where it starts and stops in the element. */
type Window = { start: number; end: number };

/** Positions this far past a window's end are the old position, before a seek landed. */
const STALE_SECONDS = 60;

/**
 * Playback for the watch view: a queue over the playlist's items that
 * advances on `ended` (clips) or on a timer (text cards), and reports a clip
 * as watched once playback passes the shared threshold. A clip is normally
 * a pre-cut file, so it plays by swapping the source. A clip without a file
 * whose game the viewer has in the cloud plays as a window of that copy:
 * the source is the game, the queue seeks to the clip's start and advances
 * at its end (`ended` never fires inside a file). The source is set and
 * played in the same call, inside the tap that asked for it: iPhone Safari
 * lets a player play with sound only from a gesture, and after one, the
 * queue can advance on its own. The listeners read the queue's position
 * from refs, so they are attached once per element.
 */
export function useWatchQueue({
  video,
  videoRef,
  items,
  onWatched,
  windowSrc,
}: {
  /** The element, to listen to. */
  video: HTMLVideoElement | null;
  /** The same element, to change. */
  videoRef: RefObject<HTMLVideoElement | null>;
  items: WatchItem[];
  /** Called once per play of a clip when it counts as watched. */
  onWatched: (matchId: string, eventId: number) => void;
  /** The game copy's play URL for a window item, when it has been fetched; null makes the item wait for the next tap. */
  windowSrc?: (matchId: string) => string | null;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [isQueueActive, setQueueActive] = useState(false);
  /** A text card's timer can be paused like footage. */
  const [cardPaused, setCardPaused] = useState(false);

  const itemsRef = useRef(items);
  const onWatchedRef = useRef(onWatched);
  const windowSrcRef = useRef(windowSrc);
  useLayoutEffect(() => {
    itemsRef.current = items;
    onWatchedRef.current = onWatched;
    windowSrcRef.current = windowSrc;
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
  /** The file the element holds, without any media fragment. */
  const loadedRef = useRef<string | null>(null);
  /** The window being played, and the seek to its start that has yet to land. */
  const windowRef = useRef<Window | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

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
    windowRef.current = null;
    pendingSeekRef.current = null;
    setQueueActive(false);
    setActiveKey(null);
    setCardPaused(false);
    videoRef.current?.pause();
  }, [videoRef, clearTextTimer]);

  /** Seeks the element to `t`, now or (a new file) as soon as it can. */
  const seekTo = (el: HTMLVideoElement, t: number) => {
    pendingSeekRef.current = t;
    // Before the metadata is in, this sets where playback starts on most
    // engines; iPhone drops it, so `loadedmetadata` below asks again.
    el.currentTime = t;
  };

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
      const el = videoRef.current;
      if (item.kind === "clip") {
        windowRef.current = null;
        pendingSeekRef.current = null;
        setSrc(item.r2Url);
        if (!el) return;
        // Same file again (replaying the only clip): no reload.
        if (loadedRef.current === item.r2Url) el.currentTime = 0;
        else {
          loadedRef.current = item.r2Url;
          el.src = item.r2Url;
        }
        // Refused without a gesture (iPhone, before the player has been
        // played by hand): the controls stay up with Play ready.
        el.play().catch(() => {});
        return;
      }
      // A window of the game's copy. Without its URL yet there is nothing to
      // play inside this tap: the stage shows Play, and the next tap lands
      // here again with the URL fetched.
      const url = windowSrcRef.current?.(item.matchId) ?? null;
      windowRef.current = { start: item.start, end: item.end };
      if (!url) {
        setSrc(null);
        el?.pause();
        return;
      }
      setSrc(url);
      if (!el) return;
      if (loadedRef.current !== url) {
        loadedRef.current = url;
        // The fragment starts the file at the clip on every engine.
        el.src = `${url}#t=${item.start.toFixed(3)}`;
      }
      seekTo(el, item.start);
      el.play().catch(() => {});
    },
    [videoRef, stop, clearTextTimer, armCardTimer],
  );
  useLayoutEffect(() => {
    playIndexRef.current = playIndex;
  });

  // Media → queue.
  useEffect(() => {
    if (!video) return;
    const current = () => {
      const item = itemsRef.current[indexRef.current];
      return item && item.kind !== "text" ? item : null;
    };
    const markIfWatched = (item: Exclude<WatchItem, { kind: "text" }>, win: Window | null) => {
      if (watchedRef.current || !activeRef.current) return;
      const watched = win
        ? isWatchedPosition(video.currentTime - win.start, win.end - win.start)
        : isWatchedPosition(video.currentTime, video.duration);
      if (!watched) return;
      watchedRef.current = true;
      onWatchedRef.current(item.matchId, item.event.eventId);
    };
    const onTimeUpdate = () => {
      const item = current();
      if (!item) return;
      const win = item.kind === "window" ? windowRef.current : null;
      if (win) {
        const t = video.currentTime;
        if (pendingSeekRef.current !== null) {
          // The seek to the clip's start hasn't landed: whatever position
          // this is, it is the old one.
          if (video.seeking || Math.abs(t - pendingSeekRef.current) > 1.5) return;
          pendingSeekRef.current = null;
        }
        if (t > win.end + STALE_SECONDS) return;
        markIfWatched(item, win);
        if (t >= win.end - 0.05 && activeRef.current) playIndexRef.current(indexRef.current + 1);
        return;
      }
      markIfWatched(item, null);
    };
    const onSeeked = () => {
      const pending = pendingSeekRef.current;
      if (pending !== null && Math.abs(video.currentTime - pending) <= 1.5) pendingSeekRef.current = null;
    };
    const onLoadedMetadata = () => {
      const pending = pendingSeekRef.current;
      if (pending !== null && Math.abs(video.currentTime - pending) > 1) video.currentTime = pending;
    };
    const onEnded = () => {
      const item = current();
      if (item) markIfWatched(item, item.kind === "window" ? windowRef.current : null);
      if (!activeRef.current) return;
      playIndexRef.current(indexRef.current + 1);
    };
    const onEmptied = () => {
      loadedRef.current = null;
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("ended", onEnded);
    video.addEventListener("emptied", onEmptied);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("emptied", onEmptied);
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
    const el = videoRef.current;
    if (item?.kind === "clip" && el) {
      el.currentTime = 0;
      el.play().catch(() => {});
    } else if (item?.kind === "window" && el && loadedRef.current) {
      seekTo(el, item.start);
      el.play().catch(() => {});
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
