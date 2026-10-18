"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Plus } from "lucide-react";
import { gameVideoStatusLabel } from "@scoutable/shared/lib/game-upload-core";
import { gameVideoQuotaLabel, getGameVideoQuota, type GameVideo, type GameVideoQuota } from "@scoutable/shared/lib/game-videos-db";
import { listMatchesLight } from "@scoutable/shared/lib/matches-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { importQuotaLabel } from "@/components/import/use-import-checks";
import { useNavUser } from "@/components/shell/nav";
import { Page, PageContent } from "@/components/shell/page";
import { useShell } from "@/components/shell/shell-context";
import { DESKTOP_APP_URL } from "@/components/shell/sidebar";
import { Toolbar } from "@/components/shell/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupHeader, GroupedList, GroupRow } from "@/components/ui/group";
import { formatGameDate, formatGameLength } from "@/lib/format-game";
import { useGameUploadJob } from "@/lib/game-upload";
import { useMyGameVideos } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";

/** A game's row: its title, date and length, and where its video stands when it isn't simply ready. */
function GameRow({ game, match, onOpen }: { game: GameVideo; match: StoredMatch | null; onOpen: () => void }) {
  const job = useGameUploadJob(game.matchId);
  const hasSync = typeof match?.syncPoint?.syncVideoTime === "number";
  const status = gameVideoStatusLabel(game, job, hasSync);
  const attention = game.status === "failed" || (game.status === "uploading" && !job) || (game.status === "ready" && status !== null);
  return (
    <GroupRow
      label={match?.title ?? "Game"}
      description={[formatGameDate(match?.date), formatGameLength(game.durationSeconds)].filter(Boolean).join(" · ") || undefined}
      leading={<Clapperboard />}
      trailing={status && <Badge variant={attention ? "warning" : "secondary"}>{status}</Badge>}
      chevron
      onClick={onOpen}
    />
  );
}

/**
 * The user's games in the cloud, in every state: uploading from this or
 * another device, converting, ready to watch, or failed. Only the uploader
 * sees a game. Importing starts here.
 */
export default function GamesPage() {
  const router = useRouter();
  const { activeOrgId, isPlayerOnly, profileLoading } = useAuth();
  const navUser = useNavUser();
  const { importQuota } = useShell();
  const { games } = useMyGameVideos({ orgId: isPlayerOnly ? null : activeOrgId, enabled: !profileLoading });
  const [matches, setMatches] = useState<Map<string, StoredMatch> | null>(null);
  const [quota, setQuota] = useState<GameVideoQuota | null>(null);
  const canImport = navUser?.canImport ?? false;

  useEffect(() => {
    if (profileLoading) return;
    const supabase = createClient();
    let cancelled = false;
    void listMatchesLight(supabase, undefined, { ownOnly: true }).then((rows) => {
      if (!cancelled) setMatches(new Map(rows.map((m) => [m.id, m])));
    });
    void getGameVideoQuota(supabase, activeOrgId).then((q) => {
      if (!cancelled) setQuota(q);
    });
    return () => {
      cancelled = true;
    };
    // `games` changing (an import, a removal) re-reads the titles too.
  }, [profileLoading, activeOrgId, games?.length]);

  const rows = useMemo(
    () =>
      (games ?? [])
        .map((game) => ({ game, match: matches?.get(game.matchId) ?? null }))
        .sort((a, b) => (b.match?.date ?? b.game.createdAt).localeCompare(a.match?.date ?? a.game.createdAt)),
    [games, matches],
  );
  const loading = games === null || matches === null || navUser === null;
  const meters = [canImport ? importQuotaLabel(importQuota) : null, quota ? gameVideoQuotaLabel(quota) : null].filter(Boolean).join(" · ");

  const importButton = (placement: "games_toolbar" | "games_empty", size: "sm" | "default" = "sm") => (
    <Button asChild size={size}>
      <ImportEntryLink placement={placement}>
        <Plus />
        Import a game
      </ImportEntryLink>
    </Button>
  );

  return (
    <Page width="medium">
      <Toolbar title="Games" actions={canImport && rows.length > 0 ? importButton("games_toolbar") : undefined} />
      <PageContent>
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          canImport ? (
            <EmptyState
              icon={<Clapperboard />}
              title="No games yet"
              body="Import a league game and upload its video; it plays here with every play lined up."
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
              icon={<Clapperboard />}
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
        ) : (
          <section>
            <GroupHeader title="In the cloud" />
            <GroupedList>
              {rows.map(({ game, match }) => (
                <GameRow
                  key={game.id}
                  game={game}
                  match={match}
                  onOpen={() => router.push(`/games/${encodeURIComponent(game.matchId)}?from=games`)}
                />
              ))}
            </GroupedList>
            {meters && <GroupFooter>{meters}</GroupFooter>}
          </section>
        )}
      </PageContent>
    </Page>
  );
}
