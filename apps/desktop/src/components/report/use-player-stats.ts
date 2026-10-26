import { useCallback, useState } from "react";
import { leagueSeasonsOf, loadGameStats, loadSeasonPlayer, makeGameCard, makeSeasonCard, seasonOf, type GameStats } from "@/lib/stats-card-data";
import type { StatsCardPlayer, StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import type { League } from "@scoutable/shared/types/league";
import type { PlayByPlayEvent, StoredMatch } from "@/types/match";

/** Who a section's numbers are read for: the roster's view of a player, and the game they are mostly in. */
export interface StatsPerson {
  playerId: string;
  name: string;
  number: string | null;
  teamName: string;
  matchId?: string;
}

export interface PlayerStatsRead {
  /** The player as the box score names them (number, team), else as given. */
  player: StatsCardPlayer;
  stats: StatsCardSpec | null;
  /** The season page couldn't be read (the network), as opposed to the league having no numbers for them. */
  failed: boolean;
}

/**
 * Reading a player's numbers for the report: season averages where the league
 * has them, else a game line, else none. Box scores read along the way are kept
 * (`boxScores`): the official box score names players the plays don't, so the
 * roster grows with them. Nothing is read to fill the roster by itself: the
 * picker asks for the playlist's games with `ensureBoxScores`.
 */
export function usePlayerStats({
  statsClips,
  matchLookup,
  leagues,
}: {
  /** The playlist's clips whose game has stats, in playlist order. */
  statsClips: readonly { matchId: string; event: PlayByPlayEvent }[];
  matchLookup: ReadonlyMap<string, StoredMatch>;
  leagues: League[];
}) {
  const [boxScores, setBoxScores] = useState<ReadonlyMap<string, GameStats>>(() => new Map());

  const keepBoxScore = useCallback((matchId: string, stats: GameStats | null) => {
    if (stats?.source !== "genius_hosted") return;
    setBoxScores((prev) => (prev.has(matchId) ? prev : new Map(prev).set(matchId, stats)));
  }, []);

  /**
   * The game a player's numbers are read from: where most of their clips from games with stats
   * are; a player with none (a section for anyone in the game) uses the game they played in.
   */
  const statsMatchIdOf = useCallback(
    (person: { playerId: string; matchId?: string }, preferMatchId?: string): string | undefined => {
      const counts = new Map<string, number>();
      for (const c of statsClips) {
        if (String(c.event.player?.playerId) === person.playerId) counts.set(c.matchId, (counts.get(c.matchId) ?? 0) + 1);
      }
      const withClips = preferMatchId && counts.has(preferMatchId) ? preferMatchId : [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      return withClips ?? person.matchId;
    },
    [statsClips],
  );

  /**
   * The player as the section keeps them, and their numbers. `competitionId` is a season the
   * coach picked (any season of the game's league): exactly that season's line, or none, never a
   * fall back to the game.
   */
  const readPlayerStats = useCallback(
    async (person: StatsPerson, preferMatchId?: string, competitionId?: number): Promise<PlayerStatsRead> => {
      const base: StatsCardPlayer = { id: person.playerId, name: person.name, number: person.number, teamId: null, teamName: person.teamName };
      const matchId = statsMatchIdOf(person, preferMatchId);
      const match = matchId ? matchLookup.get(matchId) : undefined;
      if (!match) return { player: base, stats: null, failed: false };
      const stats = await loadGameStats(match, leagues);
      keepBoxScore(match.id, stats);
      const option = stats?.players.find((o) => o.player.id === person.playerId);
      const who = option?.player ?? base;
      // The season line needs only the game's league, not the game's box score: a player who barely
      // played, or a game with no Genius game id, still has one.
      const season =
        competitionId !== undefined ? (leagueSeasonsOf(match, leagues).find((s) => s.competitionId === competitionId) ?? null) : seasonOf(match, leagues);
      // A season page that couldn't be read is not a season the player isn't in: say so apart.
      let failed = false;
      if (season) {
        const line = await loadSeasonPlayer(season.competitionId, person.playerId).catch(() => {
          failed = true;
          return null;
        });
        if (line) return { player: who, stats: makeSeasonCard(season, who, line), failed: false };
      }
      if (competitionId !== undefined || !stats || !option) return { player: who, stats: null, failed };
      return { player: who, stats: makeGameCard(match, stats, option, seasonOf(match, leagues)?.competitionId ?? null), failed: false };
    },
    [statsMatchIdOf, matchLookup, leagues, keepBoxScore],
  );

  /** Reads the box scores of these games (once each), so everyone who played joins the roster. */
  const ensureBoxScores = useCallback(
    async (games: readonly StoredMatch[]) => {
      await Promise.all(
        games.map(async (m) => {
          if (boxScores.has(m.id)) return;
          const stats = await loadGameStats(m, leagues).catch(() => null);
          keepBoxScore(m.id, stats);
        }),
      );
    },
    [boxScores, leagues, keepBoxScore],
  );

  return { boxScores, statsMatchIdOf, readPlayerStats, ensureBoxScores };
}
