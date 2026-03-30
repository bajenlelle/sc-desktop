"use client";

import { RefObject, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, FileDown, GripVertical, ListPlus, Loader2, Play, SkipForward, Square, Trash2 } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { isClipItem, type Playlist, type PlaylistFolder, type PlaylistClipItem, type PlayByPlayEvent, type SyncPoint } from "@/types/match";
import { exportPlaylist, type ExportSegment } from "@/lib/export";
import { isLocalPath } from "@/lib/stream";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventLabel(e: PlayByPlayEvent): string {
  const sub = e.subType?.toLowerCase() ?? "";
  switch (e.type) {
    case "2pt":
      return e.isSuccessful ? "2PT Made" : "2PT Miss";
    case "3pt":
      return e.isSuccessful ? "3PT Made" : "3PT Miss";
    case "freethrow":
      return e.isSuccessful ? "FT Made" : "FT Miss";
    case "rebound":
      if (sub === "offensivedeadball") return "Inbound Play";
      if (sub.includes("off")) return "Off Rebound";
      if (sub.includes("def")) return "Def Rebound";
      return "Rebound";
    case "turnover":
      if (sub === "badpass") return "Bad Pass";
      if (sub === "ballhandling") return "Ball Handling";
      if (sub === "travel") return "Travel";
      if (sub === "24sec") return "Shot Clock";
      if (sub === "outofbounds") return "Out of Bounds";
      return "Turnover";
    case "steal":
      return "Steal";
    case "foul":
      if (sub === "offensive") return "Charge";
      if (["technical", "benchtechnical", "coachtechnical"].includes(sub)) return "Technical";
      return "Foul";
    case "foulon":
      return "Foul Drawn";
    case "block":
      return "Block";
    case "assist":
      return "Assist";
    default:
      return e.type;
  }
}

