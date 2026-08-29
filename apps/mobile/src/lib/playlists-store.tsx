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
import { AppState } from "react-native";
import type {
  Playlist,
  PlayByPlayEvent,
  StoredMatch,
} from "@scoutable/shared/types/match";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import {
  getMyDirectPlaylists,
  getMySharedPlaylists,
  getMyTeamPlaylists,
} from "@scoutable/shared/lib/playlists-db";
import { listMatchesLight, listEventsForMatches } from "@scoutable/shared/lib/matches-db";
import {
  buildAggregatedTeamMap,
  collectReferencedMatchIds,
  mergeEventsIntoMatches,
} from "@scoutable/shared/lib/playlist-matches";
import { clipViewKey, listMyClipViews, markClipWatched } from "@scoutable/shared/lib/clip-views-db";
import {
  playableClips,
  toFeedPlaylists,
  type FeedPlaylist,
} from "@scoutable/shared/lib/playlist-feed";
import { getOrgContextForOrg } from "@scoutable/shared/lib/profile-db";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";
import { trackEvent } from "./analytics";

export { playableClips };

interface PlaylistsData {
  loading: boolean;
  allPlaylists: Playlist[];
  /**
   * The ONE feed view-model (shared toFeedPlaylists) — consumed by the feed
   * screen AND the tab/app-icon badges so their counts can't drift.
   */
  feedItems: FeedPlaylist[];
  directPlaylistIds: Set<string>;
  matchLookup: Map<string, StoredMatch>;
  teamMap: Map<string, OrgTeam>;
  memberMap: Map<string, UserProfile>;
  /**
   * Per-club memberships with RAW team names (teamMap values get club
   * prefixes in the aggregated multi-club feed) — for the profile screen's
   * read-only membership list.
   */
  clubTeams: Array<{ orgId: string; orgName: string; teamNames: string[] }>;
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
  const { user, activeOrgId, activeOrgRole, isPlayerOnly, myOrgs, profileLoading } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  // Player-only users always see the aggregated cross-club feed — their film
  // lives here regardless of which space happens to be "active".
  const aggregated = isPlayerOnly;
  const clubOrgs = useMemo(() => myOrgs.filter((o) => !o.isPersonal), [myOrgs]);
  // Stable key so the load effect doesn't refire on referentially-new arrays.
  const clubOrgIdsKey = clubOrgs.map((o) => o.orgId).sort().join(",");
  const [loading, setLoading] = useState(true);
  const [teamPlaylists, setTeamPlaylists] = useState<Playlist[]>([]);
  const [directPlaylists, setDirectPlaylists] = useState<Playlist[]>([]);
  const [sharedOutPlaylists, setSharedOutPlaylists] = useState<Playlist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [clubTeams, setClubTeams] = useState<PlaylistsData["clubTeams"]>([]);
  const [clipViews, setClipViews] = useState<Set<string>>(new Set());
  const [lastWatched, setLastWatched] = useState<Map<string, string>>(new Map());

  const clipViewsRef = useRef(clipViews);
  useEffect(() => {
    clipViewsRef.current = clipViews;
  }, [clipViews]);

