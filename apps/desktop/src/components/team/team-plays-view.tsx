import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Film } from "lucide-react";
import { toast } from "sonner";
import { EMPTY_CLIP_FILTERS, hasActiveFilters, playersByTeam, type ClipFilters } from "@scoutable/shared/lib/clip-filters";
import { applyPresetFilters, presetLabelsGone, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import { pickLabel } from "@scoutable/shared/lib/team-copy";
import { pickKeys, sideNumber, sideOf, teamPlayRows, type PlaysPick, type PlaysSide } from "@scoutable/shared/lib/team-video";
import type { Label } from "@scoutable/shared/types/labels";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useFilterPresets } from "@/lib/use-filter-presets";
import type { TeamPlays } from "@/lib/use-team-plays";
import { TeamPlayList, type ListRow } from "./team-play-list";
import { TeamPlaysFilters } from "./team-plays-filters";

/** The team's latest played game that can be imported: the empty view's one action. */
export interface LatestImport {
  label: string;
  /** The import page's state for that game; null opens the import page as from the sidebar. */
  state: unknown;
}

/**
 * Plays: the team's plays across the coach's games (docs/teams.md, "Plays"),
 * one list newest game first, filtered as Add clips filters, with what Watch
 * picked as one pill. The stage (the video and the now bar) is the caller's.
 */
export function TeamPlaysView({
  orgId,
  plays,
  side,
  onSide,
  pick,
  onClearPick,
  latestImport,
  current,
  onPlay,
  labels,
  labelsOf,
  onRows,
  stage,
}: {
  orgId: string | null;
  plays: TeamPlays;
  side: PlaysSide;
  onSide: (side: PlaysSide) => void;
  pick: PlaysPick | null;
  onClearPick: () => void;
  latestImport: LatestImport | null;
  current: string | null;
  onPlay: (key: string) => void;
  labels: readonly Label[];
  labelsOf: (key: string) => ReadonlySet<string> | undefined;
  /** The listed rows, for the stage's run-on and keys. */
  onRows?: (rows: readonly ListRow[]) => void;
  stage?: ReactNode;
}) {
  const [filters, setFiltersState] = useState<ClipFilters>(EMPTY_CLIP_FILTERS);
  const setFilters = (change: (f: ClipFilters) => ClipFilters) => setFiltersState(change);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const presets = useFilterPresets(orgId, "team_plays");
  const labelIds = useMemo(() => labels.map((l) => l.id), [labels]);
  const applyPreset = (p: FilterPreset) => {
    setFiltersState((f) => applyPresetFilters(f, p.filters, labelIds));
    presets.applied(p);
    if (presetLabelsGone(p.filters, labelIds)) toast("This preset's labels no longer exist, so they weren't applied");
  };

  const allGames = useMemo(() => plays.games.map((g) => g.game), [plays.games]);
  const shown = useMemo(() => plays.games.filter((g) => !unticked.has(g.game.gameId)), [plays.games, unticked]);

  // The picked plays over the games shown, and how many of them went in (threes, a shot zone).
  const picked = useMemo(() => {
    if (!pick) return null;
    const keys = pickKeys(pick, side, shown);
    const set = new Set(keys);
    let made = 0;
    for (const g of shown) for (const e of g.events) if (set.has(`${g.game.gameId}:${e.eventId}`) && e.isSuccessful === 1) made++;
    const counted = pick.kind === "zone" || (pick.kind === "stat" && pick.stat === "threes");
    return { set, label: pickLabel(pick, keys.length, counted ? made : null) };
  }, [pick, side, shown]);

  const playerGroups = useMemo(
    () => playersByTeam(shown.flatMap((g) => g.events.filter((e) => sideOf(e) === sideNumber(g.game, side)))),
    [shown, side],
  );

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    for (const r of teamPlayRows(shown, side, picked?.set ?? null, filters, labelsOf)) {
      out.push(r);
      if (r.kind === "game") {
        const why = plays.playable(r.game.gameId);
        if (why !== "ok") out.push({ kind: "note", game: r.game, why });
      }
    }
    return out;
  }, [shown, side, picked, filters, labelsOf, plays]);
  const playCount = rows.filter((r) => r.kind === "play").length;
  const gameCount = rows.filter((r) => r.kind === "game").length;
  // The stage runs on through the listed rows: told after each change.
  useEffect(() => onRows?.(rows), [rows, onRows]);

  const labelsByKey = useMemo(() => {
    const out = new Map<string, Label[]>();
    for (const r of rows) {
      if (r.kind !== "play") continue;
      const ids = labelsOf(r.key);
      if (ids && ids.size > 0) out.set(r.key, labels.filter((l) => ids.has(l.id)));
    }
    return out;
  }, [rows, labels, labelsOf]);

  if (plays.status === "none") {
    return (
      <EmptyState
        icon={<Film />}
        title="None of their games are in your library."
        body="Import one of their games to watch their plays here."
        action={
          latestImport ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/upload" state={latestImport.state ?? undefined}>
                Import their latest game: {latestImport.label}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const filtered = hasActiveFilters(filters);
  return (
    <div className="view-fade flex min-h-0 flex-1 flex-col">
      <TeamPlaysFilters
        side={side}
        onSide={onSide}
        games={allGames}
        unticked={unticked}
        onUntick={setUnticked}
        filters={filters}
        setFilters={setFilters}
        playerGroups={playerGroups}
        labels={labels}
        presets={presets}
        onApplyPreset={applyPreset}
        pill={picked?.label ?? null}
        onClearPick={onClearPick}
      />
      <div className="flex min-h-0 flex-1">
        <section aria-label="Their plays" className="flex w-[42%] min-w-80 shrink-0 flex-col border-r border-separator">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-separator px-4 text-subheadline text-muted-foreground nums">
            <span>
              {playCount} {playCount === 1 ? "play" : "plays"} in {gameCount} {gameCount === 1 ? "game" : "games"}
            </span>
            <span>Newest game first</span>
          </div>
          {plays.failed.length > 0 && (
            <div className="flex shrink-0 items-center gap-3 border-b border-separator px-4 py-2">
              <div className="min-w-0 flex-1 text-callout text-muted-foreground">
                {plays.failed.map((g) => (
                  <p key={g.gameId}>Couldn&apos;t load plays for {g.home ? "vs" : "at"} {g.opponentName}.</p>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={plays.retry}>
                Try again
              </Button>
            </div>
          )}
          {rows.length > 0 ? (
            <TeamPlayList rows={rows} current={current} playable={plays.playable} labelsByKey={labelsByKey} onPlay={onPlay} />
          ) : plays.status === "reading" && plays.games.length === 0 ? (
            <div className="space-y-2 p-4" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-fill-1" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <p className="text-body text-muted-foreground">No plays match.</p>
              {(filtered || pick) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFiltersState(EMPTY_CLIP_FILTERS);
                    onClearPick();
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </section>
        <section aria-label="Video" className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {stage}
        </section>
      </div>
    </div>
  );
}
