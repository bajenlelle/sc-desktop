import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import { rosterByTeam, type PlayerChoice } from "@scoutable/shared/lib/player-roster";
import { LEADER_STATS, formatLeaderValue, leaderValue, rankBy, topN, type LeaderRow, type LeaderStat } from "@scoutable/shared/lib/report-leaders";

export type PickerSort = LeaderStat | "clips";

export interface PickerConfirm {
  added: PlayerChoice[];
  /** Player ids whose section goes. */
  removed: string[];
  /** How many of the added were ticked by a quick pick. */
  fromLeaders: number;
  sortedBy: PickerSort | null;
}

/** "Top 3:" + one of these ticks the first team's three best in that stat. */
const QUICK_PICKS: { key: LeaderStat; label: string }[] = [
  { key: "ppg", label: "Scorers" },
  { key: "rpg", label: "Rebounders" },
  { key: "apg", label: "Passers" },
  { key: "spg", label: "Steals" },
  { key: "tpPct", label: "3-pt shooters" },
];

/** A shirt number as a sort key: numbers first, anything else after. */
const jersey = (n: string | null): number => {
  const v = n === null ? NaN : Number(n);
  return Number.isFinite(v) ? v : Infinity;
};

function sortRows(rows: readonly LeaderRow[], sort: PickerSort): LeaderRow[] {
  if (sort === "clips") return [...rows].sort((a, b) => b.player.clips - a.player.clips || jersey(a.player.number) - jersey(b.player.number) || a.player.name.localeCompare(b.player.name));
  return rankBy(rows, sort);
}