  const load = useCallback(async () => {
    if (!aggregated && !activeOrgId) return;
    const orgIds = aggregated ? clubOrgs.map((o) => o.orgId) : [activeOrgId!];
    const [shells, orgCtxRaw] = await Promise.all([
      // Light shells only — events arrive below, scoped to the matches the
      // loaded playlists actually reference. Full listMatches pulled every
      // accessible match's complete play-by-play (~500 events/game).
      // Aggregated mode loads unscoped: RLS already grants read on matches
      // referenced by shared playlists, whichever club shared them.
      listMatchesLight(supabase, aggregated ? undefined : activeOrgId!).catch(
        () => [] as StoredMatch[],
      ),
      Promise.all(orgIds.map((id) => getOrgContextForOrg(supabase, id).catch(() => null))),
    ]);
    const multiClub = aggregated && clubOrgs.length > 1;
    // Zip org names before filtering nulls so a club whose context failed to
    // load doesn't shift the org↔teams pairing.
    const teamMapEntries = orgCtxRaw.map((c, i) =>
      c ? { orgName: aggregated ? clubOrgs[i]?.orgName : undefined, teams: c.myTeams } : null,
    );
    const orgCtxs = orgCtxRaw.filter((c): c is NonNullable<(typeof orgCtxRaw)[number]> => c !== null);
    setTeamMap(buildAggregatedTeamMap(teamMapEntries, multiClub));
    setMemberMap(new Map(orgCtxs.flatMap((c) => c.orgMembers.map((m) => [m.id, m] as const))));
    setClubTeams(
      aggregated
        ? orgCtxRaw.flatMap((c, i) =>
            c && clubOrgs[i]
              ? [
                  {
                    orgId: clubOrgs[i].orgId,
                    orgName: clubOrgs[i].orgName,
                    teamNames: c.myTeams.map((t) => t.name),
                  },
                ]
              : [],
          )
        : [],
    );
    const activeTeamIds = orgCtxs.flatMap((c) => c.myTeams.map((t) => t.id));
    const [pls, directPls, sharedOut] = await Promise.all([
      getMyTeamPlaylists(supabase, activeTeamIds).catch(() => [] as Playlist[]),
      // Aggregated mode drops the team scoping for direct shares — every
      // person-to-person share RLS permits shows, team-bound or not.
      getMyDirectPlaylists(supabase, aggregated ? undefined : activeTeamIds).catch(
        () => [] as Playlist[],
      ),
      // Coaches only: their own shared-out playlists, so the watch screen can
      // open a playlist that was shared direct-to-players (it never appears
      // in the team/direct feeds above).
      isCoachOrAdmin
        ? getMySharedPlaylists(supabase).catch(() => [] as Playlist[])
        : Promise.resolve([] as Playlist[]),
    ]);
    // Events only for matches the loaded playlists can play, merged into the
    // shells and published in ONE setMatches — the watch screen drops clips
    // whose event lookup misses, so light-shells-first would flash every
    // playlist empty. On refresh the old populated lookup stays live until
    // this replacement lands.
    const referencedIds = collectReferencedMatchIds([...pls, ...directPls, ...sharedOut]);
    const eventsByMatch = await listEventsForMatches(supabase, referencedIds).catch(
      () => ({}) as Record<string, PlayByPlayEvent[]>,
    );
    setMatches(mergeEventsIntoMatches(shells, eventsByMatch));
    setTeamPlaylists(pls);
    setDirectPlaylists(directPls);
    setSharedOutPlaylists(sharedOut);

    // Watch history drives the feed's NEW badges and progress bars.
    const views = await listMyClipViews(supabase).catch(() => []);
    setClipViews(new Set(views.map((v) => clipViewKey(v.playlistId, v.matchId, v.eventId))));
    const last = new Map<string, string>();
    for (const v of views) {
      const prev = last.get(v.playlistId);
      if (!prev || v.watchedAt > prev) last.set(v.playlistId, v.watchedAt);
    }
    setLastWatched(last);
    // clubOrgIdsKey stands in for clubOrgs (referentially unstable), and the
    // aggregated path ignores activeOrgId on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregated, activeOrgId, clubOrgIdsKey, isCoachOrAdmin]);

  useEffect(() => {
    // Auth still settling → stay in loading rather than flashing the
    // "No playlists yet" empty state. Coach/scoped mode additionally waits
    // for an active org; the aggregated feed has no active-space concept.
    if (profileLoading) return;
    if (!aggregated && !activeOrgId) return;
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [aggregated, activeOrgId, profileLoading, load]);

  // A playlist can arrive via both a team share and a direct share — dedup,
  // direct wins (it carries sharedBy). A coach's own shared-out playlists
  // merge last so the watch screen can resolve them; the feed filters them
  // out (they belong on the dashboard tab).
  const allPlaylists = useMemo(() => {
    const byId = new Map<string, Playlist>();
    for (const p of [...directPlaylists, ...teamPlaylists, ...sharedOutPlaylists]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }, [directPlaylists, teamPlaylists, sharedOutPlaylists]);

  const directPlaylistIds = useMemo(
    () => new Set(directPlaylists.map((p) => p.id)),
    [directPlaylists]
  );

  const feedItems = useMemo(
    () =>
      toFeedPlaylists(allPlaylists, {
        userId: user?.id,
        clipViews,
        lastWatched,
        memberMap,
        teamMap,
        directPlaylistIds,
      }),
    [allPlaylists, user?.id, clipViews, lastWatched, memberMap, teamMap, directPlaylistIds]
  );

  // Foreground refresh (throttled like auth-context's): the tab/app-icon
  // badges are derived from this store, and without a refetch they'd show
  // whatever was true when the app was backgrounded.
  const lastLoadedAtRef = useRef(0);
  useEffect(() => {
    lastLoadedAtRef.current = Date.now();
  }, [loading]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (Date.now() - lastLoadedAtRef.current < 30_000) return;
      lastLoadedAtRef.current = Date.now();
      load().catch(() => {});
    });
    return () => sub.remove();
  }, [load]);

  const matchLookup = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);

  const recordWatched = useCallback((playlistId: string, matchId: string, eventId: number) => {
    const key = clipViewKey(playlistId, matchId, eventId);
    if (clipViewsRef.current.has(key)) return;
    trackEvent("clip_watched", { playlist_id: playlistId });
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
    feedItems,
    directPlaylistIds,
    matchLookup,
    teamMap,
    memberMap,
    clubTeams,
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
