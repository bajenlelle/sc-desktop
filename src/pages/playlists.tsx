import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDown,
  FolderPlus,
  GripVertical,
  ListPlus,
  ListVideo,
  Loader2,
  Pencil,
  Play,
  Search,
  SkipForward,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoPlayer } from "@/components/video-player";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { VideoClipControls } from "@/components/video-clip-controls";
import { listMatches, updatePlaylists, listFolders, createFolder, updateFolder, deleteFolder } from "@/lib/matches-db";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { exportPlaylist, type ExportItem } from "@/lib/export";
import type { Playlist, PlaylistFolder, PlaylistClip, PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

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
type QueueItem = { event: PlayByPlayEvent; matchId: string };

// ---------------------------------------------------------------------------
// DraggableRow (used only in manual sort mode)
// ---------------------------------------------------------------------------

function DraggableRow({
  item,
  isActive,
  isMultiMatch,
  matchTitle,
  preOffset,
  postOffset,
  onClick,
}: {
  item: QueueItem;
  isActive: boolean;
  isMultiMatch: boolean;
  matchTitle?: string;
  preOffset: number;
  postOffset: number;
  onClick: () => void;
}) {
  const controls = useDragControls();
  const { event } = item;
  return (
    <Reorder.Item
      as="tr"
      value={item}
      dragListener={false}
      dragControls={controls}
      data-event-id={event.eventId}
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
      {isMultiMatch && (
        <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[120px]">
          {matchTitle ?? "—"}
        </td>
      )}
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
        <div className="flex items-center gap-1">
          <Play
            className={`h-3.5 w-3.5 ${
              isActive ? "text-primary fill-primary" : "text-muted-foreground/30"
            }`}
          />
          {(preOffset !== 0 || postOffset !== 0) && (
            <span
              className="text-[10px] font-medium text-orange-400"
              title={`Pre ${preOffset >= 0 ? "+" : ""}${preOffset}s / Post ${postOffset >= 0 ? "+" : ""}${postOffset}s`}
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
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(true);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [pendingNewFolderId, setPendingNewFolderId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [editingPlaylistKey, setEditingPlaylistKey] = useState<string | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState("");
  // New Playlist dialog
  const [newPlDialog, setNewPlDialog] = useState(false);
  const [newPlStep, setNewPlStep] = useState<1 | 2>(1);
  const [newPlName, setNewPlName] = useState("");
  const [newPlFolderId, setNewPlFolderId] = useState("");
  const [newPlMatchId, setNewPlMatchId] = useState("");
  const [newPlSaving, setNewPlSaving] = useState(false);
  const [clockSort, setClockSort] = useState<ClockSort>("none");
  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const queueIdxRef = useRef<number>(0);
  const clipEndRef = useRef<number | undefined>(undefined);
  const pendingSeekRef = useRef<{ seekTo: number; clipEnd: number } | null>(null);
  const preRollRef = useRef(preRoll);
  const postRollRef = useRef(postRoll);
  const activeMatchIdRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);

  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  useEffect(() => { activeMatchIdRef.current = activeMatchId; }, [activeMatchId]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Load all matches on mount; restore playlist selection if returning from match detail
  useEffect(() => {
    const restore = (location.state as { restore?: { matchId: string; playlistId: string } } | null)?.restore;
    Promise.all([listMatches(), listFolders()])
      .then(([loaded, loadedFolders]) => {
        setMatches(loaded);
        const sorted = [...loadedFolders].sort((a, b) => a.sortOrder - b.sortOrder);
        setFolders(sorted);
        setExpandedFolders(new Set(sorted.map((f) => f.id)));
        if (restore) {
          const match = loaded.find((m) => m.id === restore.matchId);
          const playlist = match?.playlists?.find((p) => p.id === restore.playlistId);
          if (match && playlist) {
            setSelected({ match, playlist });
            if (playlist.folderId) {
              setExpandedFolders((prev) => new Set([...prev, playlist.folderId!]));
            } else {
              setUncategorizedExpanded(true);
            }
          }
        }
      })
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build match lookup for cross-match event resolution
  const matchLookup = useMemo(
    () => new Map(matches.map((m) => [m.id, m])),
    [matches]
  );
  const matchLookupRef = useRef(matchLookup);
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  // Initialize activeMatchId when the selected playlist changes; also stop playback
  useEffect(() => {
    handleStop();
    setActiveMatchId(selected?.match.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.match.id]);

  // Swap video source whenever activeMatchId changes
  useEffect(() => {
    if (!activeMatchId) { setLocalVideoUrl(null); return; }
    const m = matchLookupRef.current.get(activeMatchId);
    if (!m?.videoUrl) { setLocalVideoUrl(null); return; }
    const url = m.videoUrl;
    setLocalVideoUrl(isLocalPath(url) ? streamFileSrc(url) : url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchId]);

  // Apply any pending cross-match seek once the new video is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !localVideoUrl || !pendingSeekRef.current) return;
    const pending = pendingSeekRef.current;
    function handleCanPlay() {
      if (!pendingSeekRef.current) return;
      const { seekTo, clipEnd } = pendingSeekRef.current;
      pendingSeekRef.current = null;
      clipEndRef.current = clipEnd;
      video!.currentTime = seekTo;
      video!.addEventListener("seeked", () => video!.play().catch(() => {}), { once: true });
    }
    video.addEventListener("canplay", handleCanPlay, { once: true });
    return () => video.removeEventListener("canplay", handleCanPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localVideoUrl]);

  // Derived: flat list of all non-empty playlists across all matches
  const allPlaylists = useMemo(() =>
    matches.flatMap((m) =>
      (m.playlists ?? [])
        .filter((p) => p.clips.length > 0)
        .map((p) => ({ playlist: p, match: m }))
    ),
    [matches]
  );

  const totalPlaylists = allPlaylists.length;

  // Filter by search (matches playlist name, folder name, or match title)
  const filteredPlaylists = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allPlaylists;
    return allPlaylists.filter(({ playlist, match }) => {
      if (playlist.name.toLowerCase().includes(q)) return true;
      if (playlist.folderId) {
        const folder = folders.find((f) => f.id === playlist.folderId);
        if (folder?.name.toLowerCase().includes(q)) return true;
      }
      if (match.title.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [allPlaylists, search, folders]);

  // Group filtered playlists by folderId (null = Uncategorized)
  const byFolder = useMemo(() => {
    const map = new Map<string | null, typeof allPlaylists>();
    for (const item of filteredPlaylists) {
      const key = item.playlist.folderId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [filteredPlaylists]);

  // Reset clock sort when the selected playlist changes
  useEffect(() => { setClockSort("none"); }, [selected?.playlist.id]);

  // Resolve playlist events in display order (cross-match aware)
  const playlistEvents = useMemo((): QueueItem[] => {
    if (!selected) return [];
    return selected.playlist.clips
      .map((clip) => {
        const match = matchLookup.get(clip.matchId);
        const event = match?.events.find((e) => e.eventId === clip.eventId);
        return event ? { event, matchId: clip.matchId } : null;
      })
      .filter((x): x is QueueItem => x !== null);
  }, [selected, matchLookup]);

  const isMultiMatch = useMemo(
    () => new Set(selected?.playlist.clips.map((c) => c.matchId)).size > 1,
    [selected]
  );

  const sortedEvents = useMemo(() => {
    if (clockSort === "none") return playlistEvents;
    return [...playlistEvents].sort((a, b) => {
      const aT = parseGameClock(formatGameClock(a.event.gameClockTime));
      const bT = parseGameClock(formatGameClock(b.event.gameClockTime));
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
    pendingSeekRef.current = null;
    videoRef.current?.pause();
  }, []);

  function adjustActiveClip(preDelta: number, postDelta: number) {
    if (!selected || activeEventId === null) return;
    const matchId = activeMatchIdRef.current ?? selected.match.id;
    const existingClip = selected.playlist.clips.find(
      (c) => c.matchId === matchId && c.eventId === activeEventId
    );
    const newPre = Math.max(-preRollRef.current, (existingClip?.preRollOffset ?? 0) + preDelta);
    const newPost = Math.max(-postRollRef.current, (existingClip?.postRollOffset ?? 0) + postDelta);

    const newClips = selected.playlist.clips.map((c) =>
      c.matchId === matchId && c.eventId === activeEventId
        ? { ...c, preRollOffset: newPre, postRollOffset: newPost }
        : c
    );
    const updatedPlaylist = { ...selected.playlist, clips: newClips };
    const updatedPlaylists = (selected.match.playlists ?? []).map((p) =>
      p.id === selected.playlist.id ? updatedPlaylist : p
    );
    // Update state immediately
    setSelected((prev) => prev ? { ...prev, playlist: updatedPlaylist } : prev);
    setMatches((prev) =>
      prev.map((m) => m.id === selected.match.id ? { ...m, playlists: updatedPlaylists } : m)
    );
    // Also update the ref so seekToItem sees new offsets before re-render
    selectedRef.current = { ...selected, playlist: updatedPlaylist };
    // Persist (fire-and-forget)
    updatePlaylists(selected.match.id, updatedPlaylists).catch(() => {});
    // Replay with new timing immediately
    if (queueRef.current.length > 0) {
      seekToItem(queueRef.current[queueIdxRef.current], newPre, newPost);
    }
  }

  const activeClipOffsets = useMemo(() => {
    if (activeEventId === null) return { pre: 0, post: 0 };
    const matchId = activeMatchId ?? selected?.match.id;
    const clip = selected?.playlist.clips.find(
      (c) => c.matchId === matchId && c.eventId === activeEventId
    );
    return { pre: clip?.preRollOffset ?? 0, post: clip?.postRollOffset ?? 0 };
  }, [activeEventId, activeMatchId, selected]);

  function getClipOffsets(matchId: string, eventId: number) {
    const clip = selectedRef.current?.playlist.clips.find(
      (c) => c.matchId === matchId && c.eventId === eventId
    );
    return { pre: clip?.preRollOffset ?? 0, post: clip?.postRollOffset ?? 0 };
  }

  const seekToItem = useCallback((
    item: QueueItem,
    preOverride?: number,
    postOverride?: number,
  ) => {
    const sp = matchLookupRef.current.get(item.matchId)?.syncPoint;
    const video = videoRef.current;
    if (!sp || !video) return;
    const videoTime = computeVideoTime(item.event, sp);
    if (videoTime === null) return;
    const { pre, post } = getClipOffsets(item.matchId, item.event.eventId);
    const seekTo = Math.max(0, Math.min(videoTime, videoTime - preRollRef.current - (preOverride ?? pre)));
    clipEndRef.current = Math.max(videoTime, videoTime + postRollRef.current + (postOverride ?? post));
    video.pause();
    video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
    video.currentTime = seekTo;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isQueueActive = activeEventId !== null;

  const handleReplay = useCallback(() => {
    const item = queueRef.current[queueIdxRef.current];
    if (item) seekToItem(item);
  }, [seekToItem]);

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
        const nextItem = queue[nextIdx];
        setActiveEventId(nextItem.event.eventId);
        const sp = matchLookupRef.current.get(nextItem.matchId)?.syncPoint;
        if (sp) {
          const videoTime = computeVideoTime(nextItem.event, sp);
          if (videoTime !== null) {
            const { pre: nextPre, post: nextPost } = getClipOffsets(nextItem.matchId, nextItem.event.eventId);
            const seekTo = Math.max(0, videoTime - preRollRef.current - nextPre);
            const clipEnd = videoTime + postRollRef.current + nextPost;
            if (nextItem.matchId !== activeMatchIdRef.current) {
              // Cross-match: switch video source; seek happens in canplay handler
              pendingSeekRef.current = { seekTo, clipEnd };
              setActiveMatchId(nextItem.matchId);
            } else {
              clipEndRef.current = clipEnd;
              video.pause();
              video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
              video.currentTime = seekTo;
            }
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

  function startQueue(queue: QueueItem[]) {
    if (queue.length === 0) return;
    const firstItem = queue[0];
    const sp = matchLookupRef.current.get(firstItem.matchId)?.syncPoint;
    if (!sp) return;
    queueRef.current = queue;
    queueIdxRef.current = 0;
    setIsPlaying(true);
    setActiveEventId(firstItem.event.eventId);
    if (firstItem.matchId !== activeMatchIdRef.current) {
      const videoTime = computeVideoTime(firstItem.event, sp);
      if (videoTime !== null) {
        const { pre, post } = getClipOffsets(firstItem.matchId, firstItem.event.eventId);
        const seekTo = Math.max(0, videoTime - preRollRef.current - pre);
        pendingSeekRef.current = { seekTo, clipEnd: videoTime + postRollRef.current + post };
      }
      setActiveMatchId(firstItem.matchId);
    } else {
      seekToItem(firstItem);
    }
  }

  function handleRowClick(item: QueueItem) {
    const idx = sortedEvents.findIndex((i) => i.event.eventId === item.event.eventId);
    const queue = idx >= 0 ? sortedEvents.slice(idx) : [item];
    startQueue(queue);
  }

  // Arrow-key clip navigation — refs so the listener never goes stale
  const _sortedEventsRef = useRef(sortedEvents);
  _sortedEventsRef.current = sortedEvents;
  const _activeEventIdRef = useRef(activeEventId);
  _activeEventIdRef.current = activeEventId;
  const _handleRowClickRef = useRef(handleRowClick);
  _handleRowClickRef.current = handleRowClick;
  const _handleReplayRef = useRef(handleReplay);
  _handleReplayRef.current = handleReplay;

  // Prev/next based on position in the visible list (same as ↑/↓ arrow keys)
  const listPosition = activeEventId !== null
    ? sortedEvents.findIndex((i) => i.event.eventId === activeEventId)
    : -1;
  const canPrev = listPosition > 0;
  const canNext = listPosition >= 0 && listPosition < sortedEvents.length - 1;

  const handlePrev = useCallback(() => {
    const items = _sortedEventsRef.current;
    const cur = items.findIndex((i) => i.event.eventId === _activeEventIdRef.current);
    if (cur <= 0) return;
    _handleRowClickRef.current(items[cur - 1]);
  }, []);

  const handleNext = useCallback(() => {
    const items = _sortedEventsRef.current;
    const cur = items.findIndex((i) => i.event.eventId === _activeEventIdRef.current);
    if (cur === -1 || cur >= items.length - 1) return;
    _handleRowClickRef.current(items[cur + 1]);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "ArrowDown" && e.code !== "ArrowUp" && e.code !== "ArrowLeft") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      if (e.code === "ArrowLeft") { _handleReplayRef.current(); return; }
      const items = _sortedEventsRef.current;
      if (items.length === 0) return;
      const cur = items.findIndex((i) => i.event.eventId === _activeEventIdRef.current);
      const next = e.code === "ArrowDown"
        ? cur === -1 ? 0 : Math.min(cur + 1, items.length - 1)
        : cur === -1 ? items.length - 1 : Math.max(cur - 1, 0);
      if (next !== cur || cur === -1) _handleRowClickRef.current(items[next]);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll active row into view when it changes
  useEffect(() => {
    if (activeEventId === null) return;
    document.querySelector(`[data-event-id="${activeEventId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeEventId]);

  async function handleReorder(newItems: QueueItem[]) {
    if (!selected) return;
    const clipMap = new Map(
      selected.playlist.clips.map((c) => [`${c.matchId}:${c.eventId}`, c])
    );
    const newClips: PlaylistClip[] = newItems.map((item) => {
      const key = `${item.matchId}:${item.event.eventId}`;
      return clipMap.get(key) ?? { matchId: item.matchId, eventId: item.event.eventId };
    });
    const updatedPlaylist = { ...selected.playlist, clips: newClips };
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
  // Export
  // ---------------------------------------------------------------------------

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      const items = sortedEvents
        .map((item): ExportItem | null => {
          const m = matchLookup.get(item.matchId);
          if (!m?.videoUrl || !m.syncPoint) return null;
          const clip = selected?.playlist.clips.find(
            (c) => c.matchId === item.matchId && c.eventId === item.event.eventId
          );
          const exportItem: ExportItem = {
            videoPath: m.videoUrl,
            event: item.event,
            syncPoint: m.syncPoint,
          };
          if (clip?.preRollOffset !== undefined) exportItem.preRollOffset = clip.preRollOffset;
          if (clip?.postRollOffset !== undefined) exportItem.postRollOffset = clip.postRollOffset;
          return exportItem;
        })
        .filter((x): x is ExportItem => x !== null);
      await exportPlaylist(items, preRoll, postRoll, selected!.playlist.name);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsExporting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Sidebar helpers
  // ---------------------------------------------------------------------------

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectPlaylist(entry: PlaylistEntry) {
    if (selected?.playlist.id === entry.playlist.id && selected.match.id === entry.match.id) return;
    setSelected(entry);
  }

  // ---------------------------------------------------------------------------
  // Folder operations
  // ---------------------------------------------------------------------------

  function handleNewFolder() {
    const tempId = `temp-${Date.now()}`;
    setPendingNewFolderId(tempId);
    setFolders((prev) => [...prev, { id: tempId, name: "New Folder", sortOrder: 0 }]);
    setExpandedFolders((prev) => new Set([...prev, tempId]));
    setEditingFolderId(tempId);
    setEditFolderName("New Folder");
  }

  async function handleRenameFolder(id: string) {
    const name = editFolderName.trim();

    if (id === pendingNewFolderId) {
      setPendingNewFolderId(null);
      setEditingFolderId(null);
      if (!name) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); return s; });
        return;
      }
      try {
        const folder = await createFolder(name);
        setFolders((prev) => prev.map((f) => f.id === id ? folder : f));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); s.add(folder.id); return s; });
      } catch (err) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); return s; });
        console.error("Failed to create folder:", err);
        alert(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (!name) { setEditingFolderId(null); return; }
    await updateFolder(id, { name });
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name } : f));
    setEditingFolderId(null);
  }

  async function handleDeleteFolder(folderId: string) {
    // Move playlists in this folder to Uncategorized before deleting
    const affected = matches.filter((m) =>
      (m.playlists ?? []).some((p) => p.folderId === folderId)
    );
    await Promise.all(
      affected.map((m) => {
        const updated = (m.playlists ?? []).map((p) =>
          p.folderId === folderId ? { ...p, folderId: undefined } : p
        );
        return updatePlaylists(m.id, updated);
      })
    );
    setMatches((prev) => prev.map((m) => ({
      ...m,
      playlists: (m.playlists ?? []).map((p) =>
        p.folderId === folderId ? { ...p, folderId: undefined } : p
      ),
    })));
    await deleteFolder(folderId);
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
  }

  function handleDragStart(matchId: string, playlistId: string, e: React.DragEvent) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ matchId, playlistId }));
  }

  async function handleDrop(targetFolderId: string | null, e: React.DragEvent) {
    e.preventDefault();
    setDragOverFolder(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    let parsed: { matchId: string; playlistId: string };
    try { parsed = JSON.parse(raw); } catch { return; }
    const { matchId, playlistId } = parsed;
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;
    const updated = (match.playlists ?? []).map((p) =>
      p.id === playlistId ? { ...p, folderId: targetFolderId ?? undefined } : p
    );
    await updatePlaylists(matchId, updated);
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, playlists: updated } : m));
  }

  // ---------------------------------------------------------------------------
  // Playlist rename / delete
  // ---------------------------------------------------------------------------

  async function handleRenamePlaylist(matchId: string, playlistId: string) {
    const name = editPlaylistName.trim();
    setEditingPlaylistKey(null);
    if (!name) return;
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;
    const updated = (match.playlists ?? []).map((p) =>
      p.id === playlistId ? { ...p, name } : p
    );
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, playlists: updated } : m));
    if (selected?.playlist.id === playlistId && selected.match.id === matchId) {
      setSelected((prev) => prev ? { ...prev, playlist: { ...prev.playlist, name } } : prev);
    }
    await updatePlaylists(matchId, updated);
  }

  async function handleDeletePlaylist(matchId: string, playlistId: string) {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;
    const updated = (match.playlists ?? []).filter((p) => p.id !== playlistId);
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, playlists: updated } : m));
    if (selected?.playlist.id === playlistId && selected.match.id === matchId) setSelected(null);
    await updatePlaylists(matchId, updated);
  }

  // ---------------------------------------------------------------------------
  // New Playlist dialog
  // ---------------------------------------------------------------------------

  function openNewPlaylistDialog() {
    setNewPlStep(1);
    setNewPlName("");
    setNewPlFolderId("");
    setNewPlMatchId("");
    setNewPlSaving(false);
    setNewPlDialog(true);
  }

  async function handleCreateNewPlaylist() {
    if (!newPlMatchId || !newPlName.trim()) return;
    setNewPlSaving(true);
    try {
      const match = matches.find((m) => m.id === newPlMatchId);
      if (!match) return;
      const newPl: Playlist = {
        id: crypto.randomUUID(),
        name: newPlName.trim(),
        clips: [],
        folderId: newPlFolderId || undefined,
      };
      const updated = [...(match.playlists ?? []), newPl];
      await updatePlaylists(newPlMatchId, updated);
      setMatches((prev) => prev.map((m) =>
        m.id === newPlMatchId ? { ...m, playlists: updated } : m
      ));
      setNewPlDialog(false);
    } finally {
      setNewPlSaving(false);
    }
  }

  const noSync = selected !== null && !selected.match.syncPoint;
  const noVideo = selected !== null && !selected.match.videoUrl;

  const exportDisabledReason = (() => {
    if (sortedEvents.length === 0) return "Playlist is empty";
    const involvedMatchIds = new Set(sortedEvents.map((i) => i.matchId));
    for (const mId of involvedMatchIds) {
      const m = matchLookup.get(mId);
      if (!m?.videoUrl || !isLocalPath(m.videoUrl))
        return "All sessions need a local video file for export";
      if (!m.syncPoint)
        return "All sessions need a sync point for export";
    }
    return null;
  })();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL — playlist sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card overflow-y-auto" onDragOver={(e) => e.preventDefault()}>
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-card px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Playlists</span>
            {totalPlaylists > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {totalPlaylists}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                title="New Playlist"
                onClick={openNewPlaylistDialog}
              >
                <ListPlus className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                title="New Folder"
                onClick={handleNewFolder}
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search folders and playlists…"
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
                <div className="h-8 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : allPlaylists.length === 0 ? (
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
        ) : search.trim() && filteredPlaylists.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Search className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No matches for "{search}"</p>
          </div>
        ) : (
          <div className="py-2">
            {/* Named folders */}
            {folders.map((folder) => {
              const items = byFolder.get(folder.id) ?? [];
              const isExpanded = search.trim() ? true : expandedFolders.has(folder.id);
              const isEditing = editingFolderId === folder.id;
              const isDragOver = dragOverFolder === folder.id;
              return (
                <div
                  key={folder.id}
                  className={isDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary rounded-sm" : ""}
                  onDragEnter={(e) => { e.preventDefault(); setDragOverFolder(folder.id); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverFolder(folder.id); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null); }}
                  onDrop={(e) => handleDrop(folder.id, e)}
                >
                  {/* Folder header */}
                  <div
                    className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none transition-colors ${
                      isDragOver ? "" : "hover:bg-muted/50"
                    }`}
                    onClick={() => !isEditing && toggleFolder(folder.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {isEditing ? (
                      <input
                        autoFocus
                        className="flex-1 min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => handleRenameFolder(folder.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameFolder(folder.id);
                          if (e.key === "Escape") {
                            if (folder.id === pendingNewFolderId) {
                              setPendingNewFolderId(null);
                              setFolders((prev) => prev.filter((f) => f.id !== folder.id));
                              setExpandedFolders((prev) => { const s = new Set(prev); s.delete(folder.id); return s; });
                            }
                            setEditingFolderId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 truncate text-sm font-semibold text-foreground/80"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingFolderId(folder.id);
                          setEditFolderName(folder.name);
                        }}
                      >
                        {folder.name}
                      </span>
                    )}
                    {!isEditing ? (
                      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs font-semibold text-muted-foreground group-hover:hidden">{items.length}</span>
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            title="Rename folder"
                            onClick={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                            title="Delete folder"
                            onClick={() => handleDeleteFolder(folder.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">{items.length}</span>
                    )}
                  </div>

                  {/* Folder playlists */}
                  {isExpanded && (
                    <div className="pb-1">
                      {items.length === 0 ? (
                        <p className="pl-10 py-1.5 text-xs text-muted-foreground/60">
                          Empty — drag a playlist here
                        </p>
                      ) : (
                        items.map(({ playlist, match }) => {
                          const isActive = selected?.playlist.id === playlist.id && selected.match.id === match.id;
                          const editKey = `${match.id}:${playlist.id}`;
                          const isEditingThis = editingPlaylistKey === editKey;
                          return (
                            <ContextMenu key={editKey}>
                              <ContextMenuTrigger asChild>
                                <div
                                  draggable={!isEditingThis}
                                  onDragStart={(e) => handleDragStart(match.id, playlist.id, e)}
                                  onDragEnd={() => setDragOverFolder(null)}
                                  className={`group flex w-full cursor-pointer items-center justify-between border-l-2 pl-9 pr-3 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                                    isActive
                                      ? "border-l-primary bg-primary/10"
                                      : "border-l-border hover:border-l-border/80"
                                  }`}
                                  onClick={() => !isEditingThis && selectPlaylist({ playlist, match })}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                    <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab" />
                                    <ListVideo className={`h-3 w-3 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                    {isEditingThis ? (
                                      <input
                                        autoFocus
                                        className="flex-1 min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                                        value={editPlaylistName}
                                        onChange={(e) => setEditPlaylistName(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onBlur={() => handleRenamePlaylist(match.id, playlist.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleRenamePlaylist(match.id, playlist.id);
                                          if (e.key === "Escape") setEditingPlaylistKey(null);
                                        }}
                                      />
                                    ) : (
                                      <span className={`truncate text-sm ${isActive ? "font-medium text-primary" : "text-muted-foreground"}`}>
                                        {playlist.name}
                                      </span>
                                    )}
                                  </div>
                                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                                    {playlist.clips.length}
                                  </span>
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem onSelect={() => { setEditingPlaylistKey(editKey); setEditPlaylistName(playlist.name); }}>
                                  Rename
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => handleDeletePlaylist(match.id, playlist.id)}
                                >
                                  Delete
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Uncategorized */}
            {(() => {
              const items = byFolder.get(null) ?? [];
              if (items.length === 0 && folders.length > 0 && !search.trim()) return null;
              const isExpanded = search.trim() ? true : uncategorizedExpanded;
              const isDragOver = dragOverFolder === "uncategorized";
              return (
                <div>
                  <div
                    className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none transition-colors ${
                      isDragOver
                        ? "bg-primary/10 ring-1 ring-inset ring-primary"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setUncategorizedExpanded((v) => !v)}
                    onDragEnter={(e) => { e.preventDefault(); setDragOverFolder("uncategorized"); }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverFolder("uncategorized"); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null); }}
                    onDrop={(e) => handleDrop(null, e)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                      Uncategorized
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  {isExpanded && (
                    <div className="pb-1">
                      {items.map(({ playlist, match }) => {
                        const isActive = selected?.playlist.id === playlist.id && selected.match.id === match.id;
                        const editKey = `${match.id}:${playlist.id}`;
                        const isEditingThis = editingPlaylistKey === editKey;
                        return (
                          <ContextMenu key={editKey}>
                            <ContextMenuTrigger asChild>
                              <div
                                draggable={!isEditingThis}
                                onDragStart={(e) => handleDragStart(match.id, playlist.id, e)}
                                onDragEnd={() => setDragOverFolder(null)}
                                className={`group flex w-full cursor-pointer items-center justify-between border-l-2 pl-8 pr-3 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                                  isActive
                                    ? "border-l-primary bg-primary/10"
                                    : "border-l-border hover:border-l-border/80"
                                }`}
                                onClick={() => !isEditingThis && selectPlaylist({ playlist, match })}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                  <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab" />
                                  <ListVideo className={`h-3 w-3 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                  {isEditingThis ? (
                                    <input
                                      autoFocus
                                      className="flex-1 min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                                      value={editPlaylistName}
                                      onChange={(e) => setEditPlaylistName(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onBlur={() => handleRenamePlaylist(match.id, playlist.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRenamePlaylist(match.id, playlist.id);
                                        if (e.key === "Escape") setEditingPlaylistKey(null);
                                      }}
                                    />
                                  ) : (
                                    <span className={`truncate text-sm ${isActive ? "font-medium text-primary" : "text-muted-foreground"}`}>
                                      {playlist.name}
                                    </span>
                                  )}
                                </div>
                                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                                  {playlist.clips.length}
                                </span>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onSelect={() => { setEditingPlaylistKey(editKey); setEditPlaylistName(playlist.name); }}>
                                Rename
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => handleDeletePlaylist(match.id, playlist.id)}
                              >
                                Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
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
              <div className="flex h-full flex-col gap-3 overflow-hidden pr-3">
                {/* Fixed: warnings + playback controls */}
                <div className="flex shrink-0 flex-col gap-3">
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
                  <div className="ml-auto flex items-center gap-2">
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
                        disabled={sortedEvents.length === 0 || noSync}
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
                        onClick={handleExport}
                        disabled={!!exportDisabledReason}
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
                </div>{/* end fixed controls */}

                {/* Scrollable clip table */}
                <div className="min-h-0 flex-1 overflow-y-auto">
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
                          {isMultiMatch && <th className="px-4 py-2.5 text-left">Match</th>}
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
                        {sortedEvents.map((item) => {
                          const clip = selected?.playlist.clips.find(
                            (c) => c.matchId === item.matchId && c.eventId === item.event.eventId
                          );
                          return (
                            <DraggableRow
                              key={`${item.matchId}:${item.event.eventId}`}
                              item={item}
                              isActive={item.event.eventId === activeEventId}
                              isMultiMatch={isMultiMatch}
                              matchTitle={matchLookup.get(item.matchId)?.title}
                              preOffset={clip?.preRollOffset ?? 0}
                              postOffset={clip?.postRollOffset ?? 0}
                              onClick={() => handleRowClick(item)}
                            />
                          );
                        })}
                      </Reorder.Group>
                    </table>
                  </div>
                )}
                </div>{/* end scrollable clip table */}
              </div>
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel defaultSize={55} minSize={20}>
              {/* RIGHT: video */}
              <div className="flex h-full flex-col gap-2 pl-3 min-w-0">
                {localVideoUrl ? (
                  <>
                    <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                    <VideoClipControls
                      videoRef={videoRef}
                      canPrev={canPrev}
                      canNext={canNext}
                      isQueueActive={isQueueActive}
                      onPrev={handlePrev}
                      onNext={handleNext}
                      onReplay={handleReplay}
                      onStop={handleStop}
                      onPlayAll={() => startQueue([...sortedEvents])}
                      activeClipPreOffset={activeClipOffsets.pre}
                      activeClipPostOffset={activeClipOffsets.post}
                      onPreOffsetChange={(delta) => adjustActiveClip(delta, 0)}
                      onPostOffsetChange={(delta) => adjustActiveClip(0, delta)}
                    />
                  </>
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

    {/* New Playlist Dialog */}

    <Dialog open={newPlDialog} onOpenChange={(open) => { if (!open) setNewPlDialog(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {newPlStep === 1 ? "New Playlist" : "Choose a session"}
          </DialogTitle>
        </DialogHeader>

        {newPlStep === 1 ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input
                autoFocus
                placeholder="e.g. Team X 2pt Makes"
                value={newPlName}
                onChange={(e) => setNewPlName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newPlName.trim()) setNewPlStep(2); }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Folder</label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={newPlFolderId}
                onChange={(e) => setNewPlFolderId(e.target.value)}
              >
                <option value="">No folder (Uncategorized)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Choose which session stores this playlist's clips.
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border border-border">
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setNewPlMatchId(m.id)}
                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors ${
                    newPlMatchId === m.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-foreground/80"
                  }`}
                >
                  <div className="font-medium">{m.title}</div>
                  {m.date && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(m.date).toLocaleDateString("sv-SE")}
                    </div>
                  )}
                </button>
              ))}
              {matches.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No sessions available. Upload a match first.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {newPlStep === 2 && (
            <Button variant="outline" onClick={() => setNewPlStep(1)}>Back</Button>
          )}
          {newPlStep === 1 ? (
            <Button onClick={() => setNewPlStep(2)} disabled={!newPlName.trim()}>
              Next
            </Button>
          ) : (
            <Button onClick={handleCreateNewPlaylist} disabled={!newPlMatchId || newPlSaving}>
              {newPlSaving ? "Creating…" : "Create Playlist"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
