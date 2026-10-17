/**
 * A player's numbers for one game or for one season: what a stats card
 * shows. A value is null when its source doesn't record it (Profixio has no
 * misses, rebounds or assists; the play-by-play fallback has no minutes or
 * plus-minus), and a card only offers the columns whose values exist.
 *
 * Game field names follow the stat keeper's PlayerLine, so its games can
 * become a third source without a second vocabulary.
 */

export interface GameLine {
  /** Seconds on court. */
  min: number | null;
  pts: number;
  fgm: number | null;
  fga: number | null;
  /** Three-pointers. */
  tpm: number | null;
  tpa: number | null;
  ftm: number | null;
  fta: number | null;
  oreb: number | null;
  dreb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  pf: number | null;
  /** Plus-minus. */
  pm: number | null;
}

/** Per-game averages over a season; percentages are 0–100 as published. */
export interface SeasonLine {
  gp: number;
  gs: number | null;
  mpg: number | null;
  ppg: number;
  rpg: number | null;
  orpg: number | null;
  drpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  topg: number | null;
  pfpg: number | null;
  fgPct: number | null;
  /** Season totals of three-pointers made and attempted. */
  tpm: number | null;
  tpa: number | null;
  tpPct: number | null;
  ftPct: number | null;
  pmPg: number | null;
}

/** a + b, or null when either is unknown. */
export function addKnown(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/** Total rebounds, when both halves are known. */
export function gameRebounds(line: GameLine): number | null {
  return addKnown(line.oreb, line.dreb);
}

/**
 * FIBA efficiency: PTS + REB + AST + STL + BLK − missed FG − missed FT − TO.
 * Computed here because the federation's published EFF columns read 0.0 for
 * every player. Null when any input is missing.
 */
export function gameEfficiency(line: GameLine): number | null {
  const reb = gameRebounds(line);
  const parts = [reb, line.ast, line.stl, line.blk, line.fgm, line.fga, line.ftm, line.fta, line.tov];
  if (parts.some((p) => p === null)) return null;
  const missedFg = line.fga! - line.fgm!;
  const missedFt = line.fta! - line.ftm!;
  return line.pts + reb! + line.ast! + line.stl! + line.blk! - missedFg - missedFt - line.tov!;
}
