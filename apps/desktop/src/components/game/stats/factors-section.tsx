import { Fragment, useMemo } from "react";
import { POINTS_FROM, pointsFrom, teamFactors, type GameBox, type PointsFrom, type TeamFactors } from "@scoutable/shared/lib/game-box";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { GroupHeader } from "@/components/ui/group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { teamTints } from "../team-tints";
import { StatCell, type OpenPlays } from "./stat-cell";

type FactorKey = Exclude<keyof TeamFactors, "possessions">;

/** The rows in the order coaches read them: efficiency first, then the four factors. */
const FACTORS: { key: FactorKey; label: string; help: string; format: (v: number) => string; lowerIsBetter?: boolean }[] = [
  { key: "ppp", label: "Points per possession", help: "Points scored each time the team had the ball.", format: (v) => v.toFixed(2) },
  { key: "efg", label: "Shooting (eFG%)", help: "Field-goal percentage with a made three counted as one and a half twos.", format: pct },
  { key: "tovRate", label: "Turnover rate", help: "Share of possessions that ended in a turnover; lower is better.", format: pct, lowerIsBetter: true },
  { key: "orebPct", label: "Offensive rebounds won", help: "Share of the team's own misses it rebounded.", format: pct },
  { key: "ftRate", label: "Free-throw rate", help: "Free throws taken per field-goal attempt.", format: (v) => v.toFixed(2) },
];

const FROM: Record<PointsFrom, { label: string; set: string }> = {
  paint: { label: "Paint", set: "points in the paint" },
  second_chance: { label: "Second chance", set: "second-chance points" },
  fast_break: { label: "Fast break", set: "fast-break points" },
  turnovers: { label: "Off turnovers", set: "points off turnovers" },
  bench: { label: "Bench", set: "bench points" },
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Why the game went the way it did: points per possession and the four
 * factors as paired bars, home growing left and away right from the label,
 * then where each team's points came from. The better side of a row is in
 * the heavier weight; no colour says good or bad.
 */
export function FactorsSection({ match, box, onOpen }: { match: StoredMatch; box: GameBox; onOpen: OpenPlays }) {
  const factors = useMemo(() => teamFactors(box), [box]);
  const from = useMemo(() => pointsFrom(match.events, box), [match.events, box]);
  const tints = useMemo(() => teamTints(match.homeTeam.color, match.awayTeam.color), [match.homeTeam.color, match.awayTeam.color]);
  const home = match.homeTeam.name || "Home";
  const away = match.awayTeam.name || "Away";
  const possessions =
    factors.home.possessions !== null && factors.away.possessions !== null
      ? Math.round((factors.home.possessions + factors.away.possessions) / 2)
      : null;
  const figures = POINTS_FROM.filter((k) => from[k] !== null);
  if (possessions === null && figures.length === 0) {
    return (
      <section>
        <GroupHeader title="Why it went that way" />
        <p className="rounded-window bg-card px-4 py-3 text-subheadline text-muted-foreground ring-1 ring-separator">
          This league's play-by-play doesn't record missed shots, so possessions and the four factors can't be counted.
        </p>
      </section>
    );
  }

  return (
    <section>
      <GroupHeader
        title="Why it went that way"
        action={possessions !== null && <span className="text-muted-foreground nums">About {possessions} possessions each</span>}
      />
      <div className="rounded-window bg-card p-4 ring-1 ring-separator">
        {possessions === null ? (
          <p className="text-subheadline text-muted-foreground">
            This league's play-by-play doesn't record missed shots, so possessions and the four factors can't be counted.
          </p>
        ) : (
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(9rem,13rem)_minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-2.5 text-sm">
          <span className="col-span-2 truncate text-right text-caption-1 text-muted-foreground">{home}</span>
          <span />
          <span className="col-span-2 truncate text-caption-1 text-muted-foreground">{away}</span>
          {FACTORS.map((f) => {
            const h = factors.home[f.key];
            const a = factors.away[f.key];
            const top = Math.max(h ?? 0, a ?? 0);
            const better = h === null || a === null || h === a ? 0 : (h > a) !== !!f.lowerIsBetter ? 1 : 2;
            return (
              <Fragment key={f.key}>
                <span className={cn("text-right nums", better === 1 && "font-semibold")}>{h === null ? "–" : f.format(h)}</span>
                <Bar value={h} top={top} colour={tints.home} side="home" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default text-center text-subheadline text-muted-foreground">{f.label}</span>
                  </TooltipTrigger>
                  <TooltipContent>{f.help}</TooltipContent>
                </Tooltip>
                <Bar value={a} top={top} colour={tints.away} side="away" />
                <span className={cn("nums", better === 2 && "font-semibold")}>{a === null ? "–" : f.format(a)}</span>
              </Fragment>
            );
          })}
        </div>
        )}
        {figures.length > 0 && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-separator pt-3 text-subheadline">
            <span className="text-muted-foreground">Points from</span>
            {figures.map((k) => {
              const cells = from[k]!;
              return (
                <span key={k} className="whitespace-nowrap">
                  <span className="text-muted-foreground">{FROM[k].label} </span>
                  <StatCell
                    cell={cells.home}
                    name={`${home}: ${FROM[k].set}`}
                    display={String(cells.home.value)}
                    onOpen={(set) => onOpen(set, { kind: "team_stat", stat: k })}
                  />
                  <span className="text-muted-foreground">–</span>
                  <StatCell
                    cell={cells.away}
                    name={`${away}: ${FROM[k].set}`}
                    display={String(cells.away.value)}
                    onOpen={(set) => onOpen(set, { kind: "team_stat", stat: k })}
                  />
                </span>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Bar({ value, top, colour, side }: { value: number | null; top: number; colour: string; side: "home" | "away" }) {
  const width = value === null || top <= 0 ? 0 : (value / top) * 100;
  return (
    <div className={cn("flex h-2", side === "home" && "justify-end")} aria-hidden>
      <div className="h-full rounded-full opacity-60" style={{ width: `${width}%`, backgroundColor: colour }} />
    </div>
  );
}
