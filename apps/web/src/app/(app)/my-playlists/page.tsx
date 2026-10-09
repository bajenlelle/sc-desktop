"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sharerFilterOptions } from "@scoutable/shared/lib/playlist-feed";
import { isMultiGame } from "@scoutable/shared/lib/watch-queue";
import { isClipItem, type Playlist } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { AdminSetupCard } from "@/components/admin-setup-card";
import { EMPTY_FEED_FILTERS, PlaylistFeed, type FeedFilters } from "@/components/playlist/PlaylistFeed";
import { SharedByMe } from "@/components/playlist/SharedByMe";
import { ShareRecipients } from "@/components/playlist/share-recipients";
import { useSharedPlaylists } from "@/components/playlist/use-shared-playlists";
import { WatchView } from "@/components/playlist/watch-view";
import { BackButton } from "@/components/shell/back-button";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { WelcomeCard } from "@/components/welcome-card";

/**
 * Playlists shared with the user (and, for coaches, the ones they share):
 * the feed, the coach's sharing dashboard, and the watch view for the
 * playlist named in ?p=.
 */
export default function MyPlaylistsPage() {
  const { activeOrgRole, isPlayerOnly } = useAuth();
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
    allOrgTeams,
    teamMap,
    memberMap,
  } = useSharedPlaylists();

  const [shareTarget, setShareTarget] = useState<Playlist | null>(null);
  // Which perspective a coach is on: their sharing dashboard or the
  // received-playlists view. Players never see the switch.
  const [coachTab, setCoachTab] = useState<"by-me" | "with-me">("by-me");
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  const [dashboardQuery, setDashboardQuery] = useState("");
  const [shareTeamIds, setShareTeamIds] = useState<Set<string>>(new Set());
  const [shareUserIds, setShareUserIds] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);

  const sharerOptions = useMemo(() => sharerFilterOptions(feedItems), [feedItems]);
  const multiGame = useMemo(() => isMultiGame(watchItems), [watchItems]);

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
      await shareTo(target, teamIds, userIds);
    } catch (e) {
      toast.error("Couldn't update sharing", { description: (e as Error).message });
      return;
    } finally {
      setSharing(false);
    }
    setShareTarget(null);
  }

  const toggleIn = (set: (fn: (prev: Set<string>) => Set<string>) => void) => (id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  // This page can't upload (no footage on the web); the desktop app can.
  const unshipped = shareTarget?.items.filter((i) => isClipItem(i) && !i.r2Url).length ?? 0;
  const hasRecipients = (shareTarget?.teamIds?.length ?? 0) > 0 || (shareTarget?.userIds?.length ?? 0) > 0;
  const shareDialog = (
    <Dialog open={shareTarget !== null} onOpenChange={(open) => !open && !sharing && setShareTarget(null)}>
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
          onToggleTeam={toggleIn(setShareTeamIds)}
          onToggleUser={toggleIn(setShareUserIds)}
        />
        {unshipped > 0 && (
          <Callout tone="warning" icon={<AlertTriangle />}>
            {unshipped === 1
              ? "1 clip isn't uploaded yet, so recipients don't see it. Upload it from the desktop app."
              : `${unshipped} clips aren't uploaded yet, so recipients don't see them. Upload them from the desktop app.`}
          </Callout>
        )}
        <DialogFooter>
          {hasRecipients && (
            <Button variant="ghost" className="text-destructive sm:mr-auto" disabled={sharing} onClick={() => handleShare([], [])}>
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
          emptyText={
            own
              ? "No clips yet. Add clips to this playlist in the desktop app."
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
              onOpenPlaylist={openPlaylist}
              onManageShare={openShare}
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
