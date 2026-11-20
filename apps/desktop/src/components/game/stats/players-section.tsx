import { useMemo, useState } from "react";
import type { League } from "@scoutable/shared/types/league";
import { ChevronDown, ChevronUp } from "lucide-react";
import { BOX_STATS, statSetName, type BoxCell, type BoxStat, type BoxTeam, type GameBox } from "@scoutable/shared/lib/game-box";
import { onCourtStints, type GameFlow } from "@scoutable/shared/lib/game-flow";
import { gameLineups } from "@scoutable/shared/lib/game-lineups";
import type { HostedSeasonPlayer } from "@scoutable/shared/lib/hosted-stats";
import { LEADER_MIN_3PA } from "@scoutable/shared/lib/report-leaders";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { GroupHeader } from "@/components/ui/group";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { trackEvent } from "@/lib/analytics";
import { recallGameView, rememberGameView } from "@/lib/game-tabs";
import { cn } from "@/lib/utils";
import { StatCell, type OpenPlays, type PlaySet } from "./stat-cell";
import { useSeasonPlayers, type useGameBoxScore } from "./use-game-box-score";

/** One player's row: their counted line, and what the league adds (minutes, plus-minus, season). */
interface Row {
  personId: number;
  name: string;
  number: string;
  starter: boolean;
  cells: Record<BoxStat, BoxCell>;
  min: number | null;
  pm: number | null;
  /** The plays while they were on the floor: what MIN and +/- open. */
  floorIds: readonly number[];
  season: HostedSeasonPlayer | null;
}

type GameCol = BoxStat | "min" | "pm" | "season_pts";
type SeasonCol = "gp" | "mpg" | "ppg" | "rpg" | "apg" | "spg" | "bpg" | "topg" | "tpm" | "tpa" | "tpPct" | "ftPct";
type SortKey = GameCol | SeasonCol;

const GAME_COLS: { key: GameCol; label: string; title: string }[] = [
  { key: "min", label: "MIN", title: "Minutes" },
  { key: "pts", label: "PTS", title: "Points" },
  { key: "fg", label: "FG", title: "Field goals made of attempted" },
  { key: "tp", label: "3P", title: "Threes made of attempted" },
  { key: "ft", label: "FT", title: "Free throws made of attempted" },
  { key: "oreb", label: "OREB", title: "Offensive rebounds" },
  { key: "dreb", label: "DREB", title: "Defensive rebounds" },
  { key: "ast", label: "AST", title: "Assists" },
  { key: "tov", label: "TO", title: "Turnovers" },
  { key: "stl", label: "STL", title: "Steals" },
  { key: "blk", label: "BLK", title: "Blocks" },
  { key: "pf", label: "PF", title: "Fouls" },
  { key: "pm", label: "+/-", title: "Score change while on the floor" },
  { key: "season_pts", label: "Season PTS", title: "Points per game this season, from the league" },
];

