import { LEADER_MIN_3PA } from "@scoutable/shared/lib/report-leaders";
import type { SeasonLine } from "@scoutable/shared/lib/stat-lines";

/** The league's season averages as the Players tables show them: the game's Stats view and a team's page. */
export type SeasonCol = "gp" | "mpg" | "ppg" | "rpg" | "apg" | "spg" | "bpg" | "topg" | "tpm" | "tpa" | "tpPct" | "ftPct";

export const SEASON_COLS: { key: SeasonCol; label: string; title: string }[] = [
  { key: "gp", label: "GP", title: "Games played" },
  { key: "mpg", label: "MPG", title: "Minutes per game" },
  { key: "ppg", label: "PPG", title: "Points per game" },
  { key: "rpg", label: "RPG", title: "Rebounds per game" },
  { key: "apg", label: "APG", title: "Assists per game" },
  { key: "spg", label: "SPG", title: "Steals per game" },
  { key: "bpg", label: "BPG", title: "Blocks per game" },
  { key: "topg", label: "TOPG", title: "Turnovers per game" },
  { key: "tpm", label: "3PM/G", title: "Threes made per game" },
  { key: "tpa", label: "3PA/G", title: "Threes attempted per game" },
  { key: "tpPct", label: "3P%", title: `Three-point percentage, from ${LEADER_MIN_3PA} attempts` },
  { key: "ftPct", label: "FT%", title: "Free-throw percentage" },
];

/** A column's value from a season line; a 3P% only past LEADER_MIN_3PA attempts. */
export function seasonLineValue(l: SeasonLine | null | undefined, key: SeasonCol): number | null {
  if (!l) return null;
  switch (key) {
    case "tpm":
      return l.tpm !== null && l.gp > 0 ? l.tpm / l.gp : null;
    case "tpa":
      return l.tpa !== null && l.gp > 0 ? l.tpa / l.gp : null;
    case "tpPct":
      return l.tpa !== null && l.tpa >= LEADER_MIN_3PA ? l.tpPct : null;
    default:
      return l[key];
  }
}

const one = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(1));
const pctOf = (n: number | null) => (n === null ? "–" : `${Math.round(n)}%`);

/** How a column's value reads in a cell. */
export function seasonCell(l: SeasonLine | null | undefined, key: SeasonCol): string {
  if (key === "gp") return l ? String(l.gp) : "–";
  const v = seasonLineValue(l, key);
  return key === "tpPct" || key === "ftPct" ? pctOf(v) : one(v);
}
