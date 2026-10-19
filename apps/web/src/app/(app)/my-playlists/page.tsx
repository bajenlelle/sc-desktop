"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { sharerFilterOptions } from "@scoutable/shared/lib/playlist-feed";
import { canScrubPlaylist, isMultiGame } from "@scoutable/shared/lib/watch-queue";
import type { Playlist } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { AdminSetupCard } from "@/components/admin-setup-card";
import { EMPTY_FEED_FILTERS, PlaylistFeed, type FeedFilters } from "@/components/playlist/PlaylistFeed";
import { SharedByMe } from "@/components/playlist/SharedByMe";
import { ShareDialog } from "@/components/playlist/share-dialog";
import { shareReadiness } from "@/components/playlist/share-readiness";
import { useSharedPlaylists } from "@/components/playlist/use-shared-playlists";
import { WatchView } from "@/components/playlist/watch-view";
import { BackButton } from "@/components/shell/back-button";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { WelcomeCard } from "@/components/welcome-card";
import { trackEvent } from "@/lib/analytics";
import { useMyCloudGames } from "@/lib/game-videos";

/**
 * Playlists shared with the user (and, for coaches, the ones they share):
 * the feed, the coach's sharing dashboard, and the watch view for the
 * playlist named in ?p=.
 */