const SEASON_COLS: { key: SeasonCol; label: string; title: string }[] = [
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

/** Columns that a source may not record at all; dropped when neither team has one. */
const MAY_BE_UNRECORDED: readonly BoxStat[] = ["oreb", "dreb", "ast", "tov", "stl", "blk", "pf"];

const ZERO = Object.fromEntries(
  BOX_STATS.map((s): [BoxStat, BoxCell] => [s, s === "fg" || s === "tp" || s === "ft" ? { value: 0, attempts: 0, eventIds: [] } : { value: 0, eventIds: [] }]),
) as Record<BoxStat, BoxCell>;

const minutes = (seconds: number | null) => (seconds === null ? "–" : String(Math.round(seconds / 60)));
const signed = (n: number | null) => (n === null ? "–" : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const one = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(1));

function seasonValue(row: Row, key: SeasonCol): number | null {
  const l = row.season?.line;
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

function gameValue(row: Row, key: GameCol): number | null {
  if (key === "min") return row.min;
  if (key === "pm") return row.pm;
  if (key === "season_pts") return row.season?.line.ppg ?? null;
  const c = row.cells[key];
  return key === "fg" || key === "tp" || key === "ft" ? c.value * 1000 + (c.attempts ?? 0) : c.value;
}

/**
 * Both teams' players, home first: the line counted from the plays, with the
 * league's minutes and plus-minus beside it, or, switched to Season, the
 * league's season averages. Every number of the game opens the plays it
 * counts; season numbers span games that may not be in the library and open
 * nothing.
 */
export function PlayersSection({
  match,
  box,
  flow,
  boxScore,
  leagues,
  onOpen,
}: {
  match: StoredMatch;
  box: GameBox;
  flow: GameFlow;
  boxScore: ReturnType<typeof useGameBoxScore>;
  leagues: League[];
  onOpen: OpenPlays;
}) {
  const season = useSeasonPlayers(match, leagues);
  const [showSeason, setShowSeason] = useState(() => recallGameView(match.id)?.stats?.season ?? false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);

  // Minutes from the fives, when the league's box score can't be read.
  const lineupSeconds = useMemo(() => {
    const seconds = new Map<number, number>();
    if (!box.hasFives) return seconds;
    const all = gameLineups(match.events);
    for (const l of [...all.home, ...all.away]) for (const id of l.personIds) seconds.set(id, (seconds.get(id) ?? 0) + l.seconds);
    return seconds;
  }, [match.events, box.hasFives]);

  const rowsOf = (team: BoxTeam): Row[] => {
    const side = team.side;
    const starters = new Set(side === 1 ? box.starters.home : box.starters.away);
    const floor = (personId: number) => {
      const stints = onCourtStints(flow, personId);
      const ids: number[] = [];
      for (const s of stints) {
        const from = flow.indexOf.get(s.fromEventId) ?? 0;
        const to = flow.indexOf.get(s.toEventId) ?? from;
        for (const e of flow.order.slice(from, to + 1)) ids.push(e.eventId);
      }
      const pm = stints.length > 0 && stints.every((s) => s.plusMinus !== null) ? stints.reduce((n, s) => n + s.plusMinus!, 0) : null;
      return { ids, pm };
    };
    const make = (personId: number, name: string, number: string, cells: Record<BoxStat, BoxCell>): Row => {
      const league = boxScore.byPerson.get(personId);
      const stints = floor(personId);
      return {
        personId,
        name,
        number,
        starter: starters.has(personId),
        cells,
        min: league?.min ?? (boxScore.status === "stints" ? (lineupSeconds.get(personId) ?? null) : null),
        pm: league?.pm ?? (boxScore.status !== "box" ? stints.pm : null),
        floorIds: stints.ids,
        season: season.players?.get(String(personId)) ?? null,
      };
    };
    const rows = team.players.map((p) => make(p.personId, p.name, p.number, p.cells));
    // Players the league's box score lists who have no play of their own.
    for (const [personId, p] of boxScore.byPerson) {
      if (p.side !== side || rows.some((r) => r.personId === personId)) continue;
      rows.push(make(personId, p.name, p.number ?? "", ZERO));
    }
    return rows.sort(
      (a, b) =>
        Number(b.starter) - Number(a.starter) ||
        (b.min ?? -1) - (a.min ?? -1) ||
        b.cells.pts.value - a.cells.pts.value ||
        a.name.localeCompare(b.name),
    );
  };

  const teams = [
    { team: box.home, name: match.homeTeam.name || "Home" },
    { team: box.away, name: match.awayTeam.name || "Away" },
  ].map((t) => ({ ...t, rows: rowsOf(t.team) }));

  const gameCols = GAME_COLS.filter((c) => {
    if (c.key === "min" || c.key === "pm") return boxScore.status !== "none";
    if (c.key === "season_pts") return season.status !== "none" && season.status !== "failed";
    if ((MAY_BE_UNRECORDED as readonly string[]).includes(c.key)) {
      const k = c.key as BoxStat;
      return box.home.totals[k].value + box.away.totals[k].value > 0;
    }
    return true;
  });

  const sorted = (rows: Row[]) => {
    if (!sort) return rows;
    const value = (r: Row) =>
      (SEASON_COLS.some((c) => c.key === sort.key) ? seasonValue(r, sort.key as SeasonCol) : gameValue(r, sort.key as GameCol)) ?? -Infinity;
    return [...rows].sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)) || a.name.localeCompare(b.name));
  };
  const sortBy = (key: SortKey) => setSort((s) => (s?.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  const shooting = (c: BoxCell) => (box.hasMisses ? `${c.value}/${c.attempts ?? 0}` : String(c.value));
  const open = (set: PlaySet, stat: string) => onOpen(set, { kind: "player_stat", stat });
  const showingSeason = showSeason && season.status !== "none";

  return (
    <section>
      <GroupHeader
        title="Players"
        action={
          season.status !== "none" && (
            <SegmentedControl
              aria-label="Numbers"
              value={showSeason ? "season" : "game"}
              onValueChange={(v) => {
                const next = v === "season";
                setShowSeason(next);
                setSort(null);
                rememberGameView(match.id, { stats: { top: recallGameView(match.id)?.stats?.top ?? 0, season: next } });
                if (next) trackEvent("game_stats_season_shown");
              }}
              options={[
                { value: "game", label: "Game", title: "This game, counted from its plays" },
                { value: "season", label: "Season", title: "Season averages, from the league" },
              ]}
            />
          )
        }
      />
      {showingSeason && season.status === "failed" && (
        <p className="flex items-center gap-2 px-1 pb-2 text-subheadline text-muted-foreground">
          The league's season numbers couldn't be read.
          <Button variant="outline" size="xs" onClick={season.retry}>
            Try again
          </Button>
        </p>
      )}
      <div className="space-y-4">
        {teams.map(({ team, name, rows }) => (
          <div key={team.side} className="overflow-x-auto rounded-window bg-card ring-1 ring-separator">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-caption-1 text-muted-foreground">
                  <th className="sticky left-0 z-10 min-w-48 bg-card py-2 pr-3 pl-4 text-left font-medium text-foreground">{name}</th>
                  {(showingSeason ? SEASON_COLS : gameCols).map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-normal whitespace-nowrap">
                      <button
                        type="button"
                        title={c.title}
                        onClick={() => sortBy(c.key)}
                        className="inline-flex items-center gap-0.5 rounded px-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
                      >
                        {c.label}
                        {sort?.key === c.key && (sort.desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
                      </button>
                    </th>
                  ))}
                  <th className="w-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-separator border-t border-separator">
                {sorted(rows).map((r, i, list) => (
                  // The bench starts under a heavier line, while the table is in its own order.
                  <tr key={r.personId} className={cn(!sort && i > 0 && list[i - 1].starter && !r.starter && "border-t-separator-strong")}>
                    <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 pr-3 pl-4 text-left font-normal">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-6 shrink-0 text-right text-muted-foreground nums">{r.number}</span>
                        <StatCell
                          cell={{ eventIds: [...new Set(BOX_STATS.flatMap((s) => r.cells[s].eventIds))] }}
                          name={`${r.name}: plays`}
                          display={r.name}
                          onOpen={(set) => open(set, "player")}
                          className="truncate text-left"
                        />
                        {!sort && r.starter && <span className="sr-only">, starter</span>}
                      </span>
                    </th>
                    {showingSeason
                      ? SEASON_COLS.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 text-right text-muted-foreground nums">
                            {c.key === "gp" ? (r.season ? String(r.season.line.gp) : "–") : c.key === "tpPct" || c.key === "ftPct" ? pctOf(seasonValue(r, c.key)) : one(seasonValue(r, c.key))}
                          </td>
                        ))
                      : gameCols.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 text-right">
                            {c.key === "season_pts" ? (
                              <span className="text-muted-foreground nums">{one(r.season?.line.ppg)}</span>
                            ) : c.key === "min" || c.key === "pm" ? (
                              <StatCell
                                cell={{ eventIds: c.key === "min" ? (r.min === null ? [] : r.floorIds) : r.pm === null ? [] : r.floorIds }}
                                name={`${r.name}: on the floor`}
                                display={c.key === "min" ? minutes(r.min) : signed(r.pm)}
                                onOpen={(set) => open(set, c.key)}
                              />
                            ) : (
                              <StatCell
                                cell={r.cells[c.key as BoxStat]}
                                name={statSetName(r.name, c.key as BoxStat)}
                                display={c.key === "fg" || c.key === "tp" || c.key === "ft" ? shooting(r.cells[c.key]) : String(r.cells[c.key as BoxStat].value)}
                                onOpen={(set) => open(set, c.key)}
                                className={c.key === "pts" ? "font-medium" : undefined}
                              />
                            )}
                          </td>
                        ))}
                    <td />
                  </tr>
                ))}
                {!showingSeason && (
                  <>
                    <tr className="text-muted-foreground">
                      <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 pr-3 pl-12 text-left font-normal">
                        Team
                      </th>
                      {gameCols.map((c) => {
                        const k = c.key as keyof BoxTeam["teamRow"];
                        const cell = c.key === "oreb" || c.key === "dreb" || c.key === "tov" ? team.teamRow[k] : null;
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-right">
                            {cell && (
                              <StatCell
                                cell={cell}
                                name={`${name}: team ${c.key === "tov" ? "turnovers" : c.key === "oreb" ? "offensive rebounds" : "defensive rebounds"}`}
                                display={String(cell.value)}
                                onOpen={(set) => onOpen(set, { kind: "team_stat", stat: c.key })}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                    <tr className="font-medium">
                      <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 pr-3 pl-12 text-left">
                        Totals
                      </th>
                      {gameCols.map((c) => {
                        const isBox = (BOX_STATS as readonly string[]).includes(c.key);
                        const cell = isBox ? team.totals[c.key as BoxStat] : null;
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-right">
                            {cell && (
                              <StatCell
                                cell={cell}
                                name={statSetName(name, c.key as BoxStat)}
                                display={c.key === "fg" || c.key === "tp" || c.key === "ft" ? shooting(cell) : String(cell.value)}
                                onOpen={(set) => onOpen(set, { kind: "team_stat", stat: c.key })}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {!showingSeason && boxScore.status === "stints" && (
        <p className="px-1 pt-2 text-subheadline text-muted-foreground">Minutes and +/- are counted from the plays; the league's box score couldn't be read.</p>
      )}
    </section>
  );
}

function pctOf(n: number | null): string {
  return n === null ? "–" : `${Math.round(n)}%`;
}
