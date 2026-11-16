import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clamp } from "@scoutable/shared/lib/motion-math";
import {
  activePlay,
  momentAt,
  PERIOD_LEAD_SECONDS,
  pinFor,
  pinToward,
  playIndexAt,
  type GamePhase,
  type PeriodBand,
  type PlayPin,
  type TimedPlay,
} from "@scoutable/shared/lib/game-timeline";

/** Where the playhead is in the game: in a period, or in the footage around the periods. */
export interface GameMoment {
  phase: GamePhase;
  period: number | null;
  next: number | null;
}

/**
 * Which play is "now" while a whole game plays, and the ways to move through
 * it. The video's own position is never React state: the current play is,
 * and it changes only when playback crosses into another play (a few times a
 * minute), so a 480-row list stays still while the footage runs.
 *
 * Two answers to "which play is now", which differ only while a filter is
 * on: `nowKey` is the latest play of the whole game (what is on screen: what
 * the Now bar names and A adds), `activeKey` the latest play the list shows
 * (the row that is lit). `order` is the time-ordered plays the list shows,
 * `allOrder` every play. With no footage to place (`canPlay` false: the file isn't here, or the
 * game isn't synced) a click on a play only selects it.
 */
export function useGamePlayback({
  video,
  plays,
  order,
  allOrder,
  bands,
  canPlay,
  onSeek,
}: {
  video: HTMLVideoElement;
  plays: readonly TimedPlay[];
  order: readonly number[];
  /** Every play by time, whatever the list shows. */
  allOrder: readonly number[];
  /** The periods on the video: they tell a break from play. */
  bands: readonly PeriodBand[];
  canPlay: boolean;
  /** For analytics: something other than the scrubber moved the video. */
  onSeek?: (via: string, kind: string, period: number | null) => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [nowKey, setNowKey] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [moment, setMoment] = useState<GameMoment | null>(null);
  const pinRef = useRef<PlayPin | null>(null);
  const latest = useRef({ plays, order, allOrder, bands, canPlay, onSeek });
  useLayoutEffect(() => {
    latest.current = { plays, order, allOrder, bands, canPlay, onSeek };
  });

  const follow = useCallback(() => {
    const now = latest.current;
    if (!now.canPlay) return;
    const t = video.currentTime;
    // The pin lives by the whole game: a clicked play lets go when any later play has happened.
    const whole = activePlay(now.plays, now.allOrder, t, pinRef.current);
    pinRef.current = whole.pin;
    const onScreen = whole.index >= 0 ? now.plays[now.allOrder[whole.index]].key : null;
    setNowKey((prev) => (prev === onScreen ? prev : onScreen));
    // The lit row: the clicked play while it is held and listed, else the latest listed play.
    let key: string | null;
    if (whole.pin && now.order.some((i) => now.plays[i].key === whole.pin!.key)) key = whole.pin.key;
    else {
      const at = playIndexAt(now.plays, now.order, t);
      key = at >= 0 ? now.plays[now.order[at]].key : null;
    }
    setActiveKey((prev) => (prev === key ? prev : key));
    // The lead before a period is that period: a jump to Q3 isn't still half-time.
    const at = momentAt({ bands: now.bands as PeriodBand[] }, video.currentTime, PERIOD_LEAD_SECONDS);
    setMoment((prev) => (prev && prev.phase === at.phase && prev.period === at.period && prev.next === at.next ? prev : at));
  }, [video]);

  useEffect(() => {
    if (!canPlay) return;
    const onPlay = () => setStarted(true);
    video.addEventListener("timeupdate", follow);
    video.addEventListener("seeked", follow);
    video.addEventListener("loadedmetadata", follow);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("timeupdate", follow);
      video.removeEventListener("seeked", follow);
      video.removeEventListener("loadedmetadata", follow);
      video.removeEventListener("play", onPlay);
    };
  }, [video, follow, canPlay]);

  // A filter can take the current play out of the list, or bring a nearer one in.
  useEffect(() => {
    follow();
  }, [order, bands, follow]);

  /**
   * Moves the video to a second of the game. A clicked play stays the current
   * one for as long as the video is inside its run-up, whichever way it is
   * moved there (an arrow's step, a scrub, a swipe): the pin's own rule
   * decides (activePlay), so the lit row doesn't fall back to the plays that
   * happen during the run-up. `jump` is a move to another moment of the game
   * (a quarter, a marker, a skip): that lets go of the clicked play. `hold`
   * is the play that moment leads to (a timeout's restart leads to the play
   * out of it, a run's start to its first basket): it is the current play
   * from here until it has happened, as a clicked play is through its
   * run-up, so what the coach went there to see is what is named and added.
   */
  const seekTo = useCallback(
    (t: number, opts: { play?: boolean; jump?: boolean; hold?: TimedPlay | null } = {}) => {
      if (!latest.current.canPlay) return;
      if (opts.jump) pinRef.current = null;
      const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 0.05 : Infinity;
      const to = clamp(t, 0, Math.max(0, end));
      const held = pinToward(opts.hold, to);
      if (held) pinRef.current = held;
      video.currentTime = to;
      if (opts.play) {
        video.play().catch(() => {});
        setStarted(true);
      }
      follow();
    },
    [video, follow],
  );

  /**
   * A click on a play: from its pre-roll, with the play held as current until it has happened. `kind` is what the
   * click was on, for the report (a run's stretch on the timeline starts its first basket this way).
   */
  const playPlay = useCallback(
    (play: TimedPlay, via = "row", kind = "play") => {
      const now = latest.current;
      now.onSeek?.(via, kind, play.event.period);
      if (!now.canPlay || play.reach !== "in") {
        pinRef.current = null;
        setActiveKey(play.key);
        setNowKey(play.key);
        return;
      }
      pinRef.current = pinFor(play);
      setActiveKey(play.key);
      setNowKey(play.key);
      video.currentTime = play.start;
      video.play().catch(() => {});
      setStarted(true);
    },
    [video],
  );

  const position = useMemo(() => {
    if (!activeKey) return -1;
    return order.findIndex((i) => plays[i].key === activeKey);
  }, [activeKey, order, plays]);

  /** The play `delta` rows from the current one; from the playhead when the current play isn't listed. */
  const step = useCallback(
    (delta: 1 | -1, via = "key") => {
      const now = latest.current;
      if (now.order.length === 0) return;
      let target: number;
      const at = activeKey ? now.order.findIndex((i) => now.plays[i].key === activeKey) : -1;
      if (at >= 0) target = at + delta;
      else {
        const here = now.canPlay ? playIndexAt(now.plays, now.order, video.currentTime) : -1;
        target = delta > 0 ? here + 1 : here;
      }
      if (target < 0 || target >= now.order.length) return;
      playPlay(now.plays[now.order[target]], via);
    },
    [activeKey, video, playPlay],
  );

  const next = useCallback((via?: string) => step(1, via), [step]);
  const prev = useCallback((via?: string) => step(-1, via), [step]);
  const toEnd = useCallback(
    (which: "first" | "last") => {
      const now = latest.current;
      if (now.order.length === 0) return;
      playPlay(now.plays[now.order[which === "first" ? 0 : now.order.length - 1]], "key");
    },
    [playPlay],
  );
  const replay = useCallback(() => {
    const now = latest.current;
    const at = activeKey ? now.plays.find((p) => p.key === activeKey) : undefined;
    if (at) playPlay(at, "transport");
  }, [activeKey, playPlay]);

  return {
    /** The lit row: the latest play the list shows (or the one just clicked). */
    activeKey,
    /** The play on screen, of the whole game: what the Now bar names. */
    nowKey,
    /** The current play's place among the listed plays; −1 when it isn't listed or there is none. */
    position,
    /** Playback has begun at least once on this visit. */
    started,
    /** Where the playhead is in the game; null without footage. */
    moment: canPlay ? moment : null,
    playPlay,
    seekTo,
    next,
    prev,
    toEnd,
    replay,
    canPrev: order.length > 0 && position !== 0,
    canNext: order.length > 0 && position < order.length - 1,
  };
}
