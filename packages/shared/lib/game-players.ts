/**
 * A team's rows in the Stats view's players table: the line counted from the
 * plays, with minutes and plus-minus from the league's box score where it
 * could be read, else from the fives on the plays, else unknown. Players the
 * box score lists who have no play of their own get a row of zeros. Pure;
 * the desktop's players section adds the season averages beside it.
 */
import { BOX_STATS, type BoxCell, type BoxStat, type BoxTeam } from "./game-box";

/** Where the table's minutes and plus-minus come from. */
export type MinutesSource = "reading" | "box" | "stints" | "none";

/** One player as the league's box score lists them. */
export interface LeaguePerson {
  /** Seconds on the floor. */
  min: number | null;
  pm: number | null;
  number: string | null;
  name: string;
  side: 1 | 2;
}

export interface PlayerRow {
  personId: number;
  name: string;
  number: string;
  starter: boolean;
  cells: Record<BoxStat, BoxCell>;
  /** Seconds on the floor; null when unknown. */
  min: number | null;
  pm: number | null;
  /** The plays while they were on the floor: what MIN and +/- open. */
  floorIds: readonly number[];
}

/** A line of zeros, for a player with no play of their own. */
export function emptyCells(): Record<BoxStat, BoxCell> {
  const out = {} as Record<BoxStat, BoxCell>;
  for (const s of BOX_STATS) out[s] = s === "fg" || s === "tp" || s === "ft" ? { value: 0, attempts: 0, eventIds: [] } : { value: 0, eventIds: [] };
  return out;
}

export function playerRows(input: {
  team: BoxTeam;
  /** The side's first five on the floor, by personId. */
  starters: readonly number[];
  league: ReadonlyMap<number, LeaguePerson>;
  source: MinutesSource;
  /** Seconds on the floor counted from the lineups, for when the box score can't be read. */
  lineupSeconds: ReadonlyMap<number, number>;
  /** The plays during a player's stints and the score change over them (null without fives). */
  floor: (personId: number) => { eventIds: readonly number[]; plusMinus: number | null };
}): PlayerRow[] {
  const { team, league, source, lineupSeconds, floor } = input;
  const starters = new Set(input.starters);
  const make = (personId: number, name: string, number: string, cells: Record<BoxStat, BoxCell>): PlayerRow => {
    const fromLeague = league.get(personId);
    const stints = floor(personId);
    return {
      personId,
      name,
      number,
      starter: starters.has(personId),
      cells,
      min: fromLeague?.min ?? (source === "stints" ? (lineupSeconds.get(personId) ?? null) : null),
      // The league's when it has one; else the stints', when the plays list the fives.
      pm: fromLeague?.pm ?? stints.plusMinus,
      floorIds: stints.eventIds,
    };
  };
  const rows = team.players.map((p) => make(p.personId, p.name, p.number, p.cells));
  for (const [personId, p] of league) {
    if (p.side !== team.side || rows.some((r) => r.personId === personId)) continue;
    rows.push(make(personId, p.name, p.number ?? "", emptyCells()));
  }
  return rows.sort(
    (a, b) =>
      Number(b.starter) - Number(a.starter) ||
      (b.min ?? -1) - (a.min ?? -1) ||
      b.cells.pts.value - a.cells.pts.value ||
      a.name.localeCompare(b.name),
  );
}
