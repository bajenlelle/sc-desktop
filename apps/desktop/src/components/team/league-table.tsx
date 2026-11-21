import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LeagueTable as Table, LeagueTableRow } from "@scoutable/shared/lib/team-schedule";
import { cn } from "@/lib/utils";

type SortKey = "position" | "record" | "scores" | "allows" | "library";

const COLUMNS: { key: SortKey; label: string; title: string; align: "left" | "right" }[] = [
  { key: "record", label: "W–L", title: "Won and lost", align: "left" },
  { key: "scores", label: "Scores", title: "Points scored per possession this season", align: "right" },
  { key: "allows", label: "Allows", title: "Points allowed per possession this season", align: "right" },
  { key: "library", label: "Imported", title: "This team's games you have imported", align: "right" },
];

const valueOf = (r: LeagueTableRow, key: SortKey): number => {
  switch (key) {
    case "position":
      return -(r.position ?? Infinity);
    case "record":
      return r.won - r.lost;
    case "scores":
      return r.scores ?? -Infinity;
    case "allows":
      return -(r.allows ?? Infinity);
    case "library":
      return r.libraryGames;
  }
};

/** Five marks, oldest first: a filled dot for a win, a ring for a loss (the Shots section's makes and misses). */
export function LastFive({ last5 }: { last5: string }) {
  const marks = last5.split("").filter((c) => c === "W" || c === "L");
  if (marks.length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Last ${marks.length}: ${marks.map((m) => (m === "W" ? "won" : "lost")).join(", ")}`}>
      {marks.map((m, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("size-2 rounded-full", m === "W" ? "bg-foreground" : "ring-[1.5px] ring-muted-foreground ring-inset")}
        />
      ))}
    </span>
  );
}

const games = (n: number) => (n === 0 ? "" : `${n} ${n === 1 ? "game" : "games"}`);
const ppp = (v: number | null) => (v === null ? "–" : v.toFixed(2));

/** One group's table: a row per team in standings order; a header sorts its column; a row opens the team. */
export function LeagueTable({ table, competitionId }: { table: Table; competitionId: number }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const rows = sort
    ? [...table.rows].sort((a, b) => (sort.desc ? valueOf(b, sort.key) - valueOf(a, sort.key) : valueOf(a, sort.key) - valueOf(b, sort.key)))
    : table.rows;
  const sortBy = (key: SortKey) => setSort((s) => (s?.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  return (
    <section aria-label={table.title ?? undefined}>
      {table.title && <h2 className="px-1 pb-2 text-headline text-foreground">{table.title}</h2>}
      <div className="overflow-x-auto rounded-window bg-card ring-1 ring-separator">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-caption-1 text-muted-foreground">
              <th className="w-10 py-2 pl-4 text-right font-normal">
                <SortButton label="#" title="Place in the table" active={sort?.key === "position"} desc={sort?.desc} onClick={() => sortBy("position")} />
              </th>
              <th className="py-2 pr-3 pl-3 text-left font-normal">Team</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={cn("px-2 py-2 font-normal whitespace-nowrap", c.align === "right" ? "text-right" : "text-left")}>
                  <SortButton label={c.label} title={c.title} active={sort?.key === c.key} desc={sort?.desc} onClick={() => sortBy(c.key)} />
                </th>
              ))}
              <th className="px-2 py-2 text-left font-normal">Last 5</th>
              <th className="w-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-separator border-t border-separator">
            {rows.map((r) => (
              // The whole row opens the team on a click; the name is the link the keyboard and VoiceOver use.
              // (A link stretched over the row with ::after doesn't work: WebKit ignores position: relative on <tr>.)
              <tr
                key={r.teamId}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button")) return;
                  navigate(`/teams/${competitionId}/${r.teamId}`, { state: { from: "teams" } });
                }}
                className="cursor-default transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2"
              >
                <td className="py-2 pl-4 text-right text-muted-foreground nums">{r.position ?? "–"}</td>
                <td className="py-2 pr-3 pl-3">
                  <Link
                    to={`/teams/${competitionId}/${r.teamId}`}
                    state={{ from: "teams" }}
                    className="flex min-w-0 items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-selection"
                  >
                    {r.logoUrl ? <img src={r.logoUrl} alt="" className="size-5 shrink-0 object-contain" /> : <span aria-hidden className="size-5 shrink-0" />}
                    <span className="truncate font-medium text-foreground">{r.name || `Team ${r.teamId}`}</span>
                    {r.mine && <span className="shrink-0 rounded-md bg-fill-2 px-1.5 text-caption-1 text-muted-foreground">Your team</span>}
                  </Link>
                </td>
                <td className="px-2 py-2 nums">
                  {r.won}–{r.lost}
                </td>
                <td className="px-2 py-2 text-right nums">{ppp(r.scores)}</td>
                <td className="px-2 py-2 text-right nums">{ppp(r.allows)}</td>
                <td className="px-2 py-2 text-right text-muted-foreground nums">{games(r.libraryGames)}</td>
                <td className="px-2 py-2">
                  <LastFive last5={r.last5} />
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortButton({ label, title, active, desc, onClick }: { label: string; title: string; active: boolean; desc?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-0.5 rounded px-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
    >
      {label}
      {active && (desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
    </button>
  );
}

/** Placeholder rows while the league is read. */
export function LeagueTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-window bg-card ring-1 ring-separator" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex h-10 items-center gap-3 border-t border-separator px-4 first:border-t-0">
          <div className="h-3 w-4 animate-pulse rounded bg-fill-2" />
          <div className="h-3 w-40 animate-pulse rounded bg-fill-3" />
          <div className="ml-auto h-3 w-24 animate-pulse rounded bg-fill-2" />
        </div>
      ))}
    </div>
  );
}
