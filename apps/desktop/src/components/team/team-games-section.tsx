import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { TeamGameRow } from "@scoutable/shared/lib/team-schedule";
import { Button } from "@/components/ui/button";
import { GroupHeader } from "@/components/ui/group";
import { cn } from "@/lib/utils";
import { gameDay, playedDay, tipOff } from "./dates";

/** Played games shown before "Show all", and games still to play shown at all. */
const FIRST_PLAYED = 5;
const NEXT = 2;

/** Where the import page should land: the game's league, season and stage, and the game. */
export interface ImportPick {
  leagueId: string;
  seasonId: string;
  matchId: number;
  matchType: "REGULAR" | "FINALS";
}

/**
 * The team's games: the next two still to play, then the played ones newest
 * first, each with its state in the coach's library: a game they have opens
 * on Stats, one with play-by-play they don't have can be imported.
 */
export function TeamGamesSection({
  rows,
  competitionId,
  teamName,
  library,
  mine,
  importPick,
  onAction,
}: {
  rows: readonly TeamGameRow[];
  competitionId: number;
  teamName: string;
  library: ReadonlyMap<number, string>;
  mine: ReadonlySet<number>;
  importPick: (row: TeamGameRow) => ImportPick | null;
  onAction?: (action: "open_game" | "import" | "open_team" | "show_all_games") => void;
}) {
  const [all, setAll] = useState(false);
  const { pathname } = useLocation();
  const upcoming = rows.filter((r) => r.status === "upcoming").slice(0, NEXT);
  const played = rows.filter((r) => r.status === "played").reverse();
  const shown = [...upcoming, ...(all ? played : played.slice(0, FIRST_PLAYED))];
  if (shown.length === 0) return null;

  return (
    <section aria-label="Games">
      <GroupHeader
        title="Games"
        action={
          played.length > FIRST_PLAYED ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!all) onAction?.("show_all_games");
                setAll((a) => !a);
              }}
            >
              {all ? "Show fewer" : `Show all ${played.length}`}
            </Button>
          ) : undefined
        }
      />
      <div className="overflow-hidden rounded-window bg-card ring-1 ring-separator">
        <table className="w-full border-collapse text-sm">
          <thead className="sr-only">
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Result</th>
              <th>Points per possession, scored and allowed</th>
              <th>In your library</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-separator">
            {shown.map((r) => {
              const gameId = library.get(r.matchId);
              const pick = !gameId && r.importable ? importPick(r) : null;
              return (
                <tr key={r.matchId} className={cn("relative", gameId && "transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2")}>
                  <td className="w-24 py-2 pl-4 text-muted-foreground nums">{r.status === "upcoming" ? gameDay(r.at) : playedDay(r.at)}</td>
                  <td className="py-2 pr-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-muted-foreground">{r.home ? "vs" : "at"}</span>
                      <Link
                        to={`/teams/${competitionId}/${r.opponentId}`}
                        state={{ from: "team", back: { label: teamName, path: pathname } }}
                        onClick={() => onAction?.("open_team")}
                        className="relative z-10 truncate rounded text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection"
                      >
                        {r.opponentName}
                      </Link>
                      {mine.has(r.opponentId) && <span className="shrink-0 rounded-md bg-fill-2 px-1.5 text-caption-1 text-muted-foreground">You</span>}
                    </span>
                  </td>
                  <td className="w-24 py-2 nums">{r.score && r.result ? `${r.result} ${r.score.own}–${r.score.opp}` : ""}</td>
                  <td className="w-28 py-2 text-muted-foreground nums">{r.ppp ? `${r.ppp.own.toFixed(2)} – ${r.ppp.opp.toFixed(2)}` : ""}</td>
                  <td className="w-36 py-2 pr-4 text-right">
                    {r.status === "upcoming" ? (
                      <span className="text-muted-foreground nums">{tipOff(r.at)}</span>
                    ) : gameId ? (
                      <Link
                        to={`/matches/${gameId}?view=stats`}
                        onClick={() => onAction?.("open_game")}
                        className="text-foreground outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-selection"
                      >
                        In your library
                      </Link>
                    ) : pick ? (
                      <Link
                        to="/upload"
                        state={{ pick }}
                        onClick={() => onAction?.("import")}
                        className="relative z-10 rounded text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection"
                      >
                        Import
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">No play-by-play</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
