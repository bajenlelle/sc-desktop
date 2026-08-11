"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/video-player";
import { VideoClipControls } from "@/components/video-clip-controls";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Playlist, PlaylistItem, PlaylistClipItem, PlaylistTextCard, PlayByPlayEvent, StoredMatch } from "@scoutable/shared/types/match";
import { listMatches } from "@scoutable/shared/lib/matches-db";
import { ClipRow } from "@/components/playlist/ClipRow";
import { listMyClipViews, markClipWatched, clipViewKey } from "@/lib/clip-views-db";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface PlaylistClipRow {
  item_type: string;
  item_id: string | null;
  match_id: string | null;
  event_id: number | null;
  position: number;
  pre_roll_offset: number;
  post_roll_offset: number;
  note: string | null;
  text_content: string | null;
  duration_seconds: number | null;
  r2_url: string | null;
}

interface PlaylistShareRow { team_id: string }

interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  folder_id: string | null;
  team_id: string | null;
  created_at: string;
  updated_at: string;
  playlist_clips: PlaylistClipRow[];
  playlist_shares: PlaylistShareRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTextCard(item: PlaylistItem): item is PlaylistTextCard {
  return item.type === "text";
}

function isClipItem(item: PlaylistItem): item is PlaylistClipItem {
  return item.type === "clip";
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  const items = [...(row.playlist_clips ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((c): PlaylistItem | null => {
      if (c.item_type === "text") {
        if (!c.item_id) return null;
        return { type: "text", id: c.item_id, text: c.text_content ?? "", durationSeconds: c.duration_seconds ?? 5 };
      }
      if (!c.match_id || c.event_id === null) return null;
      return {
        type: "clip",
        matchId: c.match_id,
        eventId: c.event_id,
        ...(c.pre_roll_offset !== 0 ? { preRollOffset: c.pre_roll_offset } : {}),
        ...(c.post_roll_offset !== 0 ? { postRollOffset: c.post_roll_offset } : {}),
        ...(c.note ? { note: c.note } : {}),
        ...(c.r2_url ? { r2Url: c.r2_url } : {}),
      };
    })
    .filter((x): x is PlaylistItem => x !== null);
  return {
    id: row.id,
    name: row.name,
    items,
    folderId: row.folder_id ?? undefined,
    teamId: row.team_id ?? undefined,
    teamIds: (row.playlist_shares ?? []).map((s) => s.team_id),
    createdBy: row.user_id,
  };
}

type QueueItem = { event: PlayByPlayEvent; matchId: string; r2Url?: string; note?: string };
type PlaybackItem = QueueItem | PlaylistTextCard;

function itemKey(i: PlaybackItem): string {
  if ((i as PlaylistTextCard).type === "text") return `text:${(i as PlaylistTextCard).id}`;
  return `${(i as QueueItem).matchId}:${(i as QueueItem).event.eventId}`;
}

const PLAYLIST_SELECT = `
  id, user_id, name, folder_id, team_id, created_at, updated_at,
  playlist_clips (
    item_type, item_id, match_id, event_id, position,
    pre_roll_offset, post_roll_offset, note, text_content, duration_seconds, r2_url
  ),
  playlist_shares (team_id)
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ViewPlaylistPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [noAccess, setNoAccess] = useState(false);
  /** Keys ("matchId:eventId") of clips this player has already watched. */
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());

  // Playback
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<PlaybackItem[]>([]);
  const queueIdxRef = useRef(0);
  const pendingPlayRef = useRef(false);
  const textCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => { activeKeyRef.current = activeKey; }, [activeKey]);

  // Load this player's watch history so rows show their ✓ on arrival.
  useEffect(() => {
    if (!playlistId) return;
    listMyClipViews()
      .then((views) => {
        setWatchedKeys(new Set(
          views
            .filter((v) => v.playlistId === playlistId)
            .map((v) => `${v.matchId}:${v.eventId}`),
        ));
      })
      .catch(() => {});
  }, [playlistId]);

  /** Same 90%-of-duration rule the main player page uses. */
  const recordWatched = useRef((key: string) => {
    const [matchId, eventIdStr] = key.split(":");
    const eventId = Number(eventIdStr);
    if (!matchId || !Number.isFinite(eventId)) return;
    setWatchedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    void markClipWatched(playlistId, matchId, eventId);
  });

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase
        .from("playlists")
        .select(PLAYLIST_SELECT)
        .eq("id", playlistId)
        .single(),
      listMatches(supabase).catch(() => [] as StoredMatch[]),
    ]).then(([{ data, error }, ms]) => {
      if (error || !data) {
        setNoAccess(true);
        return;
      }
      const pl = rowToPlaylist(data as PlaylistRow);
      setPlaylist(pl);
      setMatches(ms);

      // Load owner name
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", pl.createdBy)
        .single()
        .then(({ data: profileData }) => {
          setOwnerName((profileData as { full_name: string | null } | null)?.full_name ?? null);
        });
    }).finally(() => setLoading(false));
  }, [playlistId]);

  const matchLookup = new Map(matches.map((m) => [m.id, m]));

  const displayItems: (PlaybackItem & { hasR2?: boolean })[] = playlist
    ? playlist.items.flatMap((item): (PlaybackItem & { hasR2?: boolean })[] => {
        if (isTextCard(item)) return [item as PlaylistTextCard];
        if (isClipItem(item)) {
          const match = matchLookup.get(item.matchId);
          const event = match?.events.find((e) => e.eventId === item.eventId);
          if (event) return [{ event, matchId: item.matchId, r2Url: item.r2Url, hasR2: !!item.r2Url, note: item.note }];
        }
        return [];
      })
    : [];

  const playableQueue = displayItems.filter((i) => {
    if ((i as PlaylistTextCard).type === "text") return true;
    return !!(i as QueueItem & { hasR2?: boolean }).hasR2;
  });

  const canPrev = isPlaying && queueIdxRef.current > 0;
  const canNext = isPlaying && queueIdxRef.current < queueRef.current.length - 1;

  function handleStop() {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveKey(null);
    setActiveTextCard(null);
    pendingPlayRef.current = false;
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    videoRef.current?.pause();
  }

  function startQueue(items: PlaybackItem[], startIdx: number) {
    handleStop();
    if (items.length === 0) return;
    queueRef.current = items;
    queueIdxRef.current = startIdx;
    setIsPlaying(true);
    playItem(items[startIdx], items);
  }

  function playItem(item: PlaybackItem, queue: PlaybackItem[]) {
    const idx = queueRef.current.indexOf(item);
    setActiveKey(itemKey(item));

    if ((item as PlaylistTextCard).type === "text") {
      const card = item as PlaylistTextCard;
      setActiveTextCard(card);
      videoRef.current?.pause();
      textCardTimerRef.current = setTimeout(() => {
        setActiveTextCard(null);
        const next = queueRef.current[idx + 1];
        if (next) { queueIdxRef.current = idx + 1; playItem(next, queue); }
        else { setIsPlaying(false); setActiveKey(null); }
      }, (card.durationSeconds ?? 5) * 1000);
      return;
    }

    const qi = item as QueueItem;
    const match = matchLookup.get(qi.matchId);
    if (!match) { handleStop(); return; }

    setVideoUrl(match.videoUrl ?? null);
    const src = qi.r2Url ?? match.videoUrl;
    if (!src) { handleStop(); return; }

    setVideoUrl(src);
    pendingPlayRef.current = true;
    const clipKey = itemKey(item);
    if (videoRef.current) {
      videoRef.current.src = src;
      videoRef.current.load();
      videoRef.current.oncanplay = () => {
        if (pendingPlayRef.current) {
          pendingPlayRef.current = false;
          videoRef.current?.play().catch(() => {});
        }
        videoRef.current!.oncanplay = null;
      };
      // Watched at 90% of duration — same rule as the main player page.
      videoRef.current.ontimeupdate = () => {
        const v = videoRef.current;
        if (!v?.duration || !Number.isFinite(v.duration)) return;
        if (v.currentTime / v.duration >= 0.9) recordWatched.current(clipKey);
      };
    }
  }

  function handleRowClick(item: PlaybackItem) {
    startQueue(playableQueue, playableQueue.indexOf(item));
  }

  function handlePrev() {
    const idx = queueIdxRef.current - 1;
    if (idx >= 0) { queueIdxRef.current = idx; playItem(queueRef.current[idx], queueRef.current); }
  }

  function handleNext() {
    const idx = queueIdxRef.current + 1;
    if (idx < queueRef.current.length) { queueIdxRef.current = idx; playItem(queueRef.current[idx], queueRef.current); }
  }

  function handleReplay() {
    if (queueRef.current.length > 0) playItem(queueRef.current[queueIdxRef.current], queueRef.current);
  }

  const effectiveVideoSrc = videoUrl;

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (noAccess || !playlist) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center p-6">
        <div className="text-center max-w-sm space-y-3">
          <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-foreground">No access</p>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have access to this playlist. Make sure you&apos;re logged in and part of the same organization.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/my-playlists">← My Playlists</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <Link href="/my-playlists" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          My Playlists
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-semibold text-foreground truncate">{playlist.name}</span>
        {ownerName && (
          <Badge variant="outline" className="text-xs ml-auto shrink-0">{ownerName}</Badge>
        )}
      </div>

      {/* Video area */}
      <div className="relative bg-black shrink-0 max-h-[50vh]">
        {effectiveVideoSrc ? (
          <VideoPlayer src={effectiveVideoSrc} videoRef={videoRef} />
        ) : (
          <div className="aspect-video flex items-center justify-center bg-black">
            <p className="text-sm text-white/40">Select a clip to play</p>
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

      {/* Controls */}
      <div className="flex justify-center border-b border-border py-2 shrink-0">
        <VideoClipControls
          videoRef={videoRef}
          canPrev={canPrev}
          canNext={canNext}
          isQueueActive={isPlaying}
          onPrev={handlePrev}
          onNext={handleNext}
          onReplay={handleReplay}
          onStop={handleStop}
          onPlayAll={() => startQueue(playableQueue, 0)}
        />
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
            if ((item as PlaylistTextCard).type === "text") {
              const card = item as PlaylistTextCard;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleRowClick(item)}
                  className={cn(
                    "w-full px-4 py-2 text-left transition-colors flex items-center gap-3 hover:bg-muted/50",
                    isActive && "bg-primary/10"
                  )}
                >
                  <span className="text-xs text-muted-foreground w-5 shrink-0 text-right">{idx + 1}</span>
                  <span className="text-sm italic text-muted-foreground truncate">{card.text || "Text card"}</span>
                </button>
              );
            }
            const qi = item as QueueItem & { hasR2?: boolean };
            const match = matchLookup.get(qi.matchId);
            return (
              <ClipRow
                key={key}
                event={qi.event}
                matchTitle={match?.title}
                matchDate={match?.date}
                note={qi.note}
                playable={!!qi.r2Url}
                watched={watchedKeys.has(key)}
                active={isActive}
                onSelect={() => handleRowClick(item)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
