import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Play, Plus, Scissors, Tag, VideoOff, X } from "lucide-react";
import type { ClipKey, Label, LabelColor } from "@scoutable/shared/types/labels";
import {
  eventColors,
  eventLabel,
  formatGameClock,
  isBookkeepingEvent,
  playerName,
} from "@scoutable/shared/lib/events";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { clickSelection, extendSelection, moveFocus, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { orderForAdd, startGame } from "@scoutable/shared/lib/add-clips-games";
import type { PlayByPlayEvent, Playlist, PlaylistClipItem, StoredMatch } from "@/types/match";
import { isClipItem } from "@/types/match";
import { trackEvent } from "@/lib/analytics";
import { getAddClipsScope, setAddClipsScope } from "@/lib/prefs";
import { togglePlayerMuted } from "@/lib/player-sound";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import type { VideoFileStatus } from "@/lib/video-probe";
import { cn } from "@/lib/utils";
import { LabelChip } from "@/components/labels/LabelChip";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import { LeadersPopover } from "@/components/leaders-popover";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EventTypeChips } from "./event-type-chips";
import { GamePicker } from "./game-picker";
import { PlayerStage } from "./player-stage";
import { usePersistentVideo } from "./use-persistent-video";

// ---------------------------------------------------------------------------
// Filter vocabulary
// ---------------------------------------------------------------------------

const EVENT_TYPE_OPTIONS = [
  { value: "2pt-made", label: "2PT made" },
  { value: "2pt-miss", label: "2PT miss" },
  { value: "3pt-made", label: "3PT made" },
  { value: "3pt-miss", label: "3PT miss" },
  { value: "freethrow-made", label: "FT made" },
  { value: "freethrow-miss", label: "FT miss" },
  { value: "rebound-off", label: "Off. rebound" },
  { value: "rebound-def", label: "Def. rebound" },
  { value: "turnover", label: "Turnover" },
  { value: "steal", label: "Steal" },
  { value: "assist", label: "Assist" },
  { value: "foul", label: "Foul" },
  { value: "foulon", label: "Foul drawn" },
  { value: "block", label: "Block" },
];

const SHOT_TYPE_OPTIONS = [
  { value: "subtype:layup", label: "Layup" },
  { value: "subtype:floater", label: "Floater" },
  { value: "subtype:jumpshot", label: "Jump shot" },
  { value: "subtype:dunk", label: "Dunk / alley-oop" },
  { value: "subtype:tipin", label: "Tip-in" },
];

const SITUATION_OPTIONS = [
  { value: "qual:fastbreak", label: "Fast break" },
  { value: "qual:pointsinthepaint", label: "In the paint" },
  { value: "qual:2ndchance", label: "2nd chance" },
  { value: "qual:fromturnover", label: "From turnover" },
  { value: "qual:shooting", label: "Shooting foul" },
  { value: "subtype:charge", label: "Charge" },
  { value: "subtype:technical", label: "Technical foul" },
  { value: "subtype:badpass", label: "Bad pass" },
  { value: "subtype:ballhandling", label: "Ball handling" },
  { value: "subtype:travel", label: "Travel" },
  { value: "subtype:24sec", label: "Shot clock" },
];

function matchesSingleType(e: PlayByPlayEvent, filter: string): boolean {
  if (filter === "rebound-off") return e.type === "rebound" && e.subType === "offensive";
  if (filter === "rebound-def") return e.type === "rebound" && e.subType === "defensive";
  if (filter === "rebound-inbound") return e.type === "rebound" && e.subType === "offensivedeadball";
  const [type, outcome] = filter.split("-");
  if (e.type !== type) return false;
  if (outcome === "made") return e.isSuccessful === 1;
  if (outcome === "miss") return e.isSuccessful === 0;
  return true;
}

function matchesShotType(e: PlayByPlayEvent, f: string): boolean {
  const sub = e.subType ?? "";
  switch (f) {
    case "subtype:layup":    return ["layup", "drivinglayup", "reverselayup"].includes(sub);
    case "subtype:floater":  return sub === "floatingjumpshot";
    case "subtype:jumpshot": return ["jumpshot", "pullupjumpshot", "turnaroundjumpshot", "fadeaway", "stepbackjumpshot", "hookshot"].includes(sub);
    case "subtype:dunk":     return ["dunk", "alleyoop", "alleyoopdunk"].includes(sub);
    case "subtype:tipin":    return ["tipinlayup", "tipindunk"].includes(sub);
    default: return false;
  }
}

