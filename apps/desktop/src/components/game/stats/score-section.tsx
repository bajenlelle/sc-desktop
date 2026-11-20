import { useId, useMemo } from "react";
import { clockSeconds, flowChart, periodLengthSeconds, type GameFlow } from "@scoutable/shared/lib/game-flow";
import { periodLabel } from "@scoutable/shared/lib/events";
import { quarterPoints } from "@scoutable/shared/lib/game-box";
import type { SeasonContext } from "@scoutable/shared/lib/season-context";
import { lastFiveLine, standingLine } from "@scoutable/shared/lib/season-copy";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { GroupHeader } from "@/components/ui/group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { teamTints } from "../team-tints";
import { StatCell, type OpenPlays } from "./stat-cell";

const CHART_W = 1000;
const CHART_H = 96;

/**
 * The game's story: points by quarter for each team, and the lead graph with
 * its runs. A quarter's figure opens that team's baskets in it; a run opens
 * every play of its stretch.
 */
export function ScoreSection({
  match,
  flow,
  season,
  onOpen,
}: {
  match: StoredMatch;
  flow: GameFlow;
  /** Each team's place in today's table, under the score, when the season is in. */
  season: SeasonContext | null;
  onOpen: OpenPlays;
}) {
  const quarters = useMemo(() => quarterPoints(match.events), [match.events]);
  const tints = useMemo(() => teamTints(match.homeTeam.color, match.awayTeam.color), [match.homeTeam.color, match.awayTeam.color]);
  if (flow.source === "none" || quarters.length === 0) return null;

  const teams = [
    { side: 1 as const, name: match.homeTeam.name || "Home", total: flow.final?.home ?? 0, tint: tints.home },
    { side: 2 as const, name: match.awayTeam.name || "Away", total: flow.final?.away ?? 0, tint: tints.away },
  ];
  const standingOf = (side: 1 | 2) => (side === 1 ? season?.home.standing : season?.away.standing) ?? null;
  const winner = (flow.final?.home ?? 0) === (flow.final?.away ?? 0) ? 0 : (flow.final?.home ?? 0) > (flow.final?.away ?? 0) ? 1 : 2;
  const lead = (side: 1 | 2) => (side === 1 ? flow.largestLead.home : flow.largestLead.away);
  const leads = teams.filter((t) => (lead(t.side)?.lead ?? 0) > 0).map((t) => `${t.name} +${lead(t.side)!.lead}`);
  const facts = [
    leads.length > 0 && `Largest lead ${leads.join(", ")}`,
    `${flow.leadChanges.length} lead ${flow.leadChanges.length === 1 ? "change" : "changes"}`,
    `${flow.ties.length} ${flow.ties.length === 1 ? "tie" : "ties"}`,
  ].filter(Boolean);

  return (
    <section>
      <GroupHeader title="Score" />
      <div className="grid gap-x-8 gap-y-4 rounded-window bg-card p-4 ring-1 ring-separator lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-caption-1 text-muted-foreground">
              <th className="text-left font-normal">
                <span className="sr-only">Team</span>
              </th>
              {quarters.map((q) => (
                <th key={q.period} className="w-10 text-right font-normal">
                  {periodLabel(q.period)}
                </th>
              ))}
              <th className="w-14 text-right font-normal">Final</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.side}>
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: t.tint }} />
                    <span className="truncate">{t.name}</span>
                  </span>
                </th>
                {quarters.map((q) => {
                  const cell = t.side === 1 ? q.home : q.away;
                  return (
                    <td key={q.period} className="text-right">
                      <StatCell
                        cell={cell}
                        name={`${t.name}: points in ${periodLabel(q.period)}`}
                        display={String(cell.value)}
                        onOpen={(set) => onOpen(set, { kind: "quarter", stat: periodLabel(q.period) })}
                      />
                    </td>
                  );
                })}
                <td className={`text-right text-title-3 nums ${winner === t.side ? "font-semibold" : ""}`}>{t.total}</td>
              </tr>
            ))}
          </tbody>
          {teams.some((t) => standingOf(t.side)) && (
            <tfoot>
              <tr>
                <td colSpan={quarters.length + 2} className="pt-2">
                  <p className="flex flex-wrap gap-x-6 gap-y-1 text-subheadline text-muted-foreground nums">
                    {teams.map((t) => {
                      const s = standingOf(t.side);
                      if (!s) return null;
                      return (
                        <span key={t.side} className="whitespace-nowrap">
                          <span>{t.name} </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                tabIndex={0}
                                className="cursor-default rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-selection"
                              >
                                {standingLine(s)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{lastFiveLine(s.last5)}</TooltipContent>
                          </Tooltip>
                        </span>
                      );
                    })}
                  </p>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        <div>
          <LeadGraph match={match} flow={flow} tints={tints} onOpen={onOpen} />
          <p className="mt-2 text-subheadline text-muted-foreground nums">{facts.join(" · ")}</p>
        </div>
      </div>
    </section>
  );
}

/** Seconds into the game for every play, quarter by quarter on the game clock; null without clocks. */
function useGameSeconds(match: StoredMatch, flow: GameFlow) {
  return useMemo(() => {
    if (!flow.byClock) return null;
    const periods = [...new Set(flow.order.map((e) => e.period))].sort((a, b) => a - b);
    const starts = new Map<number, number>();
    let total = 0;
    for (const p of periods) {
      starts.set(p, total);
      total += periodLengthSeconds(match.events, p);
    }
    const at = (period: number, clock: string) =>
      (starts.get(period) ?? 0) + periodLengthSeconds(match.events, period) - Math.max(0, clockSeconds({ gameClockTime: clock }));
    const byEvent = new Map<number, number>();
    for (const e of flow.order) byEvent.set(e.eventId, at(e.period, e.gameClockTime));
    return { total, starts: [...starts.values()].slice(1), byEvent, at };
  }, [match.events, flow]);
}

function LeadGraph({
  match,
  flow,
  tints,
  onOpen,
}: {
  match: StoredMatch;
  flow: GameFlow;
  tints: ReturnType<typeof teamTints>;
  onOpen: OpenPlays;
}) {
  const patternId = useId();
  const seconds = useGameSeconds(match, flow);
  if (!seconds || seconds.total <= 0) return null;
  const xOf = (s: number) => (s / seconds.total) * CHART_W;
  const chart = flowChart({
    points: flow.points.map((p) => ({ x: xOf(seconds.at(p.period, p.clock)), diff: p.diff })),
    x0: 0,
    x1: CHART_W,
    height: CHART_H,
    pad: 4,
  });
  const runs = flow.runs.map((run, i) => {
    const from = flow.indexOf.get(run.fromEventId) ?? 0;
    const to = flow.indexOf.get(run.toEventId) ?? from;
    const x0 = xOf(seconds.byEvent.get(run.fromEventId) ?? 0);
    const x1 = Math.max(x0 + 4, xOf(seconds.byEvent.get(run.toEventId) ?? 0));
    const team = run.team === 1 ? match.homeTeam.name || "Home" : match.awayTeam.name || "Away";
    return {
      key: i,
      run,
      x0,
      x1,
      name: `${team}: ${run.points}–0 run in ${periodLabel(run.period)}`,
      eventIds: flow.order.slice(from, to + 1).map((e) => e.eventId),
    };
  });

  return (
    <div className="relative" style={{ height: CHART_H }}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full text-foreground" aria-hidden>
        <defs>
          <pattern id={`${patternId}-away`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
            <line x1="0" y1="0" x2="0" y2="5" strokeWidth="1.5" stroke={tints.away} strokeOpacity={0.55} />
          </pattern>
        </defs>
        {runs.map((r) => (
          <rect
            key={r.key}
            x={r.x0}
            y={0}
            width={r.x1 - r.x0}
            height={CHART_H}
            fill={r.run.team === 1 ? tints.home : tints.away}
            fillOpacity={(r.run.team === 1 ? tints.homeOpacity : tints.awayOpacity) * 0.5}
          />
        ))}
        {seconds.starts.map((s) => (
          <line key={s} x1={xOf(s)} x2={xOf(s)} y1={0} y2={CHART_H} strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--separator)" }} />
        ))}
        <path d={chart.home} fill={tints.home} fillOpacity={tints.homeOpacity} />
        <path d={chart.away} fill={tints.away} fillOpacity={tints.awayOpacity} />
        {tints.awayHatch && <path d={chart.away} fill={`url(#${patternId}-away)`} />}
        <line x1={0} x2={CHART_W} y1={chart.zeroY} y2={chart.zeroY} strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--separator-strong)" }} />
        <path d={chart.line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {/* A run's score sits at the top of its band, home's above the line's side and away's below: each opens its stretch. */}
      {runs.map((r) => (
        <div
          key={r.key}
          className={`absolute -translate-x-1/2 ${r.run.team === 1 ? "top-0.5" : "bottom-0.5"}`}
          style={{ left: `${(((r.x0 + r.x1) / 2) / CHART_W) * 100}%` }}
        >
          <StatCell
            cell={{ eventIds: r.eventIds }}
            name={r.name}
            display={`${r.run.points}–0`}
            onOpen={(set) => onOpen(set, { kind: "run" })}
            className="bg-card/80 text-caption-1 text-muted-foreground"
          />
        </div>
      ))}
    </div>
  );
}
