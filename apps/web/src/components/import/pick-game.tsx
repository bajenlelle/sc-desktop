"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ScheduleGame } from "@scoutable/shared/lib/genius";
import { filterScheduleGames, resolveSelection, resolveStage, type ImportView } from "@scoutable/shared/lib/import-picker";
import { buildStoredMatch, importAnchor, importBlockOf, type ImportAnchor } from "@scoutable/shared/lib/import-session";
import { fetchGameData, getLeagueSchedule, getSeasonStages, type GameData } from "@scoutable/shared/lib/league-schedule";
import { getTeamSources } from "@scoutable/shared/lib/league-teams-db";
import { findImportedSourceGames, findMatchBySourceGame, saveMatch } from "@scoutable/shared/lib/matches-db";
import { seasonProvider } from "@scoutable/shared/lib/provider";
import { fromTeamSide, stageForMatchType, teamGames, teamSeasons, type TeamGame, type TeamSeason } from "@scoutable/shared/lib/team-games";
import type { League, Season, Stage } from "@scoutable/shared/types/league";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { Callout, GroupFooter } from "@/components/ui/group";
import { AllGamesPanel } from "@/components/import/all-games-panel";
import { TeamGamesPanel, type PickedFrom } from "@/components/import/team-games-panel";
import { cloudBlockText, importLimitText, importQuotaLabel, type ImportChecks } from "@/components/import/use-import-checks";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { useLeagues } from "@/lib/use-leagues";
import { gameVideoQuotaLabel } from "@scoutable/shared/lib/game-videos-db";

/** What the pick produced: the saved game and what its sync anchors on. */
export interface PickedGame {
  match: StoredMatch;
  anchor: ImportAnchor;
  data: GameData;
  /** The fixture was in the library already and was updated in place. */
  isUpdate: boolean;
}

type Busy = { uuid: string; step: "fetching" | "saving" } | null;
type Notice = { tone: "warning" | "destructive"; text: string; plan?: boolean } | null;

/**
 * The first step of the web import: picking a league game, from the
 * space's own team ("Your games") or any league ("All games"), then
 * fetching its play-by-play and saving the match. The selection logic is
 * the desktop importer's, with the pure parts in @scoutable/shared.
 */