function eventBadgeColor(e: PlayByPlayEvent): string {
  switch (e.type) {
    case "2pt":
    case "3pt":
    case "freethrow":
      return e.isSuccessful
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
        : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "rebound":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "steal":
    case "block":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    case "turnover":
    case "foul":
    case "foulon":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function playerName(e: PlayByPlayEvent): string {
  if (!e.player) return "—";
  return `${e.player.firstName} ${e.player.familyName}`.trim();
}

function periodLabel(period: number): string {
  return period > 4 ? `OT${period - 4}` : `Q${period}`;
}

function formatGameClock(raw: string): string {
  if (!raw) return "—";
  const parts = raw.split(":");
  return parts.slice(0, 2).join(":");
}

function parseGameClock(raw: string): number {
  if (!raw || raw === "—") return -1;
  const parts = raw.split(":");
  if (parts.length < 2) return -1;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

const EVENT_TYPE_OPTIONS = [
  { value: "2pt-made", label: "2PT Made" },
  { value: "2pt-miss", label: "2PT Miss" },
  { value: "3pt-made", label: "3PT Made" },
  { value: "3pt-miss", label: "3PT Miss" },
  { value: "freethrow-made", label: "FT Made" },
  { value: "freethrow-miss", label: "FT Miss" },
  { value: "rebound-off", label: "Off Rebound" },
  { value: "rebound-def", label: "Def Rebound" },
  { value: "rebound-inbound", label: "Inbound Play" },
  { value: "turnover", label: "Turnover" },
  { value: "steal", label: "Steal" },
  { value: "assist", label: "Assist" },
  { value: "foul", label: "Foul" },
  { value: "block", label: "Block" },
];

const SHOT_TYPE_OPTIONS = [
  { value: "subtype:layup", label: "Layup" },
  { value: "subtype:floater", label: "Floater" },
  { value: "subtype:jumpshot", label: "Jump Shot" },
  { value: "subtype:dunk", label: "Dunk / Alley-oop" },
  { value: "subtype:tipin", label: "Tip-in" },
];

const SITUATION_OPTIONS = [
  { value: "qual:fastbreak", label: "Fast Break" },
  { value: "qual:pointsinthepaint", label: "In the Paint" },
  { value: "qual:2ndchance", label: "2nd Chance" },
  { value: "qual:fromturnover", label: "From Turnover" },
  { value: "qual:shooting", label: "Shooting Foul" },
  { value: "subtype:charge", label: "Charge" },
  { value: "subtype:technical", label: "Technical Foul" },
  { value: "subtype:badpass", label: "Bad Pass" },
  { value: "subtype:ballhandling", label: "Ball Handling" },
  { value: "subtype:travel", label: "Travel" },
  { value: "subtype:24sec", label: "Shot Clock" },
];

function matchesSingleType(e: PlayByPlayEvent, filter: string): boolean {
  if (filter === "rebound-off") return e.type === "rebound" && e.subType === "offensive";
  if (filter === "rebound-def") return e.type === "rebound" && e.subType === "defensive";
  if (filter === "rebound-inbound") return e.type === "rebound" && e.subType === "offensivedeadball";
  const [type, outcome] = filter.split("-");
  if (e.type !== type) return false;
  if (outcome === "made") return e.isSuccessful === 1;
  if (outcome === "miss") return e.isSuccessful === 0;
  if (type === "foul") return e.type === "foul" || e.type === "foulon";
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

type ClockSort = "none" | "asc" | "desc";

export interface ClipsViewHandle {
  goPrev(): void;
  goNext(): void;
  replay(): void;
  stop(): void;
  playAll(): void;
  adjustPreOffset(delta: number): void;
  adjustPostOffset(delta: number): void;
}

// ---------------------------------------------------------------------------
// DraggableClipsRow (used in playlist view mode)
// ---------------------------------------------------------------------------

function DraggableClipsRow({
  event,
  isActive,
  isSelected,
  jerseyNo,
  preOffset,
  postOffset,
  onRowClick,
  onToggleSelect,
  showCheckbox,
}: {
  event: PlayByPlayEvent;
  isActive: boolean;
  isSelected: boolean;
  jerseyNo: string | null;
  preOffset?: number;
  postOffset?: number;
  onRowClick: () => void;
  onToggleSelect?: (ev: React.MouseEvent) => void;
  showCheckbox: boolean;
}) {
  const controls = useDragControls();
  const pName = playerName(event);
  return (
    <Reorder.Item
      as="tr"
      value={event}
      dragListener={false}
      dragControls={controls}
      data-event-id={event.eventId}
      className={`group cursor-pointer transition-colors hover:bg-muted/50 ${
        isActive ? "bg-primary/10" : ""
      } ${isSelected && !isActive ? "bg-primary/5" : ""}`}
      onClick={onRowClick}
    >
      <td className="w-8 px-2 py-2.5">
        <span
          className="flex cursor-grab items-center justify-center opacity-0 group-hover:opacity-60 transition-opacity active:cursor-grabbing"
          onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </td>
      {showCheckbox && (
        <td className="w-8 px-3 py-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={(ev) => onToggleSelect?.(ev)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
        </td>
      )}
      <td className="px-4 py-2.5 text-muted-foreground">{periodLabel(event.period)}</td>
      <td className="px-4 py-2.5 font-mono text-muted-foreground">
        {formatGameClock(event.gameClockTime)}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eventBadgeColor(event)}`}
        >
          {eventLabel(event)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-foreground/80">
        {jerseyNo !== null && (
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
            #{jerseyNo}
          </span>
        )}
        {pName}
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">
        {event.eventTeam?.teamName ?? "—"}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          <Play
            className={`h-3.5 w-3.5 ${
              isActive ? "text-primary" : "text-muted-foreground/40"
            }`}
          />
          {((preOffset ?? 0) !== 0 || (postOffset ?? 0) !== 0) && (
            <span
              className="text-[10px] font-medium text-orange-400"
              title={`Pre ${(preOffset ?? 0) >= 0 ? "+" : ""}${preOffset ?? 0}s / Post ${(postOffset ?? 0) >= 0 ? "+" : ""}${postOffset ?? 0}s`}
            >
              ±
            </span>
          )}
        </div>
      </td>
    </Reorder.Item>
  );
}

// ---------------------------------------------------------------------------
// AddToDropdown — playlist picker with search
// ---------------------------------------------------------------------------

function AddToDropdown({
  playlists,
  activePlaylistId,
  addToSearch,
  setAddToSearch,
  onAddToPlaylist,
}: {
  playlists: Playlist[];
  activePlaylistId: string | null;
  addToSearch: string;
  setAddToSearch: (v: string) => void;
  onAddToPlaylist: (playlist: Playlist) => void;
}) {
  const q = addToSearch.toLowerCase();

  const options = playlists.filter((pl) => {
    if (activePlaylistId && pl.id === activePlaylistId) return false;
    if (q && !pl.name.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg">
      <div className="border-b border-border p-2">
        <input
          autoFocus
          type="text"
          placeholder="Search playlists…"
          value={addToSearch}
          onChange={(e) => setAddToSearch(e.target.value)}
          className="w-full rounded-sm bg-muted px-2 py-1 text-xs outline-none"
        />
      </div>
      {options.length > 0 ? (
        <div className="max-h-60 overflow-y-auto py-1">
          {options.map((pl) => (
            <button
              key={pl.id}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onAddToPlaylist(pl)}
            >
              <span className="flex-1 truncate">{pl.name}</span>
              <span className="text-xs text-muted-foreground">{pl.items.length}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-3 py-3 text-xs text-muted-foreground">No playlists found</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

interface ClipsViewProps {
  matchId: string;
  events: PlayByPlayEvent[];
  syncPoint: SyncPoint | undefined;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl?: string;
  homeTeamName: string;
  awayTeamName: string;
  homeRoster?: RosterEntry[];
  awayRoster?: RosterEntry[];
  /** All playlists (not just this match's) — from the top-level playlists table */
  playlists?: Playlist[];
  onPlaylistCreated?: (name: string, clips: PlaylistClipItem[], folderId?: string) => Promise<void>;
  onPlaylistUpdated?: (id: string, patch: { name?: string; folderId?: string | null; clips?: PlaylistClipItem[] }) => Promise<void>;
  onPlaylistDeleted?: (id: string) => Promise<void>;
  videoAvailable?: boolean;
  onPlaybackChange?: (canPrev: boolean, canNext: boolean, isQueueActive: boolean, hasActivePlaylist: boolean) => void;
  onActiveClipChange?: (pre: number, post: number) => void;
  folders?: PlaylistFolder[];
}

export const ClipsView = forwardRef<ClipsViewHandle, ClipsViewProps>(function ClipsView({
  matchId,
  events,
  syncPoint,
  videoRef,
  videoUrl,
  homeTeamName,
  awayTeamName,
  homeRoster = [],
  awayRoster = [],
  playlists = [],
  onPlaylistCreated,
  onPlaylistUpdated,
  onPlaylistDeleted,
  videoAvailable = false,
  onPlaybackChange,
  onActiveClipChange,
  folders = [],
}: ClipsViewProps, ref) {
  // Build a name → jersey number lookup from both rosters
  const jerseyByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of [...homeRoster, ...awayRoster]) {
      if (entry.playerName && entry.jerseyNumber) {
        map.set(entry.playerName.trim().toLowerCase(), entry.jerseyNumber);
      }
    }
    return map;
  }, [homeRoster, awayRoster]);

  function jerseyNumber(e: PlayByPlayEvent): string | null {
    if (!e.player) return null;
    const name = playerName(e).trim().toLowerCase();
    return jerseyByName.get(name) ?? null;
  }

  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterSubTypes, setFilterSubTypes] = useState<Set<string>>(new Set());
  const [filterSituations, setFilterSituations] = useState<Set<string>>(new Set());
  const [filterTeams, setFilterTeams] = useState<Set<string>>(new Set());
  const [filterPlayers, setFilterPlayers] = useState<Set<string>>(new Set());
  const [preRoll, setPreRoll] = useState(10);
  const [postRoll, setPostRoll] = useState(3);

  // Refs for use inside timeupdate (avoids stale closures)
  const syncPointRef = useRef(syncPoint);
  useEffect(() => { syncPointRef.current = syncPoint; }, [syncPoint]);
  const preRollRef = useRef(preRoll);
  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  const postRollRef = useRef(postRoll);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  const transientOffsetRef = useRef({ pre: 0, post: 0 });

  // Playback queue — mutable refs avoid stale-closure bugs in timeupdate
  const queueRef = useRef<PlayByPlayEvent[]>([]);
  const queueIdxRef = useRef<number>(0);
  const clipEndRef = useRef<number | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Playlist creation UI
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistFolderId, setNewPlaylistFolderId] = useState("");
  const [showAddToDropdown, setShowAddToDropdown] = useState(false);
  const [addToSearch, setAddToSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close add-to dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAddToDropdown(false);
        setAddToSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Active playlist (playlist view mode)
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const activePlaylistRef = useRef(activePlaylist);
  useEffect(() => { activePlaylistRef.current = activePlaylist; }, [activePlaylist]);

  // Clock sort
  const [clockSort, setClockSort] = useState<ClockSort>("none");

  // Export
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport(eventsToExport: PlayByPlayEvent[], name: string) {
    if (!videoUrl || !syncPoint) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await exportPlaylist(
        eventsToExport.map((e): ExportSegment => {
          const clip = activePlaylistRef.current?.items.filter(isClipItem).find(
            (c) => c.matchId === matchId && c.eventId === e.eventId
          );
          return {
            kind: 'clip',
            videoPath: videoUrl,
            matchId,
            event: e,
            syncPoint,
            preRollOffset: clip?.preRollOffset,
            postRollOffset: clip?.postRollOffset,
          };
        }),
        preRoll,
        postRoll,
        name,
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsExporting(false);
    }
  }

  const exportDisabledReason =
    !videoUrl ? "No video loaded" :
    !isLocalPath(videoUrl) ? "Export requires a local video file" :
    !syncPoint ? "No sync point set" :
    null;

  // Event lookup map for playlist resolution
  const eventMap = useMemo(() => new Map(events.map((e) => [e.eventId, e])), [events]);

  // Collect unique teams / players from events
  const teams = Array.from(
    new Set(events.map((e) => e.eventTeam?.teamName).filter(Boolean))
  ) as string[];

  const players = Array.from(
    new Set(
      events
        .map((e) => (e.player ? playerName(e) : null))
        .filter(Boolean)
    )
  ) as string[];

  const filtered = events.filter((e) => {
    if (filterTypes.size > 0 && !Array.from(filterTypes).some((f) => matchesSingleType(e, f))) return false;
    if (filterSubTypes.size > 0 && !Array.from(filterSubTypes).some((f) => matchesShotType(e, f))) return false;
    if (filterSituations.size > 0 && !Array.from(filterSituations).some((f) => matchesSituation(e, f))) return false;
    if (filterTeams.size > 0 && !filterTeams.has(e.eventTeam?.teamName ?? "")) return false;
    if (filterPlayers.size > 0 && !filterPlayers.has(playerName(e))) return false;
    return true;
  });

  // Resolve playlist events in order (only clips from the current match are playable here)
  const playlistEvents = useMemo(() => {
    if (!activePlaylist) return null;
    return activePlaylist.items.filter(isClipItem)
      .filter((c) => c.matchId === matchId)
      .map((c) => eventMap.get(c.eventId))
      .filter((e): e is PlayByPlayEvent => e !== undefined);
  }, [activePlaylist, eventMap, matchId]);

  // Events shown in the table — playlist view overrides filtered view
  const displayEvents = activePlaylist ? (playlistEvents ?? []) : filtered;

  // Reset clock sort when switching playlists
  useEffect(() => { setClockSort("none"); }, [activePlaylist?.id]);

  const sortedDisplayEvents = useMemo(() => {
    if (clockSort === "none") return displayEvents;
    return [...displayEvents].sort((a, b) => {
      if (a.period !== b.period) return clockSort === "asc" ? a.period - b.period : b.period - a.period;
      const aT = parseGameClock(formatGameClock(a.gameClockTime));
      const bT = parseGameClock(formatGameClock(b.gameClockTime));
      // clock counts DOWN — "asc" = chronological = high clock first
      return clockSort === "asc" ? bT - aT : aT - bT;
    });
  }, [displayEvents, clockSort]);

  // Clear selection when filters change (all-clips mode only)
  useEffect(() => {
    if (!activePlaylist) setSelectedIds(new Set());
    // Sets change identity on every update — this fires correctly on each filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTypes, filterSubTypes, filterSituations, filterTeams, filterPlayers, activePlaylist]);

  // ---------------------------------------------------------------------------
  // Seek helper — reads pre/post roll and syncPoint from refs
  // ---------------------------------------------------------------------------

  function getClipOffset(eventId: number) {
    const clip = activePlaylistRef.current?.items.filter(isClipItem).find(
      (c) => c.matchId === matchId && c.eventId === eventId
    );
    return { pre: clip?.preRollOffset ?? 0, post: clip?.postRollOffset ?? 0 };
  }

  const seekToEvent = useCallback(
    (event: PlayByPlayEvent, preOverride?: number, postOverride?: number) => {
      const sp = syncPointRef.current;
      const video = videoRef.current;
      if (!sp || !video) return;
      const videoTime = computeVideoTime(event, sp);
      if (videoTime === null) return;
      const { pre, post } = getClipOffset(event.eventId);
      const seekTo = Math.max(0, Math.min(videoTime, videoTime - preRollRef.current - (preOverride ?? pre)));
      const clipEnd = Math.max(videoTime, videoTime + postRollRef.current + (postOverride ?? post));
      clipEndRef.current = undefined; // clear so timeupdate ignores stale position while seeking
      video.pause();
      video.addEventListener("seeked", () => {
        clipEndRef.current = clipEnd; // only arm the end-gate after seek lands
        video.play().catch(() => {});
      }, { once: true });
      video.currentTime = seekTo;
    },
    [videoRef] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---------------------------------------------------------------------------
  // Clip navigation helpers (exposed via ref)
  // ---------------------------------------------------------------------------
  const isQueueActive = activeEventId !== null;

  const handleReplay = useCallback(() => {
    const event = queueRef.current[queueIdxRef.current];
    if (event) seekToEvent(event);
  }, [seekToEvent]);

  const adjustActiveClipRef = useRef<(preDelta: number, postDelta: number) => void>(() => {});

  useImperativeHandle(ref, () => ({
    goPrev: handleGoPrev,
    goNext: handleGoNext,
    replay: handleReplay,
    stop: handleStop,
    playAll: handlePlayAll,
    adjustPreOffset: (delta: number) => adjustActiveClipRef.current(delta, 0),
    adjustPostOffset: (delta: number) => adjustActiveClipRef.current(0, delta),
  }));

  // ---------------------------------------------------------------------------
  // Seamless auto-advance via timeupdate
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleTimeUpdate() {
      const end = clipEndRef.current;
      if (end === undefined || !video) return;
      if (video.currentTime < end) return;

      clipEndRef.current = undefined;
      video.pause();
      const nextIdx = queueIdxRef.current + 1;
      const queue = queueRef.current;

      if (nextIdx < queue.length) {
        queueIdxRef.current = nextIdx;
        const nextEvent = queue[nextIdx];
        setActiveEventId(nextEvent.eventId);
        const sp = syncPointRef.current;
        if (sp) {
          const videoTime = computeVideoTime(nextEvent, sp);
          if (videoTime !== null) {
            const nextClip = activePlaylistRef.current?.items.filter(isClipItem).find(
              (c) => c.matchId === matchId && c.eventId === nextEvent.eventId
            );
            const seekTo = Math.max(0, videoTime - preRollRef.current - (nextClip?.preRollOffset ?? 0));
            const newEnd = Math.max(videoTime, videoTime + postRollRef.current + (nextClip?.postRollOffset ?? 0));
            // clipEndRef was already cleared above — keep it undefined until seeked
            video.pause();
            video.addEventListener("seeked", () => {
              clipEndRef.current = newEnd;
              video.play().catch(() => {});
            }, { once: true });
            video.currentTime = seekTo;
          }
        }
      } else {
        video.pause();
        setIsPlaying(false);
        setActiveEventId(null);
        queueRef.current = [];
      }
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [videoRef, videoAvailable]);

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------
  function startQueue(queue: PlayByPlayEvent[]) {
    if (queue.length === 0 || !syncPointRef.current) return;
    queueRef.current = queue;
    queueIdxRef.current = 0;
    setIsPlaying(true);
    setActiveEventId(queue[0].eventId);
    seekToEvent(queue[0]);
  }

  function handleRowClick(event: PlayByPlayEvent) {
    const idx = sortedDisplayEvents.findIndex((e) => e.eventId === event.eventId);
    const queue = idx >= 0 ? sortedDisplayEvents.slice(idx) : [event];
    startQueue(queue);
  }

  // Keep refs up-to-date for arrow key handler (avoids stale closures in global listener)
  const _sortedDisplayEventsRef = useRef(sortedDisplayEvents);
  _sortedDisplayEventsRef.current = sortedDisplayEvents;
  const _activeEventIdRef = useRef(activeEventId);
  _activeEventIdRef.current = activeEventId;
  const _handleRowClickRef = useRef(handleRowClick);
  _handleRowClickRef.current = handleRowClick;
  const _handleReplayRef = useRef(handleReplay);
  _handleReplayRef.current = handleReplay;

  // Prev/next based on position in the visible list (same as ↑/↓ arrow keys)
  const listPosition = activeEventId !== null
    ? sortedDisplayEvents.findIndex((e) => e.eventId === activeEventId)
    : -1;
  const canPrev = listPosition > 0;
  const canNext = listPosition >= 0 && listPosition < sortedDisplayEvents.length - 1;

  const handleGoPrev = useCallback(() => {
    const events = _sortedDisplayEventsRef.current;
    const cur = events.findIndex((e) => e.eventId === _activeEventIdRef.current);
    if (cur <= 0) return;
    _handleRowClickRef.current(events[cur - 1]);
  }, []);

  const handleGoNext = useCallback(() => {
    const events = _sortedDisplayEventsRef.current;
    const cur = events.findIndex((e) => e.eventId === _activeEventIdRef.current);
    if (cur === -1 || cur >= events.length - 1) return;
    _handleRowClickRef.current(events[cur + 1]);
  }, []);

  // Notify parent of playback state changes
  useEffect(() => {
    onPlaybackChange?.(canPrev, canNext, isQueueActive, activePlaylist !== null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrev, canNext, isQueueActive, activePlaylist]);

  // Notify parent of active clip offset changes
  useEffect(() => {
    transientOffsetRef.current = { pre: 0, post: 0 };
    if (activeEventId === null) { onActiveClipChange?.(0, 0); return; }
    const clip = activePlaylistRef.current?.items.filter(isClipItem).find(
      (c) => c.matchId === matchId && c.eventId === activeEventId
    );
    onActiveClipChange?.(clip?.preRollOffset ?? 0, clip?.postRollOffset ?? 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEventId]);

  // Global ↑/↓/← arrow keys → navigate clip list / replay
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "ArrowDown" && e.code !== "ArrowUp" && e.code !== "ArrowLeft") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      if (e.code === "ArrowLeft") { _handleReplayRef.current(); return; }
      const events = _sortedDisplayEventsRef.current;
      if (events.length === 0) return;
      const cur = events.findIndex((ev) => ev.eventId === _activeEventIdRef.current);
      const next =
        e.code === "ArrowDown"
          ? cur === -1 ? 0 : Math.min(cur + 1, events.length - 1)
          : cur === -1 ? events.length - 1 : Math.max(cur - 1, 0);
      if (next !== cur || cur === -1) _handleRowClickRef.current(events[next]);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll active row into view when activeEventId changes
  useEffect(() => {
    if (activeEventId === null) return;
    document.querySelector(`[data-event-id="${activeEventId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeEventId]);

  function handlePlayAll() {
    startQueue([...sortedDisplayEvents]);
  }

  function handleStop() {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    clipEndRef.current = undefined;
    videoRef.current?.pause();
  }

  // Keep adjustActiveClipRef current so the handle always calls the latest closure
  adjustActiveClipRef.current = function adjustActiveClip(preDelta: number, postDelta: number) {
    const eventId = _activeEventIdRef.current;
    if (eventId === null) return;

    if (!activePlaylistRef.current || !onPlaylistUpdated) {
      const cur = transientOffsetRef.current;
      const newPre = Math.max(-preRollRef.current, cur.pre + preDelta);
      const newPost = Math.max(-postRollRef.current, cur.post + postDelta);
      transientOffsetRef.current = { pre: newPre, post: newPost };
      onActiveClipChange?.(newPre, newPost);
      const event = queueRef.current[queueIdxRef.current];
      if (event) seekToEvent(event, newPre, newPost);
      return;
    }
    const ap = activePlaylistRef.current;
    const existingClip = ap.items.filter(isClipItem).find((c) => c.matchId === matchId && c.eventId === eventId);
    const newPre = Math.max(-preRollRef.current, (existingClip?.preRollOffset ?? 0) + preDelta);
    const newPost = Math.max(-postRollRef.current, (existingClip?.postRollOffset ?? 0) + postDelta);

    const newItems = ap.items.map((c) =>
      isClipItem(c) && c.matchId === matchId && c.eventId === eventId
        ? { ...c, preRollOffset: newPre, postRollOffset: newPost }
        : c
    );
    const updated = { ...ap, items: newItems };
    setActivePlaylist(updated);
    activePlaylistRef.current = updated;
    onPlaylistUpdated(ap.id, { clips: newItems.filter(isClipItem) }).catch(() => {});
    onActiveClipChange?.(newPre, newPost);

    // Replay with new timing immediately
    const event = queueRef.current[queueIdxRef.current];
    if (event) seekToEvent(event, newPre, newPost);
  };

  function handleReorderPlaylist(newEvents: PlayByPlayEvent[]) {
    if (!activePlaylist || !onPlaylistUpdated) return;
    // Build lookup of existing clips to preserve per-clip offsets
    const clipMap = new Map(
      activePlaylist.items.filter(isClipItem)
        .filter((c) => c.matchId === matchId)
        .map((c) => [c.eventId, c])
    );
    const reorderedSameMatch = newEvents.map((e) =>
      clipMap.get(e.eventId) ?? { type: 'clip' as const, matchId, eventId: e.eventId }
    );
    let idx = 0;
    const newItems = activePlaylist.items.map((c) => {
      if (!isClipItem(c) || c.matchId !== matchId) return c;
      return reorderedSameMatch[idx++] ?? c;
    });
    const updated = { ...activePlaylist, items: newItems };
    setActivePlaylist(updated);
    onPlaylistUpdated(activePlaylist.id, { clips: newItems.filter(isClipItem) }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Playlist view navigation
  // ---------------------------------------------------------------------------
  function handleOpenPlaylist(pl: Playlist) {
    handleStop();
    setActivePlaylist(pl);
    setSelectedIds(new Set());
  }

  function handlePlayPlaylistFromCard(pl: Playlist) {
    setActivePlaylist(pl);
    setSelectedIds(new Set());
    const queue = pl.items.filter(isClipItem)
      .filter((c) => c.matchId === matchId)
      .map((c) => eventMap.get(c.eventId))
      .filter((e): e is PlayByPlayEvent => e !== undefined);
    queueRef.current = [];
    queueIdxRef.current = 0;
    clipEndRef.current = undefined;
    videoRef.current?.pause();
    startQueue(queue);
  }

  function handleExitPlaylistView() {
    handleStop();
    setActivePlaylist(null);
    setSelectedIds(new Set());
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  const allSelected =
    sortedDisplayEvents.length > 0 && sortedDisplayEvents.every((e) => selectedIds.has(e.eventId));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedDisplayEvents.map((e) => e.eventId)));
    }
  }

  function toggleSelect(eventId: number, ev: React.MouseEvent) {
    ev.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Playlist mutation
  // ---------------------------------------------------------------------------
  function handleCreatePlaylist() {
    if (!newPlaylistName.trim() || selectedIds.size === 0) return;
    const ordered: PlaylistClipItem[] = filtered
      .filter((e) => selectedIds.has(e.eventId))
      .map((e) => ({ type: 'clip' as const, matchId, eventId: e.eventId }));
    onPlaylistCreated?.(
      newPlaylistName.trim(),
      ordered,
      newPlaylistFolderId || undefined,
    ).catch(() => {});
    setNewPlaylistName("");
    setNewPlaylistFolderId("");
    setSelectedIds(new Set());
  }

  function handleAddToPlaylist(targetPlaylist: Playlist) {
    const existingSet = new Set(targetPlaylist.items.filter(isClipItem).map((c) => `${c.matchId}:${c.eventId}`));
    const sourceEvents = activePlaylist ? sortedDisplayEvents : filtered;
    const toAdd: PlaylistClipItem[] = sourceEvents
      .filter((e) => selectedIds.has(e.eventId) && !existingSet.has(`${matchId}:${e.eventId}`))
      .map((e) => ({ type: 'clip' as const, matchId, eventId: e.eventId }));
    const newClips = [...targetPlaylist.items.filter(isClipItem), ...toAdd];
    onPlaylistUpdated?.(targetPlaylist.id, { clips: newClips }).catch(() => {});
    setSelectedIds(new Set());
    setShowAddToDropdown(false);
    setAddToSearch("");
  }

  function handleRemoveFromPlaylist() {
    if (!activePlaylist) return;
    const remaining = activePlaylist.items.filter(
      (c) => !(isClipItem(c) && c.matchId === matchId && selectedIds.has(c.eventId))
    );
    onPlaylistUpdated?.(activePlaylist.id, { clips: remaining.filter(isClipItem) }).catch(() => {});
    if (remaining.length === 0) {
      setActivePlaylist(null);
    } else {
      const updated = { ...activePlaylist, items: remaining };
      setActivePlaylist(updated);
      activePlaylistRef.current = updated;
    }
    setSelectedIds(new Set());
  }

  function handleDeletePlaylist(id: string) {
    if (activePlaylist?.id === id) {
      handleStop();
      setActivePlaylist(null);
      setSelectedIds(new Set());
    }
    onPlaylistDeleted?.(id).catch(() => {});
  }

  const noSync = !syncPoint;

  // Playlists that contain clips from this match (shown in Saved Playlists section)
  const matchPlaylists = playlists.filter((p) => p.items.some((c) => isClipItem(c) && c.matchId === matchId));

  return (
    <div className="space-y-4">
      {/* Saved Playlists — only shown in all-clips mode */}
      {!activePlaylist && (matchPlaylists.length > 0 || onPlaylistCreated) && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground/80">
              Saved Playlists
            </h3>
          </div>
          {matchPlaylists.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No playlists yet. Select clips below to create one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {matchPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-muted/50"
                  onClick={() => handleOpenPlaylist(pl)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-primary hover:underline">
                      {pl.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {pl.items.filter(isClipItem).length} clip{pl.items.filter(isClipItem).length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => handlePlayPlaylistFromCard(pl)}
                      disabled={noSync}
                    >
                      <Play className="h-3 w-3" />
                      Play
                    </Button>
                    {onPlaylistDeleted && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                        onClick={() => handleDeletePlaylist(pl.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlist mode header / All-clips filter controls */}
      {activePlaylist ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2.5">
          {/* Left: back + playlist name */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs text-primary hover:bg-primary/10"
              onClick={handleExitPlaylistView}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Clips
            </Button>
            <span className="text-sm font-semibold text-primary">
              {activePlaylist.name}
            </span>
            <span className="text-xs text-primary/70">
              {playlistEvents?.length ?? 0} clip{(playlistEvents?.length ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Right: pre/post roll + play/stop */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-primary/70">Pre</label>
              <Input
                type="number"
                min={0}
                max={30}
                className="h-7 w-16 text-xs"
                value={preRoll}
                onChange={(e) => setPreRoll(Number(e.target.value))}
              />
              <label className="text-xs text-primary/70">Post</label>
              <Input
                type="number"
                min={0}
                max={60}
                className="h-7 w-16 text-xs"
                value={postRoll}
                onChange={(e) => setPostRoll(Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              {isPlaying ? (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleStop}>
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => startQueue([...sortedDisplayEvents])}
                  disabled={sortedDisplayEvents.length === 0 || noSync}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Play Playlist
                </Button>
              )}
              {isExporting ? (
                <Button size="sm" variant="outline" disabled className="h-8 gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Exporting…
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => handleExport(sortedDisplayEvents, activePlaylist?.name ?? "playlist")}
                  disabled={!!exportDisabledReason || sortedDisplayEvents.length === 0}
                  title={exportDisabledReason ?? "Export playlist as MP4"}
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Export
                </Button>
              )}
            </div>
          </div>
          {exportError && (
            <p className="w-full text-xs text-red-500 mt-1">{exportError}</p>
          )}
        </div>
      ) : (
        /* All-clips mode: filter + play-all controls */
        <div className="flex flex-wrap items-end gap-3">
          {/* Type filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Event type</label>
            <MultiSelectDropdown
              options={EVENT_TYPE_OPTIONS}
              selected={filterTypes}
              onChange={setFilterTypes}
              placeholder="All types"
            />
          </div>

          {/* Shot type filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Shot type</label>
            <MultiSelectDropdown
              options={SHOT_TYPE_OPTIONS}
              selected={filterSubTypes}
              onChange={setFilterSubTypes}
              placeholder="All shots"
            />
          </div>

          {/* Situation filter */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Situation</label>
            <MultiSelectDropdown
              options={SITUATION_OPTIONS}
              selected={filterSituations}
              onChange={setFilterSituations}
              placeholder="Any situation"
            />
          </div>

          {/* Team filter */}
          {teams.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Team</label>
              <MultiSelectDropdown
                options={teams.map((t) => ({ value: t, label: t }))}
                selected={filterTeams}
                onChange={setFilterTeams}
                placeholder="All teams"
              />
            </div>
          )}

          {/* Player filter */}
          {players.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Player</label>
              <MultiSelectDropdown
                options={players.map((p) => ({ value: p, label: p }))}
                selected={filterPlayers}
                onChange={setFilterPlayers}
                placeholder="All players"
              />
            </div>
          )}

          {/* Pre/post roll */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Pre-roll (s)</label>
            <Input
              type="number"
              min={0}
              max={30}
              className="h-9 w-20"
              value={preRoll}
              onChange={(e) => setPreRoll(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Post-roll (s)</label>
            <Input
              type="number"
              min={0}
              max={60}
              className="h-9 w-20"
              value={postRoll}
              onChange={(e) => setPostRoll(Number(e.target.value))}
            />
          </div>

          <div className="ml-auto flex gap-2">
            {isPlaying ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleStop}
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handlePlayAll}
                disabled={filtered.length === 0 || noSync}
              >
                <SkipForward className="h-3.5 w-3.5" />
                Play All ({filtered.length})
              </Button>
            )}
            {isExporting ? (
              <Button size="sm" variant="outline" disabled className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Exporting…
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => handleExport(filtered, `${homeTeamName} vs ${awayTeamName}`)}
                disabled={!!exportDisabledReason || filtered.length === 0}
                title={exportDisabledReason ?? "Export visible clips as MP4"}
              >
                <FileDown className="h-3.5 w-3.5" />
                Export ({filtered.length})
              </Button>
            )}
          </div>
        </div>
      )}

      {noSync && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          No sync point set. Add one in the session to enable video seeking.
        </p>
      )}

      {/* Selection action bar */}
      {selectedIds.size > 0 && onPlaylistCreated && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-primary/10 px-4 py-2.5">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} clip{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            {activePlaylist ? (
              /* Playlist mode: remove + add-to-another */
              <>
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-red-600 px-2 text-xs text-white hover:bg-red-700"
                  onClick={handleRemoveFromPlaylist}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from playlist
                </Button>
                {playlists.filter((p) => p.id !== activePlaylist.id).length > 0 && (
                  <div ref={dropdownRef} className="relative">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => { setShowAddToDropdown((v) => !v); setAddToSearch(""); }}
                    >
                      Add to another playlist
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {showAddToDropdown && <AddToDropdown
                      playlists={playlists}
                      activePlaylistId={activePlaylist.id}
                      addToSearch={addToSearch}
                      setAddToSearch={setAddToSearch}
                      onAddToPlaylist={handleAddToPlaylist}
                    />}
                  </div>
                )}
              </>
            ) : (
              /* All-clips mode: create / add-to playlist */
              <>
                <Input
                  className="h-7 w-40 text-xs"
                  placeholder="Playlist name…"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreatePlaylist();
                  }}
                />
                {folders.length > 0 && (
                  <select
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    value={newPlaylistFolderId}
                    onChange={(e) => setNewPlaylistFolderId(e.target.value)}
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
                <Button
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim()}
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  Create playlist
                </Button>
                {playlists.length > 0 && (
                  <div ref={dropdownRef} className="relative">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => { setShowAddToDropdown((v) => !v); setAddToSearch(""); }}
                    >
                      Add to playlist
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {showAddToDropdown && <AddToDropdown
                      playlists={playlists}
                      activePlaylistId={null}
                      addToSearch={addToSearch}
                      setAddToSearch={setAddToSearch}
                      onAddToPlaylist={handleAddToPlaylist}
                    />}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Event list */}
      {sortedDisplayEvents.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {activePlaylist ? "This playlist has no clips." : "No events match the current filters."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
              <tr>
                {activePlaylist && <th className="w-8" />}
                {onPlaylistCreated && (
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded border-border accent-primary"
                    />
                  </th>
                )}
                <th className="px-4 py-2.5 text-left">Period</th>
                <th
                  className="px-4 py-2.5 text-left cursor-pointer select-none hover:text-foreground"
                  onClick={() => setClockSort((s) => s === "none" ? "asc" : s === "asc" ? "desc" : "none")}
                >
                  <span className="inline-flex items-center gap-1">
                    Clock
                    {clockSort === "asc" && <ArrowUp className="h-3 w-3" />}
                    {clockSort === "desc" && <ArrowDown className="h-3 w-3" />}
                  </span>
                </th>
                <th className="px-4 py-2.5 text-left">Event</th>
                <th className="px-4 py-2.5 text-left">Player</th>
                <th className="px-4 py-2.5 text-left">Team</th>
                <th className="px-4 py-2.5 text-left"></th>
              </tr>
            </thead>
            {activePlaylist ? (
              <Reorder.Group
                as="tbody"
                axis="y"
                values={sortedDisplayEvents}
                onReorder={handleReorderPlaylist}
                className="divide-y divide-border"
              >
                {sortedDisplayEvents.map((event) => {
                  const clip = activePlaylistRef.current?.items.filter(isClipItem).find(
                    (c) => c.matchId === matchId && c.eventId === event.eventId
                  );
                  return (
                    <DraggableClipsRow
                      key={event.eventId}
                      event={event}
                      isActive={event.eventId === activeEventId}
                      isSelected={selectedIds.has(event.eventId)}
                      jerseyNo={jerseyNumber(event)}
                      preOffset={clip?.preRollOffset}
                      postOffset={clip?.postRollOffset}
                      onRowClick={() => handleRowClick(event)}
                      onToggleSelect={onPlaylistCreated ? (ev) => toggleSelect(event.eventId, ev) : undefined}
                      showCheckbox={!!onPlaylistCreated}
                    />
                  );
                })}
              </Reorder.Group>
            ) : (
              <tbody className="divide-y divide-border">
                {sortedDisplayEvents.map((event, idx) => {
                  const isActive = event.eventId === activeEventId;
                  const isSelected = selectedIds.has(event.eventId);
                  const pName = playerName(event);
                  const pNo = jerseyNumber(event);
                  return (
                    <tr
                      key={`${event.eventId}-${idx}`}
                      data-event-id={event.eventId}
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                        isActive ? "bg-primary/10" : ""
                      } ${isSelected && !isActive ? "bg-primary/5" : ""}`}
                      onClick={() => handleRowClick(event)}
                    >
                      {onPlaylistCreated && (
                        <td className="w-8 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            onClick={(ev) => toggleSelect(event.eventId, ev)}
                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                          />
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {periodLabel(event.period)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {formatGameClock(event.gameClockTime)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eventBadgeColor(event)}`}
                        >
                          {eventLabel(event)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-foreground/80">
                        {pNo !== null && (
                          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                            #{pNo}
                          </span>
                        )}
                        {pName}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {event.eventTeam?.teamName ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Play
                          className={`h-3.5 w-3.5 ${
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/40"
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
      )}

      {/* Fallback info when team names from events are empty */}
      {!activePlaylist && teams.length === 0 && (homeTeamName || awayTeamName) && (
        <p className="text-xs text-muted-foreground">
          Teams: {homeTeamName} vs {awayTeamName}
        </p>
      )}
    </div>
  );
});
