"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";
import { gameVideoQuotaLabel, getGameVideoQuota, type GameVideoQuota } from "@scoutable/shared/lib/game-videos-db";
import { listMatchesLight } from "@scoutable/shared/lib/matches-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { DESKTOP_APP_URL } from "@/components/shell/sidebar";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupHeader, GroupedList, GroupRow } from "@/components/ui/group";
import { formatGameDate, formatGameLength } from "@/lib/format-game";
import { useMyCloudGames } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";

/**
 * The user's games in the cloud: the 720p copies the desktop uploaded, which
 * play here with their play-by-play. Only the uploader sees a game.
 */
export default function GamesPage() {
  const router = useRouter();
  const { activeOrgId, isPlayerOnly, profileLoading } = useAuth();
  const { games } = useMyCloudGames({ orgId: isPlayerOnly ? null : activeOrgId, enabled: !profileLoading });
  const [matches, setMatches] = useState<Map<string, StoredMatch> | null>(null);
  const [quota, setQuota] = useState<GameVideoQuota | null>(null);

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
  }, [profileLoading, activeOrgId]);

  const rows = useMemo(
    () =>
      (games ?? [])
        .map((game) => ({ game, match: matches?.get(game.matchId) ?? null }))
        .sort((a, b) => (b.match?.date ?? "").localeCompare(a.match?.date ?? "")),
    [games, matches],
  );
  const loading = games === null || matches === null;

  return (
    <Page width="medium">
      <Toolbar title="Games" />
      <PageContent>
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
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
        ) : (
          <section>
            <GroupHeader title="In the cloud" />
            <GroupedList>
              {rows.map(({ game, match }) => (
                <GroupRow
                  key={game.id}
                  label={match?.title ?? "Game"}
                  description={[formatGameDate(match?.date), formatGameLength(game.durationSeconds)].filter(Boolean).join(" · ")}
                  leading={<Clapperboard />}
                  chevron
                  onClick={() => router.push(`/games/${encodeURIComponent(game.matchId)}?from=games`)}
                />
              ))}
            </GroupedList>
            {quota && <GroupFooter>{gameVideoQuotaLabel(quota)}</GroupFooter>}
          </section>
        )}
      </PageContent>
    </Page>
  );
}
