import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { scoreAfter, scoreBefore, type GameFlow } from "@scoutable/shared/lib/game-flow";
import type { GameTimeline } from "@scoutable/shared/lib/game-timeline";
import { projectedSync, sameSyncPoint } from "@scoutable/shared/lib/period-sync";
import { defaultPreRoll } from "@scoutable/shared/lib/provider";
import {
  CHECK_LEAD_SECONDS,
  CHECK_TAIL_SECONDS,
  SAME_PLACE_SECONDS,
  checkCandidate,
  describeShiftSeconds,
  gapCandidate,
  gapShift,
  narrowClose,
  narrowFound,
  narrowRight,
  partChecked,
  partOf,
  planFix,
  playCue,
  playsMoved,
  suggestedScope,
  syncParts,
  syncFixes,
  syncProgress,
  withCheck,
  withOwnTime,
  withoutFix,
  withoutFixes,
  type FixPlan,
  type SyncFix,
  type NarrowGap,
  type PlayCue,
  type SyncPart,
} from "@scoutable/shared/lib/sync-check";
import { trackEvent } from "@/lib/analytics";
import { updateSyncPoint } from "@/lib/matches-db";
import { Sentry } from "@/lib/sentry";
import { afterSyncChange } from "@/lib/sync-change";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

/** Where a fix was started: Check sync's "It's off", the Now bar's Fix sync, or a row's menu. */
export type SyncOrigin = "check" | "now_bar" | "menu";

/**
 * Narrowing down where a shift starts (lib/sync-check.ts, NarrowGap). The fix
 * that began it is saved; what the looks at earlier plays change is kept in
 * `work` and saved once, when no play is left in doubt or the coach stops.
 * `undoTo` is the sync before the fix, `fixed` the play it was made on,
 * `partName` the stretch it was in then.
 */
interface Narrow {
  undoTo: SyncPoint;
  work: SyncPoint;
  gaps: NarrowGap<PlayByPlayEvent>[];
  fixed: PlayByPlayEvent;
  /** What the fix's toast said, said again when the narrowing saves without moving a play: its Undo is still the fix's. */
  message: string;
  partName: string;
  origin: SyncOrigin;
}

/** What the game view's sync is doing (docs/game-view.md, "Sync"). */
export type SyncMode =
  | { kind: "idle" }
  /** A play is played with the moment the sync has it at marked: is it right? Checking a part, or narrowing a shift down. */
  | {
      kind: "ask";
      purpose: "check" | "narrow";
      event: PlayByPlayEvent;
      at: number;
      part: SyncPart | null;
      partName: string;
      total: number;
      narrow: Narrow | null;
      /** The first play of a check: the bar says what a check is. */
      first?: boolean;
    }
  /** The coach scrubs to where the play really happens. While narrowing, the video starts where the shift would put the play. */
  | { kind: "find"; event: PlayByPlayEvent; mapped: number; origin: SyncOrigin; narrow: Narrow | null }
  /** The play is found: how far it moved, and what moves with it. */
  | { kind: "confirm"; event: PlayByPlayEvent; mapped: number; found: number; plan: FixPlan; suggested: "play" | "on"; origin: SyncOrigin }
  /** A fix made from a play is saved: the plays before it may be off too. */
  | { kind: "offer"; narrow: Narrow };

const TOAST = "game-sync";
/** "Sync checked" has its own toast: it must not take the place of a move's toast, whose Undo is still wanted. */
const DONE_TOAST = "game-sync-checked";
const partKey = (part: SyncPart) => `${part.period}:${part.cut?.syncRealWorldTime ?? "start"}`;
const msOf = (iso: string) => new Date(iso).getTime();
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * Finding and fixing the sync from the game view, on the view's own video:
 * Check sync (one play of each part of the game, right or off), Fix sync on
 * any play (find where it happens; the app proposes how far the move
 * reaches), and after a fix the narrowing down of where it starts. The rules
 * are lib/sync-check.ts; this is their host: the mode, the video, the saves
 * with their Undo, analytics.
 */