function matches(row: LeaderRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.player.name.toLowerCase().includes(q) || (row.player.number !== null && row.player.number === q.replace(/^#/, ""));
}

/**
 * Who is in the report: the players of the playlist's games, by team (the
 * team with the most clips first), with their clips in the playlist and their
 * season averages beside them. Ticked means in the report. Sorting a column
 * or tapping a quick pick ("Top scorers" ticks the top three) is how a coach
 * finds the opponent's leaders; unticking removes a player's section, with a
 * confirm when the section has a note.
 */
export function ReportPlayerPicker({
  open,
  onOpenChange,
  rows,
  inReport,
  noted,
  initialTicked,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everyone, in roster order. */
  rows: LeaderRow[];
  /** Player ids that have a section. */
  inReport: ReadonlySet<string>;
  /** Player ids whose section has a note. */
  noted: ReadonlySet<string>;
  /** What is ticked when the picker opens. */
  initialTicked: ReadonlySet<string>;
  /** Season pages still loading: the stat columns fill in. */
  loading: boolean;
  onConfirm: (c: PickerConfirm) => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initialTicked));
  const [fromLeaders, setFromLeaders] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<PickerSort>("clips");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  // Players were added: focus goes to the first new section's note, not back to the button that opened this.
  const keepFocusOnClose = useRef(false);

  // Opening starts over from what the report holds now.
  useEffect(() => {
    if (!open) return;
    setTicked(new Set(initialTicked));
    setFromLeaders(new Set());
    setSort("clips");
    setQuery("");
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.player.playerId, r])), [rows]);
  const teams = useMemo(() => {
    const groups = rosterByTeam(rows.map((r) => r.player));
    return groups.map((g) => ({
      teamName: g.teamName,
      clips: g.players.reduce((n, p) => n + p.clips, 0),
      rows: sortRows(g.players.map((p) => byId.get(p.playerId)!).filter(Boolean), sort),
    }));
  }, [rows, byId, sort]);
  // The other teams start folded: the opponent is the one with the clips.
  useEffect(() => {
    if (open) setCollapsed(new Set(teams.slice(1).map((t) => t.teamName)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const added = [...ticked].filter((id) => !inReport.has(id)).map((id) => byId.get(id)?.player).filter((p): p is PlayerChoice => !!p);
  const removed = [...inReport].filter((id) => !ticked.has(id));
  const removedNoted = removed.filter((id) => noted.has(id));
  const changed = added.length > 0 || removed.length > 0;

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFromLeaders((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function quickPick(stat: LeaderStat) {
    const first = teams[0];
    if (!first) return;
    const top = topN(first.rows, stat, 3).map((r) => r.player.playerId);
    setTicked((prev) => new Set([...prev, ...top]));
    setFromLeaders((prev) => new Set([...prev, ...top.filter((id) => !inReport.has(id) && !prev.has(id) && !ticked.has(id))]));
    setSort(stat);
  }

  function confirm() {
    if (!changed) {
      onOpenChange(false);
      return;
    }
    if (removedNoted.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    keepFocusOnClose.current = added.length > 0;
    onConfirm({ added, removed, fromLeaders: added.filter((p) => fromLeaders.has(p.playerId)).length, sortedBy: sort === "clips" ? null : sort });
    onOpenChange(false);
  }

  const label = !changed
    ? "Done"
    : added.length > 0 && removed.length > 0
      ? "Apply changes"
      : added.length > 0
        ? `Add ${added.length} ${added.length === 1 ? "player" : "players"}`
        : `Remove ${removed.length} ${removed.length === 1 ? "player" : "players"}`;

  const header = (key: PickerSort, text: string, align: "left" | "right" = "right") => (
    <th key={key} scope="col" className={cn("px-2 py-1.5 font-normal", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => setSort(key)}
        aria-sort={sort === key ? "descending" : undefined}
        className={cn("rounded-sm text-caption uppercase tracking-wide outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection", sort === key ? "text-foreground" : "text-muted-foreground")}
      >
        {text}
      </button>
    </th>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-3xl flex-col gap-3"
        onCloseAutoFocus={(e) => {
          if (!keepFocusOnClose.current) return;
          keepFocusOnClose.current = false;
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Players in the report</DialogTitle>
          <DialogDescription>Tick the players to scout. Each gets a section with their stats, your note and their clips.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <SearchField placeholder="Search players" value={query} onChange={(e) => setQuery(e.target.value)} className="w-48" autoFocus />
          <span className="text-callout text-muted-foreground">Top 3:</span>
          {QUICK_PICKS.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => quickPick(q.key)}
              disabled={teams.length === 0}
              className="rounded-full bg-fill-1 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-selection"
            >
              {q.label}
            </button>
          ))}
          {loading && <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Reading the season stats" />}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-window bg-card ring-1 ring-separator">
          {teams.length === 0 && <p className="px-3 py-6 text-center text-callout text-muted-foreground">No players in this playlist's games yet. Add clips first.</p>}
          {teams.map((team, ti) => {
            const shown = team.rows.filter((r) => matches(r, query));
            const folded = collapsed.has(team.teamName) && !query.trim();
            const tickedHere = team.rows.filter((r) => ticked.has(r.player.playerId)).length;
            return (
              <div key={team.teamName || `team-${ti}`} className={cn(ti > 0 && "border-t border-separator")}>
                <button
                  type="button"
                  aria-expanded={!folded}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(team.teamName)) next.delete(team.teamName);
                      else next.add(team.teamName);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-fill-1 focus-visible:ring-2 focus-visible:ring-selection"
                >
                  <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform duration-150", !folded && "rotate-90")} />
                  <span className="text-headline text-foreground">{team.teamName || "No team"}</span>
                  <span className="text-callout text-muted-foreground nums">
                    {team.rows.length} {team.rows.length === 1 ? "player" : "players"} · {team.clips} {team.clips === 1 ? "clip" : "clips"}
                    {tickedHere > 0 ? ` · ${tickedHere} ticked` : ""}
                  </span>
                </button>
                {!folded && (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-y border-separator bg-fill-1/50">
                        <th scope="col" className="w-9" />
                        <th scope="col" className="w-10 px-2 py-1.5 text-right text-caption font-normal uppercase tracking-wide text-muted-foreground">#</th>
                        <th scope="col" className="px-2 py-1.5 text-left text-caption font-normal uppercase tracking-wide text-muted-foreground">Player</th>
                        {header("clips", "Clips")}
                        {LEADER_STATS.map((s) => header(s.key, s.label))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 && (
                        <tr>
                          <td colSpan={4 + LEADER_STATS.length} className="px-3 py-3 text-center text-callout text-muted-foreground">
                            No one matches "{query.trim()}".
                          </td>
                        </tr>
                      )}
                      {shown.map((row) => {
                        const id = row.player.playerId;
                        const on = ticked.has(id);
                        return (
                          <tr
                            key={id}
                            onClick={() => toggle(id)}
                            className={cn("cursor-default border-b border-separator/60 last:border-b-0 transition-colors duration-100 hover:bg-fill-1", on && "bg-selection/10")}
                          >
                            <td className="py-1.5 pl-3">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggle(id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`${row.player.name} in the report`}
                                className="size-4 accent-primary"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground nums">{row.player.number ?? ""}</td>
                            <td className="px-2 py-1.5 text-foreground">
                              <span className="block truncate">{row.player.name}</span>
                              {inReport.has(id) && <span className="block text-caption text-muted-foreground">In the report</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right nums">{row.player.clips > 0 ? row.player.clips : <span className="text-muted-foreground">–</span>}</td>
                            {LEADER_STATS.map((s) => {
                              const v = leaderValue(row, s.key);
                              return (
                                <td key={s.key} className={cn("px-2 py-1.5 text-right nums", v === null ? "text-muted-foreground" : sort === s.key ? "text-foreground font-medium" : "text-foreground")}>
                                  {formatLeaderValue(s.key, v)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>

        {confirming ? (
          <div role="alertdialog" aria-label="Remove players with notes?" className="flex flex-col gap-2 rounded-window bg-fill-1 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Remove {removedNoted.length === 1 ? byId.get(removedNoted[0])?.player.name : `${removedNoted.length} players`}? The {removedNoted.length === 1 ? "note goes" : "notes go"} too.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
              <Button variant="destructive" size="sm" onClick={confirm}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={confirm}>{label}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
