"use client";

import { RefObject, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, FileDown, GripVertical, ListPlus, Loader2, Play, SkipForward, Square, Trash2 } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Playlist, PlaylistClip, PlayByPlayEvent, SyncPoint } from "@/types/match";
import { exportPlaylist, type ExportItem } from "@/lib/export";
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
      if (sub.includes("off")) return "Off Rebound";
      if (sub.includes("def")) return "Def Rebound";
      return "Rebound";
    case "turnover":
      return "Turnover";
    case "steal":
      return "Steal";
    case "foul":
    case "foulon":
      return "Foul";
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
  { value: "rebound", label: "Rebound" },
  { value: "turnover", label: "Turnover" },
  { value: "steal", label: "Steal" },
  { value: "foul", label: "Foul" },
  { value: "block", label: "Block" },
];

function matchesSingleType(e: PlayByPlayEvent, filter: string): boolean {
  const [type, outcome] = filter.split("-");
  if (e.type !== type) return false;
  if (outcome === "made") return e.isSuccessful === 1;
  if (outcome === "miss") return e.isSuccessful === 0;
  if (type === "rebound") return e.type === "rebound";
  if (type === "foul") return e.type === "foul" || e.type === "foulon";
  return true;
}

// ---------------------------------------------------------------------------
// MultiSelectDropdown
// ---------------------------------------------------------------------------

