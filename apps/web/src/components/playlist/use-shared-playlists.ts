"use client";

/**
 * The data behind /my-playlists: every playlist shared with the user (and,
 * for coaches, every one they share), the games their clips come from, the
 * user's watch history, and which playlist is open (?p=). The page renders
 * the feed, the dashboard and the watch view from this.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { currentUserId as sessionUserId } from "@scoutable/shared/lib/current-user";
import {
  getMyTeamPlaylists,
  getMyDirectPlaylists,
  getMySharedPlaylists,
  setPlaylistTeams,
  setPlaylistUsers,
  type SharedPlaylist,
} from "@scoutable/shared/lib/playlists-db";
import { listMatchesLight, listEventsForMatches } from "@scoutable/shared/lib/matches-db";
import {
  buildAggregatedTeamMap,
  collectReferencedMatchIds,
  mergeEventsIntoMatches,
} from "@scoutable/shared/lib/playlist-matches";
import { playableClips, toFeedPlaylists, type FeedPlaylist } from "@scoutable/shared/lib/playlist-feed";
import { getOrgContext, getOrgContextForOrg } from "@/lib/profile-db";
import { useAuth } from "@/components/auth-context";
import type { SourceOption } from "@/components/playlist/PlaylistFeed";
import { listMyClipViews, markClipWatched, clipViewKey } from "@/lib/clip-views-db";
import { trackEvent } from "@/lib/analytics";
import type { Playlist, PlayByPlayEvent, StoredMatch } from "@scoutable/shared/types/match";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";

export function useSharedPlaylists() {
  const { activeOrgId, activeOrgIsPersonal, isPlayerOnly, myOrgs, profileLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Which playlist is open lives in the URL rather than component state, so
  // a phone's back gesture returns to the feed instead of leaving the page,
  // and a refresh or shared link reopens the same playlist.
  const selectedId = searchParams.get("p");

  const clubOrgs = useMemo(() => myOrgs.filter((o) => !o.isPersonal), [myOrgs]);
  // Stable key so the load effect doesn't refire on referentially-new arrays.
  const clubOrgIdsKey = clubOrgs.map((o) => o.orgId).sort().join(",");

  useEffect(() => {
    if (profileLoading) return;
    // Player-only users always see the aggregated feed — their film lives
    // here regardless of which space happens to be "active".
    if (isPlayerOnly) return;
    // A personal-only user has nothing to watch here — send them to the
    // get-started page (the desktop app is their product), not the profile.
    if (activeOrgIsPersonal) router.replace("/get-started");
  }, [activeOrgIsPersonal, isPlayerOnly, profileLoading, router]);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [directPlaylists, setDirectPlaylists] = useState<Playlist[]>([]);
  const [sharedOutPlaylists, setSharedOutPlaylists] = useState<SharedPlaylist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [clipViews, setClipViews] = useState<Set<string>>(new Set());
  // Newest watch per playlist — orders "In progress" as continue-watching.
  const [lastWatched, setLastWatched] = useState<Map<string, string>>(new Map());
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allOrgTeams, setAllOrgTeams] = useState<OrgTeam[]>([]);

  // Every playlist the user can open, deduped — a playlist can arrive via both
  // a team share and a direct share.
  const allPlaylists = useMemo(() => {
    const byId = new Map<string, Playlist>();
    for (const p of [...directPlaylists, ...playlists, ...sharedOutPlaylists]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }, [playlists, directPlaylists, sharedOutPlaylists]);

  const selected = useMemo(
    () => allPlaylists.find((p) => p.id === selectedId) ?? null,
    [allPlaylists, selectedId],
  );

  const openPlaylist = useCallback((id: string, opts?: { resumed?: boolean }) => {
    trackEvent("playlist_opened", { playlist_id: id, resumed: opts?.resumed ?? false });
    router.push(`/my-playlists?p=${id}`);
  }, [router]);

  const closePlaylist = useCallback(() => {
    router.push("/my-playlists");
  }, [router]);

  /** Set by Resume; consumed once the playlist's items have loaded. */
  const resumeTargetRef = useRef<string | null>(null);

  // Load playlists + matches + org context. Two modes:
  // - Coach/admin (and legacy): scoped to the active org's teams.
  // - Player-only: aggregated across ALL club orgs — no active-space concept.
  //   Matches load unscoped (RLS already grants read on matches referenced by
  //   shared playlists) and team/member context merges every club org, so
  //   badges and sharer names resolve regardless of which club shared.
  useEffect(() => {
    if (profileLoading) return;
    const supabase = createClient();
    const aggregated = isPlayerOnly;
    Promise.all([
      sessionUserId(supabase),
      // Light shells only — events arrive below, scoped to the matches the
      // loaded playlists actually reference. Full listMatches pulled every
      // accessible match's complete play-by-play (~500 events/game).
      listMatchesLight(supabase, aggregated ? undefined : (activeOrgId ?? undefined)).catch(() => [] as StoredMatch[]),
      // myOrgs is already resolved in the auth context and is identical for
      // every org, so pass it in — otherwise a player in N clubs refetches
      // get_my_orgs N times for the same answer.
      aggregated
        ? Promise.all(clubOrgs.map((o) => getOrgContextForOrg(o.orgId, { myOrgs }).catch(() => null)))
        : (activeOrgId ? getOrgContextForOrg(activeOrgId, { myOrgs }) : getOrgContext()).catch(() => null),
    ]).then(async ([uid, shells, orgCtxRaw]) => {
      setCurrentUserId(uid);
      const multiClub = aggregated && clubOrgs.length > 1;
      const rawCtxList = Array.isArray(orgCtxRaw) ? orgCtxRaw : [orgCtxRaw];
      // Zip org names before filtering nulls so a club whose context failed
      // to load doesn't shift the org↔teams pairing.
      const teamMapEntries = rawCtxList.map((c, i) =>
        c ? { orgName: aggregated ? clubOrgs[i]?.orgName : undefined, teams: c.myTeams } : null,
      );
      const orgCtxs = rawCtxList.filter((c): c is NonNullable<typeof c> => c !== null);
      const orgCtx = orgCtxs[0] ?? null;
      if (orgCtx) {
        setUserRole(orgCtx.profile?.role ?? null);
        setAllOrgTeams(orgCtxs.flatMap((c) => c.allOrgTeams));
        setTeamMap(buildAggregatedTeamMap(teamMapEntries, multiClub));
        setMemberMap(new Map(orgCtxs.flatMap((c) => c.orgMembers.map((m) => [m.id, m] as const))));
      }
      const activeTeamIds = orgCtxs.flatMap((c) => c.myTeams.map((t) => t.id));
      const [pls, directPls, sharedOutPls] = await Promise.all([
        getMyTeamPlaylists(supabase, activeTeamIds).catch(() => [] as Playlist[]),
        // Aggregated mode drops the team scoping for direct shares — every
        // person-to-person share RLS permits shows, team-bound or not.
        getMyDirectPlaylists(supabase, aggregated ? undefined : activeTeamIds).catch(() => [] as Playlist[]),
        // Owner-based (not direct-shares-only): a coach's team-only-shared
        // playlists must resolve here too, or ?p= deep links go blank.
        getMySharedPlaylists(supabase, aggregated ? undefined : activeOrgId ?? undefined).catch(() => [] as SharedPlaylist[]),
      ]);
      // Events only for matches the loaded playlists can play, merged into
      // the shells and published in ONE setMatches — clip rows silently drop
      // when their event lookup misses, so light-shells-first would flash
      // every playlist empty (and break ?p= deep links mid-load).
      const referencedIds = collectReferencedMatchIds([...pls, ...directPls, ...sharedOutPls]);
      const eventsByMatch = await listEventsForMatches(supabase, referencedIds).catch(
        () => ({}) as Record<string, PlayByPlayEvent[]>,
      );
      setMatches(mergeEventsIntoMatches(shells, eventsByMatch));
      setPlaylists(pls);
      setDirectPlaylists(directPls);
      setSharedOutPlaylists(sharedOutPls);
      // Watch history drives the feed's NEW badges and progress bars.
      const views = await listMyClipViews().catch(() => []);
      setClipViews(new Set(views.map((v) => clipViewKey(v.playlistId, v.matchId, v.eventId))));
      const last = new Map<string, string>();
      for (const v of views) {
        const prev = last.get(v.playlistId);
        if (!prev || v.watchedAt > prev) last.set(v.playlistId, v.watchedAt);
      }
      setLastWatched(last);
    }).finally(() => {
      setLoading(false);
    });
    // clubOrgIdsKey stands in for clubOrgs (referentially unstable), and the
    // aggregated path ignores activeOrgId on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, isPlayerOnly, clubOrgIdsKey, profileLoading]);

  const matchLookup = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);

  /**
   * Event lookup by `matchId:eventId`, built once per matches change.
   * Resolving a clip through `match.events.find(...)` scanned a full
   * play-by-play array (~500 events per game) for every clip in the playlist.
   */
  const eventByKey = useMemo(() => {
    const map = new Map<string, PlayByPlayEvent>();
    for (const m of matches) {
      for (const e of m.events) map.set(`${m.id}:${e.eventId}`, e);
    }
    return map;
  }, [matches]);

  /**
   * What "Shared with me" actually means: playlists OTHERS sent.
   *
   * getMyTeamPlaylists returns everything shared to a team the user belongs
   * to, regardless of who owns it — so a coach who shares their own playlist
   * to their own team saw it listed here, under a tab that says otherwise.
   * Their outbound playlists belong on the "Shared by me" dashboard.
   *
   * allPlaylists stays unfiltered on purpose: selection and ?p= deep links
   * must still resolve a coach's own playlist when they open it from that
   * dashboard. This only narrows what the feed's filters offer.
   */
  const receivedTeamPlaylists = useMemo(
    () => playlists.filter((pl) => !currentUserId || pl.createdBy !== currentUserId),
    [playlists, currentUserId],
  );
  const receivedDirectPlaylists = useMemo(
    () => directPlaylists.filter((pl) => !currentUserId || pl.createdBy !== currentUserId),
    [directPlaylists, currentUserId],
  );

  /**
   * Updates who a playlist is shared with, and this page's copy of it: the
   * dashboard derives its recipient rows from that state instead of
   * refetching.
   */
  const shareTo = useCallback(async (target: Playlist, teamIds: string[], userIds: string[]) => {
    const supabase = createClient();
    await Promise.all([
      setPlaylistTeams(supabase, target.id, teamIds),
      setPlaylistUsers(supabase, target.id, userIds),
    ]);
    trackEvent("playlist_shared", { team_count: teamIds.length, user_count: userIds.length });
    setPlaylists((prev) => prev.map((p) =>
      p.id === target.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p
    ));
    // SharedByMe now derives its recipient rows from this state instead of
    // refetching, so the optimistic entry has to carry teamShares/userShares
    // too — not just the id lists. Timestamps we don't have yet are null
    // (already the type's "unknown" value); existing ones are preserved.
    setSharedOutPlaylists((prev) => {
      if (userIds.length === 0) return prev.filter((p) => p.id !== target.id);
      const exists = prev.find((p) => p.id === target.id);
      const teamShares = teamIds.map(
        (teamId) => exists?.teamShares.find((t) => t.teamId === teamId) ?? { teamId, sharedAt: null },
      );
      const userShares = userIds.map(
        (userId) => exists?.userShares.find((u) => u.userId === userId) ?? { userId, sharedAt: null },
      );
      if (exists) {
        return prev.map((p) =>
          p.id === target.id ? { ...p, teamIds, userIds, teamShares, userShares } : p,
        );
      }
      return [...prev, { ...target, teamIds, userIds, teamShares, userShares }];
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Watch state
  // ---------------------------------------------------------------------------

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
    trackEvent("clip_watched", { playlist_id: playlistId });
    void markClipWatched(playlistId, matchId, eventId);
  }, []);

  // Cards for the landing feed, with per-playlist progress folded in.
  // Own playlists are excluded: "Shared with me" means what OTHERS sent —
  // a coach's outbound playlists live on the dashboard tab, and showing them
  // here labeled them with the coach's own name as sharer.
  const feedItems = useMemo<FeedPlaylist[]>(
    () =>
      toFeedPlaylists(allPlaylists, {
        userId: currentUserId,
        clipViews,
        lastWatched,
        memberMap,
        teamMap,
        directPlaylistIds: new Set(directPlaylists.map((p) => p.id)),
      }),
    [allPlaylists, directPlaylists, clipViews, lastWatched, memberMap, currentUserId, teamMap],
  );

  /**
   * Source filter options — the feed's way to narrow by team (or direct
   * shares). Only teams that actually have playlists appear.
   */
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const opts: SourceOption[] = [{ value: "all", label: "All playlists" }];
    if (receivedDirectPlaylists.length > 0) {
      opts.push({ value: "direct", label: "Shared with me" });
    }
    for (const [teamId, team] of teamMap) {
      if (receivedTeamPlaylists.some((p) => (p.teamIds ?? []).includes(teamId))) {
        opts.push({ value: `team:${teamId}`, label: team.name });
      }
    }
    return opts;
  }, [receivedDirectPlaylists, receivedTeamPlaylists, teamMap]);

  /** Watched/total for the open playlist, shown under the controls. */
  const selectedProgress = useMemo(() => {
    if (!selected) return { watched: 0, total: 0 };
    const clips = playableClips(selected);
    return {
      watched: clips.filter((c) => clipViews.has(clipViewKey(selected.id, c.matchId, c.eventId))).length,
      total: clips.length,
    };
  }, [selected, clipViews]);

  /** Opens a playlist and starts from the first clip the player hasn't watched. */
  const resumePlaylist = useCallback((id: string) => {
    openPlaylist(id, { resumed: true });
    const pl = allPlaylists.find((p) => p.id === id);
    if (!pl) return;
    // Playable clips only — an unshipped clip can't be the resume target
    // (it isn't in the queue, and falling back to index 0 replays watched
    // clips: the exact bug this fixed).
    const firstUnwatched = playableClips(pl)
      .find((c) => !clipViews.has(clipViewKey(pl.id, c.matchId, c.eventId)));
    resumeTargetRef.current = firstUnwatched
      ? `${firstUnwatched.matchId}:${firstUnwatched.eventId}`
      : null;
  }, [allPlaylists, clipViews, openPlaylist]);

  return {
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
  };
}
