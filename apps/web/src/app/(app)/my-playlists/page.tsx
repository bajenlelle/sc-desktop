"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { VideoClipControls } from "@/components/video-clip-controls";
import { VideoPlayer } from "@/components/video-player";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { isWatchedPosition } from "@scoutable/shared/lib/clip-timing";
import { useAuth } from "@/components/auth-context";
import { cn } from "@/lib/utils";
import { ClipRow } from "@/components/playlist/ClipRow";
import { PlaylistFeed } from "@/components/playlist/PlaylistFeed";
import { SharedByMe } from "@/components/playlist/SharedByMe";
import { useSharedPlaylists } from "@/components/playlist/use-shared-playlists";
import { WelcomeCard } from "@/components/welcome-card";
import { AdminSetupCard } from "@/components/admin-setup-card";
import type {
  Playlist,
  PlaylistItem,
  PlaylistClipItem,
  PlaylistTextCard,
  PlayByPlayEvent,
  StoredMatch,
} from "@scoutable/shared/types/match";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueueItem = { event: PlayByPlayEvent; matchId: string; r2Url?: string; note?: string };
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
// Component
// ---------------------------------------------------------------------------

export default function MyPlaylistsPage() {
  const { activeOrgRole, isPlayerOnly } = useAuth();
  const {
    loading,
    selectedId,
    selected,
    openPlaylist,
    closePlaylist,
    resumePlaylist,
    resumeTargetRef,
    matchLookup,
    eventByKey,
    feedItems,
    sourceOptions,
    sharedOutPlaylists,
    shareTo,
    isClipWatched,
    recordWatched,
    selectedProgress,
    currentUserId,
    userRole,
    allOrgTeams,
    teamMap,
    memberMap,
  } = useSharedPlaylists();

  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  // Which perspective a coach is on: their sharing dashboard or the
  // received-playlists view. Players never see the tabs.
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());
  const [pendingShareUserIds, setPendingShareUserIds] = useState<Set<string>>(new Set());
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");

  // Playback state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);

  // The playback effect only re-subscribes on src change, so these keep its
  // handlers reading current values instead of a stale closure.
  const activeEventIdRef = useRef<number | null>(null);
  const recordWatchedRef = useRef<(p: string, m: string, e: number) => void>(() => {});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const clipListRef = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => { activeEventIdRef.current = activeEventId; }, [activeEventId]);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  async function handleShare(teamIds: string[], userIds: string[]) {
    if (!shareTarget) return;
    await shareTo(shareTarget, teamIds, userIds);
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

  // Swap video source when activeMatchId changes. matches.video_url can hold
  // the coach's LOCAL filesystem path (desktop imports) — a browser can't
  // play it and must never receive it as a src; only http(s) sources count.
  useEffect(() => {
    if (!activeMatchId) { setVideoUrl(null); return; }
    const m = matchLookupRef.current.get(activeMatchId);
    const url = m?.videoUrl;
    setVideoUrl(url && /^https?:\/\//.test(url) ? url : null);
  }, [activeMatchId]);


  // Build display items for selected playlist
  // For web: clips need r2Url to be playable; clips without r2Url are shown as greyed
  const displayItems = useMemo((): (PlaybackItem & { hasR2?: boolean })[] => {
    if (!selected) return [];
    const items: (PlaybackItem & { hasR2?: boolean })[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        // Unshipped clips are invisible to recipients — a greyed row they
        // can never play only reads as broken.
        if (!item.r2Url) continue;
        const event = eventByKey.get(`${item.matchId}:${item.eventId}`);
        if (event) {
          items.push({
            event,
            matchId: item.matchId,
            r2Url: item.r2Url,
            hasR2: true,
            note: item.note,
          });
        }
      } else {
        items.push(item as PlaylistTextCard);
      }
    }
    return items;
  }, [selected, eventByKey]);

  // Playable queue: only items with r2Url or text cards
  const playableQueue = useMemo(
    () => displayItems.filter((i) => isTextCard(i) || (i as QueueItem).r2Url),
    [displayItems]
  );

  useEffect(() => { recordWatchedRef.current = recordWatched; }, [recordWatched]);

  // Resume set a target before the playlist's items were available; start it
  // once they are, then clear so a later manual open doesn't autoplay.
  useEffect(() => {
    const target = resumeTargetRef.current;
    if (!target || !selected || playableQueue.length === 0) return;
    resumeTargetRef.current = null;
    const idx = playableQueue.findIndex((i) => itemKey(i) === target);
    startQueue(playableQueue, idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, playableQueue]);

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

  // Keep the active row visible as the queue auto-advances — without this a
  // long playlist plays on while the highlight drifts below the fold.
  useEffect(() => {
    if (!activeKey || !clipListRef.current) return;
    clipListRef.current
      .querySelector(`[data-item-key="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeKey]);

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

  // Autoplay when src changes; auto-advance on clip end; record watch state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !effectiveVideoSrc) return;

    function handleCanPlay() {
      if (!pendingPlayRef.current) return;
      pendingPlayRef.current = false;
      video!.play().catch(() => {});
    }

    // Watched = playback reached 3s before clip end (the post-roll — the
    // action is over, skipping ahead here is normal viewing). Shared rule:
    // isWatchedPosition in @scoutable/shared/lib/clip-timing.
    function markIfWatched() {
      const playlistId = selectedRef.current?.id;
      const matchId = activeMatchIdRef.current;
      const eventId = activeEventIdRef.current;
      if (!playlistId || !matchId || eventId === null) return;
      if (isWatchedPosition(video!.currentTime, video!.duration)) {
        recordWatchedRef.current(playlistId, matchId, eventId);
      }
    }

    function handleEnded() {
      markIfWatched();
      advanceQueueRef.current(queueIdxRef.current);
    }

    video.addEventListener("canplay", handleCanPlay, { once: true });
    video.addEventListener("timeupdate", markIfWatched);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("timeupdate", markIfWatched);
      video.removeEventListener("ended", handleEnded);
    };
  }, [effectiveVideoSrc]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isCoachOrAdmin = userRole === "coach" || userRole === "admin";
  const showDashboard = isCoachOrAdmin && coachTab === "by-me" && !selected;
  // Matches the navigation's label for this page (shared/lib/app-nav.ts).
  const title =
    !isPlayerOnly && (activeOrgRole === "coach" || activeOrgRole === "admin") ? "Shared playlists" : "My playlists";

  if (loading) {
    return selectedId ? (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ) : (
      <Page>
        <Toolbar title={title} />
        <PageContent>
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </PageContent>
      </Page>
    );
  }

  const shareDialog = (
    <Dialog open={shareTarget !== null} onOpenChange={(open) => { if (!open) { setShareTarget(null); setPlayerSearchQuery(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Playlist</DialogTitle>
          <DialogDescription>Choose which teams and players can see this playlist.</DialogDescription>
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
            <input
              type="text"
              placeholder="Search players…"
              value={playerSearchQuery}
              onChange={(e) => setPlayerSearchQuery(e.target.value)}
              className="mb-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {Array.from(memberMap.values())
                .filter((m) => m.id !== currentUserId && (m.fullName ?? "").toLowerCase().includes(playerSearchQuery.toLowerCase()))
                .map((member) => {
                  const checked = pendingShareUserIds.has(member.id);
                  const initials = (member.fullName ?? "?")
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <button
                      key={member.id}
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                        checked && "bg-primary/10"
                      )}
                      onClick={() => {
                        setPendingShareUserIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(member.id)) next.delete(member.id);
                          else next.add(member.id);
                          return next;
                        });
                      }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={checked}
                        className="h-3.5 w-3.5 rounded border-border accent-primary pointer-events-none"
                      />
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                        {initials}
                      </span>
                      <span className="flex-1 truncate">{member.fullName ?? member.email ?? "Unknown"}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
        {(() => {
          // Web can't upload clips — shares of unshipped clips stay silent
          // until the desktop editor uploads them.
          const unshipped = shareTarget?.items.filter((i) => isClipItem(i) && !i.r2Url).length ?? 0;
          return unshipped > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {unshipped} clip{unshipped === 1 ? " isn't" : "s aren't"} uploaded yet — recipients
              won&apos;t be notified until you upload them from the desktop editor.
            </p>
          ) : null;
        })()}
        <DialogFooter className="flex items-center">
          {((shareTarget?.teamIds?.length ?? 0) > 0 || (shareTarget?.userIds?.length ?? 0) > 0) && (
            <Button variant="ghost" size="sm" className="text-muted-foreground mr-auto" onClick={() => handleShare([], [])}>
              Remove all
            </Button>
          )}
          <Button size="sm" onClick={() => handleShare([...pendingShareTeamIds], [...pendingShareUserIds])}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (selected) {
    return (
      // The watch view fills the window (the tab bar steps aside for it);
      // dvh, not vh — mobile browsers shrink the viewport as the address bar
      // collapses, and vh would leave the controls clipped below the fold.
      <div className="flex h-dvh flex-col overflow-hidden pt-[var(--safe-top)]">
        {/* Page header — back-navigation and "what am I watching" belong
            above the video, not below it: this is page chrome, and putting
            it under a big black rectangle makes it read as video controls
            while labelling the video only after you've seen it. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
          <button
            type="button"
            onClick={closePlaylist}
            title={isCoachOrAdmin && coachTab === "by-me" ? "Back to Shared by me" : "Back to all playlists"}
            className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md pr-1 text-sm font-medium text-muted-foreground transition-colors active:text-foreground lg:min-h-0 lg:py-1.5 lg:hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {/* Name the destination, not "back": the coach may have
                arrived from the dashboard tab, which is where closing
                returns them (coachTab survives the ?p= round-trip). */}
            <span className="hidden sm:inline">
              {isCoachOrAdmin && coachTab === "by-me" ? "Shared by me" : "All playlists"}
            </span>
          </button>
          <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
          <p className="flex-1 truncate text-sm font-semibold text-foreground">
            {selected.name}
          </p>
        </div>

        {/* Video area — pinned while the clip list scrolls beneath it. */}
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
          <div className="flex justify-center py-3">
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
          {selectedProgress.total > 0 && (
            <div className="flex items-center gap-2 px-4 pb-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(selectedProgress.watched / selectedProgress.total) * 100}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {selectedProgress.watched}/{selectedProgress.total}
              </span>
            </div>
          )}
        </div>

        {/* Clip list */}
        <div ref={clipListRef} className="flex-1 overflow-y-auto pb-[var(--safe-bottom)]">
          {displayItems.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                {selected && currentUserId && selected.createdBy === currentUserId
                  ? "No clips yet — add clips from the desktop editor."
                  : isCoachOrAdmin
                    ? "No clips to watch yet."
                    : "No clips to watch yet. Your coach may still be uploading."}
              </p>
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
                    data-item-key={key}
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
              const qi = item as QueueItem & { hasR2?: boolean; note?: string };
              const match = matchLookup.get(qi.matchId);
              return (
                <div key={key} data-item-key={key}>
                  <ClipRow
                    event={qi.event}
                    matchTitle={match?.title}
                    matchDate={match?.date}
                    note={qi.note}
                    playable={!!qi.r2Url}
                    watched={isClipWatched(selected.id, qi.matchId, qi.event.eventId)}
                    active={isActive}
                    onSelect={() => handleRowClick(item)}
                  />
                </div>
              );
            })
          )}
        </div>
        {shareDialog}
      </div>
    );
  }

  return (
    <Page width={showDashboard ? "medium" : "wide"}>
      <Toolbar
        title={title}
        principal={
          // Coaches get two perspectives: what they sent (the dashboard) and
          // what they received (the player-style feed).
          isCoachOrAdmin ? (
            <SegmentedControl
              aria-label="Playlists"
              value={coachTab}
              onValueChange={setCoachTab}
              options={[
                { value: "by-me", label: "Shared by me" },
                { value: "with-me", label: "Shared with me" },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent>
        {showDashboard ? (
          <>
            <AdminSetupCard className="mb-4" />
            <SharedByMe
              shared={sharedOutPlaylists}
              memberMap={memberMap}
              teamMap={teamMap}
              currentUserId={currentUserId}
              onOpenPlaylist={openPlaylist}
              onManageShare={(pl) => {
                setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                setPendingShareUserIds(new Set(pl.userIds ?? []));
                setShareTarget(pl);
              }}
            />
          </>
        ) : (
          // The feed answers the player's actual question on arrival —
          // "what's new for me?" — instead of an empty pane.
          <>
            <WelcomeCard />
            <PlaylistFeed
              playlists={feedItems}
              sourceOptions={sourceOptions}
              onOpen={openPlaylist}
              onResume={resumePlaylist}
              emptyCopy={isCoachOrAdmin ? "Playlists other coaches share with you show up here." : undefined}
            />
          </>
        )}
      </PageContent>
      {shareDialog}
    </Page>
  );
}
