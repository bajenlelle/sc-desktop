import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Send, Share2, User2 } from "lucide-react";
import { ClipRow } from "@/components/playlist/ClipRow";
import { PlaylistFeed, type SourceOption } from "@/components/playlist/PlaylistFeed";
import { SharedByMe } from "@/components/playlist/SharedByMe";
import type { PlaylistCardData } from "@/components/playlist/PlaylistCard";
import { listMyClipViews, markClipWatched, clipViewKey } from "@/lib/clip-views-db";
import { trackEvent } from "@/lib/analytics";
import { VideoPlayer } from "@/components/video-player";
import { VideoClipControls } from "@/components/video-clip-controls";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { getMyTeamPlaylists, getMyDirectPlaylists, getMySharedPlaylists, setPlaylistTeams, setPlaylistUsers } from "@/lib/playlists-db";
import { getOrgContext, getOrgContextForOrg } from "@/lib/profile-db";
import { useAuth } from "@/lib/auth-context";
import { listMatches } from "@/lib/matches-db";
import { isClipItem } from "@/types/match";
import type { Playlist, PlaylistItem, PlaylistClipItem, PlaylistTextCard, PlayByPlayEvent, StoredMatch } from "@/types/match";
import type { OrgTeam, UserProfile } from "@/types/org";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `r2Url` is the pre-cut clip in cloud storage, produced by Clip & Ship when
 * a coach shares a playlist. Recipients open this page on their own machine
 * and have none of the coach's local match footage, so it is the *only*
 * usable source here — unlike the coach's own /playlists page, which seeks
 * inside the original local video.
 */
type QueueItem = { event: PlayByPlayEvent; matchId: string; r2Url?: string; note?: string };
type PlaybackItem = QueueItem | PlaylistTextCard;

function isTextCard(i: PlaybackItem): i is PlaylistTextCard {
  return (i as PlaylistTextCard).type === "text";
}

function itemKey(i: PlaybackItem): string {
  if (isTextCard(i)) return `text:${i.id}`;
  return `${(i as QueueItem).matchId}:${(i as QueueItem).event.eventId}`;
}

/** Text cards are always playable; clips need their exported cloud file. */
function isPlayable(i: PlaybackItem): boolean {
  return isTextCard(i) || !!(i as QueueItem).r2Url;
}

/**
 * The clips a recipient can actually watch — only those shipped to R2.
 * Unshipped clips are invisible on the player surface, and every progress
 * denominator counts these, so 100% is always reachable.
 */
