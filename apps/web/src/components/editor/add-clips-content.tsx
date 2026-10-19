"use client";

import * as React from "react";
import { Plus, Timer, X } from "lucide-react";
import { EVENT_TYPE_OPTIONS, SHOT_TYPE_OPTIONS, SITUATION_OPTIONS } from "@scoutable/shared/lib/clip-filters";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { MAX_POST_ROLL_SECONDS, MAX_PRE_ROLL_SECONDS } from "@scoutable/shared/lib/playlist-edits";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";
import type { Playlist, PlaylistClipItem, StoredMatch } from "@scoutable/shared/types/match";
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { PlayerStage, type PlayerStageHandle } from "@/components/player/player-stage";
import { useMediaDuration, useMediaElement } from "@/components/player/use-media";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";
import { useWatchQueue } from "@/components/playlist/use-watch-queue";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MultiSelectMenu } from "@/components/ui/multi-select-menu";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlayUrls } from "@/lib/game-videos";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AddClipsRow } from "./add-clips-row";
import { EventTypeChips } from "./event-type-chips";
import { LeadersPopover } from "./leaders-popover";
import { useAddClips } from "./use-add-clips";
import type { EditorCloud } from "./use-playlist-editor";

const noop = () => {};

export interface AddClipsSource {
  playlist: Playlist;
  matches: ReadonlyMap<string, StoredMatch>;
  cloud: EditorCloud;
  eventsLoaded: ReadonlySet<string>;
  ensureEventsFor: (matchIds: readonly string[]) => Promise<void>;
  /** The game to open on (`?add=<matchId>`). */
  initialMatchId: string | null;
  onAdd: (clips: PlaylistClipItem[]) => void | Promise<void>;
}

/**
 * Adding clips to the playlist: one of the owner's games with a cloud
 * copy, its play-by-play filtered down (the desktop picker's filters and
 * Leaders), each play previewed as a window of the copy on a small stage,
 * ticked, and added with the preview's clip length kept as offsets on the
 * playlist's pair. Owns the keys while it is open (scope "add-clips"):
 * the player's map, Return ticks the playing clip, ⌘A ticks every shown
 * clip, ⌘↩ adds, Esc closes.
 */