function matchesSituation(e: PlayByPlayEvent, f: string): boolean {
  switch (f) {
    case "qual:fastbreak":        return e.qualifiers.includes("fastbreak");
    case "qual:pointsinthepaint": return e.qualifiers.includes("pointsinthepaint");
    case "qual:2ndchance":        return e.qualifiers.includes("2ndchance");
    case "qual:fromturnover":     return e.qualifiers.includes("fromturnover");
    case "qual:shooting":         return e.type === "foul" && e.qualifiers.includes("shooting");
    case "subtype:charge":        return e.type === "foul" && e.subType === "offensive";
    case "subtype:technical":     return e.type === "foul" && ["technical", "benchTechnical", "coachTechnical"].includes(e.subType ?? "");
    case "subtype:badpass":       return e.type === "turnover" && e.subType === "badpass";
    case "subtype:ballhandling":  return e.type === "turnover" && e.subType === "ballhandling";
    case "subtype:travel":        return e.type === "turnover" && e.subType === "travel";
    case "subtype:24sec":         return e.type === "turnover" && e.subType === "24sec";
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// A row in the browser
// ---------------------------------------------------------------------------

function BrowserRow({
  rowKey,
  event,
  matchTitle,
  showGame,
  isSelected,
  alreadyIn,
  isActive,
  assignedLabels,
  onToggle,
  onClick,
  labelPicker,
}: {
  /** `matchId:eventId`: event ids repeat across games. */
  rowKey: string;
  event: PlayByPlayEvent;
  matchTitle: string;
  showGame: boolean;
  isSelected: boolean;
  alreadyIn: boolean;
  isActive: boolean;
  assignedLabels: Label[];
  /** The checkbox: a tick, or with Shift the range from the anchor. */
  onToggle: (e: React.MouseEvent) => void;
  /** The row: plain plays it, ⌘ ticks it, Shift ticks the range. */
  onClick: (e: React.MouseEvent) => void;
  labelPicker?: React.ReactNode;
}) {
  const colors = eventColors(event);
  const visible = assignedLabels.slice(0, 2);
  const overflow = assignedLabels.slice(2);
  return (
    <div
      role="row"
      data-row-key={rowKey}
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-10 cursor-default select-none items-stretch gap-1.5 pr-2 outline-none transition-colors duration-100 [&:not(:first-child)]:shadow-[inset_0_1px_0_var(--separator)]",
        isActive
          ? "bg-primary/12"
          : isSelected
            ? "bg-primary/6 hover:bg-primary/10"
            : "hover:bg-fill-1 active:bg-fill-2",
        alreadyIn && "opacity-40",
      )}
    >
      <div className={cn("w-[3px] shrink-0 self-stretch", colors.strip)} aria-hidden />
      <div className="flex w-8 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {alreadyIn ? (
          <Check className="size-3.5 text-muted-foreground" aria-label="Already in this playlist" />
        ) : (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            // No focus on press: a focused checkbox counts as a text field
            // for the sheet's keys, and they would stop after a tick.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(e);
            }}
            aria-label="Select"
            className="size-3.5 rounded accent-primary"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", colors.badge)}>
            {eventLabel(event)}
          </span>
          <span className="truncate text-sm font-medium">{playerName(event)}</span>
          {visible.map((l) => (
            <LabelChip key={l.id} label={l} className="shrink-0 whitespace-nowrap" />
          ))}
          {overflow.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground">+{overflow.length}</span>
              </TooltipTrigger>
              <TooltipContent>{overflow.map((l) => l.name).join(", ")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-subheadline nums text-muted-foreground">
          <span className="shrink-0">Q{event.period}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{formatGameClock(event.gameClockTime)}</span>
          {event.eventTeam?.teamName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{event.eventTeam.teamName}</span>
            </>
          )}
          {showGame && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{matchTitle}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {isActive && <Play className="mr-1 size-3.5 fill-current text-primary" />}
        {labelPicker}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * The page owns the labels: one cache for every game, written through these,
 * so a label set here shows on the same clip in the open playlist at once.
 */
export interface ClipBrowserLabelHandlers {
  onToggleClip: (matchId: string, eventId: number, labelId: string, state: LabelTriState) => Promise<void>;
  onBulkToggle: (clips: ClipKey[], labelId: string, state: LabelTriState) => Promise<void>;
  onCreate: (name: string, color: LabelColor) => Promise<Label>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: LabelColor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSeedDefaults: () => Promise<void>;
}

/**
 * Add clips to the open playlist: every imported game's play-by-play,
 * filtered down, previewed on its own stage, ticked and added. Lives in a
 * sheet over the editor and owns the keys while it is open.
 *
 * A coach adds in rounds (one player, then the next, from the same game), so
 * Add keeps the sheet open, and the sheet starts where the last round left
 * this playlist: that game and team (lib/prefs.ts), else the game the
 * playlist has most clips from, else the latest game (lib/add-clips-games.ts).
 */
export function ClipBrowserPanel({
  matches,
  matchLookup,
  playlist,
  onAddClips,
  activeOrgId,
  labels,
  labelAssignments,
  labelHandlers,
  onNeedEvents,
  onNeedLabels,
  videoStatusByMatch,
}: {
  matches: StoredMatch[];
  matchLookup: Map<string, StoredMatch>;
  playlist: Playlist;
  onAddClips: (clips: PlaylistClipItem[]) => void;
  activeOrgId: string | null;
  labels: Label[];
  /** The page's per-clip label sets, keyed `${matchId}:${eventId}`. */
  labelAssignments: Map<string, Set<string>>;
  labelHandlers: ClipBrowserLabelHandlers;
  /** Ask the page to load play-by-play for these matches if it hasn't yet. */
  onNeedEvents: (matchIds: string[]) => Promise<void>;
  /** The same for the labels on their clips. */
  onNeedLabels: (matchIds: string[]) => Promise<void>;
  /** Per-match video-file health from the page's probe (machine switches). */
  videoStatusByMatch: Map<string, VideoFileStatus>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [start] = useState(() => {
    const scope = getAddClipsScope(playlist.id);
    const s = startGame(matches, playlist.items, scope?.gameId ?? null);
    return { ...s, teams: s.source === "remembered" ? (scope?.teams ?? []) : [] };
  });
  const [filterMatchId, setFilterMatchId] = useState<string | null>(start.id);
  // Once per opening: where it started, and that start is now the playlist's last game.
  useEffect(() => {
    trackEvent("clip_browser_opened", { start: start.source, games_in_playlist: new Set(playlist.items.filter(isClipItem).map((c) => c.matchId)).size });
    if (start.id && start.source !== "remembered") setAddClipsScope(playlist.id, { gameId: start.id, teams: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Keyed on the match ID SET, not the matches array: merging fetched events
  // produces a new array, and depending on that would re-run this on arrival
  // and flicker the loading state.
  const matchIdsKey = matches.map((m) => m.id).join(",");

  // The page only preloads events (and labels) for games a playlist
  // references, so the browser pulls the game it is showing. Runs on open and
  // on every game switch; the page ignores ids it already has or is fetching.
  useEffect(() => {
    // No filter means "all games" — the panel would render every event.
    const ids = filterMatchId ? [filterMatchId] : matchIdsKey.split(",").filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    setEventsLoading(true);
    void Promise.all([onNeedEvents(ids), onNeedLabels(ids)]).finally(() => {
      if (!cancelled) setEventsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filterMatchId, matchIdsKey, onNeedEvents, onNeedLabels]);

  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterSubTypes, setFilterSubTypes] = useState<Set<string>>(new Set());
  const [filterSituations, setFilterSituations] = useState<Set<string>>(new Set());
  const [filterTeams, setFilterTeams] = useState<Set<string>>(new Set());
  const [filterPlayers, setFilterPlayers] = useState<Set<string>>(new Set());
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());
  const [preRoll, setPreRoll] = useState(10);
  const [postRoll, setPostRoll] = useState(3);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // "matchId:eventId"
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueIdx, setQueueIdx] = useState(0);
  const [speed, setSpeed] = useState(1);

  // One <video> for the sheet's life; the stage hosts it.
  const video = usePersistentVideo();
  const videoRef = useRef<HTMLVideoElement | null>(video);

  // Refs to avoid stale closures in the timeupdate handler
  const preRollRef = useRef(preRoll);
  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  const postRollRef = useRef(postRoll);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  const clipEndRef = useRef<number | undefined>(undefined);
  const pendingSeekRef = useRef<{ event: PlayByPlayEvent; matchId: string } | null>(null);
  const queueRef = useRef<Array<{ event: PlayByPlayEvent; matchId: string }>>([]);
  const queueIdxRef = useRef(0);
  const activeEventKeyRef = useRef(activeEventKey);
  useEffect(() => { activeEventKeyRef.current = activeEventKey; }, [activeEventKey]);

  const existingSet = useMemo(
    () => new Set(playlist.items.filter(isClipItem).map((c) => `${c.matchId}:${c.eventId}`)),
    [playlist.items],
  );

  const allEvents = useMemo(() => {
    const source = filterMatchId ? matches.filter((m) => m.id === filterMatchId) : matches;
    return source.flatMap((m) =>
      m.events
        // Dead-ball possession markers aren't watchable — keep them out of
        // the browser and everything derived from it (teams, players, counts).
        .filter((e) => !isBookkeepingEvent(e))
        .map((e) => ({ event: e, matchId: m.id, matchTitle: m.title })),
    );
  }, [matches, filterMatchId]);

  const teams = useMemo(
    () => Array.from(new Set(allEvents.map((x) => x.event.eventTeam?.teamName).filter(Boolean) as string[])),
    [allEvents],
  );
  // The team remembered with the game comes back once the game's plays are in, if the game still has it.
  const pendingTeamsRef = useRef<string[] | null>(start.teams.length > 0 ? start.teams : null);
  useEffect(() => {
    const wanted = pendingTeamsRef.current;
    if (!wanted || teams.length === 0) return;
    pendingTeamsRef.current = null;
    const kept = wanted.filter((t) => teams.includes(t));
    if (kept.length > 0) setFilterTeams(new Set(kept));
  }, [teams]);
  const players = useMemo(() => {
    const source = filterTeams.size > 0
      ? allEvents.filter(({ event }) => filterTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    return Array.from(new Set(
      source.map((x) => (x.event.player ? playerName(x.event) : null)).filter(Boolean) as string[],
    ));
  }, [allEvents, filterTeams]);
  // Same Game + Team narrowing as the players list, so the Leaders popover
  // never offers a player the Team filter would immediately hide.
  const leaderEvents = useMemo(() => {
    const source = filterTeams.size > 0
      ? allEvents.filter(({ event }) => filterTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    return source.map((x) => x.event);
  }, [allEvents, filterTeams]);

  const handleLeaderToggle = useCallback((name: string) => {
    setFilterPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const filtered = useMemo(() => allEvents.filter(({ event, matchId }) => {
    if (filterTypes.size > 0 && !Array.from(filterTypes).some((f) => matchesSingleType(event, f))) return false;
    if (filterSubTypes.size > 0 && !Array.from(filterSubTypes).some((f) => matchesShotType(event, f))) return false;
    if (filterSituations.size > 0 && !Array.from(filterSituations).some((f) => matchesSituation(event, f))) return false;
    if (filterTeams.size > 0 && !filterTeams.has(event.eventTeam?.teamName ?? "")) return false;
    if (filterPlayers.size > 0 && !filterPlayers.has(playerName(event))) return false;
    if (filterLabelIds.size > 0) {
      const assigned = labelAssignments.get(`${matchId}:${event.eventId}`);
      if (!assigned || ![...filterLabelIds].some((id) => assigned.has(id))) return false;
    }
    return true;
  }), [allEvents, filterTypes, filterSubTypes, filterSituations, filterTeams, filterPlayers, filterLabelIds, labelAssignments]);

  const selectedClipKeyPairs = useMemo<ClipKey[]>(() => {
    const out: ClipKey[] = [];
    for (const key of selectedIds) {
      const [matchId, eventIdStr] = key.split(":");
      const eventId = Number(eventIdStr);
      if (matchId && Number.isFinite(eventId)) out.push({ matchId, eventId });
    }
    return out;
  }, [selectedIds]);

  const { bulkAssignedAll, bulkAssignedSome } = useMemo(() => {
    const all = new Set<string>();
    const some = new Set<string>();
    if (selectedClipKeyPairs.length === 0) return { bulkAssignedAll: all, bulkAssignedSome: some };
    const counts = new Map<string, number>();
    for (const { matchId, eventId } of selectedClipKeyPairs) {
      const s = labelAssignments.get(`${matchId}:${eventId}`);
      if (!s) continue;
      for (const id of s) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = selectedClipKeyPairs.length;
    for (const [id, n] of counts.entries()) {
      if (n === total) all.add(id);
      else if (n > 0) some.add(id);
    }
    return { bulkAssignedAll: all, bulkAssignedSome: some };
  }, [selectedClipKeyPairs, labelAssignments]);

  function handleGameChange(newMatchId: string | null) {
    pendingTeamsRef.current = null;
    setFilterMatchId(newMatchId);
    setFilterTeams(new Set());
    setFilterPlayers(new Set());
    if (newMatchId) setAddClipsScope(playlist.id, { gameId: newMatchId, teams: [] });
  }

  function handleTeamChange(newTeams: Set<string>) {
    pendingTeamsRef.current = null;
    setFilterTeams(newTeams);
    if (filterMatchId) setAddClipsScope(playlist.id, { gameId: filterMatchId, teams: [...newTeams] });
    const source = newTeams.size > 0
      ? allEvents.filter(({ event }) => newTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    const validPlayers = new Set(
      source.map((x) => (x.event.player ? playerName(x.event) : null)).filter(Boolean) as string[],
    );
    setFilterPlayers((prev) => new Set([...prev].filter((p) => validPlayers.has(p))));
  }

  // Keep ref for the key handler (avoids stale closures)
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const videoMatchId = activeEventKey ? activeEventKey.split(":")[0] : filterMatchId ?? null;
  const localVideoUrl = useMemo(() => {
    const match = videoMatchId ? matchLookup.get(videoMatchId) : null;
    if (!match?.videoUrl) return null;
    return isLocalPath(match.videoUrl) ? streamFileSrc(match.videoUrl) : match.videoUrl;
  }, [videoMatchId, matchLookup]);
  // Which game's footage the element currently holds: a click on another
  // game's event must wait for its file before seeking (see pendingSeekRef).
  const loadedMatchIdRef = useRef<string | null>(null);
  useEffect(() => {
    loadedMatchIdRef.current = localVideoUrl ? videoMatchId : null;
  }, [localVideoUrl, videoMatchId]);

  // Full screen, as in the editor: native window full screen plus a fixed
  // layer for the stage. The sheet owns it while it is open: F, double-click,
  // the transport button and View → Fullscreen Player (the editor behind the
  // sheet ignores that menu while the sheet is up). It needs footage to show,
  // and it never outlives the sheet or the video.
  const playerFs = usePlayerFullscreen();
  const playerFsRef = useRef(playerFs);
  playerFsRef.current = playerFs;
  const hasStageRef = useRef(false);
  hasStageRef.current = !!localVideoUrl;
  const toggleFullscreen = useCallback(() => {
    if (!playerFsRef.current.active && !hasStageRef.current) return;
    playerFsRef.current.toggle();
  }, []);
  useEffect(() => {
    const onToggle = () => toggleFullscreen();
    window.addEventListener("player-fullscreen-toggle", onToggle);
    return () => window.removeEventListener("player-fullscreen-toggle", onToggle);
  }, [toggleFullscreen]);
  // Escape leaves full screen instead of closing the sheet: this capture
  // listener on window runs before the dialog's own Escape handling.
  useEffect(() => {
    if (!playerFs.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      void playerFsRef.current.exit();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [playerFs.active]);
  useEffect(() => {
    if (!localVideoUrl && playerFsRef.current.active) void playerFsRef.current.exit();
  }, [localVideoUrl]);
  useEffect(() => () => {
    if (playerFsRef.current.active) void playerFsRef.current.exit();
  }, []);

  // Seek to an event — pause → seek → play, sets clipEnd for auto-advance
  const seekToEvent = useCallback((event: PlayByPlayEvent, matchId: string) => {
    const match = matchLookup.get(matchId);
    const el = videoRef.current;
    if (!match?.syncPoint || !el) return;
    const videoTime = computeVideoTime(event, match.syncPoint);
    if (videoTime === null) return;
    const seekTo = Math.max(0, videoTime - preRollRef.current);
    const clipEnd = videoTime + postRollRef.current;
    clipEndRef.current = undefined;
    el.pause();
    const target1 = seekTo;
    function onSeeked1() {
      if (el!.currentTime > target1 + 2) { el!.addEventListener("seeked", onSeeked1, { once: true }); return; }
      clipEndRef.current = clipEnd;
      el!.play().catch(() => {});
    }
    el.addEventListener("seeked", onSeeked1, { once: true });
    el.currentTime = seekTo;
  }, [matchLookup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep seek ref current so timeupdate handler always calls the latest version
  const seekToEventRef = useRef(seekToEvent);
  seekToEventRef.current = seekToEvent;

  // Auto-advance to next clip via timeupdate
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    function handleTimeUpdate() {
      const end = clipEndRef.current;
      if (end === undefined || !el) return;
      if (el.currentTime < end) return;
      // Guard: if we're >60s past clipEnd the video is at a stale position (seek in progress)
      if (el.currentTime > end + 60) return;

      clipEndRef.current = undefined;
      el.pause();
      const nextIdx = queueIdxRef.current + 1;
      const queue = queueRef.current;

      if (nextIdx < queue.length) {
        queueIdxRef.current = nextIdx;
        setQueueIdx(nextIdx);
        const { event, matchId } = queue[nextIdx];
        const key = `${matchId}:${event.eventId}`;
        setActiveEventKey(key);
        activeEventKeyRef.current = key;
        if (loadedMatchIdRef.current === matchId) seekToEventRef.current(event, matchId);
        else pendingSeekRef.current = { event, matchId };
      } else {
        el.pause();
        setIsPlaying(false);
        setActiveEventKey(null);
        queueRef.current = [];
      }
    }

    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [localVideoUrl]);

  // Deferred seek: fires once the stage has loaded the event's game.
  useEffect(() => {
    const pending = pendingSeekRef.current;
    const el = videoRef.current;
    if (!pending || !el || !localVideoUrl) return;
    if (pending.matchId !== videoMatchId) return;
    pendingSeekRef.current = null;
    const doSeek = () => seekToEvent(pending.event, pending.matchId);
    if (el.readyState >= 1) doSeek();
    else el.addEventListener("loadedmetadata", doSeek, { once: true });
  }, [localVideoUrl, videoMatchId, seekToEvent]);

  // Stop playback when the sheet closes; the element outlives the stage.
  useEffect(() => () => { video.pause(); }, [video]);

  function handleStop() {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setQueueIdx(0);
    clipEndRef.current = undefined;
    setIsPlaying(false);
    setActiveEventKey(null);
    videoRef.current?.pause();
  }

  function handleReplay() {
    const item = queueRef.current[queueIdxRef.current];
    if (item) seekToEvent(item.event, item.matchId);
  }
  const handleReplayRef = useRef(handleReplay);
  handleReplayRef.current = handleReplay;

  const handleRowClick = useCallback((event: PlayByPlayEvent, matchId: string) => {
    const items = filteredRef.current;
    const idx = items.findIndex((x) => x.event.eventId === event.eventId && x.matchId === matchId);
    const queue = idx >= 0 ? items.slice(idx) : [{ event, matchId, matchTitle: "" }];

    queueRef.current = queue;
    queueIdxRef.current = 0;
    setQueueIdx(0);
    setIsPlaying(true);
    setActiveEventKey(`${matchId}:${event.eventId}`);

    if (loadedMatchIdRef.current === matchId) {
      seekToEvent(event, matchId);
    } else {
      // Another game: the stage swaps the file first, the effect above seeks.
      pendingSeekRef.current = { event, matchId };
    }
  }, [seekToEvent]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleRowClickRef = useRef(handleRowClick);
  handleRowClickRef.current = handleRowClick;

  function handlePrev() {
    const items = filteredRef.current;
    const cur = items.findIndex((x) => `${x.matchId}:${x.event.eventId}` === activeEventKeyRef.current);
    if (cur <= 0) return;
    const { event, matchId } = items[cur - 1];
    handleRowClickRef.current(event, matchId);
  }

  function handleNext() {
    const items = filteredRef.current;
    const cur = items.findIndex((x) => `${x.matchId}:${x.event.eventId}` === activeEventKeyRef.current);
    if (cur === -1 || cur >= items.length - 1) return;
    const { event, matchId } = items[cur + 1];
    handleRowClickRef.current(event, matchId);
  }

  function handlePlayAll() {
    const items = filteredRef.current;
    if (items.length === 0) return;
    handleRowClick(items[0].event, items[0].matchId);
  }

  const activeIdx = filtered.findIndex(({ event, matchId }) => `${matchId}:${event.eventId}` === activeEventKey);
  const activeEntry = activeIdx >= 0 ? filtered[activeIdx] : null;
  const canPrev = isPlaying && activeIdx > 0;
  const canNext = isPlaying && activeIdx >= 0 && activeIdx < filtered.length - 1;
  const isQueueActive = isPlaying;

  const clipWindow = useMemo(() => {
    if (!activeEntry) return null;
    const m = matchLookup.get(activeEntry.matchId);
    if (!m?.syncPoint) return null;
    const t = computeVideoTime(activeEntry.event, m.syncPoint);
    return t === null ? null : clipBounds(t, preRoll, postRoll);
  }, [activeEntry, matchLookup, preRoll, postRoll]);
  const clipWindowRef = useRef(clipWindow);
  clipWindowRef.current = clipWindow;

  const allSelected =
    filtered.length > 0 && filtered.every(({ event, matchId }) => selectedIds.has(`${matchId}:${event.eventId}`));

  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(({ event, matchId }) => `${matchId}:${event.eventId}`)));
  }

  function toggleOne(key: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Ticking the way the editor's list selects (list-selection.ts): a plain
  // or ⌘ click, a tick and a plain arrow set the anchor; Shift-click and
  // Shift+arrows tick everything from it to the clip. Clips already in the
  // playlist are never ticked.
  const anchorKeyRef = useRef<string | null>(null);
  const extendFocusRef = useRef<string | null>(null);
  function setAnchor(key: string | null) {
    anchorKeyRef.current = key;
    extendFocusRef.current = key;
  }
  const orderOf = () => filteredRef.current.map(({ event, matchId }) => `${matchId}:${event.eventId}`);
  function withoutExisting(keys: Set<string>) {
    for (const key of existingSet) keys.delete(key);
    return keys;
  }
  function applyClick(key: string, shift: boolean, toggle: boolean) {
    if (!shift && existingSet.has(key)) {
      setAnchor(key);
      return;
    }
    const next = clickSelection({
      order: orderOf(),
      selected: selectedIds,
      anchor: anchorKeyRef.current,
      focus: extendFocusRef.current,
      key,
      shift,
      toggle,
    });
    setSelectedIds(withoutExisting(next.selected));
    anchorKeyRef.current = next.anchor;
    extendFocusRef.current = next.focus;
  }
  function handleRowPress(event: PlayByPlayEvent, matchId: string, e: React.MouseEvent) {
    const key = `${matchId}:${event.eventId}`;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      applyClick(key, e.shiftKey, !e.shiftKey);
      return;
    }
    setAnchor(key);
    handleRowClick(event, matchId);
  }
  function playKey(key: string) {
    const item = filteredRef.current.find(({ event, matchId }) => `${matchId}:${event.eventId}` === key);
    if (item) handleRowClickRef.current(item.event, item.matchId);
  }
  /** ↑/↓, Home/End, ⌘↑/⌘↓: play the clip there. */
  function walk(move: FocusMove) {
    const to = moveFocus(orderOf(), activeEventKeyRef.current, move);
    if (to === null) return;
    if (to !== activeEventKeyRef.current) playKey(to);
    setAnchor(to);
  }
  /** Shift+arrows: tick from the anchor to the clip there, and play it. */
  function extendTicks(move: FocusMove) {
    const order = orderOf();
    const from = extendFocusRef.current ?? activeEventKeyRef.current;
    const to = moveFocus(order, from, move);
    if (to === null) return;
    const shown = (key: string | null): key is string => key !== null && order.includes(key);
    const anchor = shown(anchorKeyRef.current) ? anchorKeyRef.current : shown(from) ? from : to;
    setSelectedIds((prev) =>
      withoutExisting(extendSelection({ order, selected: prev, anchor, previousFocus: shown(from) ? from : null, focus: to })),
    );
    anchorKeyRef.current = anchor;
    extendFocusRef.current = to;
    if (to !== activeEventKeyRef.current) playKey(to);
  }
  /** ←/→ within the playing clip (Shift: further), as in the editor. */
  function nudge(delta: number) {
    const el = videoRef.current;
    if (!el) return;
    const w = clipWindowRef.current;
    const lo = w ? w.start : 0;
    const hi = w ? Math.max(w.start, w.end - 0.05) : el.duration || 0;
    el.currentTime = Math.min(hi, Math.max(lo, el.currentTime + delta));
  }

  /**
   * Adds every ticked clip the playlist doesn't have, as the button counts
   * them (filtered out of view or not), in game order, and stays open for
   * the next round: the ticks clear, the filters stay.
   */
  function handleAdd() {
    const toAdd = orderForAdd([...selectedIds].filter((k) => !existingSet.has(k)), matches);
    if (toAdd.length === 0) return;
    // The page says "5 clips added" with an Undo.
    onAddClips(toAdd);
    setSelectedIds(new Set());
  }
  const handleAddRef = useRef(handleAdd);
  handleAddRef.current = handleAdd;

  const newCount = Array.from(selectedIds).filter((k) => !existingSet.has(k)).length;
  const isMultiMatch = filterMatchId === null;

  // Keys belong to the sheet while it is open (one owner at a time), the
  // editor's where they make sense here: ↑/↓, Home/End and ⌘↑/⌘↓ walk the
  // clips, Shift with them ticks the range, ←/→ nudge (Shift: further),
  // J/K/L shuttle, Space plays, R replays, F is full screen. Return ticks the
  // playing clip, ⌘A ticks every shown clip, ⌘↩ adds.
  useKeyScope("clip-browser", true, panelRef);
  useHotkeys("clip-browser", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        handleAddRef.current();
        return;
      }
      const key = activeEventKeyRef.current;
      if (key && !existingSet.has(key)) toggleOne(key);
      if (key) setAnchor(key);
      return;
    }
    const action = resolvePlayerKey(e);
    if (action === "select-all") {
      e.preventDefault();
      setSelectedIds(new Set(filteredRef.current.map(({ event, matchId }) => `${matchId}:${event.eventId}`)));
      return;
    }
    if (action === "toggle-play") {
      e.preventDefault();
      const el = videoRef.current;
      if (!el) return;
      if (!isPlaying && el.paused) { handlePlayAll(); return; }
      if (el.paused) el.play().catch(() => {});
      else el.pause();
      return;
    }
    if (action === "replay") { e.preventDefault(); handleReplayRef.current(); return; }
    if (action === "fullscreen") { e.preventDefault(); toggleFullscreen(); return; }
    if (action === "toggle-mute") { e.preventDefault(); togglePlayerMuted({ announce: true }); return; }
    switch (action) {
      case "nudge-back":
      case "nudge-forward":
      case "nudge-back-far":
      case "nudge-forward-far": {
        e.preventDefault();
        const far = action.endsWith("-far");
        nudge((action.startsWith("nudge-back") ? -1 : 1) * (far ? NUDGE_FAR_SECONDS : NUDGE_SECONDS));
        return;
      }
      case "shuttle-pause":
        e.preventDefault();
        videoRef.current?.pause();
        return;
      case "shuttle-forward": {
        e.preventDefault();
        const el = videoRef.current;
        if (!el) return;
        setSpeed(nextShuttleRate(speed));
        if (el.paused) el.play().catch(() => {});
        return;
      }
      case "shuttle-back":
        // WebKit has no reverse playback; stepping back is the honest version.
        e.preventDefault();
        nudge(-5);
        return;
      case "next":
      case "prev":
      case "first":
      case "last":
        if (filteredRef.current.length === 0) return;
        e.preventDefault();
        walk(action === "next" ? 1 : action === "prev" ? -1 : action);
        return;
      case "extend-next":
      case "extend-prev":
      case "extend-first":
      case "extend-last":
        if (filteredRef.current.length === 0) return;
        e.preventDefault();
        extendTicks(
          action === "extend-next" ? 1 : action === "extend-prev" ? -1 : action === "extend-first" ? "first" : "last",
        );
        return;
    }
  });

  // Keep the playing row in view
  useEffect(() => {
    if (activeEventKey === null) return;
    panelRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(activeEventKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeEventKey]);

  const videoMissing =
    videoMatchId !== null &&
    videoStatusByMatch.get(videoMatchId) !== undefined &&
    videoStatusByMatch.get(videoMatchId) !== "ok";

  return (
    <div ref={panelRef} className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <SheetTitle>Add clips</SheetTitle>
          <SheetDescription className="truncate">
            to <span className="font-medium text-foreground">{playlist.name}</span>
          </SheetDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/upload">
              <Plus />
              Import game
            </Link>
          </Button>
          {activeOrgId && selectedClipKeyPairs.length > 0 && (
            <LabelPickerPopover
              trigger={
                <Button size="sm" variant="outline" title="Labels">
                  <Tag />
                  Apply label
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
              }
              labels={labels}
              assignedAllIds={bulkAssignedAll}
              assignedSomeIds={bulkAssignedSome}
              onToggle={(labelId, state) => labelHandlers.onBulkToggle(selectedClipKeyPairs, labelId, state)}
              onCreate={labelHandlers.onCreate}
              onRename={labelHandlers.onRename}
              onRecolor={labelHandlers.onRecolor}
              onDelete={labelHandlers.onDelete}
              onSeedDefaults={labelHandlers.onSeedDefaults}
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" onClick={handleAdd} disabled={newCount === 0}>
                  <Plus />
                  Add {newCount > 0 ? newCount : ""} clip{newCount !== 1 ? "s" : ""}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5">
              {newCount === 0 ? "Tick clips to add them" : "Add to the playlist"}
              <Kbd>⌘↩</Kbd>
            </TooltipContent>
          </Tooltip>
          <SheetClose
            aria-label="Close"
            className="ml-1 flex size-7 items-center justify-center rounded-full bg-fill-2 text-muted-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-fill-3 hover:text-foreground active:scale-95 active:bg-fill-4 focus-visible:ring-2 focus-visible:ring-selection"
          >
            <X className="size-3.5" />
          </SheetClose>
        </div>
      </div>

      {/* Filters */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-separator px-5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <GamePicker matches={matches} items={playlist.items} value={filterMatchId} onChange={handleGameChange} />
          <MultiSelectDropdown options={SHOT_TYPE_OPTIONS} selected={filterSubTypes} onChange={setFilterSubTypes} placeholder="Shot type" />
          <MultiSelectDropdown options={SITUATION_OPTIONS} selected={filterSituations} onChange={setFilterSituations} placeholder="Situation" />
          <MultiSelectDropdown
            options={teams.map((t) => ({ value: t, label: t }))}
            selected={filterTeams}
            onChange={handleTeamChange}
            placeholder="Team"
          />
          <MultiSelectDropdown
            options={players.map((p) => ({ value: p, label: p }))}
            selected={filterPlayers}
            onChange={setFilterPlayers}
            placeholder="Player"
          />
          <LeadersPopover events={leaderEvents} selectedPlayers={filterPlayers} onTogglePlayer={handleLeaderToggle} />
          {labels.length > 0 && (
            <MultiSelectDropdown
              options={labels.map((l) => ({ value: l.id, label: l.name }))}
              selected={filterLabelIds}
              onChange={setFilterLabelIds}
              placeholder="Labels"
            />
          )}
          <div className="ml-auto">
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Clip length">
                      <Scissors />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Clip length: {preRoll} s before, {postRoll} s after
                </TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-64 space-y-3">
                <div>
                  <p className="text-headline">Clip length</p>
                  <p className="mt-0.5 text-callout text-muted-foreground">Seconds of footage before and after each play.</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Before</span>
                  <Stepper label="Pre-roll" value={preRoll} min={0} max={30} onChange={setPreRoll} format={(v) => `${v} s`} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">After</span>
                  <Stepper label="Post-roll" value={postRoll} min={0} max={60} onChange={setPostRoll} format={(v) => `${v} s`} />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <EventTypeChips options={EVENT_TYPE_OPTIONS} selected={filterTypes} onChange={setFilterTypes} />
      </div>

      {/* Content: events | preview */}
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="55" minSize="30">
          <div className="flex h-full flex-col">
          <label className="flex h-8 shrink-0 cursor-default items-center gap-1.5 border-b border-separator pr-3 text-subheadline text-muted-foreground select-none">
            <span aria-hidden className="w-[3px]" />
            <span className="flex w-8 justify-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={filtered.length === 0}
                className="size-3.5 rounded accent-primary"
              />
            </span>
            Select all
            <span className="ml-auto nums">
              {filtered.length} event{filtered.length !== 1 ? "s" : ""}
            </span>
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              eventsLoading ? (
                // This game's play-by-play is still arriving — without this
                // branch the filter-advice copy below would be plainly wrong.
                <div className="py-12 text-center text-sm text-muted-foreground">Loading clips…</div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {matches.length === 0
                      ? "No games imported yet. Import a game to get started."
                      : "No events match the current filters. Try adjusting them."}
                  </p>
                  {matches.length === 0 && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/upload">
                        <Plus />
                        Import game
                      </Link>
                    </Button>
                  )}
                </div>
              )
            ) : (
              <div role="grid" aria-label="Events">
                {filtered.map(({ event, matchId, matchTitle }) => {
                  const key = `${matchId}:${event.eventId}`;
                  const alreadyIn = existingSet.has(key);
                  const assigned = activeOrgId ? labels.filter((l) => labelAssignments.get(key)?.has(l.id)) : [];
                  return (
                    <BrowserRow
                      key={key}
                      rowKey={key}
                      event={event}
                      matchTitle={matchTitle}
                      showGame={isMultiMatch}
                      isSelected={selectedIds.has(key)}
                      alreadyIn={alreadyIn}
                      isActive={activeEventKey === key}
                      assignedLabels={assigned}
                      onToggle={(e) => { if (!alreadyIn) applyClick(key, e.shiftKey, !e.shiftKey); }}
                      onClick={(e) => handleRowPress(event, matchId, e)}
                      labelPicker={activeOrgId ? (
                        <LabelPickerPopover
                          trigger={
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center rounded-md opacity-0 transition-[opacity,background-color] duration-100 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary active:scale-95 data-[state=open]:opacity-100 data-[state=open]:text-primary"
                              title="Labels"
                            >
                              <Tag className="size-3.5" />
                            </button>
                          }
                          labels={labels}
                          assignedAllIds={labelAssignments.get(key) ?? new Set<string>()}
                          onToggle={(labelId, state) => labelHandlers.onToggleClip(matchId, event.eventId, labelId, state)}
                          onCreate={labelHandlers.onCreate}
                          onRename={labelHandlers.onRename}
                          onRecolor={labelHandlers.onRecolor}
                          onDelete={labelHandlers.onDelete}
                          onSeedDefaults={labelHandlers.onSeedDefaults}
                        />
                      ) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize="45" minSize="25">
          <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
            {localVideoUrl ? (
              <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
              <div className={playerFs.active ? "relative min-h-0 flex-1" : "relative"}>
              <PlayerStage
                video={video}
                src={localVideoUrl}
                fileMissing={videoMissing}
                fullscreen={playerFs.active}
                onToggleFullscreen={toggleFullscreen}
                onExitFullscreen={() => void playerFs.exit()}
                title={activeEntry ? `${eventLabel(activeEntry.event)} · ${playerName(activeEntry.event)}` : undefined}
                clipWindow={clipWindow}
                position={activeIdx >= 0 ? { index: activeIdx, total: filtered.length } : null}
                onSeek={(t) => { video.currentTime = t; }}
                transport={{
                  isQueueActive,
                  canPrev,
                  canNext,
                  onPrev: handlePrev,
                  onNext: handleNext,
                  onReplay: handleReplay,
                  onStop: handleStop,
                  onPlayAll: handlePlayAll,
                }}
                speed={speed}
                onSpeedChange={setSpeed}
              >
                {videoMissing && (
                  <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 bg-black/85 px-6 text-center">
                    <VideoOff className="size-6 text-amber-400" />
                    <p className="text-sm font-medium text-white">This game's video file can't be found</p>
                    <p className="max-w-xs text-xs text-white/70">
                      It may have been moved or renamed, or it's on another computer.
                      Open the game in the Library and use Locate file to point at it.
                    </p>
                  </div>
                )}
              </PlayerStage>
              </div>
              </div>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-fill-1 px-6 text-center text-sm text-muted-foreground">
                Select a game with video to preview clips
              </div>
            )}
            {activeEntry && (
              <div className="flex min-w-0 items-center gap-2 px-1 text-sm">
                <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", eventColors(activeEntry.event).badge)}>
                  {eventLabel(activeEntry.event)}
                </span>
                <span className="truncate font-medium">{playerName(activeEntry.event)}</span>
                <span className="shrink-0 text-subheadline nums text-muted-foreground">
                  Q{activeEntry.event.period} · {formatGameClock(activeEntry.event.gameClockTime)}
                </span>
                <span className="ml-auto shrink-0 text-subheadline nums text-muted-foreground">
                  {queueIdx + 1} of {queueRef.current.length || 1} queued
                </span>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