function playableClips(pl: Playlist): PlaylistClipItem[] {
  return pl.items.filter(isClipItem).filter((c) => !!c.r2Url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MyPlaylistsPage() {
  const { activeOrgId, activeOrgIsPersonal, profileLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgIsPersonal) navigate("/playlists", { replace: true });
  }, [activeOrgIsPersonal, profileLoading, navigate]);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [directPlaylists, setDirectPlaylists] = useState<Playlist[]>([]);
  const [sharedOutPlaylists, setSharedOutPlaylists] = useState<Playlist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [clipViews, setClipViews] = useState<Set<string>>(new Set());
  // Newest watch per playlist — orders "In progress" as continue-watching.
  const [lastWatched, setLastWatched] = useState<Map<string, string>>(new Map());
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [directSectionExpanded, setDirectSectionExpanded] = useState(true);
  const [sharedOutSectionExpanded, setSharedOutSectionExpanded] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allOrgTeams, setAllOrgTeams] = useState<OrgTeam[]>([]);
  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  // Which perspective a coach is on: their sharing dashboard or the
  // received-playlists view. Players never see the tabs.
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());
  const [pendingShareUserIds, setPendingShareUserIds] = useState<Set<string>>(new Set());
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");

  // Playback state
  /** Cloud URL of the clip currently loaded into the player. */
  const [activeClipSrc, setActiveClipSrc] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<PlaybackItem[]>([]);
  const queueIdxRef = useRef<number>(0);
  /** Identity of the clip currently loaded, for attributing a watch to it. */
  const clipWatchKeyRef = useRef<{ matchId: string; eventId: number } | null>(null);
  /** Guards against re-recording the same clip on every timeupdate tick. */
  const clipWatchedRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const recordWatchedRef = useRef<(p: string, m: string, e: number) => void>(() => {});
  /** Set by Resume; consumed once the playlist's items have loaded. */
  const resumeTargetRef = useRef<string | null>(null);
  const clipListRef = useRef<HTMLDivElement | null>(null);
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

  // Load playlists + matches + org context (two stages: orgCtx first to derive
  // active-org team ids, then playlists scoped to those teams).
  useEffect(() => {
    Promise.all([
      listMatches(activeOrgId ?? undefined).catch(() => [] as StoredMatch[]),
      (activeOrgId ? getOrgContextForOrg(activeOrgId) : getOrgContext()).catch(() => null),
    ]).then(async ([ms, orgCtx]) => {
      setMatches(ms);
      if (orgCtx) {
        setCurrentUserId(orgCtx.profile.id);
        setUserRole(orgCtx.profile.role);
        setAllOrgTeams(orgCtx.allOrgTeams);
        setTeamMap(new Map(orgCtx.myTeams.map((t) => [t.id, t])));
        setMemberMap(new Map(orgCtx.orgMembers.map((m) => [m.id, m])));
      }
      const activeTeamIds = orgCtx?.myTeams.map((t) => t.id) ?? [];
      const [pls, directPls, sharedOutPls] = await Promise.all([
        getMyTeamPlaylists(activeTeamIds).catch(() => [] as Playlist[]),
        getMyDirectPlaylists(activeTeamIds).catch(() => [] as Playlist[]),
        // Owner-based (not direct-shares-only): a coach's team-only-shared
        // playlists must be resolvable/openable here too.
        getMySharedPlaylists().catch(() => [] as Playlist[]),
      ]);
      setPlaylists(pls);
      setDirectPlaylists(directPls);
      setSharedOutPlaylists(sharedOutPls);
      if (orgCtx) {
        setExpandedTeams(new Set(pls.flatMap((p) => (p.teamIds && p.teamIds.length > 0) ? p.teamIds : [p.teamId ?? '__none__'])));
      }
      // Watch history drives the feed's NEW badges and progress bars.
      const views = await listMyClipViews().catch(() => []);
      setClipViews(new Set(views.map((v) => clipViewKey(v.playlistId, v.matchId, v.eventId))));
      const last = new Map<string, string>();
      for (const v of views) {
        const prev = last.get(v.playlistId);
        if (!prev || v.watchedAt > prev) last.set(v.playlistId, v.watchedAt);
      }
      setLastWatched(last);
    }).finally(() => setLoading(false));
  }, [activeOrgId]);

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

  const { directOnlyPlaylists, overlappingDirectIds } = useMemo(() => {
    const teamPlaylistIds = new Set(playlists.map((p) => p.id));
    return {
      directOnlyPlaylists: directPlaylists.filter((p) => !teamPlaylistIds.has(p.id)),
      overlappingDirectIds: new Set(
        directPlaylists.filter((p) => teamPlaylistIds.has(p.id)).map((p) => p.id)
      ),
    };
  }, [playlists, directPlaylists]);

  // Every playlist the user can open, deduped — one can arrive via both a
  // team share and a direct share.
  const allPlaylists = useMemo(() => {
    const byId = new Map<string, Playlist>();
    for (const p of [...directPlaylists, ...playlists, ...sharedOutPlaylists]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }, [playlists, directPlaylists, sharedOutPlaylists]);

  const isClipWatched = useCallback(
    (playlistId: string, matchId: string, eventId: number) =>
      clipViews.has(clipViewKey(playlistId, matchId, eventId)),
    [clipViews],
  );

  /**
   * Records a clip as watched once. Deduped against what we already know, so
   * repeated timeupdate ticks and rewatches cost nothing.
   */
  const recordWatched = useCallback((playlistId: string, matchId: string, eventId: number) => {
    const key = clipViewKey(playlistId, matchId, eventId);
    let alreadyKnown = false;
    setClipViews((prev) => {
      if (prev.has(key)) { alreadyKnown = true; return prev; }
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    if (alreadyKnown) return;
    setLastWatched((prev) => new Map(prev).set(playlistId, new Date().toISOString()));
    void markClipWatched(playlistId, matchId, eventId);
    trackEvent("clip_watched", { playlist_id: playlistId });
  }, []);

  useEffect(() => { recordWatchedRef.current = recordWatched; }, [recordWatched]);

  const openPlaylist = useCallback((id: string) => {
    const pl = allPlaylists.find((p) => p.id === id);
    if (pl) setSelected(pl);
  }, [allPlaylists]);

  /** Opens a playlist and starts from the first clip the player hasn't watched. */
  const resumePlaylist = useCallback((id: string) => {
    const pl = allPlaylists.find((p) => p.id === id);
    if (!pl) return;
    setSelected(pl);
    // Playable clips only — an unshipped clip can't be the resume target
    // (it isn't in the queue, and falling back to index 0 replays watched
    // clips: the exact bug this fixed).
    const firstUnwatched = playableClips(pl)
      .find((c) => !clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId)));
    resumeTargetRef.current = firstUnwatched
      ? `${firstUnwatched.matchId}:${firstUnwatched.eventId}`
      : null;
  }, [allPlaylists, clipViews]);

  // Cards for the landing feed, with per-playlist progress folded in.
  // Own playlists are excluded: "Shared with me" means what OTHERS sent.
  // A coach's outbound playlists live on the dashboard tab instead —
  // otherwise they'd see their own name as the sharer.
  const feedItems = useMemo<PlaylistCardData[]>(() => {
    const directIds = new Set(directPlaylists.map((p) => p.id));
    return allPlaylists
      .filter((pl) => !currentUserId || pl.createdBy !== currentUserId)
      .map((pl) => {
      const clips = playableClips(pl);
      const watchedCount = clips.filter((c) =>
        clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId)),
      ).length;
      const sharer = pl.sharedBy ? memberMap.get(pl.sharedBy) : undefined;
      return {
        id: pl.id,
        name: pl.name,
        clipCount: clips.length,
        watchedCount,
        sharedAt: pl.sharedAt,
        lastWatchedAt: lastWatched.get(pl.id),
        sharerId: pl.sharedBy,
        // Email fallback: a sharer without full_name otherwise collapses to
        // the anonymous "Your coach".
        sharerName: sharer?.fullName ?? sharer?.email ?? undefined,
        sharerAvatarUrl: sharer?.avatarUrl ?? undefined,
        isDirect: directIds.has(pl.id),
        teamIds: pl.teamIds ?? [],
        teamNames: (pl.teamIds ?? [])
          .map((id) => teamMap.get(id)?.name)
          .filter((n): n is string => !!n),
      };
    });
  }, [allPlaylists, directPlaylists, clipViews, lastWatched, memberMap, teamMap, currentUserId]);

  /** Source filter options — mirrors how the sidebar groups playlists. */
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const opts: SourceOption[] = [{ value: "all", label: "All playlists" }];
    if (directPlaylists.length > 0) {
      opts.push({ value: "direct", label: "Shared with me" });
    }
    for (const [teamId, team] of teamMap) {
      if (playlists.some((p) => (p.teamIds ?? []).includes(teamId))) {
        opts.push({ value: `team:${teamId}`, label: team.name });
      }
    }
    return opts;
  }, [directPlaylists, playlists, teamMap]);

  /** Watched/total for the open playlist, shown under the controls. */
  const selectedProgress = useMemo(() => {
    if (!selected) return { watched: 0, total: 0 };
    const clips = playableClips(selected);
    return {
      watched: clips.filter((c) => clipViews.has(clipViewKey(selected.id, c.matchId, c.eventId))).length,
      total: clips.length,
    };
  }, [selected, clipViews]);

  const { sharedOutOnlyPlaylists, overlappingSharedOutIds } = useMemo(() => {
    const teamPlaylistIds = new Set(playlists.map((p) => p.id));
    return {
      sharedOutOnlyPlaylists: sharedOutPlaylists.filter((p) => !teamPlaylistIds.has(p.id)),
      overlappingSharedOutIds: new Set(
        sharedOutPlaylists.filter((p) => teamPlaylistIds.has(p.id)).map((p) => p.id)
      ),
    };
  }, [playlists, sharedOutPlaylists]);

  function toggleTeam(key: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleShare(teamIds: string[], userIds: string[]) {
    if (!shareTarget) return;
    await Promise.all([
      setPlaylistTeams(shareTarget.id, teamIds),
      setPlaylistUsers(shareTarget.id, userIds),
    ]);
    trackEvent("playlist_shared", { team_count: teamIds.length, user_count: userIds.length });
    setPlaylists((prev) => prev.map((p) =>
      p.id === shareTarget.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p
    ));
    setSharedOutPlaylists((prev) => {
      if (userIds.length === 0) return prev.filter((p) => p.id !== shareTarget.id);
      const exists = prev.find((p) => p.id === shareTarget.id);
      if (exists) return prev.map((p) => p.id === shareTarget.id ? { ...p, userIds } : p);
      return [...prev, { ...shareTarget, teamIds, userIds }];
    });
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
    clipWatchKeyRef.current = null;
    pendingPlayRef.current = false;
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

  // Autoplay whenever the clip source changes as part of queue playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClipSrc) return;
    function handleCanPlay() {
      if (!pendingPlayRef.current) return;
      pendingPlayRef.current = false;
      video!.play().catch(() => {});
    }
    video.addEventListener("canplay", handleCanPlay, { once: true });
    return () => video.removeEventListener("canplay", handleCanPlay);
  }, [activeClipSrc]);

  // Build ordered playback items for the selected playlist
  const displayItems = useMemo((): PlaybackItem[] => {
    if (!selected) return [];
    const items: PlaybackItem[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        // Unshipped clips are invisible to recipients — a greyed row they
        // can never play only reads as broken.
        if (!item.r2Url) continue;
        const match = matchLookup.get(item.matchId);
        const event = match?.events.find((e) => e.eventId === item.eventId);
        if (event) {
          items.push({ event, matchId: item.matchId, r2Url: item.r2Url, note: item.note });
        }
      } else {
        items.push(item as PlaylistTextCard);
      }
    }
    return items;
  }, [selected, matchLookup]);

  const playableQueue = useMemo(() => displayItems.filter(isPlayable), [displayItems]);

  useEffect(() => { displayItemsRef.current = displayItems; }, [displayItems]);

  /**
   * Starts a clip. Each cloud clip is its own pre-trimmed file, so this is
   * just a source swap — no seeking, no sync point, nothing that depends on
   * the recipient holding the original match video.
   */
  function playClip(item: QueueItem) {
    if (!item.r2Url) return;
    setActiveEventId(item.event.eventId);
    setActiveMatchId(item.matchId);
    setActiveClipSrc(item.r2Url);
    pendingPlayRef.current = true;
    clipWatchKeyRef.current = { matchId: item.matchId, eventId: item.event.eventId };
    clipWatchedRef.current = false;
  }
  // The advance handlers live in effects that only re-subscribe on src change,
  // so they reach playClip through a ref to avoid a stale closure.
  const playClipRef = useRef(playClip);
  playClipRef.current = playClip;

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
        playClipRef.current(nextItem as QueueItem);
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

  // Watch tracking + auto-advance. Each clip is now its own file, so
  // `video.duration` is the clip's length and the 90% rule applies directly —
  // the same rule the web player uses.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function markIfWatched() {
      if (clipWatchedRef.current || !video) return;
      const key = clipWatchKeyRef.current;
      const playlistId = selectedRef.current?.id;
      if (!key || !playlistId) return;
      const d = video.duration;
      if (!d || !Number.isFinite(d)) return;
      if (video.currentTime / d < 0.9) return;
      clipWatchedRef.current = true;
      recordWatchedRef.current(playlistId, key.matchId, key.eventId);
    }

    function handleEnded() {
      markIfWatched();
      const nextIdx = queueIdxRef.current + 1;
      const queue = queueRef.current;
      if (nextIdx < queue.length) {
        queueIdxRef.current = nextIdx;
        const nextItem = queue[nextIdx];
        if (isTextCard(nextItem)) {
          startTextCardRef.current(nextItem as PlaylistTextCard);
        } else {
          playClipRef.current(nextItem as QueueItem);
        }
      } else {
        setIsPlaying(false);
        setActiveEventId(null);
        queueRef.current = [];
      }
    }

    video.addEventListener("timeupdate", markIfWatched);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("timeupdate", markIfWatched);
      video.removeEventListener("ended", handleEnded);
    };
  }, [activeClipSrc]);

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
    // Clear any active text card overlay and its timer
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
    playClip(firstItem as QueueItem);
  }

  function handleRowClick(item: PlaybackItem) {
    const idx = playableQueue.findIndex((i) => itemKey(i) === itemKey(item));
    startQueue(playableQueue, idx >= 0 ? idx : 0);
  }

  function handlePlayPlaylist() {
    startQueue(playableQueue, 0);
  }

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
    if (isTextCard(item)) { startTextCardRef.current(item as PlaylistTextCard); return; }
    // Same file is already loaded — just rewind rather than re-fetching it.
    const video = videoRef.current;
    if (video) { video.currentTime = 0; video.play().catch(() => {}); }
  }

  const activeKey = activeTextCard
    ? `text:${activeTextCard.id}`
    : activeEventId !== null
    ? displayItems.find((i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId)
      ? itemKey(displayItems.find((i) => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId)!)
      : null
    : null;

  // Keep the active row visible while Play All advances through a long list.
  useEffect(() => {
    if (!activeKey || !clipListRef.current) return;
    clipListRef.current
      .querySelector(`[data-item-key="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeKey]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Sidebar rows carry the same watch signals as the feed cards.
   *
   * The feed only renders when nothing is open, so without this a player
   * watching one playlist couldn't see that another was unwatched — the exact
   * signal this is all for.
   */
  function PlaylistRowBody({ pl, meta }: { pl: Playlist; meta?: string }) {
    const clips = playableClips(pl);
    const total = clips.length;
    const watched = clips.filter((c) =>
      clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId)),
    ).length;
    const isNew = total > 0 && watched === 0;
    const isComplete = total > 0 && watched >= total;
    const partial = total > 0 && !isNew && !isComplete;

    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {isNew && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              title="Not watched yet"
            />
          )}
          {isComplete && <Check className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <p className={cn(
            "truncate text-sm text-foreground",
            isNew ? "font-semibold" : "font-medium",
          )}>
            {pl.name}
          </p>
        </div>

        {partial && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(watched / total) * 100}%` }}
            />
          </div>
        )}

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {partial
            ? `${watched}/${total} watched`
            : `${pl.items.length} item${pl.items.length !== 1 ? "s" : ""}`}
          {meta}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const isCoachOrAdmin = userRole === "coach" || userRole === "admin";
  const showDashboard = isCoachOrAdmin && coachTab === "by-me" && !selected;

  return (
    <div className="flex h-full flex-col">
    {/* Coaches get two perspectives: what they sent (dashboard) and what
        they received (the player-style view below). Hidden while watching. */}
    {isCoachOrAdmin && !selected && (
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
        {([
          ["by-me", "Shared by me"],
          ["with-me", "Shared with me"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCoachTab(key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              coachTab === key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    )}

    {showDashboard ? (
      <div className="flex-1 overflow-y-auto">
        <SharedByMe
          memberMap={memberMap}
          teamMap={teamMap}
          currentUserId={currentUserId}
          onOpenPlaylist={(pl) => setSelected(pl)}
          onManageShare={(pl) => {
            setPendingShareTeamIds(new Set(pl.teamIds ?? []));
            setPendingShareUserIds(new Set(pl.userIds ?? []));
            setShareTarget(pl);
          }}
        />
      </div>
    ) : (
    <ResizablePanelGroup direction="horizontal" autoSaveId="my-playlists-browser" className="flex-1">
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
            {playlists.length === 0 && directOnlyPlaylists.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <p className="text-sm font-medium text-foreground">No playlists yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your coach will send playlists here.
                </p>
              </div>
            ) : (
              <>
              {/* "Shared with me" section — direct shares only (no team overlap) */}
              {directOnlyPlaylists.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setDirectSectionExpanded((v) => !v)}
                    className="flex w-full items-center gap-1.5 px-3 py-2 hover:bg-muted/50 transition-colors select-none"
                  >
                    {directSectionExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <User2 className="h-3 w-3 shrink-0 text-primary/70" />
                    <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Shared with me
                    </span>
                    <span className="text-xs text-muted-foreground">{directOnlyPlaylists.length}</span>
                  </button>
                  {directSectionExpanded && directOnlyPlaylists.map((pl) => {
                    const creatorName = pl.createdBy
                      ? (memberMap.get(pl.createdBy)?.fullName ?? null)
                      : null;
                    return (
                      <div
                        key={pl.id}
                        className={cn(
                          "w-full flex items-center gap-1 px-4 py-2.5 transition-colors hover:bg-muted/50 cursor-pointer",
                          pl.id === selected?.id && "bg-muted"
                        )}
                        onClick={() => setSelected(pl.id === selected?.id ? null : pl)}
                      >
                        <PlaylistRowBody
                          pl={pl}
                          meta={creatorName ? ` · Shared by ${creatorName}` : ""}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {Array.from(grouped.entries()).map(([teamKey, teamPlaylists]) => {
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
                            <PlaylistRowBody pl={pl} meta={creatorName ? ` · ${creatorName}` : ""} />
                          </div>
                          {overlappingDirectIds.has(pl.id) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <User2 className="h-3 w-3 shrink-0 text-primary/60" />
                              </TooltipTrigger>
                              <TooltipContent>Also shared directly with you</TooltipContent>
                            </Tooltip>
                          )}
                          {overlappingSharedOutIds.has(pl.id) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <User2 className="h-3 w-3 shrink-0 text-primary/60" />
                              </TooltipTrigger>
                              <TooltipContent>Also shared directly with players</TooltipContent>
                            </Tooltip>
                          )}
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
                                setPendingShareUserIds(new Set(pl.userIds ?? []));
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

              {/* "Shared by me" moved to the coach dashboard tab. */}
              </>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Right: video player */}
      <ResizablePanel defaultSize={72}>
        <div className="flex h-full flex-col">
          {!selected ? (
            // The feed answers the player's actual question on arrival —
            // "what's new for me?" — instead of an empty pane.
            <div className="flex-1 overflow-y-auto">
              <PlaylistFeed
                playlists={feedItems}
                sourceOptions={sourceOptions}
                onOpen={openPlaylist}
                onResume={resumePlaylist}
                emptyCopy={
                  isCoachOrAdmin
                    ? "Playlists other coaches share with you show up here."
                    : undefined
                }
              />
            </div>
          ) : (
            <>
              {/* Page header — back-navigation and "what am I watching" belong
                  above the video, not below it. */}
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  title={isCoachOrAdmin && coachTab === "by-me" ? "Back to Shared by me" : "Back to all playlists"}
                  className="flex shrink-0 items-center gap-1 rounded-md py-1.5 pr-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {/* Name the destination — closing returns to whichever tab
                      the coach came from (coachTab survives selection). */}
                  {isCoachOrAdmin && coachTab === "by-me" ? "Shared by me" : "All playlists"}
                </button>
                <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
                <p className="flex-1 truncate text-sm font-semibold text-foreground">
                  {selected.name}
                </p>
              </div>

              {/* Video area */}
              <div className="relative bg-black">
                {activeClipSrc ? (
                  <VideoPlayer src={activeClipSrc} videoRef={videoRef} />
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
                    onPlayAll={handlePlayPlaylist}
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
              <div ref={clipListRef} className="flex-1 overflow-y-auto">
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
                          data-item-key={key}
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
                    const clip = selected.items
                      .filter(isClipItem)
                      .find((c) => c.matchId === qi.matchId && c.eventId === qi.event.eventId);
                    return (
                      // Wrapper carries the scroll anchor — ClipRow doesn't
                      // forward arbitrary DOM props.
                      <div key={key} data-item-key={key}>
                        <ClipRow
                          event={qi.event}
                          matchTitle={match?.title}
                          matchDate={match?.date}
                          note={clip?.note}
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
            </>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
    )}

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
    </div>
  );
}