function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const label =
    selected.size === 0
      ? placeholder
      : selected.size === 1
      ? (options.find((o) => selected.has(o.value))?.label ?? placeholder)
      : `${selected.size} selected`;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 min-w-[130px] items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted/50 ${
          selected.size > 0 ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-full rounded-md border border-border bg-popover shadow-md">
          {selected.size > 0 && (
            <button
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-b border-border"
              onClick={() => onChange(new Set())}
            >
              Clear all
            </button>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.value)}
                  onChange={() => toggle(o.value)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type ClockSort = "none" | "asc" | "desc";

export interface ClipsViewHandle {
  goPrev(): void;
  goNext(): void;
  replay(): void;
  stop(): void;
  playAll(): void;
}

// ---------------------------------------------------------------------------
// DraggableClipsRow (used in playlist view mode)
// ---------------------------------------------------------------------------

function DraggableClipsRow({
  event,
  isActive,
  isSelected,
  jerseyNo,
  onRowClick,
  onToggleSelect,
  showCheckbox,
}: {
  event: PlayByPlayEvent;
  isActive: boolean;
  isSelected: boolean;
  jerseyNo: string | null;
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
      <td className="px-4 py-2.5 text-muted-foreground">Q{event.period}</td>
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
        <Play
          className={`h-3.5 w-3.5 ${
            isActive ? "text-primary" : "text-muted-foreground/40"
          }`}
        />
      </td>
    </Reorder.Item>
  );
}

// ---------------------------------------------------------------------------
// AddToDropdown — enhanced playlist picker with search and cross-match sections
// ---------------------------------------------------------------------------

function AddToDropdown({
  playlists,
  allPlaylists,
  matchId,
  activePlaylistId,
  addToSearch,
  setAddToSearch,
  onAddToPlaylist,
}: {
  playlists: Playlist[];
  allPlaylists?: Array<{ matchId: string; matchTitle: string; playlist: Playlist }>;
  matchId: string;
  activePlaylistId: string | null;
  addToSearch: string;
  setAddToSearch: (v: string) => void;
  onAddToPlaylist: (anchorMatchId: string, playlist: Playlist) => void;
}) {
  const q = addToSearch.toLowerCase();

  const thisSessionOptions = playlists.filter((pl) => {
    if (activePlaylistId && pl.id === activePlaylistId) return false;
    if (q && !pl.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // Group other matches' playlists
  const otherGroupMap = new Map<string, { matchTitle: string; options: Array<{ pl: Playlist; anchorMatchId: string }> }>();
  for (const ap of allPlaylists ?? []) {
    if (ap.matchId === matchId) continue;
    if (activePlaylistId && ap.playlist.id === activePlaylistId) continue;
    if (q && !ap.playlist.name.toLowerCase().includes(q)) continue;
    if (!otherGroupMap.has(ap.matchId)) {
      otherGroupMap.set(ap.matchId, { matchTitle: ap.matchTitle, options: [] });
    }
    otherGroupMap.get(ap.matchId)!.options.push({ pl: ap.playlist, anchorMatchId: ap.matchId });
  }
  const otherGroups = Array.from(otherGroupMap.entries()).map(([mId, g]) => ({ matchId: mId, ...g }));

  const hasAny = thisSessionOptions.length > 0 || otherGroups.some((g) => g.options.length > 0);

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
      {thisSessionOptions.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            This session
          </p>
          {thisSessionOptions.map((pl) => (
            <button
              key={pl.id}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onAddToPlaylist(matchId, pl)}
            >
              <span className="flex-1 truncate">{pl.name}</span>
              <span className="text-xs text-muted-foreground">{pl.clips.length}</span>
            </button>
          ))}
        </>
      )}
      {otherGroups.map((group) =>
        group.options.length === 0 ? null : (
          <div key={group.matchId}>
            <p className="truncate px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.matchTitle}
            </p>
            {group.options.map(({ pl, anchorMatchId }) => (
              <button
                key={pl.id}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => onAddToPlaylist(anchorMatchId, pl)}
              >
                <span className="flex-1 truncate">{pl.name}</span>
                <span className="text-xs text-muted-foreground">{pl.clips.length}</span>
              </button>
            ))}
          </div>
        )
      )}
      {!hasAny && (
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
  playlists?: Playlist[];
  onPlaylistsChange?: (p: Playlist[]) => void;
  videoAvailable?: boolean;
  onPlaybackChange?: (canPrev: boolean, canNext: boolean, isQueueActive: boolean) => void;
  allPlaylists?: Array<{ matchId: string; matchTitle: string; playlist: Playlist }>;
  onAddToExternalPlaylist?: (anchorMatchId: string, updatedPlaylists: Playlist[]) => Promise<void>;
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
  onPlaylistsChange,
  videoAvailable = false,
  onPlaybackChange,
  allPlaylists,
  onAddToExternalPlaylist,
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
        eventsToExport.map((e): ExportItem => ({ videoPath: videoUrl, event: e, syncPoint })),
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
    if (filterTeams.size > 0 && !filterTeams.has(e.eventTeam?.teamName ?? "")) return false;
    if (filterPlayers.size > 0 && !filterPlayers.has(playerName(e))) return false;
    return true;
  });

  // Resolve playlist events in order (only clips from the current match are playable here)
  const playlistEvents = useMemo(() => {
    if (!activePlaylist) return null;
    return activePlaylist.clips
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
  }, [filterTypes, filterTeams, filterPlayers, activePlaylist]);

  // ---------------------------------------------------------------------------
  // Seek helper — reads pre/post roll and syncPoint from refs
  // ---------------------------------------------------------------------------
  const seekToEvent = useCallback(
    (event: PlayByPlayEvent) => {
      const sp = syncPointRef.current;
      const video = videoRef.current;
      if (!sp || !video) return;
      const videoTime = computeVideoTime(event, sp);
      if (videoTime === null) return;
      const seekTo = Math.max(0, videoTime - preRollRef.current);
      clipEndRef.current = videoTime + postRollRef.current;
      video.pause();
      video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
      video.currentTime = seekTo;
    },
    [videoRef]
  );

  // ---------------------------------------------------------------------------
  // Clip navigation helpers (exposed via ref)
  // ---------------------------------------------------------------------------
  const isQueueActive = activeEventId !== null;

  const handleReplay = useCallback(() => {
    const event = queueRef.current[queueIdxRef.current];
    if (event) seekToEvent(event);
  }, [seekToEvent]);

  useImperativeHandle(ref, () => ({
    goPrev: handleGoPrev,
    goNext: handleGoNext,
    replay: handleReplay,
    stop: handleStop,
    playAll: handlePlayAll,
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
            const seekTo = Math.max(0, videoTime - preRollRef.current);
            clipEndRef.current = videoTime + postRollRef.current;
            video.pause();
            video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
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
    onPlaybackChange?.(canPrev, canNext, isQueueActive);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrev, canNext, isQueueActive]);

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

  function handleReorderPlaylist(newEvents: PlayByPlayEvent[]) {
    if (!activePlaylist || !onPlaylistsChange) return;
    // Re-map current-match clips to new order; cross-match clips keep their original slot
    const reorderedIds = newEvents.map((e) => e.eventId);
    let idx = 0;
    const newClips = activePlaylist.clips.map((c) => {
      if (c.matchId !== matchId) return c;
      return { matchId, eventId: reorderedIds[idx++] ?? c.eventId };
    });
    const updated = { ...activePlaylist, clips: newClips };
    setActivePlaylist(updated);
    onPlaylistsChange(playlists.map((p) => p.id === activePlaylist.id ? updated : p));
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
    const queue = pl.clips
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
    const ordered: PlaylistClip[] = filtered
      .filter((e) => selectedIds.has(e.eventId))
      .map((e) => ({ matchId, eventId: e.eventId }));
    const newPl: Playlist = {
      id: crypto.randomUUID(),
      name: newPlaylistName.trim(),
      clips: ordered,
    };
    onPlaylistsChange?.([...playlists, newPl]);
    setNewPlaylistName("");
    setSelectedIds(new Set());
  }

  function handleAddToPlaylist(anchorMatchId: string, targetPlaylist: Playlist) {
    const existingSet = new Set(targetPlaylist.clips.map((c) => `${c.matchId}:${c.eventId}`));
    const sourceEvents = activePlaylist ? sortedDisplayEvents : filtered;
    const toAdd: PlaylistClip[] = sourceEvents
      .filter((e) => selectedIds.has(e.eventId) && !existingSet.has(`${matchId}:${e.eventId}`))
      .map((e) => ({ matchId, eventId: e.eventId }));
    const updated = { ...targetPlaylist, clips: [...targetPlaylist.clips, ...toAdd] };

    if (anchorMatchId === matchId) {
      onPlaylistsChange?.(playlists.map((p) => (p.id === targetPlaylist.id ? updated : p)));
    } else {
      const anchorPlaylists = allPlaylists
        ?.filter((ap) => ap.matchId === anchorMatchId)
        .map((ap) => ap.playlist) ?? [];
      onAddToExternalPlaylist?.(
        anchorMatchId,
        anchorPlaylists.map((p) => (p.id === targetPlaylist.id ? updated : p))
      );
    }
    setSelectedIds(new Set());
    setShowAddToDropdown(false);
    setAddToSearch("");
  }

  function handleRemoveFromPlaylist() {
    if (!activePlaylist) return;
    const remaining = activePlaylist.clips.filter(
      (c) => !(c.matchId === matchId && selectedIds.has(c.eventId))
    );
    const updated: Playlist = { ...activePlaylist, clips: remaining };
    onPlaylistsChange?.(playlists.map((p) => (p.id === activePlaylist.id ? updated : p)));
    if (remaining.length === 0) {
      setActivePlaylist(null);
    } else {
      setActivePlaylist(updated);
    }
    setSelectedIds(new Set());
  }

  function handleDeletePlaylist(id: string) {
    if (activePlaylist?.id === id) {
      handleStop();
      setActivePlaylist(null);
      setSelectedIds(new Set());
    }
    onPlaylistsChange?.(playlists.filter((p) => p.id !== id));
  }

  const noSync = !syncPoint;

  return (
    <div className="space-y-4">
      {/* Saved Playlists — only shown in all-clips mode */}
      {!activePlaylist && (playlists.length > 0 || onPlaylistsChange) && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground/80">
              Saved Playlists
            </h3>
          </div>
          {playlists.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No playlists yet. Select clips below to create one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {playlists.map((pl) => (
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
                      {pl.clips.length} clip{pl.clips.length !== 1 ? "s" : ""}
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
                    {onPlaylistsChange && (
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
      {selectedIds.size > 0 && onPlaylistsChange && (
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
                {(playlists.length > 1 || (allPlaylists && allPlaylists.length > 0)) && (
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
                      allPlaylists={allPlaylists}
                      matchId={matchId}
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
                <Button
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim()}
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  Create playlist
                </Button>
                {(playlists.length > 0 || (allPlaylists && allPlaylists.length > 0)) && (
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
                      allPlaylists={allPlaylists}
                      matchId={matchId}
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
                {onPlaylistsChange && (
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
                {sortedDisplayEvents.map((event) => (
                  <DraggableClipsRow
                    key={event.eventId}
                    event={event}
                    isActive={event.eventId === activeEventId}
                    isSelected={selectedIds.has(event.eventId)}
                    jerseyNo={jerseyNumber(event)}
                    onRowClick={() => handleRowClick(event)}
                    onToggleSelect={onPlaylistsChange ? (ev) => toggleSelect(event.eventId, ev) : undefined}
                    showCheckbox={!!onPlaylistsChange}
                  />
                ))}
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
                      {onPlaylistsChange && (
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
                        Q{event.period}
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
