"use client";

import { Loader2 } from "lucide-react";
import type { ScheduleGame } from "@scoutable/shared/lib/genius";
import { scheduleEmptyMessage } from "@scoutable/shared/lib/import-picker";
import { seasonProvider } from "@scoutable/shared/lib/provider";
import type { League, Season, Stage } from "@scoutable/shared/types/league";
import { Callout, GroupedList, GroupRow } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SearchField } from "@/components/ui/search-field";
import { ImportedTag } from "@/components/import/team-games-panel";
import { LeaguePicker } from "@/components/import/league-picker";
import { formatDate } from "@/lib/format-date";

function TeamCrest({ icon }: { icon: string }) {
  if (!icon) return null;
  // eslint-disable-next-line @next/next/no-img-element -- remote league crests, sized by CSS
  return <img src={icon} alt="" className="size-5 shrink-0 object-contain" />;
}

interface AllGamesPanelProps {
  leagues: League[];
  league: League | null;
  season: Season | null;
  stage: Stage | null;
  stages: Stage[];
  stageStatus: "idle" | "loading" | "error";
  onLeagueChange: (league: League) => void;
  onSeasonChange: (seasonId: string) => void;
  onStageChange: (stageId: string) => void;
  /** The whole schedule of the selected stage, before the search. */
  schedule: ScheduleGame[];
  /** The games the search leaves. */
  games: ScheduleGame[];
  status: "loading" | "idle" | "error";
  query: string;
  onQueryChange: (query: string) => void;
  importedIds: ReadonlySet<string>;
  busyId: string | null;
  /** New imports are blocked by a meter: only games already imported stay pressable. */
  blocked: boolean;
  onPick: (game: ScheduleGame) => void;
}

/**
 * "All games": a league, its season and stage (a Profixio category), a
 * search, and every completed game with play-by-play as a row.
 */
export function AllGamesPanel({
  leagues,
  league,
  season,
  stage,
  stages,
  stageStatus,
  onLeagueChange,
  onSeasonChange,
  onStageChange,
  schedule,
  games,
  status,
  query,
  onQueryChange,
  importedIds,
  busyId,
  blocked,
  onPick,
}: AllGamesPanelProps) {
  const isProfixio = !!season && seasonProvider(season) === "profixio";
  return (
    <div className="space-y-3">
      {/* League · Season · Stage. Season and Stage stay hidden while there's
          only one option: no dead controls for single-season leagues. */}
      <div className="flex flex-wrap items-center gap-2">
        <LeaguePicker leagues={leagues} value={league} onChange={onLeagueChange} />
        {league && league.seasons.length > 1 && (
          <PopUpButton
            aria-label="Season"
            value={season?.id ?? null}
            onValueChange={onSeasonChange}
            options={league.seasons.map((s) => ({ value: s.id, label: s.label }))}
            className="pointer-coarse:h-9 pointer-coarse:rounded-lg"
          />
        )}
        {stages.length > 1 && (
          <PopUpButton
            aria-label={isProfixio ? "Category" : "Stage"}
            value={stage?.id ?? null}
            onValueChange={onStageChange}
            options={stages.map((s) => ({ value: s.id, label: s.label }))}
            placeholder={isProfixio ? "Category" : "Stage"}
            className="pointer-coarse:h-9 pointer-coarse:rounded-lg"
          />
        )}
        {stageStatus === "loading" && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading categories" />}
      </div>
      {isProfixio && <p className="text-callout text-muted-foreground">This league records points, fouls and timeouts only.</p>}

      {stageStatus === "error" ? (
        <Callout tone="destructive">Couldn&apos;t load the categories. Check your connection.</Callout>
      ) : (
        <>
          <SearchField placeholder="Search by team or date" aria-label="Search games" value={query} onChange={(e) => onQueryChange(e.target.value)} />

          {(status === "loading" || stageStatus === "loading") && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading the schedule…</span>
            </div>
          )}

          {status === "error" && stageStatus !== "loading" && <Callout tone="destructive">Couldn&apos;t load the schedule. Check your connection.</Callout>}

          {status === "idle" && stageStatus === "idle" && (
            games.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {scheduleEmptyMessage({
                  scheduleCount: schedule.length,
                  isProfixio,
                  stage,
                  stageCount: stages.length,
                  seasonCount: league?.seasons.length ?? 0,
                  seasonLabel: season?.label ?? null,
                })}
              </p>
            ) : (
              <GroupedList>
                {games.map((game) => {
                  const imported = importedIds.has(game.uuid);
                  const busy = busyId === game.uuid;
                  return (
                    <GroupRow
                      key={game.uuid}
                      leading={<span className="w-14 text-callout text-muted-foreground nums">{formatDate(game.rawStartDateTime, "short")}</span>}
                      label={
                        <span className="flex min-w-0 items-center gap-1.5">
                          <TeamCrest icon={game.homeTeamInfo.icon} />
                          <span className="truncate font-medium">{game.homeTeamInfo.names.short}</span>
                          <span className="shrink-0 text-xs font-semibold text-foreground/80 nums">
                            {game.homeTeamInfo.score}–{game.awayTeamInfo.score}
                          </span>
                          <span className="truncate font-medium">{game.awayTeamInfo.names.short}</span>
                          <TeamCrest icon={game.awayTeamInfo.icon} />
                        </span>
                      }
                      description={game.venueInfo?.name || undefined}
                      trailing={
                        <>
                          {imported && <ImportedTag />}
                          {busy && <Loader2 className="size-4 animate-spin text-primary" />}
                        </>
                      }
                      chevron
                      disabled={busyId !== null || (blocked && !imported)}
                      onClick={() => onPick(game)}
                    />
                  );
                })}
              </GroupedList>
            )
          )}
        </>
      )}
    </div>
  );
}
