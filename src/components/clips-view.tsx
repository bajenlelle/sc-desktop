"use client";

import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ListPlus, Play, SkipForward, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Playlist, PlayByPlayEvent, SyncPoint } from "@/types/match";

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
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
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

function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

const EVENT_TYPE_OPTIONS = [
  { value: "", label: "All types" },
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

function matchesTypeFilter(e: PlayByPlayEvent, filter: string): boolean {
  if (!filter) return true;
  const [type, outcome] = filter.split("-");
  if (e.type !== type) return false;
  if (outcome === "made") return e.isSuccessful === 1;
  if (outcome === "miss") return e.isSuccessful === 0;
  if (type === "rebound") return e.type === "rebound";
  if (type === "foul") return e.type === "foul" || e.type === "foulon";
  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

interface ClipsViewProps {
  events: PlayByPlayEvent[];
  syncPoint: SyncPoint | undefined;
  videoRef: RefObject<HTMLVideoElement | null>;
  homeTeamName: string;
  awayTeamName: string;
  homeRoster?: RosterEntry[];
  awayRoster?: RosterEntry[];
  playlists?: Playlist[];
  onPlaylistsChange?: (p: Playlist[]) => void;
  videoAvailable?: boolean;
}

export function ClipsView({
  events,
  syncPoint,
  videoRef,
  homeTeamName,
  awayTeamName,
  homeRoster = [],
  awayRoster = [],
  playlists = [],
  onPlaylistsChange,
  videoAvailable = false,
}: ClipsViewProps) {
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

  const [filterType, setFilterType] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterPlayer, setFilterPlayer] = useState("");
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

  // Active playlist (playlist view mode)
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);

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
    if (!matchesTypeFilter(e, filterType)) return false;
    if (filterTeam && e.eventTeam?.teamName !== filterTeam) return false;
    if (filterPlayer && playerName(e) !== filterPlayer) return false;
    return true;
  });

  // Resolve playlist events in order
  const playlistEvents = useMemo(() => {
    if (!activePlaylist) return null;
    return activePlaylist.eventIds
      .map((id) => eventMap.get(id))
      .filter((e): e is PlayByPlayEvent => e !== undefined);
  }, [activePlaylist, eventMap]);

  // Events shown in the table — playlist view overrides filtered view
  const displayEvents = activePlaylist ? (playlistEvents ?? []) : filtered;

  // Clear selection when filters change (all-clips mode only)
  useEffect(() => {
    if (!activePlaylist) setSelectedIds(new Set());
  }, [filterType, filterTeam, filterPlayer, activePlaylist]);

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
      video.currentTime = seekTo;
      video.play().catch(() => {});
    },
    [videoRef]
  );

  // ---------------------------------------------------------------------------
  // Seamless auto-advance via timeupdate (no setTimeout, no pause between clips)
  // videoAvailable in deps ensures the effect re-runs once the video element
  // is mounted (videoRef.current was null on initial mount).
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
            video.currentTime = seekTo;
            video.play().catch(() => {});
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
  }, [videoRef, videoAvailable]); // videoAvailable flip re-runs when video element appears

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
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(event.eventId);
    seekToEvent(event);
  }

  function handlePlayAll() {
    startQueue([...filtered]);
  }

  function handleStop() {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    clipEndRef.current = undefined;
    videoRef.current?.pause();
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
    const queue = pl.eventIds
      .map((id) => eventMap.get(id))
      .filter((e): e is PlayByPlayEvent => e !== undefined);
    // Reset queue state before starting so stop→start is clean
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
    displayEvents.length > 0 && displayEvents.every((e) => selectedIds.has(e.eventId));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayEvents.map((e) => e.eventId)));
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
    const ordered = filtered
      .filter((e) => selectedIds.has(e.eventId))
      .map((e) => e.eventId);
    const newPl: Playlist = {
      id: crypto.randomUUID(),
      name: newPlaylistName.trim(),
      eventIds: ordered,
    };
    onPlaylistsChange?.([...playlists, newPl]);
    setNewPlaylistName("");
    setSelectedIds(new Set());
  }

  function handleAddToPlaylist(playlist: Playlist) {
    const existingSet = new Set(playlist.eventIds);
    const toAdd = filtered
      .filter((e) => selectedIds.has(e.eventId) && !existingSet.has(e.eventId))
      .map((e) => e.eventId);
    const updated = { ...playlist, eventIds: [...playlist.eventIds, ...toAdd] };
    onPlaylistsChange?.(playlists.map((p) => (p.id === playlist.id ? updated : p)));
    setSelectedIds(new Set());
    setShowAddToDropdown(false);
  }

  function handleRemoveFromPlaylist() {
    if (!activePlaylist) return;
    const remaining = activePlaylist.eventIds.filter((id) => !selectedIds.has(id));
    const updated: Playlist = { ...activePlaylist, eventIds: remaining };
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
        <div className="rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Saved Playlists
            </h3>
          </div>
          {playlists.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500">
              No playlists yet. Select clips below to create one.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => handleOpenPlaylist(pl)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {pl.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {pl.eventIds.length} clip{pl.eventIds.length !== 1 ? "s" : ""}
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
                        className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
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

      {/* ------------------------------------------------------------------ */}
      {/* Playlist mode: breadcrumb header + slim controls                    */}
      {/* All-clips mode: filter controls                                     */}
      {/* ------------------------------------------------------------------ */}
      {activePlaylist ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5 dark:border-indigo-900 dark:bg-indigo-950/40">
          {/* Left: back + playlist name */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs text-indigo-600 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-900"
              onClick={handleExitPlaylistView}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Clips
            </Button>
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              {activePlaylist.name}
            </span>
            <span className="text-xs text-indigo-500 dark:text-indigo-400">
              {playlistEvents?.length ?? 0} clip{(playlistEvents?.length ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Right: pre/post roll + play/stop */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-indigo-500 dark:text-indigo-400">Pre</label>
              <Input
                type="number"
                min={0}
                max={30}
                className="h-7 w-16 text-xs"
                value={preRoll}
                onChange={(e) => setPreRoll(Number(e.target.value))}
              />
              <label className="text-xs text-indigo-500 dark:text-indigo-400">Post</label>
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
                className="h-8 gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={() => playlistEvents && startQueue([...playlistEvents])}
                disabled={!playlistEvents || playlistEvents.length === 0 || noSync}
              >
                <SkipForward className="h-3.5 w-3.5" />
                Play Playlist
              </Button>
            )}
          </div>
        </div>
      ) : (
        /* All-clips mode: filter + play-all controls */
        <div className="flex flex-wrap items-end gap-3">
          {/* Type filter */}
          <div className="space-y-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Event type</label>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              {EVENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Team filter */}
          {teams.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">Team</label>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={filterTeam}
                onChange={(e) => setFilterTeam(e.target.value)}
              >
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Player filter */}
          {players.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">Player</label>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={filterPlayer}
                onChange={(e) => setFilterPlayer(e.target.value)}
              >
                <option value="">All players</option>
                {players.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Pre/post roll */}
          <div className="space-y-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Pre-roll (s)</label>
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
            <label className="text-xs text-slate-500 dark:text-slate-400">Post-roll (s)</label>
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
                className="gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={handlePlayAll}
                disabled={filtered.length === 0 || noSync}
              >
                <SkipForward className="h-3.5 w-3.5" />
                Play All ({filtered.length})
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
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-indigo-50 px-4 py-2.5 dark:bg-indigo-950/40">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} clip{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            {activePlaylist ? (
              /* Playlist mode: remove selected clips */
              <Button
                size="sm"
                className="h-7 gap-1 bg-red-600 px-2 text-xs text-white hover:bg-red-700"
                onClick={handleRemoveFromPlaylist}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove from playlist
              </Button>
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
                  className="h-7 gap-1 bg-indigo-600 px-2 text-xs text-white hover:bg-indigo-700"
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim()}
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  Create playlist
                </Button>
                {playlists.length > 0 && (
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setShowAddToDropdown((v) => !v)}
                    >
                      Add to playlist
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {showAddToDropdown && (
                      <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        {playlists.map((pl) => (
                          <button
                            key={pl.id}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                            onClick={() => handleAddToPlaylist(pl)}
                          >
                            <span className="flex-1 truncate">{pl.name}</span>
                            <span className="text-xs text-slate-400">{pl.eventIds.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Event list */}
      {displayEvents.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          {activePlaylist ? "This playlist has no clips." : "No events match the current filters."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                {onPlaylistsChange && (
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600"
                    />
                  </th>
                )}
                <th className="px-4 py-2.5 text-left">Period</th>
                <th className="px-4 py-2.5 text-left">Clock</th>
                <th className="px-4 py-2.5 text-left">Event</th>
                <th className="px-4 py-2.5 text-left">Player</th>
                <th className="px-4 py-2.5 text-left">Team</th>
                <th className="px-4 py-2.5 text-left">Video time</th>
                <th className="px-4 py-2.5 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {displayEvents.map((event, idx) => {
                const vt = syncPoint ? computeVideoTime(event, syncPoint) : null;
                const isActive = event.eventId === activeEventId;
                const isSelected = selectedIds.has(event.eventId);
                const pName = playerName(event);
                const pNo = jerseyNumber(event);
                return (
                  <tr
                    key={`${event.eventId}-${idx}`}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      isActive ? "bg-indigo-50 dark:bg-indigo-950/40" : ""
                    } ${isSelected && !isActive ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""}`}
                    onClick={() => handleRowClick(event)}
                  >
                    {onPlaylistsChange && (
                      <td className="w-8 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          onClick={(ev) => toggleSelect(event.eventId, ev)}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      Q{event.period}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                      {formatGameClock(event.gameClockTime)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eventBadgeColor(event)}`}
                      >
                        {eventLabel(event)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                      {pNo !== null && (
                        <span className="mr-1.5 font-mono text-xs text-slate-400">
                          #{pNo}
                        </span>
                      )}
                      {pName}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {event.eventTeam?.teamName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {vt !== null
                        ? `${Math.floor(vt / 60)}:${String(Math.floor(vt % 60)).padStart(2, "0")}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Play
                        className={`h-3.5 w-3.5 ${
                          isActive
                            ? "text-indigo-500"
                            : "text-slate-300 dark:text-slate-600"
                        }`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Fallback info when team names from events are empty */}
      {!activePlaylist && teams.length === 0 && (homeTeamName || awayTeamName) && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Teams: {homeTeamName} vs {awayTeamName}
        </p>
      )}
    </div>
  );
}
