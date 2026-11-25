import { Fragment, useMemo, type ReactNode } from "react";
import {
  FACTOR_SCALE,
  LOWER_IS_BETTER,
  POINTS_FROM,
  pointsFrom,
  teamFactors,
  type FactorKey,
  type GameBox,
  type PointsFrom,
} from "@scoutable/shared/lib/game-box";
import { realGap, type SeasonContext, type TeamSeason } from "@scoutable/shared/lib/season-context";
import { allowedLine, gapCaption, seasonHoverLine, seasonKey, usuallyPerGame } from "@scoutable/shared/lib/season-copy";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { GroupHeader } from "@/components/ui/group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { teamTints } from "../team-tints";
import { FactorBar, WithHover } from "./factor-bar";
import { StatCell, type OpenPlays } from "./stat-cell";
import type { SeasonStatus } from "./use-season-context";
import { SideTeamLink } from "./side-team-link";

/** The rows in the order coaches read them: efficiency first, then the four factors. */
export const FACTORS: { key: FactorKey; label: string; help: string; format: (v: number) => string }[] = [
  { key: "ppp", label: "Points per possession", help: "Points scored each time the team had the ball.", format: (v) => v.toFixed(2) },
  { key: "efg", label: "Shooting (eFG%)", help: "Field-goal percentage with a made three counted as one and a half twos.", format: pct },
  { key: "tovRate", label: "Turnover rate", help: "Share of possessions that ended in a turnover; lower is better.", format: pct },
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
 * the heavier weight; no colour says good or bad. Each bar runs on its
 * factor's fixed scale. With the season (`season`), a line on each team's bar
 * marks its season and a caption names a gap only when it is real
 * (season-context.ts); the season never opens plays.
 */
export function FactorsSection({
  match,
  box,
  season,
  onOpen,
}: {
  match: StoredMatch;
  box: GameBox;
  season: { status: SeasonStatus; context: SeasonContext | null };
  onOpen: OpenPlays;
}) {
  const factors = useMemo(() => teamFactors(box), [box]);
  const ctx = season.context;
  const gapOf = (key: FactorKey, side: "home" | "away"): boolean => {
    if (!ctx) return false;
    const t: TeamSeason = ctx[side];
    return realGap(factors[side][key], t.factors[key], ctx.swing[key], t.games);
  };
  const usual = (side: "home" | "away", k: PointsFrom): string | undefined => {
    const n = ctx?.[side].perGame[k];
    return n === null || n === undefined ? undefined : usuallyPerGame(n);
  };
  const keyLine =
    season.status === "failed" ? "Season numbers aren't available right now." : ctx ? seasonKey(ctx.home.games, ctx.away.games, ctx.regular) : null;
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
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(9rem,13rem)_minmax(0,1fr)_6.5rem] items-center gap-x-3 gap-y-2.5 text-sm">
          <SideTeamLink side={1} name={home} className="col-span-2 truncate text-right text-caption-1 text-muted-foreground" />
          <span />
          <SideTeamLink side={2} name={away} className="col-span-2 truncate text-caption-1 text-muted-foreground" />
          {FACTORS.map((f) => {
            const h = factors.home[f.key];
            const a = factors.away[f.key];
            const better = h === null || a === null || h === a ? 0 : (h > a) !== LOWER_IS_BETTER.has(f.key) ? 1 : 2;
            const side = (s: "home" | "away") => {
              const t = ctx?.[s];
              const value = t?.factors[f.key] ?? null;
              if (!ctx || !t || value === null) return null;
              const opp = ctx[s === "home" ? "away" : "home"];
              const allowed = opp.allowed[f.key];
              const hover = (
                <>
                  <span className="block">{seasonHoverLine(f.key, value, t.games, t.ranks[f.key], t.of, ctx.regular)}</span>
                  {allowed !== null && <span className="block">{allowedLine(f.key, s === "home" ? away : home, allowed)}</span>}
                </>
              );
              const caption = gapOf(f.key, s) ? gapCaption(f.key, value, t.ranks[f.key]) : null;
              return { value, hover, caption };
            };
            const hs = side("home");
            const as = side("away");
            return (
              <Fragment key={f.key}>
                <Figure align="right" bold={better === 1} text={h === null ? "–" : f.format(h)} caption={hs?.caption ?? null} hover={hs?.hover} />
                <FactorBar value={h} mark={hs?.value ?? null} scale={FACTOR_SCALE[f.key]} colour={tints.home} grow="left" hover={hs?.hover} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default text-center text-subheadline text-muted-foreground">{f.label}</span>
                  </TooltipTrigger>
                  <TooltipContent>{f.help}</TooltipContent>
                </Tooltip>
                <FactorBar value={a} mark={as?.value ?? null} scale={FACTOR_SCALE[f.key]} colour={tints.away} grow="right" hover={as?.hover} />
                <Figure align="left" bold={better === 2} text={a === null ? "–" : f.format(a)} caption={as?.caption ?? null} hover={as?.hover} />
              </Fragment>
            );
          })}
        </div>
        )}
        {possessions !== null && keyLine && <p className="mt-3 text-footnote text-muted-foreground">{keyLine}</p>}
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
                    hint={usual("home", k)}
                    name={`${home}: ${FROM[k].set}`}
                    display={String(cells.home.value)}
                    onOpen={(set) => onOpen(set, { kind: "team_stat", stat: k })}
                  />
                  <span className="text-muted-foreground">–</span>
                  <StatCell
                    cell={cells.away}
                    hint={usual("away", k)}
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

/**
 * Tonight's number, and under it a caption when the gap to the season is real.
 * The season's lines are also read out beside the number, since the mark and
 * the hover are visual; the caption takes keyboard focus to show its hover.
 */
function Figure({ align, bold, text, caption, hover }: { align: "left" | "right"; bold: boolean; text: string; caption: string | null; hover?: ReactNode }) {
  return (
    <span className={cn("flex flex-col", align === "right" ? "items-end text-right" : "items-start")}>
      <span className={cn("nums", bold && "font-semibold")}>{text}</span>
      {hover && <span className="sr-only">{hover}</span>}
      {caption && (
        <WithHover hover={hover}>
          <span
            tabIndex={0}
            className="cursor-default whitespace-nowrap rounded-[4px] text-footnote text-muted-foreground nums outline-none focus-visible:ring-2 focus-visible:ring-selection"
          >
            {caption}
          </span>
        </WithHover>
      )}
    </span>
  );
}

