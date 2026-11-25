import { useMemo, useState } from "react";
import { gameLineups, LINEUP_MIN_SECONDS, LINEUPS_SHOWN, type Lineup } from "@scoutable/shared/lib/game-lineups";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { GroupHeader } from "@/components/ui/group";
import { StatCell, type OpenPlays } from "./stat-cell";
import { SideTeamLink } from "./side-team-link";

type People = ReadonlyMap<number, { number: string; name: string }>;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const signed = (n: number | null) => (n === null ? "–" : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/**
 * The fives each team used, longest on the floor first, with time and the
 * score change while they were on. Described, not rated: one game is too
 * little to rate a lineup, so nothing here ranks one. A row opens every play
 * while that five was on.
 */
export function LineupsSection({ match, hasFives, people, onOpen }: { match: StoredMatch; hasFives: boolean; people: People; onOpen: OpenPlays }) {
  const lineups = useMemo(() => gameLineups(match.events), [match.events]);
  return (
    <section>
      <GroupHeader title="Lineups" />
      {!hasFives ? (
        <p className="rounded-window bg-card px-4 py-3 text-subheadline text-muted-foreground ring-1 ring-separator">
          Lineups come with games imported since September 2026.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <TeamLineups side={1} name={match.homeTeam.name || "Home"} lineups={lineups.home} people={people} onOpen={onOpen} />
          <TeamLineups side={2} name={match.awayTeam.name || "Away"} lineups={lineups.away} people={people} onOpen={onOpen} />
        </div>
      )}
    </section>
  );
}

function TeamLineups({ side, name, lineups, people, onOpen }: { side: 1 | 2; name: string; lineups: readonly Lineup[]; people: People; onOpen: OpenPlays }) {
  const [all, setAll] = useState(false);
  const main = lineups.filter((l) => l.seconds >= LINEUP_MIN_SECONDS).slice(0, LINEUPS_SHOWN);
  const shown = all ? lineups : main;
  const numbers = (l: Lineup) => l.personIds.map((id) => people.get(id)?.number || "?").join(" · ");
  const names = (l: Lineup) => l.personIds.map((id) => people.get(id)?.name ?? "Unknown").join(", ");

  return (
    <div className="overflow-hidden rounded-window bg-card ring-1 ring-separator">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-caption-1 text-muted-foreground">
            <th className="py-2 pl-4 text-left font-medium text-foreground">
              <SideTeamLink side={side} name={name} />
            </th>
            <th className="w-16 px-2 py-2 text-right font-normal">Time</th>
            <th className="w-14 py-2 pr-4 pl-2 text-right font-normal">+/-</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-separator border-t border-separator">
          {shown.map((l) => {
            const set = `Lineup ${numbers(l)}`;
            return (
              <tr key={l.personIds.join()}>
                <td className="py-1.5 pl-4" title={names(l)}>
                  <StatCell cell={l} name={set} display={numbers(l)} onOpen={(s) => onOpen(s, { kind: "lineup" })} />
                </td>
                <td className="px-2 py-1.5 text-right nums">{clock(l.seconds)}</td>
                <td className="py-1.5 pr-4 pl-2 text-right nums">{signed(l.plusMinus)}</td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-2 text-subheadline text-muted-foreground">
                No five played two minutes together.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {lineups.length > main.length && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="flex min-h-9 w-full items-center border-t border-separator px-4 text-left text-sm text-primary outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
        >
          {all ? "Show fewer" : `Show all ${lineups.length}`}
        </button>
      )}
    </div>
  );
}
