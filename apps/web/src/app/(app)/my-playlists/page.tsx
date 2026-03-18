"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoClipControls } from "@/components/video-clip-controls";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VideoPlayer } from "@/components/video-player";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { getMyTeamPlaylists, setPlaylistTeams } from "@scoutable/shared/lib/playlists-db";
import { listMatches } from "@scoutable/shared/lib/matches-db";
import { getOrgContext } from "@/lib/profile-db";
import { cn } from "@/lib/utils";
import type {
  Playlist,
  PlaylistItem,
  PlaylistClipItem,
  PlaylistTextCard,
  PlayByPlayEvent,
  StoredMatch,
} from "@scoutable/shared/types/match";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueueItem = { event: PlayByPlayEvent; matchId: string; r2Url?: string };
type PlaybackItem = QueueItem | PlaylistTextCard;

function isTextCard(i: PlaybackItem): i is PlaylistTextCard {
  return (i as PlaylistTextCard).type === "text";
}

function isClipItem(i: PlaylistItem): i is PlaylistClipItem {
  return i.type === "clip";
}

function itemKey(i: PlaybackItem): string {
  if (isTextCard(i)) return `text:${i.id}`;
  return `${(i as QueueItem).matchId}:${(i as QueueItem).event.eventId}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function playerName(event: PlayByPlayEvent): string {
  if (!event.player) return "Unknown player";
  return `${event.player.firstName} ${event.player.familyName}`.trim();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MyPlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allOrgTeams, setAllOrgTeams] = useState<OrgTeam[]>([]);
  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());

  // Playback state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<PlaybackItem[]>([]);
  const queueIdxRef = useRef<number>(0);
  const pendingPlayRef = useRef(false);
  const activeMatchIdRef = useRef<string | null>(null);
  const matchLookupRef = useRef<Map<string, StoredMatch>>(new Map());
  const textCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTextCardRef = useRef<PlaylistTextCard | null>(null);
  const selectedRef = useRef(selected);

  const playableQueueRef = useRef<PlaybackItem[]>([]);

  useEffect(() => { activeMatchIdRef.current = activeMatchId; }, [activeMatchId]);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Load playlists + matches + org context
  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.auth.getUser(),
      getMyTeamPlaylists(supabase).catch(() => [] as Playlist[]),
      listMatches(supabase).catch(() => [] as StoredMatch[]),
      getOrgContext().catch(() => null),
    ]).then(([{ data: { user } }, pls, ms, orgCtx]) => {
      setCurrentUserId(user?.id ?? null);
      setPlaylists(pls);
      setMatches(ms);
      if (orgCtx) {
        setUserRole(orgCtx.profile?.role ?? null);
        setAllOrgTeams(orgCtx.allOrgTeams);
        setTeamMap(new Map(orgCtx.myTeams.map((t) => [t.id, t])));
        setMemberMap(new Map(orgCtx.orgMembers.map((m) => [m.id, m])));
        setExpandedTeams(new Set(pls.flatMap((p) => (p.teamIds && p.teamIds.length > 0) ? p.teamIds : [p.teamId ?? "__none__"])));
      }
    }).finally(() => {
      setLoading(false);
      if (window.innerWidth < 1024) setSheetOpen(true);
    });
  }, []);

  const matchLookup = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  const grouped = useMemo(() => {
    const map = new Map<string, Playlist[]>();
    for (const pl of playlists) {
      const keys = (pl.teamIds && pl.teamIds.length > 0) ? pl.teamIds : [pl.teamId ?? "__none__"];
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
    const supabase = createClient();
    await setPlaylistTeams(supabase, shareTarget.id, teamIds);
    setPlaylists((prev) => prev.map((p) =>
      p.id === shareTarget.id ? { ...p, teamIds, teamId: teamIds[0] } : p
    ));
    setShareTarget(null);
  }

  const handleStop = useCallback(() => {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    setActiveTextCard(null);
    pendingPlayRef.current = false;
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    videoRef.current?.pause();
  }, []);

  useEffect(() => {
    handleStop();
    const mId = selected?.items.find(isClipItem)?.matchId ?? null;
    setActiveMatchId(mId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Swap video source when activeMatchId changes
  useEffect(() => {
    if (!activeMatchId) { setVideoUrl(null); return; }
    const m = matchLookupRef.current.get(activeMatchId);
    setVideoUrl(m?.videoUrl ?? null);
  }, [activeMatchId]);


  // Build display items for selected playlist
  // For web: clips need r2Url to be playable; clips without r2Url are shown as greyed
  const displayItems = useMemo((): (PlaybackItem & { hasR2?: boolean })[] => {
    if (!selected) return [];
    const items: (PlaybackItem & { hasR2?: boolean })[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        const match = matchLookup.get(item.matchId);
        const event = match?.events.find((e) => e.eventId === item.eventId);
        if (event) {
          items.push({ event, matchId: item.matchId, r2Url: item.r2Url, hasR2: !!item.r2Url });
        }
      } else {
        items.push(item as PlaylistTextCard);
      }
    }
    return items;
  }, [selected, matchLookup]);

  // Playable queue: only items with r2Url or text cards
  const playableQueue = useMemo(
    () => displayItems.filter((i) => isTextCard(i) || (i as QueueItem).r2Url),
    [displayItems]
  );

  useEffect(() => { playableQueueRef.current = playableQueue; }, [playableQueue]);

  const advanceQueueRef = useRef<(fromIdx: number) => void>(() => {});
  const advanceFromTextCardRef = useRef<() => void>(() => {});

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

  function advanceQueue(fromIdx: number) {
    const queue = queueRef.current;
    const nextIdx = fromIdx + 1;
    if (nextIdx >= queue.length) {
      setIsPlaying(false);
      queueRef.current = [];
      return;
    }
    queueIdxRef.current = nextIdx;
    const nextItem = queue[nextIdx];
    if (isTextCard(nextItem)) {
      startTextCardRef.current(nextItem as PlaylistTextCard);
    } else {
      const clipItem = nextItem as QueueItem;
      if (!clipItem.r2Url) {
        advanceQueue(nextIdx);
        return;
      }
      pendingPlayRef.current = true;
      setActiveEventId(clipItem.event.eventId);
      if (clipItem.matchId !== activeMatchIdRef.current) {
        setActiveMatchId(clipItem.matchId);
      }
    }
  }
  advanceQueueRef.current = advanceQueue;

  advanceFromTextCardRef.current = () => {
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
    advanceQueue(queueIdxRef.current);
  };

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
    if (!clipItem.r2Url) {
      advanceQueue(0);
      return;
    }
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
    pendingPlayRef.current = true;
    setActiveEventId(clipItem.event.eventId);
    if (clipItem.matchId !== activeMatchIdRef.current) {
      setActiveMatchId(clipItem.matchId);
    }
  }

  function handleRowClick(item: PlaybackItem & { hasR2?: boolean }) {
    if (!isTextCard(item) && !item.hasR2) return; // greyed out
    const idx = playableQueue.findIndex((i) => itemKey(i) === itemKey(item));
    startQueue(playableQueue, idx >= 0 ? idx : 0);
  }

  const listPosition = useMemo(() => {
    if (activeTextCard)
      return playableQueue.findIndex(i => isTextCard(i) && (i as PlaylistTextCard).id === activeTextCard.id);
    if (activeEventId !== null)
      return playableQueue.findIndex(i => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId);
    return -1;
  }, [activeTextCard, activeEventId, playableQueue]);

  const canPrev = isPlaying && listPosition > 0;
  const canNext = isPlaying && listPosition >= 0 && listPosition < playableQueue.length - 1;
  const isQueueActive = isPlaying;

  function handlePrev() {
    if (listPosition <= 0) return;
    handleRowClick(playableQueueRef.current[listPosition - 1]);
  }
  function handleNext() {
    if (listPosition < 0 || listPosition >= playableQueueRef.current.length - 1) return;
    handleRowClick(playableQueueRef.current[listPosition + 1]);
  }
  function handleReplay() {
    const item = queueRef.current[queueIdxRef.current];
    if (!item) return;
    if (isTextCard(item)) {
      startTextCardRef.current(item as PlaylistTextCard);
    } else {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }

  const activeKey = activeTextCard
    ? `text:${activeTextCard.id}`
    : activeEventId !== null
    ? displayItems.find((i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId)
      ? itemKey(displayItems.find((i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId)!)
      : null
    : null;

  // ---------------------------------------------------------------------------
  // Current video src: for R2-based playback, swap to clip's r2Url when active
  // ---------------------------------------------------------------------------
  const currentClipR2 = useMemo(() => {
    if (!activeEventId) return null;
    const item = displayItems.find(
      (i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId
    ) as QueueItem | undefined;
    return item?.r2Url ?? null;
  }, [activeEventId, displayItems]);

  // For R2 clips: video src is the clip's r2Url directly (no server streaming)
  // For match video: video src is the match videoUrl
  const effectiveVideoSrc = currentClipR2 ?? videoUrl;

  // Autoplay when src changes; auto-advance on clip end
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !effectiveVideoSrc) return;

    function handleCanPlay() {
      if (!pendingPlayRef.current) return;
      pendingPlayRef.current = false;
      video!.play().catch(() => {});
    }
    function handleEnded() {
      advanceQueueRef.current(queueIdxRef.current);
    }

    video.addEventListener("canplay", handleCanPlay, { once: true });
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("ended", handleEnded);
    };
  }, [effectiveVideoSrc]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  function PlaylistTree({ onSelect }: { onSelect: (pl: Playlist) => void }) {
    if (playlists.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <p className="text-sm font-medium text-foreground">No playlists yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Your coach will send playlists here.</p>
        </div>
      );
    }
    return (
      <>
        {Array.from(grouped.entries()).map(([teamKey, teamPlaylists]) => {
          const team = teamKey !== "__none__" ? teamMap.get(teamKey) : undefined;
          const teamName = team?.name ?? "Unassigned";
          const isExpanded = expandedTeams.has(teamKey);
          return (
            <div key={teamKey}>
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

              {isExpanded &&
                teamPlaylists.map((pl) => {
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
                      <div className="flex-1 min-w-0" onClick={() => onSelect(pl)}>
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
        })}
      </>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left: playlist list (desktop only) */}
      <aside className="w-72 shrink-0 flex flex-col border-r border-border overflow-hidden hidden lg:flex">
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
          <PlaylistTree onSelect={(pl) => setSelected(pl.id === selected?.id ? null : pl)} />
        </div>
      </aside>

      {/* Right: video + clip list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Select a playlist to watch</p>
              <Button
                className="mt-4 gap-2 lg:hidden"
                onClick={() => setSheetOpen(true)}
              >
                Select a Playlist
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Video area */}
            <div className="relative bg-black shrink-0 max-h-[55vh]">
              {effectiveVideoSrc ? (
                <VideoPlayer src={effectiveVideoSrc} videoRef={videoRef} />
              ) : (
                <div className="aspect-video flex items-center justify-center bg-black">
                  <p className="text-sm text-white/40">No video available</p>
                </div>
              )}
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
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="flex flex-1 items-center gap-1 min-w-0 lg:pointer-events-none"
                >
                  <p className="truncate text-sm font-semibold text-foreground">{selected.name}</p>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground lg:hidden" />
                </button>
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
                  onPlayAll={() => startQueue(playableQueue, 0)}
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
                  const qi = item as QueueItem & { hasR2?: boolean };
                  const hasR2 = !!qi.r2Url;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => hasR2 ? handleRowClick(item) : undefined}
                      disabled={!hasR2}
                      className={cn(
                        "w-full px-4 py-2 text-left transition-colors flex items-center gap-3",
                        hasR2 ? "hover:bg-muted/50" : "opacity-50 cursor-not-allowed",
                        isActive && "bg-primary/10"
                      )}
                    >
                      <span className="text-xs text-muted-foreground w-5 shrink-0 text-right">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{playerName(qi.event)}</p>
                        <p className="text-xs text-muted-foreground">
                          {qi.event.type} · {qi.event.gameClockTime}
                        </p>
                      </div>
                      {!hasR2 && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          Not on web
                        </Badge>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom sheet (mobile only) */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="h-[70vh] flex flex-col px-0 lg:hidden">
          <SheetHeader className="px-4 pb-3 border-b border-border shrink-0">
            <SheetTitle className="text-sm font-semibold flex items-center gap-2">
              {(userRole === "coach" || userRole === "admin") ? (
                <Share2 className="h-4 w-4 text-muted-foreground" />
              ) : (
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              )}
              {(userRole === "coach" || userRole === "admin") ? "Shared Playlists" : "My Playlists"}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-2">
            <PlaylistTree
              onSelect={(pl) => {
                setSelected(pl.id === selected?.id ? null : pl);
                setSheetOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

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
    </div>
  );
}
