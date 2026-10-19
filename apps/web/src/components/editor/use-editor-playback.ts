"use client";

/**
 * The editor's player state: one <video>, the watch queue over the
 * playlist's items as the owner plays them (windows of their own cloud
 * copies, so a trim shows the moment it is made), the signed play URLs for
 * those copies, the speed, full screen, and the trim session.
 *
 * While a clip is being trimmed the queue steps aside (nothing plays or
 * advances on its own; the trim bar drives the element), and when the trim
 * ends the clip comes back paused at its new start, so Space plays the
 * result and the queue carries on after it.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clipBounds, computeVideoTime, type RollPair } from "@scoutable/shared/lib/clip-timing";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { offsetsForTrim } from "@scoutable/shared/lib/trim-math";
import { buildWatchItems, type WatchItem } from "@scoutable/shared/lib/watch-queue";
import { isClipItem, type PlayByPlayEvent, type Playlist, type PlaylistClipItem } from "@scoutable/shared/types/match";
import type { PlayerStageHandle } from "@/components/player/player-stage";
import { useMediaDuration, useMediaElement } from "@/components/player/use-media";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { useWatchQueue } from "@/components/playlist/use-watch-queue";
import { trackEvent } from "@/lib/analytics";
import { usePlayUrls } from "@/lib/game-videos";
import type { TrimWindow } from "./clip-trimmer";
import type { EditorCloud } from "./use-playlist-editor";

/** The clip on the trim bar: its play's time in the video and the window as it was when trimming began. */
export interface TrimSession {
  key: string;
  matchId: string;
  eventId: number;
  eventTime: number;
  start: number;
  end: number;
}

/** The same key the watch view remembers the speed under, so one choice follows the viewer. */
const SPEED_KEY = "scoutable_watch_speed";
/** A trim counts from this much movement of either end. */
const TRIM_EPSILON = 0.05;

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

const noop = () => {};

