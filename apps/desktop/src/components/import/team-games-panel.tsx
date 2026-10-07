import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SingleSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { cn } from "@/lib/utils";
import {
  latestToImport,
  teamSeasonLabel,
  type GameResult,
  type TeamGame,
  type TeamSeason,
} from "@scoutable/shared/lib/team-games";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";

export type PickedFrom = "latest_card" | "team_list";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function OpponentCrest({ icon, size }: { icon: string; size: number }) {
  const style = { width: size, height: size };
  return icon ? (
    <img src={icon} alt="" style={style} className="shrink-0 rounded-full bg-white object-contain ring-1 ring-border" />
  ) : (
    <span style={style} className="shrink-0 rounded-full bg-muted ring-1 ring-border" />
  );
}

/** "W 84–77", our score first. */
function Result({ result, ours, theirs, large }: { result: GameResult; ours: number; theirs: number; large?: boolean }) {
  return (
    <span className={cn("shrink-0 tabular-nums", large ? "text-base font-semibold" : "text-sm font-medium")}>
      <span
        className={cn(
          "mr-1.5",
          result === "W" && "text-emerald-600 dark:text-emerald-400",
          result === "L" && "text-red-600 dark:text-red-400",
          result === "T" && "text-muted-foreground",
        )}
      >
        {result}
      </span>
      <span className="text-foreground">
        {ours}–{theirs}
      </span>
    </span>
  );
}

function PlayoffChip() {
  return (
    <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Playoffs
    </span>
  );
}

export function ImportedTag() {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Imported</span>
  );
}

interface TeamGamesPanelProps {
  team: LeagueTeam;
  /** null while loading. */
  seasons: TeamSeason[] | null;
  selected: TeamSeason | null;
  onSeasonChange: (season: TeamSeason) => void;
  status: "loading" | "idle" | "error";
  games: TeamGame[];
  importedIds: ReadonlySet<string>;
  onPick: (game: TeamGame, from: PickedFrom) => void;
  onShowAll: () => void;
}

/**
 * "Your games": the newest game not yet imported as a card with one button,
 * then every other game of the season, read from the team's side.
 */
export function TeamGamesPanel({
  team,
  seasons,
  selected,
  onSeasonChange,
  status,
  games,
  importedIds,
  onPick,
  onShowAll,
}: TeamGamesPanelProps) {
  if (seasons !== null && seasons.length === 0) {
    return (
      <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
        <p>We don&apos;t have games for {team.name} yet.</p>
        <Button variant="outline" size="sm" onClick={onShowAll}>
          Browse all games
        </Button>
      </div>
    );
  }

  const older = seasons && selected ? seasons[seasons.indexOf(selected) + 1] : undefined;
  const latest = latestToImport(games, importedIds);
  const rest = games.filter((g) => g !== latest);

  return (
    <div className="space-y-3">
      {seasons && selected && (
        seasons.length > 1 ? (
          <SingleSelectDropdown
            options={seasons.map((s) => ({ value: `${s.league.id}/${s.season.id}`, label: teamSeasonLabel(s) }))}
            value={`${selected.league.id}/${selected.season.id}`}
            onChange={(key) => {
              const next = seasons.find((s) => `${s.league.id}/${s.season.id}` === key);
              if (next) onSeasonChange(next);
            }}
            placeholder="Season"
            required
          />
        ) : (
          <p className="text-xs text-muted-foreground">{teamSeasonLabel(selected)}</p>
        )
      )}

      {(seasons === null || status === "loading") && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading your games…</span>
        </div>
      )}

      {seasons !== null && status === "error" && (
        <p className="py-4 text-center text-sm text-red-500">Failed to load schedule. Check your connection.</p>
      )}

      {seasons !== null && status === "idle" && games.length === 0 && (
        <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
          <p>
            No games for {team.name} in {selected?.season.label ?? "this season"} yet.
          </p>
          {older ? (
            <Button variant="outline" size="sm" onClick={() => onSeasonChange(older)}>
              Show {older.season.label}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onShowAll}>
              Browse all games
            </Button>
          )}
        </div>
      )}

      {seasons !== null && status === "idle" && games.length > 0 && (
        <>
          {latest && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest game</p>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center gap-3">
                  <OpponentCrest icon={latest.opponent.icon} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-foreground">
                        {latest.isHome ? "vs" : "@"} {latest.opponent.name}
                      </span>
                      {latest.playoff && <PlayoffChip />}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {longDate(latest.game.rawStartDateTime)} · {latest.isHome ? "Home" : "Away"}
                      {latest.game.venueInfo.name ? ` · ${latest.game.venueInfo.name}` : ""}
                    </p>
                  </div>
                  <Result result={latest.result} ours={latest.ours} theirs={latest.theirs} large />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button onClick={() => onPick(latest, "latest_card")}>Import this game</Button>
                </div>
              </div>
            </div>
          )}

          {rest.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {latest ? "Other games" : "Your games"}
              </p>
              <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {rest.map((g) => (
                  <button
                    key={g.game.uuid}
                    type="button"
                    onClick={() => onPick(g, "team_list")}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    <span className="w-14 shrink-0 text-xs text-muted-foreground">{shortDate(g.game.rawStartDateTime)}</span>
                    <span className="w-5 shrink-0 text-xs text-muted-foreground">{g.isHome ? "vs" : "@"}</span>
                    <OpponentCrest icon={g.opponent.icon} size={20} />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{g.opponent.name}</span>
                    {g.playoff && <PlayoffChip />}
                    <Result result={g.result} ours={g.ours} theirs={g.theirs} />
                    <span className="w-16 shrink-0 text-right">{importedIds.has(g.game.uuid) && <ImportedTag />}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
