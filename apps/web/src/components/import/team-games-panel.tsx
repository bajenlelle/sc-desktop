"use client";

import { Loader2 } from "lucide-react";
import {
  latestToImport,
  teamSeasonLabel,
  type GameResult,
  type TeamGame,
  type TeamSeason,
} from "@scoutable/shared/lib/team-games";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, GroupFooter, GroupHeader, GroupedList, GroupRow } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export type PickedFrom = "latest_card" | "team_list";

function OpponentCrest({ icon, size }: { icon: string; size: number }) {
  const style = { width: size, height: size };
  return icon ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote league crests, sized by CSS
    <img src={icon} alt="" style={style} className="shrink-0 rounded-full bg-white object-contain ring-1 ring-separator" />
  ) : (
    <span style={style} className="shrink-0 rounded-full bg-fill-2 ring-1 ring-separator" />
  );
}

/** "W 84–77", our score first. */
function Result({ result, ours, theirs, large }: { result: GameResult; ours: number; theirs: number; large?: boolean }) {
  return (
    <span className={cn("shrink-0 nums", large ? "text-base font-semibold" : "text-sm font-medium")}>
      <span className={cn("mr-1.5", result === "W" && "text-success", result === "L" && "text-destructive", result === "T" && "text-muted-foreground")}>
        {result}
      </span>
      <span className="text-foreground">
        {ours}–{theirs}
      </span>
    </span>
  );
}

function PlayoffChip() {
  return <Badge variant="secondary">Playoffs</Badge>;
}

export function ImportedTag() {
  return <Badge variant="outline">Imported</Badge>;
}

const seasonKey = (s: TeamSeason) => `${s.league.id}/${s.season.id}`;

interface TeamGamesPanelProps {
  team: LeagueTeam;
  /** null while loading. */
  seasons: TeamSeason[] | null;
  selected: TeamSeason | null;
  onSeasonChange: (season: TeamSeason) => void;
  status: "loading" | "idle" | "error";
  games: TeamGame[];
  importedIds: ReadonlySet<string>;
  /** The game being imported right now, if any. */
  busyId: string | null;
  /** New imports are blocked by a meter: only games already imported stay pressable. */
  blocked: boolean;
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
  busyId,
  blocked,
  onPick,
  onShowAll,
}: TeamGamesPanelProps) {
  if (seasons !== null && seasons.length === 0) {
    return (
      <Callout
        action={
          <Button variant="outline" size="sm" onClick={onShowAll}>
            Browse all games
          </Button>
        }
      >
        We don&apos;t have games for {team.name} yet.
      </Callout>
    );
  }

  const older = seasons && selected ? seasons[seasons.indexOf(selected) + 1] : undefined;
  const latest = latestToImport(games, importedIds);
  const rest = games.filter((g) => g !== latest);

  return (
    <div className="space-y-5">
      {seasons && selected && seasons.length > 1 && (
        <PopUpButton
          aria-label="Season"
          value={seasonKey(selected)}
          onValueChange={(key) => {
            const next = seasons.find((s) => seasonKey(s) === key);
            if (next) onSeasonChange(next);
          }}
          options={seasons.map((s) => ({ value: seasonKey(s), label: teamSeasonLabel(s) }))}
        />
      )}

      {(seasons === null || status === "loading") && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading your games…</span>
        </div>
      )}

      {seasons !== null && status === "error" && <Callout tone="destructive">Couldn&apos;t load the schedule. Check your connection.</Callout>}

      {seasons !== null && status === "idle" && games.length === 0 && (
        <Callout
          action={
            older ? (
              <Button variant="outline" size="sm" onClick={() => onSeasonChange(older)}>
                Show {older.season.label}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onShowAll}>
                Browse all games
              </Button>
            )
          }
        >
          No games for {team.name} in {selected?.season.label ?? "this season"} yet.
        </Callout>
      )}

      {seasons !== null && status === "idle" && games.length > 0 && (
        <>
          {latest && (
            <section>
              <GroupHeader title="Latest game" />
              <div className="rounded-window bg-card p-4 ring-1 ring-separator">
                <div className="flex items-center gap-3">
                  <OpponentCrest icon={latest.opponent.icon} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-foreground">
                        {latest.isHome ? "vs" : "@"} {latest.opponent.name}
                      </span>
                      {latest.playoff && <PlayoffChip />}
                    </div>
                    <p className="truncate text-callout text-muted-foreground nums">
                      {formatDate(latest.game.rawStartDateTime, "weekday")} · {latest.isHome ? "Home" : "Away"}
                      {latest.game.venueInfo.name ? ` · ${latest.game.venueInfo.name}` : ""}
                    </p>
                  </div>
                  <Result result={latest.result} ours={latest.ours} theirs={latest.theirs} large />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button disabled={blocked || busyId !== null} onClick={() => onPick(latest, "latest_card")}>
                    {busyId === latest.game.uuid && <Loader2 className="animate-spin" />}
                    Import this game
                  </Button>
                </div>
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section>
              <GroupHeader title={latest ? "Other games" : "Your games"} />
              <GroupedList>
                {rest.map((g) => {
                  const imported = importedIds.has(g.game.uuid);
                  const busy = busyId === g.game.uuid;
                  return (
                    <GroupRow
                      key={g.game.uuid}
                      leading={<OpponentCrest icon={g.opponent.icon} size={24} />}
                      label={`${g.isHome ? "vs" : "@"} ${g.opponent.name}`}
                      description={`${formatDate(g.game.rawStartDateTime, "short")} · ${g.isHome ? "Home" : "Away"}`}
                      trailing={
                        <>
                          {g.playoff && <PlayoffChip />}
                          <Result result={g.result} ours={g.ours} theirs={g.theirs} />
                          {imported && <ImportedTag />}
                          {busy && <Loader2 className="size-4 animate-spin text-primary" />}
                        </>
                      }
                      chevron
                      disabled={busyId !== null || (blocked && !imported)}
                      onClick={() => onPick(g, "team_list")}
                    />
                  );
                })}
              </GroupedList>
              {selected && seasons.length === 1 && <GroupFooter>{teamSeasonLabel(selected)}</GroupFooter>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
