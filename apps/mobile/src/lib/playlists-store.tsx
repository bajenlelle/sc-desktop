/**
 * Shared data layer for the feed and watch screens — the mobile port of the
 * web my-playlists page's load effect (apps/web .../my-playlists/page.tsx).
 * Lives in a context so opening a playlist doesn't refetch everything.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Playlist, PlaylistClipItem, PlaylistItem, StoredMatch } from "@scoutable/shared/types/match";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import {
  getMyDirectPlaylists,
  getMyTeamPlaylists,
} from "@scoutable/shared/lib/playlists-db";
import { listMatches } from "@scoutable/shared/lib/matches-db";
import { clipViewKey, listMyClipViews, markClipWatched } from "@scoutable/shared/lib/clip-views-db";
import { getOrgContextForOrg } from "@scoutable/shared/lib/profile-db";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";

function isClipItem(i: PlaylistItem): i is PlaylistClipItem {
  return i.type === "clip";
}

/**
 * The clips a recipient can actually watch — only those shipped to R2.
 * Unshipped clips are invisible on the player surface (not greyed out), and
 * every progress denominator counts these, so 100% is always reachable.
 */
export function playableClips(pl: Playlist): PlaylistClipItem[] {
  return pl.items.filter(isClipItem).filter((c) => !!c.r2Url);
}

interface PlaylistsData {
  loading: boolean;
  allPlaylists: Playlist[];
  directPlaylistIds: Set<string>;
  matchLookup: Map<string, StoredMatch>;
  teamMap: Map<string, OrgTeam>;
  memberMap: Map<string, UserProfile>;
  clipViews: Set<string>;
  /** Newest watch per playlist — orders "In progress" as continue-watching. */
  lastWatched: Map<string, string>;
  refresh: () => Promise<void>;
  /**
   * Fire-and-forget watched write with in-memory dedup (mirrors web's
   * recordWatched): updates clipViews + lastWatched locally so the feed
   * reorders without a refetch.
   */
  recordWatched: (playlistId: string, matchId: string, eventId: number) => void;
}

const PlaylistsContext = createContext<PlaylistsData | null>(null);

export function PlaylistsProvider({ children }: { children: React.ReactNode }) {
  const { activeOrgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [teamPlaylists, setTeamPlaylists] = useState<Playlist[]>([]);
  const [directPlaylists, setDirectPlaylists] = useState<Playlist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [clipViews, setClipViews] = useState<Set<string>>(new Set());
  const [lastWatched, setLastWatched] = useState<Map<string, string>>(new Map());

  const clipViewsRef = useRef(clipViews);
  useEffect(() => {
    clipViewsRef.current = clipViews;
  }, [clipViews]);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    const [ms, orgCtx] = await Promise.all([
      listMatches(supabase, activeOrgId).catch(() => [] as StoredMatch[]),
      getOrgContextForOrg(supabase, activeOrgId).catch(() => null),
    ]);
    setMatches(ms);
    if (orgCtx) {
      setTeamMap(new Map(orgCtx.myTeams.map((t) => [t.id, t])));
      setMemberMap(new Map(orgCtx.orgMembers.map((m) => [m.id, m])));
    }
    const activeTeamIds = orgCtx?.myTeams.map((t) => t.id) ?? [];
    const [pls, directPls] = await Promise.all([
      getMyTeamPlaylists(supabase, activeTeamIds).catch(() => [] as Playlist[]),
      getMyDirectPlaylists(supabase, activeTeamIds).catch(() => [] as Playlist[]),
    ]);
    setTeamPlaylists(pls);
    setDirectPlaylists(directPls);

    // Watch history drives the feed's NEW badges and progress bars.
    const views = await listMyClipViews(supabase).catch(() => []);
    setClipViews(new Set(views.map((v) => clipViewKey(v.playlistId, v.matchId, v.eventId))));
    const last = new Map<string, string>();
    for (const v of views) {
      const prev = last.get(v.playlistId);
      if (!prev || v.watchedAt > prev) last.set(v.playlistId, v.watchedAt);
    }
    setLastWatched(last);
  }, [activeOrgId]);

  useEffect(() => {
    // No org resolved yet (auth still settling) → stay in loading rather than
    // flashing the "No playlists yet" empty state.
    if (!activeOrgId) return;
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, load]);

  // A playlist can arrive via both a team share and a direct share — dedup,
  // direct wins (it carries sharedBy).
  const allPlaylists = useMemo(() => {
    const byId = new Map<string, Playlist>();
    for (const p of [...directPlaylists, ...teamPlaylists]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }, [directPlaylists, teamPlaylists]);

  const directPlaylistIds = useMemo(
    () => new Set(directPlaylists.map((p) => p.id)),
    [directPlaylists]
  );

  const matchLookup = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);

  const recordWatched = useCallback((playlistId: string, matchId: string, eventId: number) => {
    const key = clipViewKey(playlistId, matchId, eventId);
    if (clipViewsRef.current.has(key)) return;
    setClipViews((prev) => new Set(prev).add(key));
    setLastWatched((prev) => {
      const next = new Map(prev);
      next.set(playlistId, new Date().toISOString());
      return next;
    });
    // Fire-and-forget; errors swallowed like web.
    markClipWatched(supabase, playlistId, matchId, eventId).catch(() => {});
  }, []);

  const value: PlaylistsData = {
    loading,
    allPlaylists,
    directPlaylistIds,
    matchLookup,
    teamMap,
    memberMap,
    clipViews,
    lastWatched,
    refresh: load,
    recordWatched,
  };

  return <PlaylistsContext.Provider value={value}>{children}</PlaylistsContext.Provider>;
}

export function usePlaylists(): PlaylistsData {
  const ctx = useContext(PlaylistsContext);
  if (!ctx) throw new Error("usePlaylists must be used inside PlaylistsProvider");
  return ctx;
}
