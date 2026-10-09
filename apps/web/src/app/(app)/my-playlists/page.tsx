"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { sharerFilterOptions } from "@scoutable/shared/lib/playlist-feed";
import { isMultiGame } from "@scoutable/shared/lib/watch-queue";
import { isClipItem, type Playlist } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { AdminSetupCard } from "@/components/admin-setup-card";
import { EMPTY_FEED_FILTERS, PlaylistFeed, type FeedFilters } from "@/components/playlist/PlaylistFeed";
import { SharedByMe } from "@/components/playlist/SharedByMe";
import { useSharedPlaylists } from "@/components/playlist/use-shared-playlists";
import { WatchView } from "@/components/playlist/watch-view";
import { BackButton } from "@/components/shell/back-button";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { WelcomeCard } from "@/components/welcome-card";
import { cn } from "@/lib/utils";

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
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());
  const [pendingShareUserIds, setPendingShareUserIds] = useState<Set<string>>(new Set());
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");

  const sharerOptions = useMemo(() => sharerFilterOptions(feedItems), [feedItems]);
  const multiGame = useMemo(() => isMultiGame(watchItems), [watchItems]);

  async function handleShare(teamIds: string[], userIds: string[]) {
    if (!shareTarget) return;
    await shareTo(shareTarget, teamIds, userIds);
    setShareTarget(null);
  }

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
          !showDashboard && feedItems.length > 0 ? (
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
              onOpenPlaylist={openPlaylist}
              onManageShare={(pl) => {
                setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                setPendingShareUserIds(new Set(pl.userIds ?? []));
                setShareTarget(pl);
              }}
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
