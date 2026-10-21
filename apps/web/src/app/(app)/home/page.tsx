"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Film, ListVideo, Loader2, Plus, Ticket } from "lucide-react";
import { isEditorUser } from "@scoutable/shared/lib/app-nav";
import { folderPath } from "@scoutable/shared/lib/folder-tree";
import { computeHomeHero } from "@scoutable/shared/lib/home-hero";
import { listFolders, listMatchesLight } from "@scoutable/shared/lib/matches-db";
import { listOwnPlaylistsAndShared, type SharedPlaylist } from "@scoutable/shared/lib/playlists-db";
import { buildDashboardRows, latestBehindPlaylist, summarizeDashboard, type DashboardRow } from "@scoutable/shared/lib/shared-by-me";
import { getTeamMembers } from "@scoutable/shared/lib/teams-db";
import type { Playlist, PlaylistFolder, StoredMatch } from "@scoutable/shared/types/match";
import { AdminSetupCard } from "@/components/admin-setup-card";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { LibraryRow } from "@/components/game/library-row";
import { GettingStarted } from "@/components/home/getting-started";
import { NextActionHero } from "@/components/home/next-action-hero";
import { TeamEngagement } from "@/components/home/team-engagement";
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { PlaylistRow, playlistClipCount } from "@/components/playlist/playlist-row";
import { ShareDialog } from "@/components/playlist/share-dialog";
import { requestShipAfterShare, shareReadiness } from "@/components/playlist/share-readiness";
import { useNewPlaylist } from "@/components/playlist/use-new-playlist";
import { RolePrompt } from "@/components/role-prompt";
import { useNavUser } from "@/components/shell/nav";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { GroupHeader, GroupRow, GroupedList } from "@/components/ui/group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { listPlaylistClipViews } from "@/lib/clip-views-db";
import { GAME_VIDEO_CHANGED, useMyGameVideos } from "@/lib/game-videos";
import { bulkSendReminders } from "@/lib/reminders-bulk";
import { createClient } from "@/lib/supabase/client";

const RECENT_MATCH_COUNT = 3;
const PLAYLIST_ROW_COUNT = 6;

interface HomeData {
  orgId: string | null;
  matches: StoredMatch[];
  playlists: Playlist[];
  /** The shared subset of `playlists`, with share timestamps: the engagement dashboard's base. */
  shared: SharedPlaylist[];
  folders: PlaylistFolder[];
}

/**
 * The signed-in landing for coaches and anyone in their personal space: a
 * port of the desktop's Home. The getting-started checklist (or the club
 * admin's setup card) until it is dismissed, then one next action; the
 * team's engagement in club spaces; the newest playlists and imports. Club
 * players and player-only users are sent on to their playlist feed, the
 * desktop's rule.
 */
