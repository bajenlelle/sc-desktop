import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { ChartColumn } from "lucide-react";
import { gameFlow } from "@scoutable/shared/lib/game-flow";
import { gameShots } from "@scoutable/shared/lib/game-shots";
import { gameBox } from "@scoutable/shared/lib/game-box";
import { FactorsSection } from "./factors-section";
import { PlayersSection } from "./players-section";
import type { MinutesSource } from "./use-game-box-score";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { recallGameView, rememberGameView } from "@/lib/game-tabs";
import { GameBackButton, GameTitle } from "../game-toolbar-parts";
import { ScoreSection } from "./score-section";
import type { OpenPlays } from "./stat-cell";

/**
 * The game as numbers (docs/game-view.md, "Stats"): the score by quarter and
 * the lead graph, why it went that way, both teams' players, their shots and
 * the lineups. Everything is counted from the stored plays, and a number
 * opens exactly the plays it counts in the Game view (`onOpenPlays`).
 */
export function GameStatsView({
  match,
  viewSwitch,
  entry,
  onOpenPlays,
  onShowDetails,
}: {
  match: StoredMatch;
  viewSwitch: ReactNode;
  /** How the coach got here, for analytics. */
  entry: string;
  onOpenPlays: OpenPlays;
  onShowDetails: () => void;
}) {
  const flow = useMemo(() => gameFlow(match.events), [match.events]);
  const box = useMemo(() => gameBox(match.events), [match.events]);
  const shots = useMemo(() => gameShots(match.events), [match.events]);
  const hasFives = useMemo(() => match.events.some((e) => e.onCourtHome?.length || e.onCourtAway?.length), [match.events]);

  // Where the coach left the page, for coming back through the switch.
  const anchorRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = anchorRef.current?.closest<HTMLElement>("[data-page-scroller]");
    if (!scroller) return;
    const top = recallGameView(match.id)?.stats?.top ?? 0;
    if (top > 0) scroller.scrollTop = top;
    const save = () => {
      const was = recallGameView(match.id)?.stats;
      rememberGameView(match.id, { stats: { top: scroller.scrollTop, season: was?.season ?? false } });
    };
    scroller.addEventListener("scroll", save, { passive: true });
    return () => scroller.removeEventListener("scroll", save);
  }, [match.id]);

  // Once per visit, when the players' table knows where its minutes come from.
  const viewed = useRef(false);
  const onMinutesSource = useCallback(
    (source: MinutesSource) => {
      if (viewed.current || source === "reading") return;
      viewed.current = true;
      trackEvent("game_stats_viewed", { entry, has_shots: shots.hasPositions, has_lineups: hasFives, plays: match.events.length, minutes_source: source });
    },
    [entry, shots.hasPositions, hasFives, match.events.length],
  );

  const open: OpenPlays = (set, meta) => {
    trackEvent("game_stats_plays_opened", { kind: meta.kind, stat: meta.stat ?? null, plays: set.eventIds.length });
    onOpenPlays(set, meta);
  };

  return (
    <Page>
      <Toolbar
        title={<GameTitle title={match.title} />}
        leading={
          <>
            <GameBackButton matchId={match.id} />
            {viewSwitch}
          </>
        }
      />
      <PageContent width="wide" className="space-y-7">
        <div ref={anchorRef} className="contents" />
        {match.events.length === 0 ? (
          <EmptyState
            icon={<ChartColumn />}
            title="No plays for this game"
            body="Stats are counted from the league's play-by-play, and this game has none."
            action={
              <Button variant="outline" size="sm" onClick={onShowDetails}>
                Show details
              </Button>
            }
          />
        ) : (
          <>
            <ScoreSection match={match} flow={flow} onOpen={open} />
            <FactorsSection match={match} box={box} onOpen={open} />
            <PlayersSection match={match} box={box} flow={flow} onOpen={open} onMinutesSource={onMinutesSource} />
          </>
        )}
      </PageContent>
    </Page>
  );
}
