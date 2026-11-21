import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { nextPlayable, previousPlayable, type TeamPlayRow } from "@scoutable/shared/lib/team-video";
import type { PlayByPlayEvent, StoredMatch } from "@/types/match";
import { isLocalPath, streamFileSrc } from "@/lib/stream";

type PlayRow = Extract<TeamPlayRow, { kind: "play" }>;

/**
 * Plays a team's plays across games on one video element (docs/teams.md,
 * "Plays"): a play's game's file is loaded if it isn't the one in the
 * element, the play is sought to its pre-roll and played to its post-roll,
 * and playback runs on to the next listed play whose game can play, into the
 * next game, until the last. The seek and run-on are Add clips' own
 * (clip-browser-panel.tsx), with its queue replaced by the listed rows.
 */
export function useCrossGamePlayback({
  video,
  rows,
  matches,
  playable,
  preRoll,
  postRoll,
}: {
  video: HTMLVideoElement;
  rows: readonly TeamPlayRow[];
  matches: ReadonlyMap<string, StoredMatch>;
  playable: (gameId: string) => boolean;
  preRoll: number;
  postRoll: number;
}) {
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const playableRef = useRef(playable);
  playableRef.current = playable;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const rollRef = useRef({ preRoll, postRoll });
  rollRef.current = { preRoll, postRoll };
  const currentRef = useRef(currentKey);
  currentRef.current = currentKey;
  const clipEndRef = useRef<number | undefined>(undefined);
  /** A play waiting for its game's file to load. */
  const pendingRef = useRef<PlayRow | null>(null);
  /** Which game's file the element holds. */
  const loadedRef = useRef<string | null>(null);

  const rowOf = useCallback((key: string | null): PlayRow | null => {
    if (!key) return null;
    const r = rowsRef.current.find((x) => x.kind === "play" && x.key === key);
    return r && r.kind === "play" ? r : null;
  }, []);

  const current = useMemo(() => rowOf(currentKey), [rowOf, currentKey, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const gameId = current?.game.gameId ?? null;
  const src = useMemo(() => {
    const url = gameId ? matches.get(gameId)?.videoUrl : null;
    if (!url) return null;
    return isLocalPath(url) ? streamFileSrc(url) : url;
  }, [gameId, matches]);
  useEffect(() => {
    loadedRef.current = src ? gameId : null;
  }, [src, gameId]);

  /** Pause, seek to the play's pre-roll, play to its post-roll. */
  const seek = useCallback(
    (event: PlayByPlayEvent, id: string) => {
      const m = matchesRef.current.get(id);
      if (!m?.syncPoint) return;
      const t = computeVideoTime(event, m.syncPoint);
      if (t === null) return;
      const start = Math.max(0, t - rollRef.current.preRoll);
      clipEndRef.current = undefined;
      video.pause();
      const onSeeked = () => {
        // A stale seek still landing: wait for ours.
        if (video.currentTime > start + 2) {
          video.addEventListener("seeked", onSeeked, { once: true });
          return;
        }
        clipEndRef.current = t + rollRef.current.postRoll;
        video.play().catch(() => {});
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.currentTime = start;
    },
    [video],
  );

  const play = useCallback(
    (key: string) => {
      const r = rowOf(key);
      if (!r) return;
      setCurrentKey(key);
      currentRef.current = key;
      if (!playableRef.current(r.game.gameId)) {
        // Listed but can't play here: it is the play shown, and nothing runs.
        video.pause();
        clipEndRef.current = undefined;
        setRunning(false);
        return;
      }
      setRunning(true);
      if (loadedRef.current === r.game.gameId) seek(r.event, r.game.gameId);
      else pendingRef.current = r;
    },
    [rowOf, seek, video],
  );
  const playRef = useRef(play);
  playRef.current = play;

  const stop = useCallback(() => {
    clipEndRef.current = undefined;
    pendingRef.current = null;
    video.pause();
    setRunning(false);
  }, [video]);

  const ok = useCallback((id: string) => playableRef.current(id), []);
  const next = useCallback(() => {
    const key = nextPlayable(rowsRef.current, currentRef.current, ok);
    if (key) playRef.current(key);
  }, [ok]);
  const previous = useCallback(() => {
    const key = previousPlayable(rowsRef.current, currentRef.current, ok);
    if (key) playRef.current(key);
  }, [ok]);
  const replay = useCallback(() => {
    const r = rowOf(currentRef.current);
    if (r) playRef.current(r.key);
  }, [rowOf]);
  const playAll = useCallback(() => {
    const key = nextPlayable(rowsRef.current, null, ok);
    if (key) playRef.current(key);
  }, [ok]);

  // The seek waiting for another game's file, once the stage has loaded it.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || !src || pending.game.gameId !== gameId) return;
    pendingRef.current = null;
    const go = () => seek(pending.event, pending.game.gameId);
    if (video.readyState >= 1) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  }, [src, gameId, seek, video]);

  // Run on: at the play's post-roll, the next listed play that can play, in this game or the next; past the last, stop.
  useEffect(() => {
    const onTime = () => {
      const end = clipEndRef.current;
      if (end === undefined || video.currentTime < end || video.currentTime > end + 60) return;
      clipEndRef.current = undefined;
      const key = nextPlayable(rowsRef.current, currentRef.current, ok);
      if (key) playRef.current(key);
      else {
        video.pause();
        setRunning(false);
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [video, ok]);

  // The element outlives the view: nothing plays on once it goes.
  useEffect(() => () => video.pause(), [video]);

  const clipWindow = useMemo(() => {
    if (!current) return null;
    const m = matches.get(current.game.gameId);
    if (!m?.syncPoint) return null;
    const t = computeVideoTime(current.event, m.syncPoint);
    return t === null ? null : clipBounds(t, preRoll, postRoll);
  }, [current, matches, preRoll, postRoll]);

  return { currentKey, current, src, running, play, next, previous, replay, stop, playAll, clipWindow };
}
