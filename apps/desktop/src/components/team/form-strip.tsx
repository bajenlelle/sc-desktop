import { Link } from "react-router-dom";
import { FORM_MARGIN_CAP, formStrip, type TeamGameRow } from "@scoutable/shared/lib/team-schedule";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { playedDay } from "./dates";

/** Half the strip's height: a bar of the capped margin reaches the edge. */
const HALF = 18;

/**
 * The season in one glance: a bar per regular-season game, oldest first, up
 * for a win and down for a loss, as tall as the margin (capped). A dot under a
 * game in the coach's library; that bar opens the game on Stats.
 */
export function FormStrip({ rows, library }: { rows: readonly TeamGameRow[]; library: ReadonlyMap<number, string> }) {
  const bars = formStrip(rows);
  if (bars.length === 0) return null;
  const byId = new Map(rows.map((r) => [r.matchId, r]));
  return (
    <div className="flex items-stretch gap-[3px]" role="list" aria-label="Season, game by game">
      {bars.map((b) => {
        const row = byId.get(b.matchId)!;
        const gameId = library.get(b.matchId);
        const label = `${playedDay(row.at)} ${row.home ? "vs" : "at"} ${row.opponentName}, ${b.won ? "won" : "lost"} ${row.score!.own}–${row.score!.opp}.${gameId ? " Imported." : ""}`;
        const height = Math.max(2, (b.margin / FORM_MARGIN_CAP) * HALF);
        const bar = (
          <span className="flex w-[9px] flex-col items-center" style={{ height: HALF * 2 + 8 }}>
            <span className="flex w-full flex-1 items-end" style={{ height: HALF }}>
              {b.won && <span className="w-full rounded-[2px] bg-foreground" style={{ height }} />}
            </span>
            <span className="flex w-full flex-1 items-start" style={{ height: HALF }}>
              {!b.won && <span className="w-full rounded-[2px] bg-muted-foreground/60" style={{ height }} />}
            </span>
            <span className={cn("mt-1 size-[5px] rounded-full", gameId ? "bg-primary" : "bg-transparent")} />
          </span>
        );
        return (
          <Tooltip key={b.matchId}>
            <TooltipTrigger asChild>
              {gameId ? (
                <Link
                  role="listitem"
                  to={`/matches/${gameId}?view=stats`}
                  aria-label={label}
                  className="rounded-sm outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-selection"
                >
                  {bar}
                </Link>
              ) : (
                <span role="listitem" aria-label={label} tabIndex={0} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-selection">
                  {bar}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