export function AddClipsContent({
  source,
  onClose,
  containerRef,
  compact = false,
}: {
  source: AddClipsSource;
  onClose: () => void;
  /** The panel's root, the keys' container; focused on open so they route here. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** In the phone sheet, which pads its own edges. */
  compact?: boolean;
}) {
  const { playlist, cloud, onAdd } = source;
  const picker = useAddClips(source);
  const reduced = useReducedMotionSafe();
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, [containerRef]);

  // ---------------------------------------------------------------------------
  // The preview: the shown plays as windows of the game's copy, at the
  // preview's clip length, through the same queue the editor plays with.
  // ---------------------------------------------------------------------------

  const { element: video, ref: videoRef, attach: attachVideo } = useMediaElement<HTMLVideoElement>();
  const [stage, setStage] = React.useState<HTMLDivElement | null>(null);
  const stageHandle = React.useRef<PlayerStageHandle | null>(null);
  const fullscreen = useStageFullscreen(stage);
  const duration = useMediaDuration(video);
  const [speed, setSpeed] = React.useState(1);

  const sync = picker.matchId ? cloud.syncByMatch.get(picker.matchId) : undefined;
  const previewItems = React.useMemo<WatchItem[]>(() => {
    if (!sync) return [];
    const out: WatchItem[] = [];
    for (const entry of picker.filtered) {
      const t = computeVideoTime(entry.event, sync);
      if (t === null) continue;
      const { start, end } = clipBounds(t, picker.pair.pre, picker.pair.post);
      out.push({ kind: "window", key: entry.key, event: entry.event, matchId: entry.matchId, start, end });
    }
    return out;
  }, [picker.filtered, sync, picker.pair]);
  const previewKeys = React.useMemo(() => new Set(previewItems.map((i) => i.key)), [previewItems]);
  const playUrls = usePlayUrls(React.useMemo(() => (picker.matchId ? [picker.matchId] : []), [picker.matchId]));
  const q = useWatchQueue({ video, videoRef, items: previewItems, onWatched: noop, windowSrc: playUrls.urlFor });
  const active = q.activeItem?.kind === "window" ? q.activeItem : null;

  const seek = React.useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el) return;
      const win = active;
      const lo = win ? win.start : 0;
      const hi = win ? Math.max(win.start, win.end - 0.05) : duration === null ? null : Math.max(0, duration - 0.05);
      if (hi === null) return;
      el.currentTime = clamp(t, lo, hi);
    },
    [videoRef, active, duration],
  );
  const nudge = (delta: number) => {
    const el = videoRef.current;
    if (el && active) seek(el.currentTime + delta);
  };

  /** Plays the row under `key` on the preview, when the copy can place it. */
  const play = React.useCallback(
    (key: string) => {
      if (previewKeys.has(key)) q.playFrom(key);
    },
    [previewKeys, q],
  );
  const playAll = React.useCallback(() => {
    if (previewItems.length > 0) q.playFrom(previewItems[0].key);
  }, [previewItems, q]);

  // Keep the playing row in view as the preview advances.
  React.useEffect(() => {
    if (!q.activeKey) return;
    listRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(q.activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [q.activeKey, reduced]);

  // ---------------------------------------------------------------------------
  // Adding
  // ---------------------------------------------------------------------------

  function add() {
    const clips = picker.buildClips();
    if (clips.length === 0) return;
    void onAdd(clips);
    onClose();
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  useKeyScope("add-clips", true, containerRef);
  useHotkeys("add-clips", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        add();
        return;
      }
      const key = q.activeKey;
      if (key) {
        picker.toggleOne(key);
        picker.setAnchor(key);
      }
      return;
    }
    const action = resolvePlayerKey(e);
    if (!action) return;
    const el = videoRef.current;
    switch (action) {
      case "select-all":
        e.preventDefault();
        picker.selectAllShown();
        return;
      case "toggle-play":
        e.preventDefault();
        stageHandle.current?.togglePlay();
        return;
      case "replay":
        e.preventDefault();
        q.replay();
        return;
      case "fullscreen":
        e.preventDefault();
        fullscreen.toggle();
        return;
      case "toggle-mute":
        e.preventDefault();
        if (el) el.muted = !el.muted;
        return;
      case "escape":
        e.preventDefault();
        if (fullscreen.active) void fullscreen.exit();
        else onClose();
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
        el?.pause();
        return;
      case "shuttle-forward":
        e.preventDefault();
        setSpeed(nextShuttleRate(speed));
        if (active && el?.paused) el.play().catch(() => {});
        return;
      case "next":
      case "prev":
      case "first":
      case "last": {
        if (picker.filtered.length === 0) return;
        e.preventDefault();
        const to = picker.walk(action === "next" ? 1 : action === "prev" ? -1 : action, q.activeKey);
        if (to !== null && to !== q.activeKey) play(to);
        return;
      }
      case "extend-next":
      case "extend-prev":
      case "extend-first":
      case "extend-last": {
        if (picker.filtered.length === 0) return;
        e.preventDefault();
        const to = picker.extendTicks(
          action === "extend-next" ? 1 : action === "extend-prev" ? -1 : action === "extend-first" ? "first" : "last",
          q.activeKey,
        );
        if (to !== null && to !== q.activeKey) play(to);
        return;
      }
      default:
        return;
    }
  });

  // ---------------------------------------------------------------------------

  const pad = compact ? "" : "px-4 sm:px-5";
  const kbd = "h-4 min-w-4 px-0.5 text-footnote";
  const n = picker.newCount;
  const noGame = picker.matchId === null;

  return (
    <div ref={containerRef} tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
      {/* Header */}
      <div className={cn("flex shrink-0 items-start gap-2 pt-3 pb-3", pad)}>
        <div className="min-w-0 flex-1">
          <h2 className="text-title-3">Add clips</h2>
          <p className="truncate text-callout text-muted-foreground">
            to <span className="font-medium text-foreground">{playlist.name}</span>
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button size="sm" onClick={add} disabled={n === 0}>
                <Plus />
                Add {n > 0 ? n : ""} {n === 1 ? "clip" : "clips"}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-1.5 pointer-coarse:hidden">
            {n === 0 ? "Tick plays to add them" : "Add to the playlist"}
            <Kbd className={kbd}>⌘↩</Kbd>
          </TooltipContent>
        </Tooltip>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-2 text-muted-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-fill-3 hover:text-foreground active:scale-95 active:bg-fill-4 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-8"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className={cn("flex shrink-0 flex-col gap-2 border-b border-separator pb-3", pad)}>
        <div className="flex flex-wrap items-center gap-2">
          <PopUpButton
            aria-label="Game"
            value={picker.matchId}
            onValueChange={picker.setGame}
            options={picker.gameOptions}
            placeholder={picker.gameOptions.length === 0 ? "No games yet" : "Choose a game"}
            disabled={picker.gameOptions.length === 0}
            className="max-w-[16rem] pointer-coarse:h-9"
          />
          <MultiSelectMenu label="Shot type" options={SHOT_TYPE_OPTIONS} selected={picker.filters.shotTypes} onChange={(s) => picker.setFilter("shotTypes", s)} disabled={noGame} />
          <MultiSelectMenu label="Situation" options={SITUATION_OPTIONS} selected={picker.filters.situations} onChange={(s) => picker.setFilter("situations", s)} disabled={noGame} />
          <MultiSelectMenu
            label="Team"
            options={picker.teams.map((t) => ({ value: t, label: t }))}
            selected={picker.filters.teams}
            onChange={(s) => picker.setFilter("teams", s)}
            emptyText="No teams in this game's plays yet"
            disabled={noGame}
          />
          <MultiSelectMenu
            label="Player"
            options={picker.players.map((p) => ({ value: p, label: p }))}
            selected={picker.filters.players}
            onChange={(s) => picker.setFilter("players", s)}
            emptyText="No players in these plays"
            disabled={noGame}
          />
          <LeadersPopover events={picker.leaderEvents} selectedPlayers={picker.filters.players} onTogglePlayer={picker.togglePlayer} disabled={noGame} />
          <div className="ml-auto">
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Clip length" className="text-muted-foreground">
                      <Timer />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Clip length: {picker.pair.pre} s before, {picker.pair.post} s after
                </TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-64 space-y-3">
                <div>
                  <p className="text-headline">Clip length</p>
                  <p className="mt-0.5 text-callout text-muted-foreground">
                    For the preview and the clips you add. The playlist&apos;s own length is {playlist.preRoll ?? 10} s before, {playlist.postRoll ?? 3} s after.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Before</span>
                  <Stepper label="Seconds before" value={picker.pair.pre} min={0} max={MAX_PRE_ROLL_SECONDS} onChange={(v) => picker.setPair({ pre: v })} format={(v) => `${v} s`} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">After</span>
                  <Stepper label="Seconds after" value={picker.pair.post} min={0} max={MAX_POST_ROLL_SECONDS} onChange={(v) => picker.setPair({ post: v })} format={(v) => `${v} s`} />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <EventTypeChips options={EVENT_TYPE_OPTIONS} selected={picker.filters.types} onChange={(s) => picker.setFilter("types", s)} />
      </div>

      {/* The preview */}
      {!noGame && (
        <div className={cn("shrink-0 pt-3", pad)}>
          <div className="mx-auto w-full max-w-md">
            <PlayerStage
              handleRef={stageHandle}
              attachVideo={attachVideo}
              video={video}
              videoRef={videoRef}
              stageRef={setStage}
              stage={stage}
              src={q.src}
              duration={active ? active.end - active.start : null}
              clipWindow={active ? { start: active.start, end: active.end } : null}
              onSeek={seek}
              fullscreen={fullscreen}
              title={active ? `${eventLabel(active.event)} · ${playerName(active.event)}` : picker.match?.title}
              position={q.position >= 0 ? { index: q.position, total: previewItems.length } : null}
              transport={{
                canPrev: q.canPrev,
                canNext: q.canNext,
                isQueueActive: q.isQueueActive,
                onPrev: q.prev,
                onNext: q.next,
                onReplay: q.replay,
                onStop: q.stop,
                onPlayAll: playAll,
              }}
              speed={speed}
              onSpeedChange={setSpeed}
              className="rounded-lg"
            >
              {!q.isQueueActive && q.src === null && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-callout text-white/70 @max-[559px]/stage:hidden">
                  {previewItems.length > 0 ? "Choose a play to preview it" : "No plays to preview"}
                </div>
              )}
            </PlayerStage>
          </div>
          <div className="mx-auto mt-2 flex min-h-5 w-full max-w-md items-center gap-2 px-1 text-sm">
            {active && (
              <>
                <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", eventColors(active.event).badge)}>
                  {eventLabel(active.event)}
                </span>
                <span className="truncate font-medium">{playerName(active.event)}</span>
                <span className="shrink-0 text-subheadline text-muted-foreground nums">
                  {periodLabel(active.event.period)} · {formatGameClock(active.event.gameClockTime)}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* The plays */}
      <label className={cn("flex h-8 shrink-0 cursor-default items-center gap-1.5 border-b border-separator text-subheadline text-muted-foreground select-none", compact ? "pr-1" : "pr-4 sm:pr-5")}>
        <span aria-hidden className="w-[3px]" />
        <span className="flex w-8 justify-center pointer-coarse:w-10">
          <input
            type="checkbox"
            checked={picker.allShownSelected}
            onChange={picker.toggleSelectAll}
            disabled={picker.filtered.length === 0}
            onMouseDown={(e) => e.preventDefault()}
            className="size-3.5 rounded accent-primary pointer-coarse:size-4"
          />
        </span>
        Select all
        <span className="ml-auto nums">
          {picker.filtered.length} {picker.filtered.length === 1 ? "play" : "plays"}
          {picker.filtersActive && picker.allCount !== picker.filtered.length ? ` of ${picker.allCount}` : ""}
        </span>
      </label>
      <div ref={listRef} role="grid" aria-label="Plays" aria-multiselectable className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {noGame && !cloud.loaded ? (
          <p className="px-6 py-10 text-center text-callout text-muted-foreground">Loading your games…</p>
        ) : noGame ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-headline">No game to pick from yet</p>
            <p className="text-callout text-muted-foreground">
              Clips play from your cloud copy of a game. Upload a game&apos;s video and set its tip-off, and its plays show up here.
            </p>
            <Button asChild size="sm" variant="outline">
              <ImportEntryLink placement="add_clips">
                <Plus />
                Import a game
              </ImportEntryLink>
            </Button>
          </div>
        ) : picker.loading ? (
          <p className="px-6 py-10 text-center text-callout text-muted-foreground">Loading the game&apos;s plays…</p>
        ) : picker.filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-callout text-muted-foreground">{picker.filtersActive ? "No plays match these filters." : "This game has no plays yet."}</p>
            {picker.filtersActive && (
              <Button size="sm" variant="outline" onClick={picker.clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          picker.filtered.map((entry) => (
            <AddClipsRow
              key={entry.key}
              rowKey={entry.key}
              event={entry.event}
              isSelected={picker.selected.has(entry.key)}
              alreadyIn={picker.existing.has(entry.key)}
              isActive={q.activeKey === entry.key}
              onToggle={(e) => picker.applyClick(entry.key, e.shiftKey, !e.shiftKey)}
              onClick={(e) => {
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  picker.applyClick(entry.key, e.shiftKey, !e.shiftKey);
                  return;
                }
                picker.setAnchor(entry.key);
                play(entry.key);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
