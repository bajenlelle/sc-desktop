import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Film, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { GroupedList, GroupHeader } from "@/components/ui/group";
import { EmptyState } from "@/components/empty-state";
import { MatchRow } from "@/components/match-row";
import { RelinkVideosDialog } from "@/components/relink-videos-dialog";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { gameTabsScope, useGameTabs } from "@/lib/game-tabs";
import { listMatchesLight, setMatchArchived } from "@/lib/matches-db";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";
import { useAuth } from "@/lib/auth-context";
import { Sentry } from "@/lib/sentry";
import type { StoredMatch } from "@/types/match";

function filterBySearch(list: StoredMatch[], search: string): StoredMatch[] {
  if (!search.trim()) return list;
  const q = search.toLowerCase();
  return list.filter(
    (m) =>
      m.title.toLowerCase().includes(q) ||
      m.homeTeam.name.toLowerCase().includes(q) ||
      m.awayTeam.name.toLowerCase().includes(q)
  );
}

export function MatchesPage() {
  const { user, activeOrgId, activeOrgRole, activeOrgIsPersonal, profileLoading } = useAuth();
  // The games open on this computer (the sidebar's Open games), marked Open in the list.
  const gameTabs = useGameTabs(gameTabsScope(user?.id, activeOrgId));
  const openInTabs = useMemo(() => new Set(gameTabs.tabs.map((t) => t.id)), [gameTabs.tabs]);
  const navigate = useNavigate();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Not remembered across visits: archived is the exception.
  const [showArchived, setShowArchived] = useState(false);
  const [videoStatus, setVideoStatus] = useState<Map<string, VideoFileStatus>>(new Map());

  // Machine-switch detection: matches sync via the DB, but video files live
  // on the machine that imported them. Probe each local path (1-byte local
  // fetch per game) so dead references get a badge instead of a black player.
  // Keyed on each game's video, not the array: archiving restamps `matches`
  // twice (optimistic, then stored) and must not re-probe the library.
  const probeKey = useMemo(() => matches.map((m) => `${m.id}:${m.videoUrl ?? ""}`).join("\n"), [matches]);
  useEffect(() => {
    if (matches.length === 0) return;
    let cancelled = false;
    probeMatches(matches).then((map) => {
      if (!cancelled) setVideoStatus(map);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the games' ids and videos are fully represented by probeKey
  }, [probeKey]);

  // The Library loads archived games too and splits them here, so the toggle
  // is instant and the Archived group can show its count.
  const active = useMemo(() => matches.filter((m) => !m.archivedAt), [matches]);
  const archived = useMemo(() => matches.filter((m) => m.archivedAt), [matches]);

  // Active games only: the Relink dialog never asks about archived ones (their
  // rows still show the badge, probeMatches probes every game).
  const missingMatches = useMemo(
    () =>
      active.filter((m) => {
        const s = videoStatus.get(m.id);
        return s !== undefined && s !== "ok";
      }),
    [active, videoStatus],
  );

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  const filteredActive = useMemo(() => filterBySearch(active, search), [active, search]);
  const filteredArchived = useMemo(() => filterBySearch(archived, search), [archived, search]);

  useEffect(() => {
    if (!canAccess) return;
    setLoading(true);
    const load = () =>
      listMatchesLight(activeOrgId ?? undefined, { ownOnly: true, withEventCount: true })
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setLoading(false));
    load();
    // The sample game is seeded fire-and-forget on first launch and may land
    // after this page already rendered.
    window.addEventListener("demo-seeded", load);
    return () => window.removeEventListener("demo-seeded", load);
  }, [activeOrgId, canAccess]);

  if (!profileLoading && !canAccess) return null;

  // Archived games stay in the list: optimistic, then the database's own stamp.
  // Undo brings the game back; bringing it back needs no toast, the row visibly moves.
  async function setArchived(match: StoredMatch, toArchived: boolean) {
    const setStamp = (archivedAt: string | undefined) =>
      setMatches((ms) => ms.map((m) => (m.id === match.id ? { ...m, archivedAt } : m)));
    setStamp(toArchived ? new Date().toISOString() : undefined);
    let stored: string | null;
    try {
      stored = await setMatchArchived(match.id, toArchived);
    } catch (err) {
      Sentry.captureException(err);
      setStamp(match.archivedAt);
      toast.error(toArchived ? "Couldn't archive the game" : "Couldn't bring the game back", {
        description: "Check the connection and try again.",
      });
      return;
    }
    setStamp(stored ?? undefined);
    if (toArchived) {
      toast("Game archived", {
        // Sonner's own description grey is unreadable on the dark themes.
        description: <span className="text-muted-foreground">Clips from it stay in your playlists.</span>,
        // The row as it is now, so a failed Undo puts it back in the Archived group.
        action: { label: "Undo", onClick: () => void setArchived({ ...match, archivedAt: stored ?? undefined }, false) },
      });
    }
  }

  const searching = search.trim() !== "";
  const archivedRowsShown = showArchived || searching;
  const renderRow = (match: StoredMatch) => (
    <MatchRow
      key={match.id}
      match={match}
      videoStatus={videoStatus.get(match.id)}
      openInTab={openInTabs.has(match.id)}
      onArchive={(a) => void setArchived(match, a)}
      onDelete={() => setMatches((ms) => ms.filter((m) => m.id !== match.id))}
    />
  );

  const importButton = (
    <Button size="sm" asChild>
      <Link to="/upload">
        <Plus />
        Import game
      </Link>
    </Button>
  );

  return (
    <Page>
      <Toolbar
        title="Library"
        subtitle={!loading && matches.length > 0 ? `${active.length} games` : undefined}
        search={
          !loading && matches.length > 0 ? (
            <SearchField
              placeholder="Search games"
              aria-label="Search games"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : undefined
        }
        actions={
          <>
            {missingMatches.length > 0 && (
              <RelinkVideosDialog
                missing={missingMatches}
                onRelinked={() => {
                  // Re-load + re-probe: updateVideoUrl dispatched matches-changed,
                  // but this page's loader only listens for demo-seeded.
                  listMatchesLight(activeOrgId ?? undefined, { ownOnly: true, withEventCount: true })
                    .then(setMatches)
                    .catch(() => {});
                }}
              />
            )}
            {importButton}
          </>
        }
      />
      <PageContent width="wide">
        {loading ? (
          <GroupedList>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <div className="h-7 w-[3px] animate-pulse rounded-full bg-fill-3" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-fill-3" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-fill-2" />
                </div>
              </div>
            ))}
          </GroupedList>
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<Film />}
            title="No games yet"
            body="Import a game and every play becomes a clip, synced to the official play-by-play."
            action={importButton}
          />
        ) : searching && filteredActive.length === 0 && filteredArchived.length === 0 ? (
          <EmptyState
            title="No games match your search"
            body="Try a different title or team name."
          />
        ) : (
          <div className="space-y-8">
            {filteredActive.length > 0 ? (
              <GroupedList>{filteredActive.map(renderRow)}</GroupedList>
            ) : (
              !searching && (
                <EmptyState
                  title="Every game is archived"
                  body="Import a game, or show your archived games below."
                  action={importButton}
                />
              )
            )}
            {archived.length > 0 && (!searching || filteredArchived.length > 0) && (
              <section>
                <GroupHeader
                  title={
                    <>
                      Archived <span className="ml-1.5 font-normal text-muted-foreground nums">{archived.length}</span>
                    </>
                  }
                  action={
                    !searching && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        aria-expanded={showArchived}
                        onClick={() => setShowArchived((v) => !v)}
                      >
                        {showArchived ? "Hide" : "Show"}
                      </Button>
                    )
                  }
                />
                {archivedRowsShown && <GroupedList>{filteredArchived.map(renderRow)}</GroupedList>}
              </section>
            )}
          </div>
        )}
      </PageContent>
    </Page>
  );
}
