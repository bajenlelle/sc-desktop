import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/video-player";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { getMyTeamPlaylists } from "@/lib/playlists-db";
import { listMatches } from "@/lib/matches-db";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { isClipItem } from "@/types/match";
import type { Playlist, PlaylistItem, PlaylistClipItem, PlaylistTextCard, PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueueItem = { event: PlayByPlayEvent; matchId: string };
type PlaybackItem = QueueItem | PlaylistTextCard;

function isTextCard(i: PlaybackItem): i is PlaylistTextCard {
  return (i as PlaylistTextCard).type === "text";
}

function itemKey(i: PlaybackItem): string {
  if (isTextCard(i)) return `text:${i.id}`;
  return `${(i as QueueItem).matchId}:${(i as QueueItem).event.eventId}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

function playerName(event: PlayByPlayEvent): string {
  if (!event.player) return "Unknown player";
  return `${event.player.firstName} ${event.player.familyName}`.trim();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MyPlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Playlist | null>(null);

  // Playback state
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<PlaybackItem[]>([]);
  const queueIdxRef = useRef<number>(0);
  const clipEndRef = useRef<number | undefined>(undefined);
  const pendingSeekRef = useRef<{ seekTo: number; clipEnd: number } | null>(null);
  const activeMatchIdRef = useRef<string | null>(null);
  const matchLookupRef = useRef<Map<string, StoredMatch>>(new Map());
  const textCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTextCardRef = useRef<PlaylistTextCard | null>(null);
  const selectedRef = useRef(selected);

  useEffect(() => { activeMatchIdRef.current = activeMatchId; }, [activeMatchId]);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Load playlists + matches
  useEffect(() => {
    Promise.all([
      getMyTeamPlaylists().catch(() => [] as Playlist[]),
      listMatches().catch(() => [] as StoredMatch[]),
    ]).then(([pls, ms]) => {
      setPlaylists(pls);
      setMatches(ms);
    }).finally(() => setLoading(false));
  }, []);

  const matchLookup = useMemo(
    () => new Map(matches.map((m) => [m.id, m])),
    [matches]
  );
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  // Primary match for a playlist
  function primaryMatchId(pl: Playlist): string | null {
    return pl.items.find(isClipItem)?.matchId ?? null;
  }

  // Stop playback when selected changes
  const handleStop = useCallback(() => {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    setActiveTextCard(null);
    clipEndRef.current = undefined;
    pendingSeekRef.current = null;
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    videoRef.current?.pause();
  }, []);

  useEffect(() => {
    handleStop();
    const mId = selected ? primaryMatchId(selected) : null;
    setActiveMatchId(mId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Swap video source when activeMatchId changes
  useEffect(() => {
    if (!activeMatchId) { setLocalVideoUrl(null); return; }
    const m = matchLookupRef.current.get(activeMatchId);
    if (!m?.videoUrl) { setLocalVideoUrl(null); return; }
    const url = m.videoUrl;
    setLocalVideoUrl(isLocalPath(url) ? streamFileSrc(url) : url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchId]);

  // Apply pending seek after video source changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !localVideoUrl || !pendingSeekRef.current) return;
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

  // Build ordered playback items for the selected playlist
  const displayItems = useMemo((): PlaybackItem[] => {
    if (!selected) return [];
    const items: PlaybackItem[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        const match = matchLookup.get(item.matchId);
        const event = match?.events.find((e) => e.eventId === item.eventId);
        if (event) items.push({ event, matchId: item.matchId });
      } else {
        items.push(item as PlaylistTextCard);
      }
    }
    return items;
  }, [selected, matchLookup]);

  // Helper: get clip offsets (always 0 for read-only view)
  function getClipOffsets() {
    return { pre: 0, post: 0 };
  }

  const preRoll = 10;
  const postRoll = 3;

  function seekToItem(item: QueueItem) {
    const sp = matchLookupRef.current.get(item.matchId)?.syncPoint;
    const video = videoRef.current;
    if (!sp || !video) return;
    const videoTime = computeVideoTime(item.event, sp);
    if (videoTime === null) return;
    const seekTo = Math.max(0, videoTime - preRoll);
    clipEndRef.current = Math.max(videoTime, videoTime + postRoll);
    video.pause();
    video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
    video.currentTime = seekTo;
  }

  // Text card advance logic
  function advanceFromTextCard() {
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
    const nextIdx = queueIdxRef.current + 1;
    const queue = queueRef.current;
    if (nextIdx < queue.length) {
      queueIdxRef.current = nextIdx;
      const nextItem = queue[nextIdx];
      if (isTextCard(nextItem)) {
        startTextCardRef.current(nextItem as PlaylistTextCard);
      } else {
        const clipItem = nextItem as QueueItem;
        setActiveEventId(clipItem.event.eventId);
        const sp = matchLookupRef.current.get(clipItem.matchId)?.syncPoint;
        if (sp) {
          const videoTime = computeVideoTime(clipItem.event, sp);
          if (videoTime !== null) {
            const seekTo = Math.max(0, videoTime - preRoll);
            const clipEnd = Math.max(videoTime, videoTime + postRoll);
            if (clipItem.matchId !== activeMatchIdRef.current) {
              pendingSeekRef.current = { seekTo, clipEnd };
              setActiveMatchId(clipItem.matchId);
            } else {
              clipEndRef.current = clipEnd;
              const video = videoRef.current;
              video?.pause();
              video?.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
              if (video) video.currentTime = seekTo;
            }
          }
        }
      }
    } else {
      setIsPlaying(false);
      queueRef.current = [];
    }
  }
  const advanceFromTextCardRef = useRef(advanceFromTextCard);
  advanceFromTextCardRef.current = advanceFromTextCard;

  function startTextCard(card: PlaylistTextCard) {
    setActiveEventId(null);
    setActiveTextCard(card);
    activeTextCardRef.current = card;
    videoRef.current?.pause();
    if (textCardTimerRef.current) clearTimeout(textCardTimerRef.current);
    textCardTimerRef.current = setTimeout(() => {
      textCardTimerRef.current = null;
      advanceFromTextCardRef.current();
    }, card.durationSeconds * 1000);
  }
  const startTextCardRef = useRef(startTextCard);
  startTextCardRef.current = startTextCard;

  // Auto-advance via timeupdate
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
        const nextItem = queue[nextIdx];
        if (isTextCard(nextItem)) {
          startTextCardRef.current(nextItem as PlaylistTextCard);
        } else {
          const clipItem = nextItem as QueueItem;
          setActiveEventId(clipItem.event.eventId);
          const sp = matchLookupRef.current.get(clipItem.matchId)?.syncPoint;
          if (sp) {
            const videoTime = computeVideoTime(clipItem.event, sp);
            if (videoTime !== null) {
              const seekTo = Math.max(0, videoTime - preRoll);
              const clipEnd = Math.max(videoTime, videoTime + postRoll);
              if (clipItem.matchId !== activeMatchIdRef.current) {
                pendingSeekRef.current = { seekTo, clipEnd };
                setActiveMatchId(clipItem.matchId);
              } else {
                clipEndRef.current = clipEnd;
                video.pause();
                video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
                video.currentTime = seekTo;
              }
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

  function startQueue(queue: PlaybackItem[], startIdx = 0) {
    if (queue.length === 0) return;
    const sliced = queue.slice(startIdx);
    if (sliced.length === 0) return;
    const firstItem = sliced[0];
    queueRef.current = sliced;
    queueIdxRef.current = 0;
    setIsPlaying(true);
    if (isTextCard(firstItem)) {
      startTextCardRef.current(firstItem as PlaylistTextCard);
      return;
    }
    const clipItem = firstItem as QueueItem;
    const sp = matchLookupRef.current.get(clipItem.matchId)?.syncPoint;
    if (!sp) return;
    setActiveEventId(clipItem.event.eventId);
    if (clipItem.matchId !== activeMatchIdRef.current) {
      const videoTime = computeVideoTime(clipItem.event, sp);
      if (videoTime !== null) {
        pendingSeekRef.current = { seekTo: Math.max(0, videoTime - preRoll), clipEnd: videoTime + postRoll };
      }
      setActiveMatchId(clipItem.matchId);
    } else {
      seekToItem(clipItem);
    }
  }

  function handleRowClick(item: PlaybackItem) {
    const idx = displayItems.findIndex((i) => itemKey(i) === itemKey(item));
    startQueue(displayItems, idx >= 0 ? idx : 0);
  }

  function handlePlayPlaylist() {
    startQueue(displayItems, 0);
  }

  const activeKey = activeTextCard
    ? `text:${activeTextCard.id}`
    : activeEventId !== null
    ? displayItems.find((i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId)
      ? itemKey(displayItems.find((i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId)!)
      : null
    : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId="my-playlists-browser" className="h-full">
      {/* Left: playlist list */}
      <ResizablePanel defaultSize={25} minSize={15} collapsible collapsedSize={0}>
        <div className="flex h-full flex-col border-r border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">My Playlists</span>
            {playlists.length > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">{playlists.length}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {playlists.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <p className="text-sm font-medium text-foreground">No playlists yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your coach will send playlists here.
                </p>
              </div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => setSelected(pl.id === selected?.id ? null : pl)}
                  className={cn(
                    "w-full px-4 py-2.5 text-left transition-colors hover:bg-accent",
                    pl.id === selected?.id && "bg-accent"
                  )}
                >
                  <p className="truncate text-sm font-medium text-foreground">{pl.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pl.items.length} item{pl.items.length !== 1 ? "s" : ""}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Right: video player */}
      <ResizablePanel defaultSize={72}>
        <div className="flex h-full flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Select a playlist to watch</p>
              </div>
            </div>
          ) : (
            <>
              {/* Video area */}
              <div className="relative bg-black">
                {localVideoUrl ? (
                  <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                ) : (
                  <VideoPlaceholder />
                )}
                {/* Text card overlay */}
                {activeTextCard && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <p className="max-w-lg px-8 text-center text-2xl font-bold text-white">
                      {activeTextCard.text}
                    </p>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <p className="flex-1 truncate text-sm font-semibold text-foreground">
                  {selected.name}
                </p>
                {isPlaying ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={handleStop}>
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={handlePlayPlaylist}
                    disabled={displayItems.length === 0}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Play Playlist
                  </Button>
                )}
              </div>

              {/* Clip list */}
              <div className="flex-1 overflow-y-auto">
                {displayItems.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <p className="text-sm text-muted-foreground">This playlist is empty.</p>
                  </div>
                ) : (
                  displayItems.map((item, idx) => {
                    const key = itemKey(item);
                    const isActive = activeKey === key;
                    if (isTextCard(item)) {
                      const card = item as PlaylistTextCard;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleRowClick(item)}
                          className={cn(
                            "w-full px-4 py-2.5 text-left transition-colors hover:bg-accent flex items-center gap-3",
                            isActive && "bg-primary/10"
                          )}
                        >
                          <span className="text-xs text-muted-foreground w-5 shrink-0 text-right">
                            {idx + 1}
                          </span>
                          <span className="text-sm italic text-muted-foreground truncate">
                            {card.text || "Text card"}
                          </span>
                        </button>
                      );
                    }
                    const qi = item as QueueItem;
                    const match = matchLookup.get(qi.matchId);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleRowClick(item)}
                        className={cn(
                          "w-full px-4 py-2 text-left transition-colors hover:bg-accent flex items-center gap-3",
                          isActive && "bg-primary/10"
                        )}
                      >
                        <span className="text-xs text-muted-foreground w-5 shrink-0 text-right">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">
                            {playerName(qi.event)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {qi.event.type} · {qi.event.gameClockTime}
                            {match && ` · ${match.homeTeam} vs ${match.awayTeam}`}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
