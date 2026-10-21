import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Film, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { GroupedList } from "@/components/ui/group";
import { EmptyState } from "@/components/empty-state";
import { MatchRow } from "@/components/match-row";
import { RelinkVideosDialog } from "@/components/relink-videos-dialog";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { listMatchesLight } from "@/lib/matches-db";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";
import { useAuth } from "@/lib/auth-context";
import type { StoredMatch } from "@/types/match";

export function MatchesPage() {
  const { activeOrgId, activeOrgRole, activeOrgIsPersonal, profileLoading } = useAuth();
  const navigate = useNavigate();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [videoStatus, setVideoStatus] = useState<Map<string, VideoFileStatus>>(new Map());

  // Machine-switch detection: matches sync via the DB, but video files live
  // on the machine that imported them. Probe each local path (1-byte local
  // fetch per game) so dead references get a badge instead of a black player.
  useEffect(() => {
    if (matches.length === 0) return;
    let cancelled = false;
    probeMatches(matches).then((map) => {
      if (!cancelled) setVideoStatus(map);
    });
    return () => { cancelled = true; };
  }, [matches]);

  const missingMatches = useMemo(
    () =>
      matches.filter((m) => {
        const s = videoStatus.get(m.id);
        return s !== undefined && s !== "ok";
      }),
    [matches, videoStatus],
  );

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return matches;
    const q = search.toLowerCase();
    return matches.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.homeTeam.name.toLowerCase().includes(q) ||
        m.awayTeam.name.toLowerCase().includes(q)
    );
  }, [matches, search]);

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
        subtitle={!loading && matches.length > 0 ? `${matches.length} games` : undefined}
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
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No games match your search"
            body="Try a different title or team name."
          />
        ) : (
          <GroupedList>
            {filtered.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                videoStatus={videoStatus.get(match.id)}
                onDelete={() => setMatches((ms) => ms.filter((m) => m.id !== match.id))}
              />
            ))}
          </GroupedList>
        )}
      </PageContent>
    </Page>
  );
}
