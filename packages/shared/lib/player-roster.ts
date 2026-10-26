/**
 * Who a scouting report section can be about.
 *
 * A section can be about anyone in the games the playlist's clips come from,
 * not only the players who have clips: the roster is the clipped players
 * first (most clips first), then everyone else the game data has, from the
 * stored plays and, once loaded, the box score (which also lists players who
 * played without a recorded action). Pure, so the desktop picker and its
 * tests share one definition.
 */
import type { PlayByPlayEvent, PlaylistItem, StoredMatch } from "../types/match";
import { isClipItem } from "../types/match";
import { itemKey } from "./playlist-edits";
import { rankPlayersByClips } from "./stats-card";
import { eventPeople, type GameStats } from "./stats-card-data";
import type { StatsClip } from "./stats-card-defaults";

export interface PlayerChoice {
  playerId: string;
  name: string;
  number: string | null;
  teamName: string;
  /** Clips of theirs in the playlist; 0 for a player who is only in the game. */
  clips: number;
  /** The game their numbers are read from first: the one with most of their clips, else a game they played in. */
  matchId: string;
  /** The report already has a section about them. */
  taken: boolean;
}

/** A shirt number as a sort key: numbers first, anything else after. */
const jersey = (n: string | null): number => {
  const v = n === null ? NaN : Number(n);
  return Number.isFinite(v) ? v : Infinity;
};

/**
 * Everyone a section can be about: the players with clips in the playlist,
 * most clips first, then the rest of the games' players by team (the team
 * with more clips first), shirt number and name. Games are the ones the
 * playlist's clips come from; a player in several is listed once.
 */
export function playerRoster(input: {
  items: readonly PlaylistItem[];
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  matches: ReadonlyMap<string, StoredMatch>;
  /** Box scores read so far, by game: their players join the roster. */
  boxScores?: ReadonlyMap<string, GameStats>;
  /** Players the report already has a section about (report-draft's sections). Nobody, when absent. */
  taken?: ReadonlySet<string>;
}): PlayerChoice[] {
  const { items, eventByKey, matches, boxScores } = input;
  const taken = input.taken ?? new Set<string>();

  const clips: StatsClip[] = [];
  for (const item of items) {
    if (!isClipItem(item)) continue;
    const event = eventByKey.get(itemKey(item));
    if (event) clips.push({ matchId: item.matchId, event });
  }

  // The game each clipped player has the most clips in (a tie keeps the first).
  const perGame = new Map<string, Map<string, number>>();
  for (const c of clips) {
    if (!c.event.player) continue;
    const id = String(c.event.player.playerId);
    const games = perGame.get(id) ?? new Map<string, number>();
    games.set(c.matchId, (games.get(c.matchId) ?? 0) + 1);
    perGame.set(id, games);
  }
  const bestGame = (id: string): string => {
    let best = "";
    let most = 0;
    for (const [matchId, n] of perGame.get(id) ?? []) {
      if (n > most) {
        best = matchId;
        most = n;
      }
    }
    return best;
  };

  // Everyone the data has for the games the clips come from, in playlist order.
  const known = new Map<string, { name: string; number: string | null; teamName: string; matchId: string }>();
  for (const matchId of new Set(clips.map((c) => c.matchId))) {
    const match = matches.get(matchId);
    if (!match) continue;
    for (const [id, p] of eventPeople(match)) {
      if (!known.has(id)) known.set(id, { name: p.name, number: p.number, teamName: p.teamName, matchId });
    }
    for (const o of boxScores?.get(matchId)?.players ?? []) {
      if (!known.has(o.player.id)) {
        known.set(o.player.id, { name: o.player.name, number: o.player.number, teamName: o.player.teamName, matchId });
      }
    }
  }

  const ranked = rankPlayersByClips(clips.map((c) => c.event)).map(
    (p): PlayerChoice => ({
      playerId: p.playerId,
      name: p.name,
      number: p.number,
      // A play without its team leaves the name blank: the game data knows it.
      teamName: p.teamName || known.get(p.playerId)?.teamName || "",
      clips: p.clips,
      matchId: bestGame(p.playerId),
      taken: taken.has(p.playerId),
    }),
  );

  const clipped = new Set(ranked.map((p) => p.playerId));
  const teamClips = new Map<string, number>();
  for (const p of ranked) teamClips.set(p.teamName, (teamClips.get(p.teamName) ?? 0) + p.clips);
  const rest = [...known]
    .filter(([id]) => !clipped.has(id))
    .map(([id, p]): PlayerChoice => ({ playerId: id, ...p, clips: 0, taken: taken.has(id) }));
  rest.sort(
    (a, b) =>
      (teamClips.get(b.teamName) ?? 0) - (teamClips.get(a.teamName) ?? 0) ||
      a.teamName.localeCompare(b.teamName) ||
      jersey(a.number) - jersey(b.number) ||
      a.name.localeCompare(b.name),
  );
  return [...ranked, ...rest];
}

/**
 * The roster as the picker lists it: one group per team, the team with most
 * clips first, then by name; players keep their roster order. Players whose
 * team the data doesn't name share a "" group, which sorts after the named
 * teams with as many clips (a data gap, not a team to rank).
 */
export function rosterByTeam(roster: readonly PlayerChoice[]): { teamName: string; players: PlayerChoice[] }[] {
  const teams = new Map<string, { teamName: string; players: PlayerChoice[]; clips: number }>();
  for (const p of roster) {
    const team = teams.get(p.teamName) ?? { teamName: p.teamName, players: [], clips: 0 };
    team.players.push(p);
    team.clips += p.clips;
    teams.set(p.teamName, team);
  }
  return [...teams.values()]
    .sort((a, b) => b.clips - a.clips || Number(a.teamName === "") - Number(b.teamName === "") || a.teamName.localeCompare(b.teamName))
    .map(({ teamName, players }) => ({ teamName, players }));
}