export function useEditorPlayback({
  playlist,
  eventByKey,
  cloud,
  rolls,
  onCommitOffsets,
}: {
  playlist: Playlist | null;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  cloud: EditorCloud;
  rolls: RollPair;
  /** A trim or a Reset: the clip's new offsets (use-playlist-editor's commitClipOffsets). */
  onCommitOffsets: (key: string, pre: number, post: number) => unknown;
}) {
  const { element: video, ref: videoRef, attach: attachVideo } = useMediaElement<HTMLVideoElement>();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageHandle = useRef<PlayerStageHandle | null>(null);
  const fullscreen = useStageFullscreen(stage);
  const duration = useMediaDuration(video);

  const [speed, setSpeedState] = useState(readSpeed);
  const setSpeed = useCallback((next: number) => {
    setSpeedState(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // Remembering the speed is a convenience.
    }
  }, []);

  // Every clip of a game the owner has in the cloud plays as a window of
  // that copy, uploaded file or not; a clip of a game they haven't plays
  // from its file when it has one, and not at all otherwise.
  const items = useMemo<WatchItem[]>(
    () => (playlist ? buildWatchItems(playlist, eventByKey as Map<string, PlayByPlayEvent>, { syncByMatch: cloud.syncByMatch, preferWindows: true }) : []),
    [playlist, eventByKey, cloud.syncByMatch],
  );
  const windowMatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) if (item.kind === "window") ids.add(item.matchId);
    return [...ids];
  }, [items]);
  const playUrls = usePlayUrls(windowMatchIds);

  // The owner's own playback is never a view: nothing is recorded.
  const q = useWatchQueue({ video, videoRef, items, onWatched: noop, windowSrc: playUrls.urlFor });

  const [trim, setTrim] = useState<TrimSession | null>(null);

  const itemsRef = useRef(items);
  const qRef = useRef(q);
  const rollsRef = useRef(rolls);
  const trimRef = useRef(trim);
  useLayoutEffect(() => {
    itemsRef.current = items;
    qRef.current = q;
    rollsRef.current = rolls;
    trimRef.current = trim;
  });

  const clipByKey = useMemo(() => {
    const map = new Map<string, PlaylistClipItem>();
    if (playlist) for (const item of playlist.items) if (isClipItem(item)) map.set(itemKey(item), item);
    return map;
  }, [playlist]);

  /** The clip's window in its game's copy, from the playlist's pair and the clip's own offsets; null when it can't be placed. */
  const windowFor = useCallback(
    (key: string): { eventTime: number; start: number; end: number } | null => {
      const clip = clipByKey.get(key);
      const event = eventByKey.get(key);
      const sync = clip && cloud.syncByMatch.get(clip.matchId);
      if (!clip || !event || !sync) return null;
      const eventTime = computeVideoTime(event, sync);
      if (eventTime === null) return null;
      const { start, end } = clipBounds(eventTime, rolls.pre, rolls.post, clip.preRollOffset, clip.postRollOffset);
      return { eventTime, start, end };
    },
    [clipByKey, eventByKey, cloud.syncByMatch, rolls],
  );

  // ---------------------------------------------------------------------------
  // Playing rows
  // ---------------------------------------------------------------------------

  /**
   * Plays the row under `key` and the ones after it. A text card played by
   * hand is held on the stage so it can be read and edited; Space carries
   * on from it. False when the row has nothing to play.
   */
  const playRow = useCallback((key: string, opts: { holdCard?: boolean } = {}): boolean => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (!item) return false;
    // Another clip takes over from one on the trim bar: the trim just closes.
    if (trimRef.current && trimRef.current.key !== key) setTrim(null);
    qRef.current.playFrom(key);
    if (item.kind === "text" && opts.holdCard) qRef.current.toggleCard();
    return true;
  }, []);

  /** Seeks within the playing clip: a window keeps the seek inside its seconds of the game. */
  const seek = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el) return;
      const active = qRef.current.activeItem;
      const win = active?.kind === "window" ? active : null;
      const lo = win ? win.start : 0;
      const hi = win ? Math.max(win.start, win.end - 0.05) : duration === null ? null : Math.max(0, duration - 0.05);
      if (hi === null) return;
      el.currentTime = clamp(t, lo, hi);
    },
    [videoRef, duration],
  );

  const nudge = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el || !qRef.current.activeItem || qRef.current.activeItem.kind === "text") return;
      seek(el.currentTime + delta);
    },
    [videoRef, seek],
  );

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (el) el.muted = !el.muted;
  }, [videoRef]);

  // ---------------------------------------------------------------------------
  // Trim
  // ---------------------------------------------------------------------------

  /**
   * T, the Trim button, or a row's "Trim clip…": the clip's ends on handles
   * over the player. The clip must play as a window of a copy whose URL is
   * in (it is signed as the editor opens). A clip that isn't playing is
   * brought up first. False when it can't be trimmed.
   */
  const startTrim = useCallback(
    (key?: string | null): boolean => {
      const k = key ?? qRef.current.activeKey;
      if (!k || trim) return false;
      const item = itemsRef.current.find((i) => i.key === k);
      if (!item || item.kind !== "window") return false;
      if (!playUrls.urlFor(item.matchId)) return false;
      const w = windowFor(k);
      if (!w) return false;
      const clip = clipByKey.get(k);
      if (!clip) return false;
      // The element holds this clip's game at the clip: the queue brings it up, then steps aside.
      if (qRef.current.activeKey !== k) qRef.current.playFrom(k);
      qRef.current.stop();
      setTrim({ key: k, matchId: clip.matchId, eventId: clip.eventId, eventTime: w.eventTime, start: w.start, end: w.end });
      return true;
    },
    [trim, playUrls, windowFor, clipByKey],
  );

  /**
   * Done (with the new ends) or Cancel (null). A change counts from 0.05 s
   * and is saved as the clip's offsets. Either way the clip comes back
   * paused at its start, once the list reflects it.
   */
  const endTrim = useCallback(
    (result: TrimWindow | null) => {
      const tr = trim;
      if (!tr) return;
      setTrim(null);
      let window = { start: tr.start, end: tr.end };
      const inChanged = !!result && Math.abs(result.start - tr.start) >= TRIM_EPSILON;
      const outChanged = !!result && Math.abs(result.end - tr.end) >= TRIM_EPSILON;
      if (result && (inChanged || outChanged)) {
        const pair = rollsRef.current;
        const offsets = offsetsForTrim({ eventTime: tr.eventTime, start: result.start, end: result.end, preRoll: pair.pre, postRoll: pair.post });
        void onCommitOffsets(tr.key, offsets.preRollOffset, offsets.postRollOffset);
        window = clipBounds(tr.eventTime, pair.pre, pair.post, offsets.preRollOffset, offsets.postRollOffset);
        trackEvent("clip_trimmed", {
          origin: "web",
          playlist_id: playlist?.id,
          in_changed: inChanged,
          out_changed: outChanged,
          length_seconds: Math.round((window.end - window.start) * 10) / 10,
        });
      }
      // The edit lands in the list on the render this handler queued; the
      // queue reads the new window a frame later and parks the clip there
      // (unless the clip left the list meanwhile).
      requestAnimationFrame(() => {
        if (!itemsRef.current.some((i) => i.key === tr.key)) return;
        qRef.current.playFrom(tr.key);
        videoRef.current?.pause();
      });
    },
    [trim, onCommitOffsets, playlist?.id, videoRef],
  );

  /** Reset: the clip back to the playlist's clip length. */
  const resetTrim = useCallback(
    (key: string) => {
      const clip = clipByKey.get(key);
      if (!clip || ((clip.preRollOffset ?? 0) === 0 && (clip.postRollOffset ?? 0) === 0)) return;
      void onCommitOffsets(key, 0, 0);
      if (qRef.current.activeKey === key) {
        requestAnimationFrame(() => {
          qRef.current.playFrom(key);
          videoRef.current?.pause();
        });
      }
    },
    [clipByKey, onCommitOffsets, videoRef],
  );

  // ---------------------------------------------------------------------------
  // What the stage shows
  // ---------------------------------------------------------------------------

  /** The item on the stage: the one being trimmed, else the queue's. */
  const activeKey = trim?.key ?? q.activeKey;
  const activeItem = useMemo(() => (trim ? (items.find((i) => i.key === trim.key) ?? null) : q.activeItem), [trim, items, q.activeItem]);
  const activePlay = activeItem && activeItem.kind !== "text" ? activeItem : null;
  const activeWindow = activePlay?.kind === "window" ? activePlay : null;
  const activeCard = activeItem?.kind === "text" ? activeItem.card : null;

  return {
    video,
    videoRef,
    attachVideo,
    stage,
    setStage,
    stageHandle,
    fullscreen,
    duration,
    speed,
    setSpeed,
    items,
    playUrls,
    q,
    playRow,
    seek,
    nudge,
    toggleMute,
    trim,
    startTrim,
    endTrim,
    resetTrim,
    windowFor,
    activeKey,
    activeItem,
    activePlay,
    activeWindow,
    activeCard,
  };
}

export type EditorPlayback = ReturnType<typeof useEditorPlayback>;