export default function HomePage() {
  const router = useRouter();
  const { user, profile, profileLoading, activeOrgId, activeOrgIsPersonal, activeOrgRole, myOrgs, setActiveOrg } = useAuth();
  const navUser = useNavUser();
  const editor = navUser ? isEditorUser(navUser) : null;
  const canImport = navUser?.canImport ?? false;
  const { createNew, creating } = useNewPlaylist();
  // Every state, so the recent imports read like the Library's rows.
  const { byMatch } = useMyGameVideos({ orgId: activeOrgId, enabled: !profileLoading });
  const isClubSpace = !activeOrgIsPersonal;

  useEffect(() => {
    if (editor === false) router.replace("/my-playlists");
  }, [editor, router]);

  const [data, setData] = useState<HomeData | null>(null);
  /** Personal spaces: whether the user has made a highlight link (Send to my phone, on any device); their own rows, by RLS. */
  const [links, setLinks] = useState<{ userId: string; any: boolean } | null>(null);
  const [dashboard, setDashboard] = useState<{ orgId: string; rows: DashboardRow[] } | null>(null);
  const [dashboardTick, setDashboardTick] = useState(0);
  const [reminding, setReminding] = useState(false);
  const [sharing, setSharing] = useState<Playlist | null>(null);

  // A game's video changing here (an import finished, a removal) re-reads
  // the games too. Not keyed on the games list itself: it arrives after the
  // first read and would make every visit read everything twice.
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    const onChange = () => setReloadTick((t) => t + 1);
    window.addEventListener(GAME_VIDEO_CHANGED, onChange);
    return () => window.removeEventListener(GAME_VIDEO_CHANGED, onChange);
  }, []);

  useEffect(() => {
    if (profileLoading || !editor) return;
    const supabase = createClient();
    const orgId = activeOrgId ?? undefined;
    const scope = { includeUnscoped: activeOrgIsPersonal };
    let cancelled = false;
    void Promise.all([
      listMatchesLight(supabase, orgId, { ownOnly: true, ...scope }).catch(() => [] as StoredMatch[]),
      // One read for the list and the engagement dashboard's shared subset.
      listOwnPlaylistsAndShared(supabase, orgId, scope).catch(() => ({ playlists: [] as Playlist[], shared: [] as SharedPlaylist[] })),
      listFolders(supabase, orgId, scope).catch(() => [] as PlaylistFolder[]),
    ]).then(([matches, own, folders]) => {
      if (!cancelled) setData({ orgId: activeOrgId, matches, playlists: own.playlists, shared: own.shared, folders });
    });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, editor, activeOrgId, activeOrgIsPersonal, reloadTick]);

  const userId = user?.id ?? null;
  useEffect(() => {
    if (profileLoading || !editor || isClubSpace || !userId) return;
    let cancelled = false;
    void createClient()
      .from("highlight_shares")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .then(({ count, error }) => {
        // A failed read keeps the nudge away rather than repeating it.
        if (!cancelled) setLinks({ userId, any: !!error || (count ?? 0) > 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, editor, isClubSpace, userId]);
  // Unknown until read: the hero and the checklist wait for it rather than change under the user.
  const hasExported = isClubSpace ? true : links && links.userId === userId ? links.any : null;

  // Shared-by-me engagement (club spaces only). Name maps are left out on
  // purpose: the strip and the hero need counts and remind targets only.
  // The shared playlists come with the page's own read (listOwnPlaylistsAndShared).
  const sharedForDashboard = data && data.orgId === activeOrgId ? data.shared : null;
  useEffect(() => {
    if (profileLoading || !editor || !isClubSpace || !activeOrgId || !sharedForDashboard) return;
    const supabase = createClient();
    const orgId = activeOrgId;
    const shared = sharedForDashboard;
    // Nothing shared: no rows (derived below), nothing to read.
    if (shared.length === 0) return;
    let cancelled = false;
    const teamIds = [...new Set(shared.flatMap((p) => p.teamShares.map((t) => t.teamId)))];
    Promise.all([getTeamMembers(supabase, teamIds), listPlaylistClipViews(shared.map((p) => p.id))])
      .then(([teamMembers, views]) => {
        if (cancelled) return;
        setDashboard({
          orgId,
          rows: buildDashboardRows({ shared, teamMembers, views, memberMap: new Map(), teamMap: new Map(), currentUserId: user?.id ?? null }),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileLoading, editor, isClubSpace, activeOrgId, user?.id, dashboardTick, sharedForDashboard]);

  const loading = navUser === null || data === null || data.orgId !== activeOrgId;
  const matches = useMemo(() => (loading ? [] : data!.matches), [loading, data]);
  const playlists = useMemo(() => (loading ? [] : data!.playlists), [loading, data]);
  const folders = data?.folders ?? [];
  const rows = useMemo(
    () => (isClubSpace && sharedForDashboard?.length !== 0 && dashboard?.orgId === activeOrgId ? dashboard.rows : []),
    [isClubSpace, sharedForDashboard, dashboard, activeOrgId],
  );
  const summary = useMemo(() => summarizeDashboard(rows), [rows]);
  // The hero's remind scope: the newest shared playlist with stragglers.
  const latestBehind = useMemo(() => latestBehindPlaylist(rows), [rows]);

  const readyMatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [matchId, video] of byMatch) if (video.status === "ready") ids.add(matchId);
    return ids;
  }, [byMatch]);
  const matchesById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  // The game the add-clips panel opens on: the newest with a copy to clip (listMatchesLight is newest import first).
  const newestReadyMatchId = useMemo(() => matches.find((m) => readyMatchIds.has(m.id))?.id ?? null, [matches, readyMatchIds]);
  const addClipsHref = useCallback(
    (playlistId: string) =>
      `/playlists/${encodeURIComponent(playlistId)}${newestReadyMatchId ? `?add=${encodeURIComponent(newestReadyMatchId)}` : ""}`,
    [newestReadyMatchId],
  );
  const demo = matches.find((m) => m.isDemo) ?? null;
  // The sample game is seeded by the desktop; on the web it is only worth a visit once it has a copy.
  const demoHref = demo && readyMatchIds.has(demo.id) ? `/library/${encodeURIComponent(demo.id)}?from=home` : null;

  const hero = useMemo(
    () =>
      computeHomeHero({
        ownGameCount: matches.filter((m) => !m.isDemo).length,
        demoMatchId: demo?.id ?? null,
        playlists: playlists.map((p) => ({ id: p.id, name: p.name, clipCount: playlistClipCount(p) })),
        isClubSpace,
        hasSharedAny: rows.length > 0,
        latestBehind: latestBehind
          ? { playlistId: latestBehind.playlistId, playlistName: latestBehind.playlistName, behindCount: latestBehind.behindCount }
          : null,
        hasExported: hasExported ?? true,
      }),
    [matches, demo?.id, playlists, isClubSpace, rows.length, latestBehind, hasExported],
  );

  async function handleRemindLatest() {
    if (reminding || !latestBehind || latestBehind.targets.length === 0) return;
    setReminding(true);
    try {
      await bulkSendReminders(latestBehind.targets);
    } finally {
      setReminding(false);
    }
  }

  const readiness = useMemo(() => (sharing ? shareReadiness(sharing, readyMatchIds, matchesById) : undefined), [sharing, readyMatchIds, matchesById]);
  function handleShared(playlist: Playlist, teamIds: string[], userIds: string[]) {
    setData((prev) =>
      prev ? { ...prev, playlists: prev.playlists.map((p) => (p.id === playlist.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p)) } : prev,
    );
    setDashboardTick((t) => t + 1);
    if (teamIds.length + userIds.length > 0 && (readiness?.prepare ?? 0) > 0) requestShipAfterShare(playlist.id);
  }

  const showChecklist = profile?.onboardingChecklistDismissedAt == null;
  const isClubAdmin = isClubSpace && activeOrgRole === "admin";
  const canInvite = isClubSpace && (activeOrgRole === "coach" || activeOrgRole === "admin");
  // Club players in their personal space get the road back: the coach's
  // shares live in the club space, one click away.
  const playerClub = activeOrgIsPersonal ? (myOrgs.find((o) => !o.isPersonal && o.role === "player") ?? null) : null;
  const newPlaylist = () => void createNew();

  return (
    <Page width="wide">
      <Toolbar
        title="Home"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={newPlaylist} disabled={creating} aria-label="New playlist">
              {creating ? <Loader2 className="animate-spin" /> : <ListVideo />}
              <span className="hidden sm:inline">New playlist</span>
            </Button>
            {canImport && (
              <Button size="sm" asChild>
                <ImportEntryLink placement="home_toolbar">
                  <Plus />
                  Import a game
                </ImportEntryLink>
              </Button>
            )}
          </>
        }
      />
      <PageContent>
        <div className="space-y-8">
          {playerClub && (
            <p className="text-sm text-muted-foreground">
              Playlists your coach shares live in the {playerClub.orgName} space.{" "}
              <button
                type="button"
                onClick={() => setActiveOrg(playerClub.orgId)}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Open {playerClub.orgName}
              </button>
            </p>
          )}

          {!loading &&
            hasExported !== null &&
            showChecklist &&
            (isClubAdmin ? (
              <AdminSetupCard />
            ) : (
              <GettingStarted
                matches={matches}
                playlists={playlists}
                readyMatchIds={readyMatchIds}
                hasExported={hasExported}
                onNewPlaylist={newPlaylist}
                creating={creating}
                addClipsHref={addClipsHref}
              />
            ))}

          {/* One next action at every stage; the checklist says the same
              things while it is up, so the hero waits for it to go. */}
          {!loading && hasExported !== null && !showChecklist && (
            <>
              <RolePrompt />
              <NextActionHero
                hero={hero}
                onNewPlaylist={newPlaylist}
                creating={creating}
                addClipsHref={addClipsHref}
                onShare={(id) => setSharing(playlists.find((p) => p.id === id) ?? null)}
                onRemind={() => void handleRemindLatest()}
                reminding={reminding}
                demoHref={demoHref}
              />
            </>
          )}

          {isClubSpace && <TeamEngagement summary={summary} canInvite={canInvite} />}

          <section>
            <GroupHeader
              title={
                <>
                  Playlists
                  {!loading && <span className="ml-1.5 font-normal text-muted-foreground nums">{playlists.length}</span>}
                </>
              }
              action={
                <Link href="/playlists" className="text-sm text-primary hover:underline">
                  View all
                </Link>
              }
            />
            {loading ? (
              <SkeletonRows count={3} />
            ) : playlists.length === 0 ? (
              <GroupedList>
                <EmptyState
                  icon={<ListVideo />}
                  title="No playlists yet"
                  body="Create a playlist and add clips from your games."
                  action={
                    <Button onClick={newPlaylist} disabled={creating}>
                      {creating && <Loader2 className="animate-spin" />}
                      New playlist
                    </Button>
                  }
                />
              </GroupedList>
            ) : (
              <GroupedList>
                {playlists.slice(0, PLAYLIST_ROW_COUNT).map((playlist) => (
                  <PlaylistRow
                    key={playlist.id}
                    playlist={playlist}
                    folderLabel={playlist.folderId ? folderPath(folders, playlist.folderId).join(" / ") || null : null}
                    onOpen={() => router.push(`/playlists/${encodeURIComponent(playlist.id)}`)}
                  />
                ))}
              </GroupedList>
            )}
          </section>

          <section>
            <GroupHeader
              title="Recent imports"
              action={
                <Link href="/library" className="text-sm text-primary hover:underline">
                  View all
                </Link>
              }
            />
            {loading ? (
              <SkeletonRows count={3} />
            ) : matches.length === 0 ? (
              <GroupedList>
                <EmptyState
                  icon={<Film />}
                  title="No games yet"
                  body={canImport ? "Import a game to start building playlists." : "Games you import show up here."}
                  action={
                    canImport ? (
                      <Button asChild>
                        <ImportEntryLink placement="get_started">
                          <Plus />
                          Import a game
                        </ImportEntryLink>
                      </Button>
                    ) : undefined
                  }
                />
              </GroupedList>
            ) : (
              <GroupedList>
                {matches.slice(0, RECENT_MATCH_COUNT).map((match) => (
                  <LibraryRow
                    key={match.id}
                    match={match}
                    video={byMatch.get(match.id) ?? null}
                    canUpload={canImport}
                    onOpen={() => router.push(`/library/${encodeURIComponent(match.id)}?from=home`)}
                  />
                ))}
              </GroupedList>
            )}
          </section>

          {/* What the Get started page used to offer a personal space. */}
          {!loading && activeOrgIsPersonal && (
            <GroupedList>
              <GroupRow leading={<Ticket />} label="Joining a team? Enter your invite code" chevron onClick={() => router.push("/onboarding")} />
              <GroupRow leading={<CreditCard />} label="Manage your plan" chevron onClick={() => router.push("/profile")} />
            </GroupedList>
          )}
        </div>
      </PageContent>

      {isClubSpace && (
        <ShareDialog playlist={sharing} orgId={activeOrgId} onClose={() => setSharing(null)} onShared={handleShared} readiness={readiness} />
      )}
    </Page>
  );
}