export default function MyPlaylistsPage() {
  const { activeOrgId, activeOrgRole, isPlayerOnly, myOrgs, profileLoading } = useAuth();
  const {
    loading,
    selectedId,
    selected,
    openPlaylist,
    resumePlaylist,
    autoplay,
    consumeAutoplay,
    watchItems,
    startKey,
    matchLookup,
    feedItems,
    sourceOptions,
    sharedOutPlaylists,
    shareTo,
    isClipWatched,
    recordWatched,
    selectedProgress,
    currentUserId,
    userRole,
    teamMap,
    memberMap,
    windowSrc,
    gameHrefFor,
  } = useSharedPlaylists();
  // The viewer's ready copies: what the share dialog can promise to prepare.
  const cloud = useMyCloudGames({ enabled: !profileLoading });

  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  // Which perspective a coach is on: their sharing dashboard or the
  // received-playlists view. Players never see the switch.
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  const [dashboardQuery, setDashboardQuery] = useState("");

  const sharerOptions = useMemo(() => sharerFilterOptions(feedItems), [feedItems]);
  const multiGame = useMemo(() => isMultiGame(watchItems), [watchItems]);
  const shareReady = useMemo(
    () => (shareTarget ? shareReadiness(shareTarget, new Set(cloud.byMatch.keys()), matchLookup) : undefined),
    [shareTarget, cloud.byMatch, matchLookup],
  );

  const isCoachOrAdmin = userRole === "coach" || userRole === "admin";
  const showDashboard = isCoachOrAdmin && coachTab === "by-me";
  // Matches the navigation's label for this page (shared/lib/app-nav.ts).
  const title =
    !isPlayerOnly && (activeOrgRole === "coach" || activeOrgRole === "admin") ? "Shared playlists" : "My playlists";

  if (loading) {
    return (
      <Page width="medium">
        <Toolbar title={selectedId ? "" : title} inline={!!selectedId} />
        <PageContent>
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </PageContent>
      </Page>
    );
  }

  // The shared dialog writes the shares; this page only updates its copy.
  const shareDialog = (
    <ShareDialog
      playlist={shareTarget}
      orgId={activeOrgId}
      onClose={() => setShareTarget(null)}
      onShared={(pl, teamIds, userIds) => shareTo(pl, teamIds, userIds)}
      readiness={shareReady}
    />
  );

  // ---------------------------------------------------------------- watch
  if (selected) {
    const sharer = selected.sharedBy
      ? memberMap.get(selected.sharedBy)
      : selected.createdBy
        ? memberMap.get(selected.createdBy)
        : undefined;
    const own = !!currentUserId && selected.createdBy === currentUserId;
    // Named after where it goes: a coach returns to the view they came from
    // (coachTab survives the ?p= round trip).
    const backLabel = !isCoachOrAdmin ? "My playlists" : coachTab === "by-me" ? "Shared by me" : "Shared with me";
    return (
      <Page width="full">
        <Toolbar
          inline
          title={selected.name}
          subtitle={[
            own ? "Your playlist" : `From ${sharer?.fullName ?? sharer?.email ?? "your coach"}`,
            `${selectedProgress.total} clip${selectedProgress.total === 1 ? "" : "s"}`,
          ].join(" · ")}
          leading={<BackButton href="/my-playlists" label={backLabel} />}
        />
        <WatchView
          key={selected.id}
          title={selected.name}
          items={watchItems}
          matchTitleFor={(id) => (multiGame ? matchLookup.get(id)?.title : undefined)}
          isWatched={(m, e) => isClipWatched(selected.id, m, e)}
          onWatched={(m, e) => recordWatched(selected.id, m, e)}
          progress={selectedProgress}
          startKey={startKey}
          autoplay={autoplay}
          onAutoplayStarted={consumeAutoplay}
          canScrub={canScrubPlaylist({ userId: currentUserId, myOrgs }, selected)}
          windowSrc={windowSrc}
          gameHrefFor={gameHrefFor}
          onWindowPlayed={() => trackEvent("clip_played_from_game", { playlist_id: selected.id })}
          emptyText={
            own
              ? "No clips yet. Open the playlist to add clips from your games."
              : isCoachOrAdmin
                ? "No clips to watch yet."
                : "No clips to watch yet. Your coach may still be uploading them."
          }
        />
      </Page>
    );
  }

  // ---------------------------------------------------------------- lists
  const filterButtons = !showDashboard && (sharerOptions.length > 0 || sourceOptions.length > 1) && (
    <>
      {sharerOptions.length > 0 && (
        <PopUpButton
          aria-label="From"
          align="end"
          size="sm"
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
          size="sm"
          value={feedFilters.source}
          onValueChange={(source) => setFeedFilters((f) => ({ ...f, source }))}
          options={sourceOptions}
        />
      )}
    </>
  );

  return (
    <Page width="medium">
      <Toolbar
        title={title}
        principal={
          isCoachOrAdmin ? (
            <SegmentedControl
              aria-label="Shared playlists"
              value={coachTab}
              onValueChange={setCoachTab}
              options={[
                { value: "by-me", label: "Shared by me" },
                { value: "with-me", label: "Shared with me" },
              ]}
            />
          ) : undefined
        }
        search={
          showDashboard ? (
            <SearchField
              placeholder="Search playlists"
              aria-label="Search playlists"
              value={dashboardQuery}
              onChange={(e) => setDashboardQuery(e.target.value)}
            />
          ) : feedItems.length > 0 ? (
            <SearchField
              placeholder="Search playlists"
              aria-label="Search playlists"
              value={feedFilters.query}
              onChange={(e) => setFeedFilters((f) => ({ ...f, query: e.target.value }))}
            />
          ) : undefined
        }
        actions={filterButtons ? <div className="hidden items-center gap-2 lg:flex">{filterButtons}</div> : undefined}
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
              query={dashboardQuery}
              onClearQuery={() => setDashboardQuery("")}
              onOpenPlaylist={openPlaylist}
              onManageShare={setShareTarget}
            />
          </>
        ) : (
          <PlaylistFeed
            playlists={feedItems}
            filters={feedFilters}
            onWatchChange={(watch) => setFeedFilters((f) => ({ ...f, watch }))}
            onClearFilters={() => setFeedFilters(EMPTY_FEED_FILTERS)}
            onOpen={openPlaylist}
            onResume={resumePlaylist}
            welcome={<WelcomeCard />}
            emptyBody={isCoachOrAdmin ? "Playlists other coaches share with you show up here." : undefined}
            filterControls={filterButtons || undefined}
          />
        )}
      </PageContent>
      {shareDialog}
    </Page>
  );
}
