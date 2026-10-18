"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";
import type { GameVideoPlayResponse } from "@scoutable/shared/lib/game-video-wire";
import { getMatch } from "@scoutable/shared/lib/matches-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { GameWatchView } from "@/components/game/game-watch-view";
import { BackButton } from "@/components/shell/back-button";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { formatGameDate, formatGameLength } from "@/lib/format-game";
import { fetchPlayUrl } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; match: StoredMatch; play: GameVideoPlayResponse };

/**
 * A whole game from its cloud copy, with the play-by-play beside it. Only
 * the person who uploaded the copy gets a URL for it; everyone else sees
 * the same "isn't available" whether the game exists or not.
 */
export default function GamePage() {
  const { matchId } = useParams<{ matchId: string }>();
  const searchParams = useSearchParams();
  const startAt = useMemo(() => {
    const t = Number(searchParams.get("t"));
    return Number.isFinite(t) && t > 0 ? t : null;
  }, [searchParams]);
  const from = searchParams.get("from");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void Promise.all([getMatch(createClient(), matchId), fetchPlayUrl(matchId)]).then(([match, play]) => {
      if (cancelled) return;
      if (!match || !play) {
        setState({ status: "unavailable" });
        return;
      }
      setState({ status: "ready", match, play });
      trackEvent("game_opened", { match_id: matchId, from: from === "games" || from === "clip" ? from : "link" });
    });
    return () => {
      cancelled = true;
    };
    // `from` only labels the first open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  /** A fresh play URL when the current one has run out (they live 12 hours). */
  const refreshUrl = useCallback(() => fetchPlayUrl(matchId, { force: true }).then((r) => r?.url ?? null), [matchId]);

  if (state.status === "loading") {
    return (
      <Page width="full">
        <Toolbar inline title="" leading={<BackButton href="/games" label="Games" />} />
        <PageContent>
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </PageContent>
      </Page>
    );
  }

  if (state.status === "unavailable") {
    return (
      <Page width="medium">
        <Toolbar inline title="Game" leading={<BackButton href="/games" label="Games" />} />
        <StatusScreen
          icon={<Clapperboard />}
          title="This game isn't available"
          body="Only the person who keeps a game in the cloud can watch it here."
          actions={
            <Button asChild variant="outline">
              <Link href="/games">Your games</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const { match, play } = state;
  return (
    <Page width="full">
      <Toolbar
        inline
        title={match.title}
        subtitle={[formatGameDate(match.date), formatGameLength(play.durationSeconds)].filter(Boolean).join(" · ")}
        leading={<BackButton href="/games" label="Games" />}
      />
      <GameWatchView key={match.id} match={match} src={play.url} startAt={startAt} onSourceStale={refreshUrl} />
    </Page>
  );
}
