import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { whoDoesWhat, type Named, type TeamPlayerRow } from "@scoutable/shared/lib/team-players";
import { SEASON_COLS, seasonCell, seasonLineValue, type SeasonCol } from "@/components/game/stats/season-columns";
import { PlayerPhoto } from "@/components/report/player-photo";
import { usePlayerPhotos } from "@/components/report/use-player-photos";
import { Button } from "@/components/ui/button";
import { GroupHeader } from "@/components/ui/group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TeamPlayersStatus } from "@/lib/use-team-players";

/** Players shown before "Show all". */
const FIRST = 8;

const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
const one = (n: number) => (Math.round(n * 10) / 10).toString();
const named = (list: Named[], format: (v: number) => string, unit = "") =>
  list.map((n, i) => `${surname(n.name)} ${format(n.value)}${i === 0 ? unit : ""}`).join(", ");

/** Three lines by volume, each left out when it has no one to name. */
function WhoDoesWhat({ rows }: { rows: TeamPlayerRow[] }) {
  const w = useMemo(() => whoDoesWhat(rows), [rows]);
  const lines = [
    [w.threes.length > 0 && `Most threes: ${named(w.threes, one, " a game")}`, w.offensiveGlass.length > 0 && `Offensive glass: ${named(w.offensiveGlass, one)}`]
      .filter(Boolean)
      .join(" · "),
    w.toTheLine.length > 0 ? `To the line: ${named(w.toTheLine, one, " free throws a game")}` : "",
    w.freeThrows ? `Free throws: best ${surname(w.freeThrows.best.name)} ${Math.round(w.freeThrows.best.value)}%, worst ${surname(w.freeThrows.worst.name)} ${Math.round(w.freeThrows.worst.value)}%` : "",
  ].filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  return (
    <div className="space-y-0.5 px-1 pb-3 text-body text-foreground">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

/**
 * The team's players: who does what, then the league's season averages, most
 * minutes first. Season numbers: names and numbers open nothing.
 */
export function TeamPlayersSection({
  status,
  rows,
  retry,
  onShowAll,
}: {
  status: TeamPlayersStatus;
  rows: TeamPlayerRow[];
  retry: () => void;
  onShowAll?: () => void;
}) {
  const [sort, setSort] = useState<{ key: SeasonCol; desc: boolean } | null>(null);
  const [all, setAll] = useState(false);
  const photos = usePlayerPhotos(useMemo(() => rows.map((r) => r.personId), [rows]));
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const av = seasonLineValue(a.line, sort.key) ?? -Infinity;
        const bv = seasonLineValue(b.line, sort.key) ?? -Infinity;
        return sort.desc ? bv - av : av - bv;
      })
    : rows;
  const shown = all ? sorted : sorted.slice(0, FIRST);

  let body: React.ReactNode;
  if (status === "reading") body = <div className="h-40 animate-pulse rounded-window bg-fill-1" aria-hidden />;
  else if (status === "failed")
    body = (
      <p className="flex items-center gap-2 px-1 text-subheadline text-muted-foreground">
        Couldn't load the players' season numbers.
        <Button variant="outline" size="xs" onClick={retry}>
          Try again
        </Button>
      </p>
    );
  else if (status === "no_roster") body = <p className="px-1 text-subheadline text-muted-foreground">No roster for this team yet.</p>;
  else if (status === "past_season") body = <p className="px-1 text-subheadline text-muted-foreground">Players are listed for the current season only.</p>;
  else if (rows.length === 0) body = <p className="px-1 text-subheadline text-muted-foreground">No player has played for this team yet.</p>;
  else
    body = (
      <>
        <WhoDoesWhat rows={rows} />
        <div className="overflow-x-auto rounded-window bg-card ring-1 ring-separator">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-caption-1 text-muted-foreground">
                <th className="sticky left-0 z-10 min-w-48 bg-card py-2 pr-3 pl-4 text-left font-medium text-foreground">Player</th>
                {SEASON_COLS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-normal whitespace-nowrap">
                    <button
                      type="button"
                      title={c.title}
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))}
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
              {shown.map((r) => {
                const name = (
                  <span className="flex min-w-0 items-center gap-2">
                    <PlayerPhoto
                      photoKey={photos.get(r.personId)}
                      px={24}
                      badge={null}
                      fallback={<span aria-hidden className="size-6 shrink-0 rounded-full bg-fill-1" />}
                      className="size-6 shrink-0"
                    />
                    <span className="w-6 shrink-0 text-right text-muted-foreground nums">{r.number ?? ""}</span>
                    <span className="truncate">{r.name}</span>
                  </span>
                );
                return (
                  <tr key={r.personId}>
                    <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 pr-3 pl-4 text-left font-normal">
                      {r.stints > 1 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{name}</TooltipTrigger>
                          <TooltipContent>Includes games for another team this season.</TooltipContent>
                        </Tooltip>
                      ) : (
                        name
                      )}
                    </th>
                    {SEASON_COLS.map((c) => (
                      <td key={c.key} className="px-2 py-1.5 text-right nums">
                        {seasonCell(r.line, c.key)}
                      </td>
                    ))}
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );

  return (
    <section aria-label="Players">
      <GroupHeader
        title="Players"
        action={
          status === "ready" && rows.length > FIRST ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!all) onShowAll?.();
                setAll((a) => !a);
              }}
            >
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </Button>
          ) : undefined
        }
      />
      {body}
    </section>
  );
}
