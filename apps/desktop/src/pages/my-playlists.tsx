import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Share2, Users } from "lucide-react";
import { VideoPlayer } from "@/components/video-player";
import { VideoClipControls } from "@/components/video-clip-controls";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { getMyTeamPlaylists, setPlaylistTeams } from "@/lib/playlists-db";
import { getOrgContext } from "@/lib/profile-db";
import { listMatches } from "@/lib/matches-db";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { isClipItem } from "@/types/match";
import type { Playlist, PlaylistItem, PlaylistClipItem, PlaylistTextCard, PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";
import type { OrgTeam, UserProfile } from "@/types/org";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allOrgTeams, setAllOrgTeams] = useState<OrgTeam[]>([]);
  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());

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

  const displayItemsRef = useRef<PlaybackItem[]>([]);

  useEffect(() => { activeMatchIdRef.current = activeMatchId; }, [activeMatchId]);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Load playlists + matches + org context
  useEffect(() => {
    Promise.all([
      getMyTeamPlaylists().catch(() => [] as Playlist[]),
      listMatches().catch(() => [] as StoredMatch[]),
      getOrgContext().catch(() => null),
    ]).then(([pls, ms, orgCtx]) => {
      setPlaylists(pls);
      setMatches(ms);
      if (orgCtx) {
        setCurrentUserId(orgCtx.profile.id);
        setUserRole(orgCtx.profile.role);
        setAllOrgTeams(orgCtx.allOrgTeams);
        setTeamMap(new Map(orgCtx.myTeams.map((t) => [t.id, t])));
        setMemberMap(new Map(orgCtx.orgMembers.map((m) => [m.id, m])));
        // Start all teams expanded
        setExpandedTeams(new Set(pls.flatMap((p) => (p.teamIds && p.teamIds.length > 0) ? p.teamIds : [p.teamId ?? '__none__'])));
      }
    }).finally(() => setLoading(false));
  }, []);

  const matchLookup = useMemo(
    () => new Map(matches.map((m) => [m.id, m])),
    [matches]
  );
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  const grouped = useMemo(() => {
    const map = new Map<string, Playlist[]>();
    for (const pl of playlists) {
      const keys = (pl.teamIds && pl.teamIds.length > 0) ? pl.teamIds : [pl.teamId ?? '__none__'];
      for (const key of keys) {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(pl);
      }
    }
    return map;
  }, [playlists]);

  function toggleTeam(key: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleShareWithTeams(teamIds: string[]) {
    if (!shareTarget) return;
    await setPlaylistTeams(shareTarget.id, teamIds);
    setPlaylists((prev) => prev.map((p) =>
      p.id === shareTarget.id ? { ...p, teamIds, teamId: teamIds[0] } : p
    ));
    setShareTarget(null);
  }

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

  useEffect(() => { displayItemsRef.current = displayItems; }, [displayItems]);

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
    // Clear any active text card overlay and its timer
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
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

  const listPosition = useMemo(() => {
    if (activeTextCard)
      return displayItems.findIndex(i => isTextCard(i) && (i as PlaylistTextCard).id === activeTextCard.id);
    if (activeEventId !== null)
      return displayItems.findIndex(i => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId);
    return -1;
  }, [activeTextCard, activeEventId, displayItems]);

  const canPrev = isPlaying && listPosition > 0;
  const canNext = isPlaying && listPosition >= 0 && listPosition < displayItems.length - 1;
  const isQueueActive = isPlaying;

  function handlePrev() {
    if (listPosition <= 0) return;
    handleRowClick(displayItemsRef.current[listPosition - 1]);
  }
  function handleNext() {
    if (listPosition < 0 || listPosition >= displayItemsRef.current.length - 1) return;
    handleRowClick(displayItemsRef.current[listPosition + 1]);
  }
  function handleReplay() {
    const item = queueRef.current[queueIdxRef.current];
    if (!item) return;
    if (isTextCard(item)) startTextCardRef.current(item as PlaylistTextCard);
    else seekToItem(item as QueueItem);
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
    <>
    <ResizablePanelGroup direction="horizontal" autoSaveId="my-playlists-browser" className="h-full">
      {/* Left: playlist list */}
      <ResizablePanel defaultSize={25} minSize={15} collapsible collapsedSize={0}>
        <div className="flex h-full flex-col border-r border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            {(userRole === "coach" || userRole === "admin") ? (
              <Share2 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-semibold text-foreground">
              {(userRole === "coach" || userRole === "admin") ? "Shared Playlists" : "My Playlists"}
            </span>
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
              Array.from(grouped.entries()).map(([teamKey, teamPlaylists]) => {
                const team = teamKey !== '__none__' ? teamMap.get(teamKey) : undefined;
                const teamName = team?.name ?? "Unassigned";
                const isExpanded = expandedTeams.has(teamKey);
                return (
                  <div key={teamKey}>
                    {/* Section header */}
                    <button
                      type="button"
                      onClick={() => toggleTeam(teamKey)}
                      className="flex w-full items-center gap-1.5 px-3 py-2 hover:bg-muted/50 transition-colors select-none"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {teamName}
                      </span>
                      <span className="text-xs text-muted-foreground">{teamPlaylists.length}</span>
                    </button>

                    {/* Playlist rows */}
                    {isExpanded && teamPlaylists.map((pl) => {
                      const creatorName = pl.createdBy
                        ? (memberMap.get(pl.createdBy)?.fullName ?? null)
                        : null;
                      return (
                        <div
                          key={pl.id}
                          className={cn(
                            "group w-full flex items-center gap-1 px-4 py-2.5 transition-colors hover:bg-muted/50 cursor-pointer",
                            pl.id === selected?.id && "bg-muted"
                          )}
                        >
                          <div className="flex-1 min-w-0" onClick={() => setSelected(pl.id === selected?.id ? null : pl)}>
                            <p className="truncate text-sm font-medium text-foreground">{pl.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {pl.items.length} item{pl.items.length !== 1 ? "s" : ""}
                              {creatorName ? ` · ${creatorName}` : ""}
                            </p>
                          </div>
                          {pl.createdBy === currentUserId && (
                            <button
                              type="button"
                              className={cn(
                                "shrink-0 rounded p-1 focus:outline-none transition-opacity",
                                (pl.teamIds?.length ?? 0) > 0
                                  ? "text-primary"
                                  : "text-muted-foreground/50 opacity-0 group-hover:opacity-100"
                              )}
                              title={(pl.teamIds?.length ?? 0) > 0 ? "Manage sharing" : "Share with team"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                                setShareTarget(pl);
                              }}
                            >
                              <Share2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
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

              {/* Controls bar */}
              <div className="border-b border-border shrink-0">
                <div className="flex items-center gap-2 px-4 py-2">
                  <p className="flex-1 truncate text-sm font-semibold text-foreground">{selected.name}</p>
                </div>
                <div className="flex justify-center pb-3">
                  <VideoClipControls
                    videoRef={videoRef}
                    canPrev={canPrev}
                    canNext={canNext}
                    isQueueActive={isQueueActive}
                    onPrev={handlePrev}
                    onNext={handleNext}
                    onReplay={handleReplay}
                    onStop={handleStop}
                    onPlayAll={handlePlayPlaylist}
                  />
                </div>
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
                            "w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/50 flex items-center gap-3",
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
                          "w-full px-4 py-2 text-left transition-colors hover:bg-muted/50 flex items-center gap-3",
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
                            {match && ` · ${match.homeTeam.name} vs ${match.awayTeam.name}`}
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

    <Dialog open={shareTarget !== null} onOpenChange={(open) => !open && setShareTarget(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Playlist</DialogTitle>
          <DialogDescription>Choose which teams can see this playlist.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teams</p>
          <div className="flex flex-col gap-1">
            {allOrgTeams.map((team) => {
              const checked = pendingShareTeamIds.has(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                    checked && "bg-primary/10"
                  )}
                  onClick={() => {
                    setPendingShareTeamIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(team.id)) next.delete(team.id);
                      else next.add(team.id);
                      return next;
                    });
                  }}
                >
                  <span className={cn("flex h-4 w-4 items-center justify-center rounded border", checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                    {checked && <span className="text-[10px] font-bold">✓</span>}
                  </span>
                  {team.name}
                </button>
              );
            })}
          </div>
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Players</p>
            <p className="text-xs text-muted-foreground">Coming soon</p>
          </div>
        </div>
        <DialogFooter className="flex items-center">
          {(shareTarget?.teamIds?.length ?? 0) > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground mr-auto" onClick={() => handleShareWithTeams([])}>
              Remove all
            </Button>
          )}
          <Button size="sm" onClick={() => handleShareWithTeams([...pendingShareTeamIds])}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