export function PickGame({
  orgId,
  view,
  onViewChange,
  team,
  canSetTeam,
  onSetTeam,
  checks,
  onPicked,
}: {
  orgId: string | null;
  view: ImportView;
  onViewChange: (view: ImportView) => void;
  /** The space's team, once known; null when the space has none. */
  team: LeagueTeam | null;
  /** The space could have a team but hasn't said: offer the team dialog. */
  canSetTeam: boolean;
  onSetTeam: () => void;
  checks: ImportChecks;
  onPicked: (picked: PickedGame) => void;
}) {
  const leagues = useLeagues();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // League, season and stage. The ids are the state; the objects are
  // re-resolved against the list every render, so a served catalogue
  // replacing the bundled one never leaves a stale object (and its old
  // competitionId) selected. The full list opens on the team's league until
  // the user picks another.
  const [chosen, setChosen] = useState<{ leagueId: string | null; seasonId: string | null }>({ leagueId: null, seasonId: null });
  const [stageId, setStageId] = useState<string | null>(null);
  const leagueTouched = useRef(false);
  const teamLeagueId = team?.leagueId ?? null;
  const selectionIds = !leagueTouched.current && teamLeagueId ? { leagueId: teamLeagueId, seasonId: null } : chosen;
  const resolved = resolveSelection(leagues, selectionIds);
  const selectedLeague = resolved?.league ?? null;
  const selectedSeason = resolved?.season ?? null;
  const isProfixioSeason = !!selectedSeason && seasonProvider(selectedSeason) === "profixio";
  const seasonKey = selectedLeague && selectedSeason ? `${selectedLeague.id}/${selectedSeason.id}` : null;

  // The stage list is static for Genius seasons (regular season / playoffs)
  // and fetched for Profixio seasons (the league's categories).
  const [fetchedStages, setFetchedStages] = useState<{ key: string; stages: Stage[] | "error" } | null>(null);
  useEffect(() => {
    if (!isProfixioSeason || !selectedLeague || !selectedSeason || !seasonKey) return;
    let cancelled = false;
    getSeasonStages(createClient(), selectedLeague, selectedSeason)
      .then((list) => {
        if (!cancelled) setFetchedStages({ key: seasonKey, stages: list });
      })
      .catch((err) => {
        console.error("[import] stages", err);
        if (!cancelled) setFetchedStages({ key: seasonKey, stages: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isProfixioSeason, selectedLeague, selectedSeason, seasonKey]);
  const stages: Stage[] = !selectedSeason
    ? []
    : !isProfixioSeason
      ? selectedSeason.stages
      : fetchedStages?.key === seasonKey && fetchedStages.stages !== "error"
        ? fetchedStages.stages
        : [];
  const stageStatus: "idle" | "loading" | "error" = !isProfixioSeason
    ? "idle"
    : fetchedStages?.key !== seasonKey
      ? "loading"
      : fetchedStages.stages === "error"
        ? "error"
        : "idle";
  const selectedStage = resolveStage(stages, stageId);

  // Your games: the team's seasons, then the selected season's schedule
  // read from the team's side.
  const teamId = team?.id ?? null;
  const [teamSeasonState, setTeamSeasonState] = useState<{ teamId: string; list: TeamSeason[] | "error" } | null>(null);
  useEffect(() => {
    if (!teamId || leagues.length === 0) return;
    let cancelled = false;
    getTeamSources(createClient(), teamId)
      .then((sources) => {
        if (!cancelled) setTeamSeasonState({ teamId, list: teamSeasons(sources, leagues) });
      })
      .catch((err) => {
        console.error("[import] team seasons", err);
        if (!cancelled) setTeamSeasonState({ teamId, list: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, leagues]);
  const teamSeasonList = useMemo<TeamSeason[] | null>(
    () => (teamSeasonState?.teamId === teamId ? (teamSeasonState.list === "error" ? [] : teamSeasonState.list) : null),
    [teamSeasonState, teamId],
  );
  const [teamSeasonKey, setTeamSeasonKey] = useState<string | null>(null);
  const teamSeason =
    teamSeasonList?.find((s) => `${s.league.id}/${s.season.id}` === teamSeasonKey) ?? teamSeasonList?.[0] ?? null;
  const teamScheduleKey = teamSeason ? `${teamSeason.league.id}/${teamSeason.season.id}` : null;
  const [teamSchedule, setTeamSchedule] = useState<{ key: string; games: ScheduleGame[] | "error" } | null>(null);
  useEffect(() => {
    if (view !== "team" || !teamSeason || !teamScheduleKey) return;
    let cancelled = false;
    getLeagueSchedule(createClient(), teamSeason.league, teamSeason.season, null)
      .then((games) => {
        if (!cancelled) setTeamSchedule({ key: teamScheduleKey, games });
      })
      .catch((err) => {
        console.error("[import] team schedule", err);
        if (!cancelled) setTeamSchedule({ key: teamScheduleKey, games: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [view, teamSeason, teamScheduleKey]);
  const teamStatus: "loading" | "idle" | "error" =
    teamSchedule?.key !== teamScheduleKey ? "loading" : teamSchedule.games === "error" ? "error" : "idle";
  const myGames = useMemo<TeamGame[]>(
    () => (teamSeason && teamSchedule?.key === teamScheduleKey && teamSchedule.games !== "error" ? teamGames(teamSchedule.games, teamSeason.teamIds) : []),
    [teamSeason, teamSchedule, teamScheduleKey],
  );
  // The team's ids across every season, to tell whether any picked game is theirs.
  const allTeamIds = useMemo(() => new Set((teamSeasonList ?? []).flatMap((s) => [...s.teamIds])), [teamSeasonList]);

  // All games: the selected stage's schedule.
  const scheduleKey = seasonKey && selectedStage ? `${seasonKey}/${selectedStage.id}` : null;
  const [schedule, setSchedule] = useState<{ key: string; games: ScheduleGame[] | "error" } | null>(null);
  useEffect(() => {
    if (view !== "all" || !selectedLeague || !selectedSeason || !selectedStage || !scheduleKey) return;
    let cancelled = false;
    getLeagueSchedule(createClient(), selectedLeague, selectedSeason, selectedStage)
      .then((games) => {
        if (!cancelled) setSchedule({ key: scheduleKey, games });
      })
      .catch((err) => {
        // The user sees the error; without this we'd never know it happened.
        console.error("[import] schedule", err);
        if (!cancelled) setSchedule({ key: scheduleKey, games: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [view, selectedLeague, selectedSeason, selectedStage, scheduleKey]);
  const scheduleGames = useMemo<ScheduleGame[]>(
    () => (schedule?.key === scheduleKey && schedule.games !== "error" ? schedule.games : []),
    [schedule, scheduleKey],
  );
  const scheduleStatus: "loading" | "idle" | "error" =
    !scheduleKey ? (stageStatus === "loading" ? "loading" : "idle") : schedule?.key !== scheduleKey ? "loading" : schedule.games === "error" ? "error" : "idle";
  const [query, setQuery] = useState("");
  const filteredGames = useMemo(() => filterScheduleGames(scheduleGames, query), [scheduleGames, query]);

  // "Imported" tags for whichever list is showing.
  const visibleIdsKey = (view === "team" ? myGames.map((g) => g.game.uuid) : scheduleGames.map((g) => g.uuid)).join(",");
  const [imported, setImported] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    const ids = visibleIdsKey ? visibleIdsKey.split(",") : [];
    let cancelled = false;
    void findImportedSourceGames(createClient(), ids, orgId ?? undefined).then((set) => {
      if (!cancelled) setImported({ key: `${orgId}|${visibleIdsKey}`, ids: set });
    });
    return () => {
      cancelled = true;
    };
  }, [visibleIdsKey, orgId]);
  const importedIds = imported?.key === `${orgId}|${visibleIdsKey}` ? imported.ids : EMPTY_IDS;

  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const blocked = checks.importBlocked || checks.cloudBlock !== null;

  function handleLeagueChange(league: League) {
    if (selectedLeague && league.id === selectedLeague.id) return;
    leagueTouched.current = true;
    setChosen({ leagueId: league.id, seasonId: null });
    setStageId(null);
    setQuery("");
  }

  function handleSeasonChange(seasonId: string) {
    if (!selectedLeague || seasonId === selectedSeason?.id) return;
    leagueTouched.current = true;
    setChosen({ leagueId: selectedLeague.id, seasonId });
    setStageId(null);
    setQuery("");
  }

  function handleStageChange(id: string) {
    if (id === selectedStage?.id) return;
    leagueTouched.current = true;
    setStageId(id);
    setQuery("");
  }

  /** A game from "Your games": its league, season and stage come from the game. */
  function pickTeamGame(tg: TeamGame, from: PickedFrom) {
    if (!teamSeason?.season.competitionId) return; // Genius seasons only
    const { league, season } = teamSeason;
    void pick(tg.game, { league, season, stage: stageForMatchType(season, tg.game.matchType) }, from);
  }

  async function pick(game: ScheduleGame, ctx: { league: League; season: Season; stage: Stage | null }, from: PickedFrom | "all_list") {
    if (busy) return;
    const supabase = createClient();
    setBusy({ uuid: game.uuid, step: "fetching" });
    setNotice(null);
    try {
      // The same fixture already imported into this space: re-importing
      // updates that row in place instead of creating a duplicate, and never
      // touches the allowance (an upsert, not an insert).
      const existing = await findMatchBySourceGame(supabase, game.uuid, orgId ?? undefined);
      if (!existing && checks.importBlocked) {
        setNotice({ tone: "warning", text: importLimitText(checks.importQuota), plan: true });
        return;
      }
      if (!existing && checks.cloudBlock) {
        setNotice({ tone: "warning", text: cloudBlockText(checks.cloudBlock, checks.cloudQuota), plan: true });
        return;
      }
      const data = await fetchGameData(supabase, ctx.season, game, ctx.stage);
      if (data.pbpStatus === "empty") {
        setNotice({ tone: "destructive", text: "No play-by-play is available for this game, so clips can't be created from it." });
        return;
      }
      const match = buildStoredMatch({ ...ctx, game }, data, {
        orgId,
        existing: existing ? { id: existing.id, videoUrl: existing.videoUrl } : null,
        newId: () => crypto.randomUUID(),
      });
      if (!alive.current) return;
      setBusy({ uuid: game.uuid, step: "saving" });
      await saveMatch(supabase, match, { refreshEvents: !!existing });
      trackEvent("game_synced", {
        surface: "web",
        game_id: match.id,
        title: match.title,
        league: ctx.league.name,
        season: ctx.season.label,
        source_game_id: match.sourceGameId ?? null,
        match_date: match.date,
        has_video: false,
        has_sync_point: false,
        has_play_by_play: data.events.length > 0,
        event_count: data.events.length,
        reimport: !!existing,
        provider: seasonProvider(ctx.season),
        picked_from: from,
        team_game: fromTeamSide(game, allTeamIds) !== null,
      });
      checks.refresh();
      if (alive.current) onPicked({ match, anchor: importAnchor(data), data, isUpdate: !!existing });
    } catch (err) {
      if (!alive.current) return;
      const block = importBlockOf(err);
      if (block === "import_limit_reached") {
        // The precheck raced another import: the database is the real gate.
        setNotice({ tone: "warning", text: importLimitText(checks.importQuota), plan: true });
        checks.refresh();
        return;
      }
      if (block === "license_locked") {
        setNotice({ tone: "destructive", text: "This club's license has expired, so importing is paused until it's renewed." });
        return;
      }
      console.error("[import] pick failed", err);
      trackEvent("game_sync_failed", { surface: "web", error: String(err).slice(0, 200) });
      setNotice({ tone: "destructive", text: err instanceof Error ? err.message : "Couldn't import the game." });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const planAction = (
    <Button asChild variant="outline" size="sm">
      <Link href="/profile">Manage your plan</Link>
    </Button>
  );
  const meterLine = [importQuotaLabel(checks.importQuota), checks.cloudQuota ? gameVideoQuotaLabel(checks.cloudQuota) : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      {/* The meters, when one of them says no: the buttons below are off and here is why. */}
      {checks.loaded && checks.cloudBlock && (
        <Callout tone="warning" icon={<AlertTriangle />} action={planAction}>
          {cloudBlockText(checks.cloudBlock, checks.cloudQuota)}
        </Callout>
      )}
      {checks.loaded && checks.importBlocked && !checks.cloudBlock && (
        <Callout tone="warning" icon={<AlertTriangle />} action={planAction}>
          {importLimitText(checks.importQuota)}
        </Callout>
      )}
      {notice && (
        <Callout tone={notice.tone} icon={<AlertTriangle />} action={notice.plan ? planAction : undefined}>
          {notice.text}
        </Callout>
      )}

      {canSetTeam && view === "all" && (
        <Callout
          action={
            <Button variant="outline" size="sm" onClick={onSetTeam}>
              Set your team
            </Button>
          }
        >
          See your team&apos;s games first.
        </Callout>
      )}

      {view === "team" && team ? (
        <TeamGamesPanel
          team={team}
          seasons={teamSeasonList}
          selected={teamSeason}
          onSeasonChange={(s) => setTeamSeasonKey(`${s.league.id}/${s.season.id}`)}
          status={teamStatus}
          games={myGames}
          importedIds={importedIds}
          busyId={busy?.uuid ?? null}
          blocked={blocked}
          onPick={pickTeamGame}
          onShowAll={() => onViewChange("all")}
        />
      ) : (
        <AllGamesPanel
          leagues={leagues}
          league={selectedLeague}
          season={selectedSeason}
          stage={selectedStage}
          stages={stages}
          stageStatus={stageStatus}
          onLeagueChange={handleLeagueChange}
          onSeasonChange={handleSeasonChange}
          onStageChange={handleStageChange}
          schedule={scheduleGames}
          games={filteredGames}
          status={scheduleStatus}
          query={query}
          onQueryChange={setQuery}
          importedIds={importedIds}
          busyId={busy?.uuid ?? null}
          blocked={blocked}
          onPick={(game) => {
            if (selectedLeague && selectedSeason) void pick(game, { league: selectedLeague, season: selectedSeason, stage: selectedStage }, "all_list");
          }}
        />
      )}

      {busy && (
        <p className="flex items-center gap-2 text-callout text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" />
          {busy.step === "fetching" ? "Fetching the play-by-play…" : "Saving the game…"}
        </p>
      )}
      {meterLine && <GroupFooter>{meterLine}</GroupFooter>}
    </div>
  );
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
