import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Clapperboard, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { playableClips, toFeedPlaylists, sharerFilterOptions } from "@scoutable/shared/lib/playlist-feed";
import { collectReferencedMatchIds, mergeEventsIntoMatches } from "@scoutable/shared/lib/playlist-matches";
import { EMPTY_FEED_FILTERS, PlaylistFeed, type FeedFilters } from "@/components/playlist/PlaylistFeed";
import { SharedByMe } from "@/components/playlist/SharedByMe";
import { ShareRecipients } from "@/components/playlist/share-recipients";
import { WatchView } from "@/components/playlist/watch-view";
import type { WatchItem } from "@/components/playlist/use-watch-queue";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { listMyClipViews, markClipWatched, clipViewKey } from "@/lib/clip-views-db";
import { trackEvent } from "@/lib/analytics";
import {
  getMyTeamPlaylists,
  getMyDirectPlaylists,
  getMySharedPlaylists,
  setPlaylistTeams,
  setPlaylistUsers,
  type SharedPlaylist,
} from "@/lib/playlists-db";
import { dismissWelcome, getOrgContext, getOrgContextForOrg } from "@/lib/profile-db";
import { useAuth } from "@/lib/auth-context";
import { listMatchesLight, listEventsForMatches } from "@/lib/matches-db";
import { isClipItem } from "@/types/match";
import type { Playlist, PlayByPlayEvent, StoredMatch } from "@/types/match";
import type { OrgTeam, UserProfile } from "@/types/org";

const COACH_VIEW_KEY = "scoutable_shared_view";

type CoachView = "by-me" | "with-me";

function readCoachView(): CoachView {
  try {
    return localStorage.getItem(COACH_VIEW_KEY) === "with-me" ? "with-me" : "by-me";
  } catch {
    return "by-me";
  }
}

/**
 * First visit to a club's player feed: what lands here, and (for players
 * with one) the personal space where they can build their own tapes. Shares
 * the welcome_dismissed_at flag with the web app.
 */
function WelcomeCallout() {
  const navigate = useNavigate();
  const { profile, myOrgs, setActiveOrg } = useAuth();
  const [hidden, setHidden] = useState(false);
  const personalOrg = myOrgs.find((o) => o.isPersonal) ?? null;
  if (hidden || !profile || profile.welcomeDismissedAt != null) return null;
  return (
    <Callout
      icon={<Clapperboard />}
      action={
        <div className="flex items-center gap-1">
          {personalOrg && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                trackEvent("player_welcome_cta");
                setActiveOrg(personalOrg.orgId);
                navigate("/");
              }}
            >
              Open my space
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => {
              setHidden(true);
              trackEvent("player_welcome_dismissed");
              dismissWelcome().catch(() => {});
            }}
          >
            <X />
          </Button>
        </div>
      }
    >
      <p className="font-medium">Welcome to Scoutable</p>
      <p className="mt-0.5 text-muted-foreground">
        Playlists your coach shares with you appear here, and you get an email when a new one arrives.
        {personalOrg && " Your personal space is where you import your own games and build highlight tapes."}
      </p>
    </Callout>
  );
}

