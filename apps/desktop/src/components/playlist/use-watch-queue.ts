import { useCallback, useEffect, useRef, useState } from "react";
import { isWatchedPosition } from "@scoutable/shared/lib/clip-timing";
import type { PlayByPlayEvent, PlaylistTextCard } from "@/types/match";

/**
 * One item a recipient can watch. Clips are pre-cut files in cloud storage
 * (Clip & Ship); recipients don't have the coach's footage, so a clip plays
 * by swapping the source — no seeking, no sync point.
 */
export type WatchItem =
  | { kind: "clip"; key: string; event: PlayByPlayEvent; matchId: string; r2Url: string; note?: string }
  | { kind: "text"; key: string; card: PlaylistTextCard };

/**
 * Playback for the watch view: a queue over the playlist's items that
 * advances on `ended` (clips) or on a timer (text cards) and records a clip
 * as watched once playback passes the shared threshold. The state lives in
 * refs the media listeners read, so the listeners are attached once.
 */
export function useWatchQueue({
  video,
  items,
  onWatched,
}: {
  video: HTMLVideoElement;
  items: WatchItem[];
  /** Called once per clip when it counts as watched. */
  onWatched: (matchId: string, eventId: number) => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [isQueueActive, setQueueActive] = useState(false);
  /** A text card's timer can be paused like footage. */
  const [cardPaused, setCardPaused] = useState(false);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onWatchedRef = useRef(onWatched);
  onWatchedRef.current = onWatched;

  const indexRef = useRef(-1);
  const activeRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const watchedRef = useRef(false);
  const textTimerRef = useRef<number | null>(null);
  /** When the running card's timer fires, or how much of it is left while paused. */
  const cardDeadlineRef = useRef(0);
  const cardRemainingRef = useRef(0);

  const clearTextTimer = () => {
    if (textTimerRef.current !== null) window.clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
  };
  const armCardTimer = (ms: number) => {
    clearTextTimer();
    cardDeadlineRef.current = Date.now() + ms;
    textTimerRef.current = window.setTimeout(() => {
      textTimerRef.current = null;
      playIndexRef.current(indexRef.current + 1);
    }, ms);
  };

  const stop = useCallback(() => {
    clearTextTimer();
    activeRef.current = false;
    indexRef.current = -1;
    pendingPlayRef.current = false;
    setQueueActive(false);
    setActiveKey(null);
    setCardPaused(false);
    video.pause();
  }, [video]);

  // Declared through a ref so the timer and `ended` listener reach the
  // latest version without re-subscribing.
  const playIndexRef = useRef<(i: number) => void>(() => {});
  const playIndex = useCallback(
    (i: number) => {
      const list = itemsRef.current;
      const item = list[i];
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
        video.pause();
        armCardTimer(item.card.durationSeconds * 1000);
        return;
      }
      watchedRef.current = false;
      if (video.getAttribute("src") === item.r2Url) {
        // Same file again (replaying the only clip): no load, no canplay.
        video.currentTime = 0;
        video.play().catch(() => {});
      } else {
        pendingPlayRef.current = true;
        setSrc(item.r2Url);
      }
    },
    [video, stop],
  );
  playIndexRef.current = playIndex;

  // Media → queue. Attached once per element.
  useEffect(() => {
    const markIfWatched = () => {
      if (watchedRef.current || !activeRef.current) return;
      const item = itemsRef.current[indexRef.current];
      if (!item || item.kind !== "clip") return;
      if (!isWatchedPosition(video.currentTime, video.duration)) return;
      watchedRef.current = true;
      onWatchedRef.current(item.matchId, item.event.eventId);
    };
    const onCanPlay = () => {
      if (!pendingPlayRef.current) return;
      pendingPlayRef.current = false;
      video.play().catch(() => {});
    };
    const onEnded = () => {
      markIfWatched();
      if (!activeRef.current) return;
      playIndexRef.current(indexRef.current + 1);
    };
    video.addEventListener("timeupdate", markIfWatched);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", markIfWatched);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("ended", onEnded);
    };
  }, [video]);

  useEffect(() => () => clearTextTimer(), []);

  const indexOf = useCallback((key: string) => itemsRef.current.findIndex((i) => i.key === key), []);

  const playFrom = useCallback(
    (key: string) => {
      const i = indexOf(key);
      playIndex(i >= 0 ? i : 0);
    },
    [indexOf, playIndex],
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
    if (item?.kind === "clip") {
      video.currentTime = 0;
      video.play().catch(() => {});
    } else if (item) {
      playIndex(indexRef.current);
    }
  }, [video, playIndex]);

  const activeItem = position >= 0 ? items[position] : null;

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
