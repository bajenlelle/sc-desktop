import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { ChartColumn } from "lucide-react";
import { gameFlow } from "@scoutable/shared/lib/game-flow";
import { gameShots } from "@scoutable/shared/lib/game-shots";
import { gameBox, teamFactors } from "@scoutable/shared/lib/game-box";
import { seasonGaps, seasonMatchOf } from "@scoutable/shared/lib/season-context";
import { FactorsSection } from "./factors-section";
import { LineupsSection } from "./lineups-section";
import { PlayersSection } from "./players-section";
import { ShotsSection } from "./shots-section";
import { useGameBoxScore } from "./use-game-box-score";
import { useSeasonContext } from "./use-season-context";
import { useLeagues } from "@/lib/use-leagues";
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
    // Restored now and again on the next frame: WebKit can lay the page out once more after the first paint.
    let last = top;
    let restoring = top > 0;
    if (restoring) scroller.scrollTop = top;
    const frame = requestAnimationFrame(() => {
      if (restoring) scroller.scrollTop = top;
      restoring = false;
    });
    const note = () => {
      if (!restoring) last = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", note, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", note);
      // Written once, when the view leaves: a scroll event while the page comes down mustn't count.
      rememberGameView(match.id, { stats: { top: last, season: recallGameView(match.id)?.stats?.season ?? false } });
    };
  }, [match.id]);

  // The league's box score: minutes and plus-minus for the players, names for the lineups.
  const leagues = useLeagues();
  const boxScore = useGameBoxScore(match, leagues, hasFives);
  // Each team's season beside the game: marks on the factor bars, the place in the table.
  const season = useSeasonContext(match, leagues);

  // How many captions the factor bars write: the same rule, counted here.
  const gaps = useMemo(
    () => (season.context && match.events.length > 0 ? seasonGaps(teamFactors(box), season.context) : 0),
    [season.context, box, match.events.length],
  );

  // Once per visit, when it is known where the minutes come from and whether the season came.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || boxScore.status === "reading" || season.status === "reading") return;
    viewed.current = true;
    trackEvent("game_stats_viewed", {
      entry,
      has_shots: shots.hasPositions,
      has_lineups: hasFives,
      plays: match.events.length,
      minutes_source: boxScore.status,
      season: season.status === "ready" ? "shown" : season.status,
      season_gaps: gaps,
    });
  }, [boxScore.status, season.status, gaps, entry, shots.hasPositions, hasFives, match.events.length]);

  /** Shirt number and name by personId: the plays first, then the box score for players with none. */
  const people = useMemo(() => {
    const out = new Map<number, { number: string; name: string }>();
    for (const [id, p] of boxScore.byPerson) out.set(id, { number: p.number ?? "", name: p.name });
    for (const p of [...box.home.players, ...box.away.players]) out.set(p.personId, { number: p.number, name: p.name });
    return out;
  }, [box, boxScore.byPerson]);

  const open: OpenPlays = (set, meta) => {
    trackEvent("game_stats_plays_opened", { kind: meta.kind, stat: meta.stat ?? null, plays: set.eventIds.length });
    onOpenPlays(set, meta);
  };

  return (
    <Page>
      <Toolbar
        compactBelow="auto"
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
            <ScoreSection
              match={match}
              flow={flow}
              season={season.context}
              competitionId={seasonMatchOf(match, leagues)?.competitionId ?? null}
              onOpen={open}
            />
            <FactorsSection match={match} box={box} season={season} onOpen={open} />
            <PlayersSection match={match} box={box} flow={flow} boxScore={boxScore} leagues={leagues} onOpen={open} />
            <ShotsSection match={match} shots={shots} people={people} onOpen={open} />
            <LineupsSection match={match} hasFives={hasFives} people={people} onOpen={open} />
          </>
        )}
      </PageContent>
    </Page>
  );
}
