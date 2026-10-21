"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Film, Plus } from "lucide-react";
import { filterLibrary, sortLibrary } from "@scoutable/shared/lib/game-library";
import { gameVideoQuotaLabel, getGameVideoQuota, type GameVideoQuota } from "@scoutable/shared/lib/game-videos-db";
import { listMatchesLight } from "@scoutable/shared/lib/matches-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { LibraryRow } from "@/components/game/library-row";
import { ImportEntryLink, type ImportPlacement } from "@/components/import/import-entry-link";
import { importQuotaLabel } from "@/components/import/use-import-checks";
import { useNavUser } from "@/components/shell/nav";
import { Page, PageContent } from "@/components/shell/page";
import { useShell } from "@/components/shell/shell-context";
import { DESKTOP_APP_URL } from "@/components/shell/sidebar";
import { Toolbar } from "@/components/shell/toolbar";
import { ToolbarSearch, focusToolbarSearch } from "@/components/shell/toolbar-search";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupedList } from "@/components/ui/group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { GAME_VIDEO_CHANGED, useMyGameVideos } from "@/lib/game-videos";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { createClient } from "@/lib/supabase/client";

const KEY_SCOPE = "library";

/**
 * Every game of the space the user imported, with where its video stands:
 * in the cloud (and whether the plays are placed), converting, uploading
 * from this or another device, failed, or without a video yet, which is
 * where the upload starts. Only the uploader sees a game's video.
 * Importing starts here too. `/` focuses the search.
 */
export default function LibraryPage() {
  const router = useRouter();
  const { activeOrgId, activeOrgIsPersonal, isPlayerOnly, profileLoading } = useAuth();
  const navUser = useNavUser();
  const { importQuota } = useShell();
  // A player-only user's navigation spans their clubs, so their rows come unscoped.
  const orgId = isPlayerOnly ? null : activeOrgId;
  const { games, byMatch } = useMyGameVideos({ orgId, enabled: !profileLoading });
  const [matches, setMatches] = useState<StoredMatch[] | null>(null);
  const [quota, setQuota] = useState<GameVideoQuota | null>(null);
  const [query, setQuery] = useState("");
  const canImport = navUser?.canImport ?? false;

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
    if (profileLoading) return;
    const supabase = createClient();
    let cancelled = false;
    void listMatchesLight(supabase, orgId ?? undefined, { ownOnly: true, includeUnscoped: activeOrgIsPersonal }).then((rows) => {
      if (!cancelled) setMatches(sortLibrary(rows));
    });
    void getGameVideoQuota(supabase, activeOrgId).then((q) => {
      if (!cancelled) setQuota(q);
    });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, orgId, activeOrgId, activeOrgIsPersonal, reloadTick]);

  useKeyScope(KEY_SCOPE);
  useHotkeys(KEY_SCOPE, (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/" && focusToolbarSearch()) e.preventDefault();
  });

  const filtered = useMemo(() => (matches ? filterLibrary(matches, query) : []), [matches, query]);
  const loading = games === null || matches === null || navUser === null;
  const total = matches?.length ?? 0;
  const noneInCloud = !loading && total > 0 && !matches!.some((m) => byMatch.has(m.id));
  const meters = [canImport ? importQuotaLabel(importQuota) : null, quota ? gameVideoQuotaLabel(quota) : null].filter(Boolean).join(" · ");

  const importButton = (placement: ImportPlacement, size: "sm" | "default" = "sm") => (
    <Button asChild size={size}>
      <ImportEntryLink placement={placement}>
        <Plus />
        Import a game
      </ImportEntryLink>
    </Button>
  );

  return (
    <Page width="medium">
      <Toolbar
        title="Library"
        subtitle={!loading && total > 0 ? `${total} game${total === 1 ? "" : "s"}` : undefined}
        search={
          !loading && total > 0 ? (
            <ToolbarSearch placeholder="Search games" aria-label="Search games" value={query} onChange={(e) => setQuery(e.target.value)} />
          ) : undefined
        }
        actions={canImport && !loading && total > 0 ? importButton("games_toolbar") : undefined}
      />
      <PageContent>
        {loading ? (
          <SkeletonRows count={5} />
        ) : total === 0 ? (
          canImport ? (
            <EmptyState
              icon={<Film />}
              title="No games yet"
              body="Import a league game and upload its video; it plays here with every play lined up, ready to clip."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {importButton("games_empty", "default")}
                  <Button asChild variant="outline">
                    <a href={DESKTOP_APP_URL} target="_blank" rel="noopener noreferrer">
                      Get the desktop app
                    </a>
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={<Film />}
              title="No games in the cloud yet"
              body="Keep a copy of a game in the cloud from its page in the desktop app, and it plays here with every play."
              action={
                <Button asChild variant="outline">
                  <a href={DESKTOP_APP_URL} target="_blank" rel="noopener noreferrer">
                    Get the desktop app
                  </a>
                </Button>
              }
            />
          )
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Film />}
            title="No games match your search"
            body="Try a different title or team name."
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <section>
            <GroupedList>
              {filtered.map((match) => (
                <LibraryRow
                  key={match.id}
                  match={match}
                  video={byMatch.get(match.id) ?? null}
                  canUpload={canImport}
                  onOpen={() => router.push(`/library/${encodeURIComponent(match.id)}?from=library`)}
                />
              ))}
            </GroupedList>
            {noneInCloud && (
              <GroupFooter>
                {canImport
                  ? "None of your games has a cloud copy yet. Upload a game's video to watch it and clip it here."
                  : "None of your games has a cloud copy yet."}
              </GroupFooter>
            )}
            {meters && <GroupFooter>{meters}</GroupFooter>}
          </section>
        )}
      </PageContent>
    </Page>
  );
}
