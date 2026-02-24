import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  ListVideo,
  Play,
  Search,
  SkipForward,
  Square,
  X,
} from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoPlayer } from "@/components/video-player";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { listMatches, updatePlaylists } from "@/lib/matches-db";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import type { Playlist, PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

// ---------------------------------------------------------------------------
// Helpers (mirrors clips-view.tsx)
// ---------------------------------------------------------------------------

function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClockSort = "none" | "asc" | "desc";
type PlaylistEntry = { playlist: Playlist; match: StoredMatch };

// ---------------------------------------------------------------------------
// DraggableRow (used only in manual sort mode)
// ---------------------------------------------------------------------------

function DraggableRow({
  event,
  isActive,
  onClick,
}: {
  event: PlayByPlayEvent;
  isActive: boolean;
  onClick: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="tr"
      value={event}
      dragListener={false}
      dragControls={controls}
      className={`group cursor-pointer transition-colors hover:bg-muted/50 ${
        isActive ? "bg-primary/10" : ""
      }`}
      onClick={onClick}
    >
      <td className="w-8 px-2 py-2.5">
        <span
          className="flex cursor-grab items-center justify-center opacity-0 group-hover:opacity-60 transition-opacity active:cursor-grabbing"
          onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </td>
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
      <td className="px-4 py-2.5 text-foreground/80">{playerName(event)}</td>
      <td className="px-4 py-2.5 text-muted-foreground">
        {event.eventTeam?.teamName ?? "—"}
      </td>
      <td className="px-4 py-2.5">
        <Play
          className={`h-3.5 w-3.5 ${
            isActive ? "text-primary fill-primary" : "text-muted-foreground/30"
          }`}
        />
      </td>
    </Reorder.Item>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlaylistsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PlaylistEntry | null>(null);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [preRoll, setPreRoll] = useState(10);
  const [postRoll, setPostRoll] = useState(3);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [clockSort, setClockSort] = useState<ClockSort>("none");
  const [search, setSearch] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<PlayByPlayEvent[]>([]);
  const queueIdxRef = useRef<number>(0);
  const clipEndRef = useRef<number | undefined>(undefined);
  const preRollRef = useRef(preRoll);
  const postRollRef = useRef(postRoll);
  const syncPointRef = useRef<SyncPoint | undefined>(undefined);

  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  useEffect(() => {
    syncPointRef.current = selected?.match.syncPoint;
  }, [selected]);

  // Load all matches on mount; restore playlist selection if returning from match detail
  useEffect(() => {
    const restore = (location.state as { restore?: { matchId: string; playlistId: string } } | null)?.restore;
    listMatches()
      .then((loaded) => {
        setMatches(loaded);
        if (restore) {
          const match = loaded.find((m) => m.id === restore.matchId);
          const playlist = match?.playlists?.find((p) => p.id === restore.playlistId);
          if (match && playlist) {
            setSelected({ match, playlist });
            setExpanded((prev) => new Set([...prev, match.id]));
          }
        }
      })
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap video source whenever the selected match changes
  useEffect(() => {
    handleStop();
    if (!selected?.match.videoUrl) {
      setLocalVideoUrl(null);
      return;
    }
    const url = selected.match.videoUrl;
    setLocalVideoUrl(isLocalPath(url) ? streamFileSrc(url) : url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.match.id]);

  // Derived: matches that have at least one non-empty playlist
  const grouped = useMemo(() =>
    matches
      .filter((m) => (m.playlists ?? []).some((p) => p.eventIds.length > 0))
      .map((m) => ({
        match: m,
        playlists: (m.playlists ?? []).filter((p) => p.eventIds.length > 0),
      })),
    [matches]
  );

  const totalPlaylists = grouped.reduce((n, g) => n + g.playlists.length, 0);

  const filteredGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map(({ match, playlists }) => {
        const matchHits = match.title.toLowerCase().includes(q);
        const filteredPlaylists = matchHits
          ? playlists
          : playlists.filter((p) => p.name.toLowerCase().includes(q));
        return { match, playlists: filteredPlaylists };
      })
      .filter(({ playlists }) => playlists.length > 0);
  }, [grouped, search]);

  // Reset clock sort when the selected playlist changes
  useEffect(() => { setClockSort("none"); }, [selected?.playlist.id]);

  // Resolve playlist events in display order
  const playlistEvents = useMemo(() => {
    if (!selected) return [];
    const eventMap = new Map(selected.match.events.map((e) => [e.eventId, e]));
    return selected.playlist.eventIds
      .map((id) => eventMap.get(id))
      .filter((e): e is PlayByPlayEvent => e !== undefined);
  }, [selected]);

  const sortedEvents = useMemo(() => {
    if (clockSort === "none") return playlistEvents;
    return [...playlistEvents].sort((a, b) => {
      const aT = parseGameClock(formatGameClock(a.gameClockTime));
      const bT = parseGameClock(formatGameClock(b.gameClockTime));
      // clock counts DOWN — "asc" = chronological = high clock first
      return clockSort === "asc" ? bT - aT : aT - bT;
    });
  }, [playlistEvents, clockSort]);

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  const handleStop = useCallback(() => {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    clipEndRef.current = undefined;
    videoRef.current?.pause();
  }, []);

  const seekToEvent = useCallback((event: PlayByPlayEvent) => {
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
  }, []);

  // Auto-advance via timeupdate — re-binds when video source changes
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
  }, [localVideoUrl]);

  function startQueue(queue: PlayByPlayEvent[]) {
    if (queue.length === 0 || !syncPointRef.current) return;
    queueRef.current = queue;
    queueIdxRef.current = 0;
    setIsPlaying(true);
    setActiveEventId(queue[0].eventId);
    seekToEvent(queue[0]);
  }

  function handleRowClick(event: PlayByPlayEvent) {
    const idx = sortedEvents.findIndex((e) => e.eventId === event.eventId);
    const queue = idx >= 0 ? sortedEvents.slice(idx) : [event];
    startQueue(queue);
  }

  async function handleReorder(newEvents: PlayByPlayEvent[]) {
    if (!selected) return;
    const newIds = newEvents.map((e) => e.eventId);
    const updatedPlaylist = { ...selected.playlist, eventIds: newIds };
    const updatedPlaylists = (selected.match.playlists ?? []).map((p) =>
      p.id === selected.playlist.id ? updatedPlaylist : p
    );
    setMatches((prev) =>
      prev.map((m) => m.id === selected.match.id ? { ...m, playlists: updatedPlaylists } : m)
    );
    setSelected({ ...selected, playlist: updatedPlaylist });
    await updatePlaylists(selected.match.id, updatedPlaylists);
  }

  // ---------------------------------------------------------------------------
  // Sidebar helpers
  // ---------------------------------------------------------------------------

  function toggleCollapse(matchId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  }

  function selectPlaylist(entry: PlaylistEntry) {
    if (selected?.playlist.id === entry.playlist.id && selected.match.id === entry.match.id) return;
    setSelected(entry);
  }

  const noSync = selected !== null && !selected.match.syncPoint;
  const noVideo = selected !== null && !selected.match.videoUrl;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL — playlist sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <ListVideo className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">
              Playlists
            </span>
            {totalPlaylists > 0 && (
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {totalPlaylists}
              </span>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search sessions or playlists…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-8 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <ListVideo className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No playlists yet</p>
            <p className="text-xs text-muted-foreground/70">
              Open a session and create playlists from the Clips tab.
            </p>
            <Link to="/matches" className="mt-2">
              <Button size="sm" variant="outline" className="text-xs">
                Go to Sessions
              </Button>
            </Link>
          </div>
        ) : filteredGrouped.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Search className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No matches for "{search}"</p>
          </div>
        ) : (
          <div className="py-2">
            {filteredGrouped.map(({ match, playlists }) => {
              const isOpen = search.trim() ? true : expanded.has(match.id);
              return (
                <div key={match.id} className="mb-2">
                  {/* Match group header */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left bg-muted/50 hover:bg-muted transition-colors"
                    onClick={() => toggleCollapse(match.id)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground/80">
                        {match.title}
                      </p>
                      {match.date && (
                        <p className="truncate text-xs text-muted-foreground">
                          {new Date(match.date).toLocaleDateString("sv-SE")}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Team color bar */}
                  <div className="flex h-[3px] w-full overflow-hidden">
                    <div
                      className="h-full flex-1"
                      style={{ backgroundColor: match.homeTeam.color || "#6366f1" }}
                    />
                    <div
                      className="h-full flex-1"
                      style={{ backgroundColor: match.awayTeam.color || "#94a3b8" }}
                    />
                  </div>

                  {/* Playlist rows */}
                  {isOpen && (
                    <div className="pb-1">
                      {playlists.map((pl) => {
                        const isActive =
                          selected?.playlist.id === pl.id && selected.match.id === match.id;
                        return (
                          <button
                            key={pl.id}
                            type="button"
                            className={`flex w-full items-center justify-between border-l-2 pl-8 pr-4 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                              isActive
                                ? "border-l-primary bg-primary/10"
                                : "border-l-border hover:border-l-border/80"
                            }`}
                            onClick={() => selectPlaylist({ playlist: pl, match })}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <ListVideo className={`h-3 w-3 shrink-0 ${
                                isActive ? "text-primary" : "text-muted-foreground"
                              }`} />
                              <span
                                className={`text-sm truncate ${
                                  isActive
                                    ? "font-medium text-primary"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {pl.name}
                              </span>
                            </div>
                            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                              {pl.eventIds.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RIGHT PANEL — detail */}
      <div className="flex flex-1 flex-col overflow-hidden bg-background">
        {selected === null ? (
          /* Empty state */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
            <ListVideo className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              Select a playlist
            </p>
            <p className="text-sm text-muted-foreground/70">
              Choose a playlist from the left panel to watch its clips here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5 h-full">
            {/* Match badge + open link */}
            <div className="flex items-center justify-between flex-none">
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: selected.match.homeTeam.color || "#6366f1" }}
                  />
                  <span className="text-xs text-muted-foreground truncate">
                    {selected.match.title}
                  </span>
                </div>
                <span className="text-base font-semibold text-foreground truncate">
                  {selected.playlist.name}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => navigate(`/matches/${selected.match.id}`, {
                  state: { from: "/playlists", matchId: selected.match.id, playlistId: selected.playlist.id },
                })}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open Session
              </Button>
            </div>

            {/* Side-by-side: controls + table on left, video on right */}
            <ResizablePanelGroup direction="horizontal" autoSaveId="playlists-split" className="min-h-0 flex-1">
              <ResizablePanel defaultSize={45} minSize={20}>
              {/* LEFT: playback controls + clip table */}
              <div className="flex h-full flex-col gap-3 overflow-y-auto pr-3">
                {/* No sync warning */}
                {noSync && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                    No sync point — set one in the session to enable playback controls.
                  </div>
                )}

                {/* Playback controls */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground">Pre</label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      className="h-7 w-16 text-xs"
                      value={preRoll}
                      onChange={(e) => setPreRoll(Number(e.target.value))}
                    />
                    <label className="text-xs text-muted-foreground">Post</label>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      className="h-7 w-16 text-xs"
                      value={postRoll}
                      onChange={(e) => setPostRoll(Number(e.target.value))}
                    />
                  </div>
                  <div className="ml-auto">
                    {isPlaying ? (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleStop}>
                        <Square className="h-3.5 w-3.5" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => startQueue([...sortedEvents])}
                        disabled={sortedEvents.length === 0 || noSync || noVideo}
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                        Play Playlist
                      </Button>
                    )}
                  </div>
                </div>

                {/* Clip table */}
                {sortedEvents.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    This playlist has no clips.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-muted/80 text-xs font-medium text-muted-foreground">
                        <tr>
                          <th className="w-8" />
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
                      <Reorder.Group
                        as="tbody"
                        axis="y"
                        values={sortedEvents}
                        onReorder={handleReorder}
                        className="divide-y divide-border bg-card"
                      >
                        {sortedEvents.map((event) => (
                          <DraggableRow
                            key={event.eventId}
                            event={event}
                            isActive={event.eventId === activeEventId}
                            onClick={() => handleRowClick(event)}
                          />
                        ))}
                      </Reorder.Group>
                    </table>
                  </div>
                )}
              </div>
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel defaultSize={55} minSize={20}>
              {/* RIGHT: video */}
              <div className="flex h-full flex-col gap-2 pl-3 min-w-0">
                {localVideoUrl ? (
                  <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                ) : (
                  <div className="space-y-2">
                    <VideoPlaceholder />
                    {noVideo && (
                      <p className="text-center text-xs text-muted-foreground">
                        No video linked. Add one in the session.
                      </p>
                    )}
                  </div>
                )}
              </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}
      </div>
    </div>
  );
}