export function MyPlaylistsPage() {
  const { activeOrgId, activeOrgIsPersonal, profileLoading, myOrgs, setActiveOrg } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profileLoading) return;
    // No shared-with-me feed exists in a personal space: back to Home. It
    // must stay "/" — this also fires while "Open my space" switches spaces
    // and navigates there itself.
    if (activeOrgIsPersonal) navigate("/", { replace: true });
  }, [activeOrgIsPersonal, profileLoading, navigate]);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [directPlaylists, setDirectPlaylists] = useState<Playlist[]>([]);
  const [sharedOutPlaylists, setSharedOutPlaylists] = useState<SharedPlaylist[]>([]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [clipViews, setClipViews] = useState<Set<string>>(new Set());
  const [lastWatched, setLastWatched] = useState<Map<string, string>>(new Map());
  const [teamMap, setTeamMap] = useState<Map<string, OrgTeam>>(new Map());
  const [memberMap, setMemberMap] = useState<Map<string, UserProfile>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allOrgTeams, setAllOrgTeams] = useState<OrgTeam[]>([]);

  const [coachView, setCoachViewState] = useState<CoachView>(readCoachView);
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  const [dashboardQuery, setDashboardQuery] = useState("");
  /** The open playlist, and whether it was opened with Resume. */
  const [watching, setWatching] = useState<{ id: string; autoplay: boolean; startKey: string | null } | null>(null);

  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  const [shareTeamIds, setShareTeamIds] = useState<Set<string>>(new Set());
  const [shareUserIds, setShareUserIds] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);

  const setCoachView = (v: CoachView) => {
    setCoachViewState(v);
    try {
      localStorage.setItem(COACH_VIEW_KEY, v);
    } catch {
      // A remembered tab is a convenience.
    }
  };

  // Org context first (for the active space's teams), then the playlists
  // scoped to them, then only the events those playlists reference.
  useEffect(() => {
    setLoading(true);
    setWatching(null);
    Promise.all([
      listMatchesLight(activeOrgId ?? undefined).catch(() => [] as StoredMatch[]),
      (activeOrgId ? getOrgContextForOrg(activeOrgId, { myOrgs }) : getOrgContext()).catch(() => null),
    ])
      .then(async ([shells, orgCtx]) => {
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
          // Owner-based: a coach's team-only shares must be openable too.
          getMySharedPlaylists(activeOrgId ?? undefined).catch(() => [] as SharedPlaylist[]),
        ]);
        // Events only for the referenced matches, published with the shells
        // in one go: clip rows drop when their event lookup misses.
        const referencedIds = collectReferencedMatchIds([...pls, ...directPls, ...sharedOutPls]);
        const eventsByMatch = await listEventsForMatches(referencedIds).catch(
          () => ({}) as Record<string, PlayByPlayEvent[]>,
        );
        setMatches(mergeEventsIntoMatches(shells, eventsByMatch));
        setPlaylists(pls);
        setDirectPlaylists(directPls);
        setSharedOutPlaylists(sharedOutPls);
        const views = await listMyClipViews().catch(() => []);
        setClipViews(new Set(views.map((v) => clipViewKey(v.playlistId, v.matchId, v.eventId))));
        const last = new Map<string, string>();
        for (const v of views) {
          const prev = last.get(v.playlistId);
          if (!prev || v.watchedAt > prev) last.set(v.playlistId, v.watchedAt);
        }
        setLastWatched(last);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const matchLookup = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const eventByKey = useMemo(() => {
    const map = new Map<string, PlayByPlayEvent>();
    for (const m of matches) for (const e of m.events) map.set(`${m.id}:${e.eventId}`, e);
    return map;
  }, [matches]);

  // Every playlist the user can open, deduped (a team share and a direct
  // share can both deliver one).
  const allPlaylists = useMemo(() => {
    const byId = new Map<string, Playlist>();
    for (const p of [...directPlaylists, ...playlists, ...sharedOutPlaylists]) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()];
  }, [playlists, directPlaylists, sharedOutPlaylists]);

  const isWatched = useCallback(
    (playlistId: string, matchId: string, eventId: number) => clipViews.has(clipViewKey(playlistId, matchId, eventId)),
    [clipViews],
  );

  /** Records a clip as watched, once. */
  const recordWatched = useCallback((playlistId: string, matchId: string, eventId: number) => {
    const key = clipViewKey(playlistId, matchId, eventId);
    let alreadyKnown = false;
    setClipViews((prev) => {
      if (prev.has(key)) {
        alreadyKnown = true;
        return prev;
      }
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    if (alreadyKnown) return;
    setLastWatched((prev) => new Map(prev).set(playlistId, new Date().toISOString()));
    void markClipWatched(playlistId, matchId, eventId);
    trackEvent("clip_watched", { playlist_id: playlistId });
  }, []);

  // "Shared with me" is what OTHERS sent; a coach's own playlists live on
  // the dashboard (toFeedPlaylists drops them).
  const feed = useMemo(
    () =>
      toFeedPlaylists(allPlaylists, {
        userId: currentUserId,
        clipViews,
        lastWatched,
        memberMap,
        teamMap,
        directPlaylistIds: new Set(directPlaylists.map((p) => p.id)),
      }),
    [allPlaylists, currentUserId, clipViews, lastWatched, memberMap, teamMap, directPlaylists],
  );

  const sharerOptions = useMemo(() => sharerFilterOptions(feed), [feed]);
  const sourceOptions = useMemo(() => {
    const received = (pls: Playlist[]) => pls.filter((pl) => !currentUserId || pl.createdBy !== currentUserId);
    const opts = [{ value: "all", label: "All teams" }];
    if (received(directPlaylists).length > 0) opts.push({ value: "direct", label: "Shared with me" });
    for (const [teamId, team] of teamMap) {
      if (received(playlists).some((p) => (p.teamIds ?? []).includes(teamId))) {
        opts.push({ value: `team:${teamId}`, label: team.name });
      }
    }
    return opts;
  }, [directPlaylists, playlists, teamMap, currentUserId]);

  const firstUnwatchedKey = useCallback(
    (pl: Playlist) => {
      const c = playableClips(pl).find((clip) => !clipViews.has(clipViewKey(pl.id, clip.matchId, clip.eventId)));
      return c ? `${c.matchId}:${c.eventId}` : null;
    },
    [clipViews],
  );

  const open = (pl: Playlist | undefined, autoplay: boolean) => {
    if (!pl) return;
    setWatching({ id: pl.id, autoplay, startKey: firstUnwatchedKey(pl) });
  };
  const openById = (id: string, autoplay: boolean) => open(allPlaylists.find((p) => p.id === id), autoplay);

  const selected = watching ? (allPlaylists.find((p) => p.id === watching.id) ?? null) : null;

  const watchItems = useMemo<WatchItem[]>(() => {
    if (!selected) return [];
    const out: WatchItem[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        // Unshipped clips are invisible to recipients: a row they can never
        // play only reads as broken.
        if (!item.r2Url) continue;
        const event = eventByKey.get(`${item.matchId}:${item.eventId}`);
        if (event) {
          out.push({ kind: "clip", key: `${item.matchId}:${item.eventId}`, event, matchId: item.matchId, r2Url: item.r2Url, note: item.note });
        }
      } else {
        out.push({ kind: "text", key: `text:${item.id}`, card: item });
      }
    }
    return out;
  }, [selected, eventByKey]);

  const multiGame = useMemo(
    () => new Set(watchItems.flatMap((i) => (i.kind === "clip" ? [i.matchId] : []))).size > 1,
    [watchItems],
  );

  const selectedProgress = useMemo(() => {
    if (!selected) return { watched: 0, total: 0 };
    const clips = playableClips(selected);
    return {
      watched: clips.filter((c) => clipViews.has(clipViewKey(selected.id, c.matchId, c.eventId))).length,
      total: clips.length,
    };
  }, [selected, clipViews]);

  function openShare(pl: Playlist) {
    setShareTeamIds(new Set(pl.teamIds ?? []));
    setShareUserIds(new Set(pl.userIds ?? []));
    setShareTarget(pl);
  }

  async function handleShare(teamIds: string[], userIds: string[]) {
    const target = shareTarget;
    if (!target) return;
    setSharing(true);
    try {
      await Promise.all([setPlaylistTeams(target.id, teamIds), setPlaylistUsers(target.id, userIds)]);
    } catch (e) {
      setSharing(false);
      toast.error("Couldn't update sharing", { description: (e as Error).message });
      return;
    }
    setSharing(false);
    const before = { teams: new Set(target.teamIds ?? []), users: new Set(target.userIds ?? []) };
    const addedTeams = teamIds.filter((id) => !before.teams.has(id)).length;
    const addedUsers = userIds.filter((id) => !before.users.has(id)).length;
    if (addedTeams + addedUsers > 0) trackEvent("playlist_shared", { team_count: addedTeams, user_count: addedUsers });
    setPlaylists((prev) => prev.map((p) => (p.id === target.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p)));
    // The dashboard derives its recipient rows from this state, so the
    // entry carries teamShares/userShares too (unknown timestamps are null).
    setSharedOutPlaylists((prev) => {
      if (teamIds.length === 0 && userIds.length === 0) return prev.filter((p) => p.id !== target.id);
      const exists = prev.find((p) => p.id === target.id);
      const teamShares = teamIds.map((teamId) => exists?.teamShares.find((t) => t.teamId === teamId) ?? { teamId, sharedAt: null });
      const userShares = userIds.map((userId) => exists?.userShares.find((u) => u.userId === userId) ?? { userId, sharedAt: null });
      if (exists) return prev.map((p) => (p.id === target.id ? { ...p, teamIds, userIds, teamShares, userShares } : p));
      return [...prev, { ...target, teamIds, userIds, teamShares, userShares }];
    });
    setShareTarget(null);
  }

  const isCoachOrAdmin = userRole === "coach" || userRole === "admin";
  const showDashboard = isCoachOrAdmin && coachView === "by-me";
  const personalOrg = myOrgs.find((o) => o.isPersonal);

  // ---------------------------------------------------------------- watch
  if (selected) {
    const sharer = selected.sharedBy ? memberMap.get(selected.sharedBy) : selected.createdBy ? memberMap.get(selected.createdBy) : undefined;
    const own = !!currentUserId && selected.createdBy === currentUserId;
    const backLabel = !isCoachOrAdmin ? "My playlists" : coachView === "by-me" ? "Shared by me" : "Shared with me";
    return (
      <Page>
        <Toolbar
          variant="static"
          leading={
            <Button variant="ghost" size="sm" className="-ml-1 shrink-0 text-muted-foreground" onClick={() => setWatching(null)}>
              <ChevronLeft />
              {backLabel}
            </Button>
          }
          title={selected.name}
          subtitle={[
            own ? "Your playlist" : `From ${sharer?.fullName ?? sharer?.email ?? "your coach"}`,
            `${selectedProgress.total} clip${selectedProgress.total === 1 ? "" : "s"}`,
          ].join(" · ")}
        />
        <WatchView
          key={selected.id}
          title={selected.name}
          items={watchItems}
          matchTitleFor={(id) => (multiGame ? matchLookup.get(id)?.title : undefined)}
          isWatched={(m, e) => isWatched(selected.id, m, e)}
          onWatched={(m, e) => recordWatched(selected.id, m, e)}
          progress={selectedProgress}
          startKey={watching?.startKey ?? null}
          autoplay={watching?.autoplay ?? false}
        />
      </Page>
    );
  }

  // ---------------------------------------------------------------- lists
  const search = showDashboard ? (
    <SearchField
      placeholder="Search playlists"
      aria-label="Search playlists"
      value={dashboardQuery}
      onChange={(e) => setDashboardQuery(e.target.value)}
    />
  ) : feed.length > 0 ? (
    <SearchField
      placeholder="Search playlists"
      aria-label="Search playlists"
      value={feedFilters.query}
      onChange={(e) => setFeedFilters((f) => ({ ...f, query: e.target.value }))}
    />
  ) : undefined;

  const feedFilterButtons = !showDashboard && (sharerOptions.length > 0 || sourceOptions.length > 1) && (
    <>
      {sharerOptions.length > 0 && (
        <PopUpButton
          aria-label="From"
          align="end"
          value={feedFilters.sharer}
          onValueChange={(sharer) => setFeedFilters((f) => ({ ...f, sharer }))}
          options={[
            { value: "all", label: "From everyone" },
            ...sharerOptions.filter((o) => o.value !== "all").map((o) => ({ value: o.value, label: `From ${o.label}` })),
          ]}
        />
      )}
      {sourceOptions.length > 1 && (
        <PopUpButton
          aria-label="Team"
          align="end"
          value={feedFilters.source}
          onValueChange={(source) => setFeedFilters((f) => ({ ...f, source }))}
          options={sourceOptions}
        />
      )}
    </>
  );

  return (
    <Page>
      <Toolbar
        title={isCoachOrAdmin ? "Shared playlists" : "My playlists"}
        principal={
          isCoachOrAdmin ? (
            <SegmentedControl
              aria-label="Shared playlists"
              value={coachView}
              onValueChange={setCoachView}
              options={[
                { value: "by-me", label: "Shared by me" },
                { value: "with-me", label: "Shared with me" },
              ]}
            />
          ) : undefined
        }
        search={search}
        actions={feedFilterButtons || undefined}
      />
      <PageContent width="medium">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : showDashboard ? (
          <SharedByMe
            shared={sharedOutPlaylists}
            memberMap={memberMap}
            teamMap={teamMap}
            currentUserId={currentUserId}
            query={dashboardQuery}
            onOpenPlaylist={(pl) => open(pl, false)}
            onManageShare={openShare}
          />
        ) : (
          <PlaylistFeed
            playlists={feed}
            filters={feedFilters}
            onWatchChange={(watch) => setFeedFilters((f) => ({ ...f, watch }))}
            onClearFilters={() => setFeedFilters(EMPTY_FEED_FILTERS)}
            onOpen={(id) => openById(id, false)}
            onResume={(id) => openById(id, true)}
            welcome={!isCoachOrAdmin ? <WelcomeCallout /> : undefined}
            emptyBody={isCoachOrAdmin ? "Playlists other coaches share with you show up here." : undefined}
            emptyAction={
              !isCoachOrAdmin && personalOrg ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    trackEvent("player_feed_personal_space_link");
                    setActiveOrg(personalOrg.orgId);
                    navigate("/");
                  }}
                >
                  Build your own highlight tape
                </Button>
              ) : undefined
            }
          />
        )}
      </PageContent>

      <Dialog open={shareTarget !== null} onOpenChange={(o) => !o && !sharing && setShareTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share playlist</DialogTitle>
            <DialogDescription>Choose the teams and members who can watch “{shareTarget?.name}”.</DialogDescription>
          </DialogHeader>
          <ShareRecipients
            teams={allOrgTeams}
            members={[...memberMap.values()].filter((m) => m.id !== currentUserId)}
            teamIds={shareTeamIds}
            userIds={shareUserIds}
            onToggleTeam={(id) =>
              setShareTeamIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onToggleUser={(id) =>
              setShareUserIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
          {(() => {
            // This page can't upload (no local footage here); the editor can.
            const unshipped = shareTarget?.items.filter((i) => i.type === "clip" && !i.r2Url).length ?? 0;
            if (!shareTarget || unshipped === 0) return null;
            const target = shareTarget;
            return (
              <Callout
                tone="warning"
                action={
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => navigate("/playlists", { state: { restore: { playlistId: target.id }, reship: true } })}
                  >
                    Upload missing clips
                  </Button>
                }
              >
                {unshipped === 1
                  ? "1 clip isn't uploaded yet, so recipients don't see it."
                  : `${unshipped} clips aren't uploaded yet, so recipients don't see them.`}
              </Callout>
            );
          })()}
          <DialogFooter>
            {((shareTarget?.teamIds?.length ?? 0) > 0 || (shareTarget?.userIds?.length ?? 0) > 0) && (
              <Button variant="ghost" className="mr-auto text-destructive" disabled={sharing} onClick={() => handleShare([], [])}>
                Stop sharing
              </Button>
            )}
            <Button variant="outline" disabled={sharing} onClick={() => setShareTarget(null)}>
              Cancel
            </Button>
            <Button disabled={sharing} onClick={() => handleShare([...shareTeamIds], [...shareUserIds])}>
              {sharing && <Loader2 className="animate-spin" />}
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