export function useGameSync({
  match,
  timeline,
  flow,
  video,
  duration,
  footage,
  seek,
  onSyncChange,
}: {
  match: StoredMatch;
  timeline: GameTimeline;
  flow: GameFlow;
  video: HTMLVideoElement;
  duration: number | null;
  footage: boolean;
  /** Moves the game view's video. */
  seek: (t: number, play: boolean) => void;
  /** The game's sync was saved: the page's copy of the game follows. */
  onSyncChange: (next: SyncPoint) => void;
}) {
  const [mode, setMode] = useState<SyncMode>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  // The sync as last saved: a step that follows a save reads it before the page has drawn the game again.
  const syncRef = useRef(match.syncPoint);
  useEffect(() => {
    syncRef.current = match.syncPoint;
  }, [match.syncPoint]);
  const tried = useRef(new Set<number>());
  const skipped = useRef(new Set<string>());
  const lead = defaultPreRoll(match);

  // Every play the game view lists (no bookkeeping rows, no timeouts).
  const plays = useMemo(() => timeline.plays.map((p) => p.event), [timeline]);
  const inFile = useCallback(
    (e: PlayByPlayEvent, sync: SyncPoint) => {
      const t = computeVideoTime(e, sync);
      return t !== null && t >= 0 && (duration === null || t <= duration);
    },
    [duration],
  );

  const parts = useMemo(() => (match.syncPoint && footage ? syncParts(match.syncPoint, plays) : []), [match.syncPoint, plays, footage]);
  const progress = useMemo(() => syncProgress(parts), [parts]);

  // ---- Saving -------------------------------------------------------------------
  const commit = useCallback(
    async (next: SyncPoint, opts: { moved: boolean; message?: string; undoTo?: SyncPoint; scope?: string } = { moved: false }): Promise<boolean> => {
      const before = syncRef.current;
      setBusy(true);
      try {
        // A check alone places every play where it was: no clip that players have is touched.
        await updateSyncPoint(match.id, next, { moved: opts.moved });
      } catch (e) {
        Sentry.captureException(e);
        toast.error("Couldn’t save the sync", { id: TOAST, description: "Check the connection and try again.", action: undefined });
        return false;
      } finally {
        setBusy(false);
      }
      syncRef.current = next;
      onSyncChange(next);
      // Shared clips cut with the old sync are cut again; a check alone moves nothing.
      if (opts.moved) void afterSyncChange({ ...match, syncPoint: next }, before);
      if (opts.message) {
        const undoTo = opts.undoTo;
        toast.success(opts.message, {
          id: TOAST,
          action: undoTo
            ? {
                label: "Undo",
                onClick: (e) => {
                  e.preventDefault();
                  if (!sameSyncPoint(syncRef.current, next)) {
                    toast("The sync changed since, so nothing was undone", { id: TOAST, action: undefined });
                    return;
                  }
                  void (async () => {
                    try {
                      await updateSyncPoint(match.id, undoTo);
                    } catch (err) {
                      Sentry.captureException(err);
                      toast.error("Couldn’t put the sync back", { id: TOAST, action: undefined, description: "Check the connection and try again." });
                      return;
                    }
                    syncRef.current = undoTo;
                    onSyncChange(undoTo);
                    setMode({ kind: "idle" });
                    void afterSyncChange({ ...match, syncPoint: undoTo }, next);
                    toast.success("Moved back", { id: TOAST, action: undefined });
                    trackEvent("sync_fix_undone", { scope: opts.scope, surface: "game_view" });
                  })();
                },
              }
            : undefined,
        });
      }
      return true;
    },
    [match, onSyncChange],
  );
  // The toast's Undo acts on this game: it goes when the view does.
  useEffect(
    () => () => {
      toast.dismiss(TOAST);
      toast.dismiss(DONE_TOAST);
    },
    [],
  );

  // ---- Asking about a play ---------------------------------------------------------
  const ask = useCallback(
    (purpose: "check" | "narrow", event: PlayByPlayEvent, part: SyncPart | null, partName: string, total: number, narrow: Narrow | null, first = false) => {
      // A play asked about while narrowing is where the work in hand has it.
      const sync = narrow ? narrow.work : syncRef.current;
      const at = sync ? computeVideoTime(event, sync) : null;
      if (at === null) return false;
      setMode({ kind: "ask", purpose, event, at, part, partName, total, narrow, first });
      seek(Math.max(0, at - CHECK_LEAD_SECONDS), true);
      return true;
    },
    [seek],
  );

  /** The next part to check: the first one with no check that wasn't passed on and has a play to ask about. */
  const nextCheck = useCallback(
    (first?: number) => {
      const sync = syncRef.current;
      if (!sync) return null;
      const all = syncParts(sync, plays);
      const shown = plays.filter((e) => inFile(e, sync));
      const order = first === undefined ? all : [...all.filter((p) => p.index === first), ...all.filter((p) => p.index !== first)];
      for (const part of order) {
        if (partChecked(part) || skipped.current.has(partKey(part))) continue;
        const event = checkCandidate(part, all, shown, sync, tried.current);
        if (event) return { part, event, total: all.length };
      }
      return null;
    },
    [plays, inFile],
  );

  const finish = useCallback(() => {
    setMode({ kind: "idle" });
    video.pause();
    const sync = syncRef.current;
    const left = sync ? syncProgress(syncParts(sync, plays)).left : 0;
    trackEvent("sync_check_finished", { left });
    if (left === 0) toast.success("Sync checked", { id: DONE_TOAST, description: "Every part of the game has a play you’ve seen in the right place." });
  }, [video, plays]);

  const advance = useCallback(() => {
    const next = nextCheck();
    if (!next || !ask("check", next.event, next.part, next.part.name, next.total, null)) finish();
  }, [nextCheck, ask, finish]);

  /** Check sync: from the first part without a check, or from `partIndex` (a click on that part of the timeline). */
  const startCheck = useCallback(
    (entry: "button" | "lane" | "banner", partIndex?: number) => {
      if (!footage || !syncRef.current) return;
      tried.current = new Set();
      skipped.current = new Set();
      const next = nextCheck(partIndex);
      trackEvent("sync_check_started", { entry, parts: progress.total, left: progress.left });
      if (!next || !ask("check", next.event, next.part, next.part.name, next.total, null, true)) {
        toast(progress.left === 0 ? "Sync is already checked" : "No play to check with", {
          id: TOAST,
          description: progress.left === 0 ? "Use Fix sync on a play that looks off." : "The parts left have no made basket inside the video. Use Fix sync on a play instead.",
          action: undefined,
        });
      }
    },
    [footage, nextCheck, ask, progress],
  );

  // ---- Finding a play --------------------------------------------------------------
  const enterFind = useCallback(
    (event: PlayByPlayEvent, origin: SyncOrigin, narrow: Narrow | null = null) => {
      const sync = narrow ? narrow.work : syncRef.current;
      const mapped = sync ? computeVideoTime(event, sync) : null;
      if (!sync || mapped === null) {
        toast("This play has no time in the feed, so it can’t be placed", { id: TOAST, action: undefined });
        return;
      }
      // Open where the play is set now; when that isn't in the video at all (a later quarter of a video that skips
      // the breaks), where it should be if the breaks are cut. While narrowing: where the shift would put it, so a
      // play that has the same shift is already on screen.
      const shown = mapped >= 0 && (duration === null || mapped < duration);
      const start = narrow?.gaps[0]
        ? mapped + gapShift(sync, narrow.gaps[0].b)
        : shown
          ? mapped
          : (computeVideoTime(event, projectedSync(sync, match.events)) ?? mapped);
      video.pause();
      setMode({ kind: "find", event, mapped, origin, narrow });
      seek(Math.max(0, duration === null ? start : Math.min(start, duration - 1)), false);
    },
    [video, duration, match.events, seek],
  );

  // ---- Taking fixes back -----------------------------------------------------------
  /** The fixes made in the game view that can be taken back one at a time (lib/sync-check.ts, SyncFix). */
  const fixes = useMemo(() => (match.syncPoint && footage ? syncFixes(match.syncPoint, plays) : []), [match.syncPoint, plays, footage]);

  /** Takes back one fix, or all of them: the plays it moved follow the sync again. The toast's Undo puts it back. */
  const removeFix = useCallback(
    async (fix: SyncFix | "all") => {
      const sync = syncRef.current;
      if (!sync || busy) return;
      const next = fix === "all" ? withoutFixes(sync) : withoutFix(sync, fix);
      if (sameSyncPoint(next, sync)) return;
      trackEvent("sync_fix_removed", { kind: fix === "all" ? "all" : fix.kind, surface: "game_view" });
      await commit(next, { moved: true, message: fix === "all" ? "Fixes removed" : "Fix removed", undoTo: sync, scope: "remove" });
    },
    [busy, commit],
  );

  /** Fix sync on a play, from the Now bar or a row's menu. */
  const fixPlay = useCallback(
    (event: PlayByPlayEvent, origin: "now_bar" | "menu") => {
      if (!footage || !syncRef.current) return;
      trackEvent("sync_fix_opened", { entry: origin === "menu" ? "game_row_menu" : "game_now_bar" });
      enterFind(event, origin);
    },
    [footage, enterFind],
  );

  /** After a fix made outside Check sync: back to watching, on the play where it is now. */
  const backToPlay = useCallback(
    (event: PlayByPlayEvent) => {
      setMode({ kind: "idle" });
      const sync = syncRef.current;
      const at = sync ? computeVideoTime(event, sync) : null;
      if (at !== null) seek(Math.max(0, at - lead), true);
    },
    [seek, lead],
  );

  // ---- Narrowing down where a shift starts -----------------------------------------
  /** Saves what the narrowing has worked out, and goes on: with the check, or back to the play the fix was made on. */
  const finishNarrow = useCallback(
    async (n: Narrow) => {
      const current = syncRef.current;
      if (current && !sameSyncPoint(n.work, current)) {
        const moved = playsMoved(current, n.work, match.events);
        const saved = await commit(n.work, {
          moved: moved > 0,
          // The fix's own toast said how far; this one says what the looks at earlier plays added. Either way
          // Undo takes the game back to before the fix.
          message: moved > 0 ? `${plural(moved, "earlier play")} moved too` : n.message,
          undoTo: n.undoTo,
          scope: "play",
        });
        if (!saved) return;
        if (moved > 0) trackEvent("sync_fix_applied", { scope: "narrowed", period: n.fixed.period, surface: "game_view", plays: moved });
      }
      if (n.origin === "check") advance();
      else backToPlay(n.fixed);
    },
    [match.events, commit, advance, backToPlay],
  );

  /** The next play to look at: in the first gap that has one. A gap with none left is closed on the way. */
  const nextNarrow = useCallback(
    (n: Narrow) => {
      let work = n.work;
      const gaps = [...n.gaps];
      while (gaps.length > 0) {
        const event = gapCandidate(work, plays.filter((e) => inFile(e, work)), gaps[0]);
        if (event) {
          if (ask("narrow", event, null, n.partName, 0, { ...n, work, gaps })) return;
          break;
        }
        work = narrowClose(work, match.events, gaps[0]);
        gaps.shift();
      }
      void finishNarrow({ ...n, work, gaps: [] });
    },
    [plays, inFile, match.events, ask, finishNarrow],
  );

  // ---- What the bar's buttons do -----------------------------------------------------
  const actions = useMemo(() => {
    const looksRight = async () => {
      if (mode.kind !== "ask" || busy) return;
      trackEvent("sync_check_answered", { answer: "right", purpose: mode.purpose, period: mode.event.period });
      if (mode.purpose === "narrow" && mode.narrow) {
        const n = mode.narrow;
        const step = narrowRight(n.work, n.gaps[0], mode.event);
        return nextNarrow({ ...n, work: step.sync, gaps: [...step.gaps, ...n.gaps.slice(1)] });
      }
      const sync = syncRef.current;
      if (sync && (await commit(withCheck(sync, mode.event)))) advance();
    };
    const itsOff = () => {
      if (mode.kind !== "ask" || busy) return;
      trackEvent("sync_check_answered", { answer: "off", purpose: mode.purpose, period: mode.event.period });
      // Off while narrowing: looked for where the shift would put it.
      if (mode.purpose === "narrow" && mode.narrow) return enterFind(mode.event, mode.narrow.origin, mode.narrow);
      trackEvent("sync_fix_opened", { entry: "game_check" });
      enterFind(mode.event, "check");
    };
    const another = () => {
      if (mode.kind !== "ask" || mode.purpose !== "check") return;
      trackEvent("sync_check_answered", { answer: "another", purpose: "check", period: mode.event.period });
      tried.current.add(mode.event.eventId);
      advance();
    };
    const skip = () => {
      if (mode.kind !== "ask" || mode.purpose !== "check") return;
      trackEvent("sync_check_answered", { answer: "skip", purpose: "check", period: mode.event.period });
      if (mode.part) skipped.current.add(partKey(mode.part));
      advance();
    };
    const replay = () => {
      if (mode.kind === "ask") seek(Math.max(0, mode.at - CHECK_LEAD_SECONDS), true);
    };
    const stop = () => {
      if (mode.kind === "ask" && mode.narrow) void finishNarrow(mode.narrow);
      else if (mode.kind === "ask") finish();
    };
    const here = async () => {
      if (mode.kind !== "find" || busy) return;
      const sync = syncRef.current;
      if (!sync) return;
      const found = video.currentTime;
      if (mode.narrow) {
        // No question of how far it reaches here: the play settles where the shift starts, or gets a fix of its own.
        const n = mode.narrow;
        const step = narrowFound(n.work, match.events, n.gaps[0], mode.event, found, lead);
        trackEvent("sync_check_answered", { answer: step.outcome, purpose: "narrow", period: mode.event.period });
        return nextNarrow({ ...n, work: step.sync, gaps: [...step.gaps, ...n.gaps.slice(1)] });
      }
      const delta = found - mode.mapped;
      if (Math.abs(delta) < SAME_PLACE_SECONDS) {
        if (mode.origin === "check") {
          if (await commit(withCheck(sync, mode.event))) advance();
        } else {
          setMode({ kind: "idle" });
          toast("That’s where the play already is, so nothing moved", { id: TOAST, action: undefined });
        }
        return;
      }
      const plan = planFix(sync, match.events, mode.event, found, lead, "play");
      if (!plan) return;
      video.pause();
      setMode({ kind: "confirm", event: mode.event, mapped: mode.mapped, found, plan, suggested: suggestedScope(mode.event, delta), origin: mode.origin });
    };
    const cancel = () => {
      if (mode.kind !== "find") return;
      // Back to the question the search came from.
      if (mode.narrow) nextNarrow(mode.narrow);
      else if (mode.origin === "check") advance();
      else setMode({ kind: "idle" });
    };
    const back = () => {
      if (mode.kind === "confirm") setMode({ kind: "find", event: mode.event, mapped: mode.mapped, origin: mode.origin, narrow: null });
    };
    const moveOnlyThis = async () => {
      if (mode.kind !== "confirm" || busy) return;
      const sync = syncRef.current;
      if (!sync) return;
      const delta = mode.found - mode.mapped;
      const saved = await commit(withOwnTime(sync, mode.event, mode.found), {
        moved: true,
        message: `This play moved ${describeShiftSeconds(delta)}`,
        undoTo: sync,
        scope: "play_only",
      });
      if (!saved) return;
      trackEvent("sync_fix_applied", { scope: "play_only", period: mode.event.period, delta_s: Math.round(delta * 10) / 10, surface: "game_view", suggested: mode.suggested === "play", late: !!mode.event.loggedAt });
      if (mode.origin === "check") {
        // The play said nothing about its part: another one is asked about.
        tried.current.add(mode.event.eventId);
        advance();
      } else backToPlay(mode.event);
    };
    const moveOn = async () => {
      if (mode.kind !== "confirm" || busy) return;
      const base = syncRef.current;
      if (!base) return;
      const plan = planFix(base, match.events, mode.event, mode.found, lead, "play");
      if (!plan) return;
      const message = `${plural(plan.reach.plays, "play")} moved ${describeShiftSeconds(plan.delta)}`;
      const saved = await commit(plan.next, { moved: true, message, undoTo: base, scope: "play" });
      if (!saved) return;
      trackEvent("sync_fix_applied", { scope: "play", period: mode.event.period, delta_s: Math.round(plan.delta * 10) / 10, surface: "game_view", suggested: mode.suggested === "on", plays: plan.reach.plays });
      // The plays before this one, back to the last one seen right, may be off too.
      const part = partOf(syncParts(base, plays), mode.event);
      const at = msOf(mode.event.realWorldTime);
      const lastRight = part?.checks.filter((c) => msOf(c.realWorldTime) < at && c.eventId !== mode.event.eventId).at(-1);
      const a = lastRight ? (match.events.find((e) => e.eventId === lastRight.eventId) ?? null) : null;
      const narrow: Narrow = { undoTo: base, work: plan.next, gaps: [{ a, b: mode.event }], fixed: mode.event, message, partName: part?.name ?? "", origin: mode.origin };
      const open = gapCandidate(plan.next, plays.filter((e) => inFile(e, plan.next)), narrow.gaps[0]);
      if (!open) {
        if (mode.origin === "check") advance();
        else backToPlay(mode.event);
      } else if (mode.origin === "check") nextNarrow(narrow);
      else setMode({ kind: "offer", narrow });
    };
    const checkEarlier = () => {
      if (mode.kind === "offer") nextNarrow(mode.narrow);
    };
    const done = () => {
      if (mode.kind === "offer") backToPlay(mode.narrow.fixed);
    };
    /** Return: the bar's main button. */
    const primary = () => {
      if (mode.kind === "ask") void looksRight();
      else if (mode.kind === "find") void here();
      else if (mode.kind === "confirm") void (mode.suggested === "play" ? moveOnlyThis() : moveOn());
      else if (mode.kind === "offer") checkEarlier();
    };
    /** Escape: one step back out. */
    const escape = () => {
      if (mode.kind === "ask") stop();
      else if (mode.kind === "find") cancel();
      else if (mode.kind === "confirm") back();
      else if (mode.kind === "offer") done();
    };
    return { looksRight, itsOff, another, skip, replay, stop, here, cancel, back, moveOnlyThis, moveOn, checkEarlier, done, primary, escape };
  }, [mode, busy, video, match.events, plays, lead, seek, commit, advance, finish, enterFind, nextNarrow, finishNarrow, backToPlay, inFile]);

  // A question plays its clip once: from before the play to a little after it.
  const askAt = mode.kind === "ask" ? mode.at : null;
  const askKey = mode.kind === "ask" ? mode.event.eventId : null;
  useEffect(() => {
    if (askAt === null) return;
    const end = askAt + CHECK_TAIL_SECONDS;
    const stop = () => {
      // Only playback running into the clip's end stops there; the coach is free to scrub past it.
      if (!video.paused && video.currentTime >= end && video.currentTime < end + 1.5) video.pause();
    };
    video.addEventListener("timeupdate", stop);
    return () => video.removeEventListener("timeupdate", stop);
  }, [video, askAt, askKey]);

  const active = mode.kind !== "idle";
  const event = mode.kind === "idle" ? null : mode.kind === "offer" ? mode.narrow.fixed : mode.event;
  const cue: PlayCue | null = useMemo(
    () => (event ? playCue(event, scoreBefore(flow, event.eventId), scoreAfter(flow, event.eventId)) : null),
    [event, flow],
  );

  return {
    mode,
    active,
    busy,
    /** The game's parts as the saved sync divides it, for the timeline's sync row. */
    parts,
    progress,
    /** The play the mode is about, and how to find it in the footage. */
    event,
    cue,
    /** The clip a question plays, for the player's scrubber. */
    clip: mode.kind === "ask" ? { start: Math.max(0, mode.at - CHECK_LEAD_SECONDS), end: mode.at + CHECK_TAIL_SECONDS, mark: mode.at } : null,
    startCheck,
    fixPlay,
    /** The game view's fixes, and taking one or all of them back. */
    fixes,
    removeFix,
    actions,
  };
}

export type GameSync = ReturnType<typeof useGameSync>;
