/**
 * Starting a scouting report from a team (docs/scouting-reports.md, "Starting
 * from a team"): reads what the Team page knows about the team (its season,
 * its next game against the space's team, its keys and its players), then
 * writes the playlist and a draft that already holds the opponent, the intro
 * and the players with their season cards. The report opens in the
 * playlist's Report view, as every report does.
 *
 * The reads are the Team page's own (league-data.ts, the roster and the
 * season page), cached, so a report started from the page it was looking at
 * costs no new reads.
 */
import { getTeamSources } from "@scoutable/shared/lib/league-teams-db";
import { listTeamRoster } from "@scoutable/shared/lib/league-players-db";
import { leagueSeason } from "@scoutable/shared/lib/league-season";
import { emptyDraft, setOpponent, type ReportGame, type ReportTeam } from "@scoutable/shared/lib/report-draft";
import { makeSeasonCard, seasonOfCompetition } from "@scoutable/shared/lib/stats-card-data";
import { teamSeasons } from "@scoutable/shared/lib/team-games";
import { teamKeys } from "@scoutable/shared/lib/team-keys";
import { teamPlayers, whoDoesWhat } from "@scoutable/shared/lib/team-players";
import { buildTeamReportDraft, pickReportPlayers, reportPlayerOf, teamReportKeys, teamReportName } from "@scoutable/shared/lib/team-report";
import { meeting, nextGame, teamGameRows, teamGroupLabel, teamNames } from "@scoutable/shared/lib/team-schedule";
import type { League } from "@scoutable/shared/types/league";
import { trackEvent } from "@/lib/analytics";
import { loadFixtures, loadSeason } from "@/lib/league-data";
import { announcePlaylistsChanged } from "@/lib/playlist-events";
import { createPlaylist, deletePlaylist } from "@/lib/playlists-db";
import { setCollectTarget } from "@/lib/prefs";
import { saveReportDraft } from "@/lib/report-drafts-db";
import { loadSeasonPlayers } from "@/lib/stats-card-data";
import { createClient } from "@/lib/supabase/client";

/** Where New report was pressed (scouting_report_started's `from`). */
export type ReportStartFrom = "team_page" | "next_game" | "reports";

/** The collect target key the team's Plays remembers (pages/team.tsx). */
export const teamCollectKey = (competitionId: number, teamId: number) => `team:${competitionId}:${teamId}`;

/** The space's team's ids in a competition (a Genius team id is per season); empty without a team there. */
export async function myTeamIdsIn(spaceTeamId: string | null, competitionId: number, leagues: League[]): Promise<ReadonlySet<number>> {
  if (!spaceTeamId) return new Set();
  const sources = await getTeamSources(createClient(), spaceTeamId);
  const season = teamSeasons(sources, leagues).find((s) => s.season.competitionId === competitionId);
  return new Set(season ? [...season.teamIds].map(Number) : []);
}

/**
 * The next game against the space's team, as a report names it; null when
 * they don't meet again this season (a game already played doesn't count:
 * a report prepares for one to come).
 */
export function nextMeeting(rows: Parameters<typeof meeting>[0], mine: ReadonlySet<number>): ReportGame | null {
  const m = meeting(rows, mine);
  if (m?.kind !== "next" || !m.row.at) return null;
  return { id: String(m.row.matchId), at: m.row.at, home: m.row.home };
}

/** A team in the catalogue (league_teams) as the Teams pages open it: its newest season's ids; null when it has none we follow. */
export async function resolveLeagueTeam(leagueTeamId: string, leagues: League[]): Promise<{ competitionId: number; teamId: number } | null> {
  const newest = teamSeasons(await getTeamSources(createClient(), leagueTeamId), leagues)[0];
  const teamId = newest ? Number([...newest.teamIds][0]) : NaN;
  if (!newest?.season.competitionId || !Number.isFinite(teamId)) return null;
  return { competitionId: newest.season.competitionId, teamId };
}

/** The next game this team plays against the space's team, read from the season; null when none is to come. */
export async function nextGameAgainstUs(competitionId: number, teamId: number, spaceTeamId: string | null, leagues: League[]): Promise<ReportGame | null> {
  if (!spaceTeamId) return null;
  const [payload, fixtures, mine] = await Promise.all([loadSeason(competitionId), loadFixtures(competitionId), myTeamIdsIn(spaceTeamId, competitionId, leagues)]);
  return payload ? nextMeeting(teamGameRows(fixtures, payload, teamId, new Date()), mine) : null;
}

/** The space's team's next opponent this season, for the top of Reports' New report; null without a team or a game to come. */
export async function nextOpponent(
  spaceTeamId: string | null,
  leagues: League[],
): Promise<{ competitionId: number; teamId: number; name: string; game: ReportGame } | null> {
  if (!spaceTeamId) return null;
  const own = await resolveLeagueTeam(spaceTeamId, leagues);
  if (!own) return null;
  const [payload, fixtures, mine] = await Promise.all([loadSeason(own.competitionId), loadFixtures(own.competitionId), myTeamIdsIn(spaceTeamId, own.competitionId, leagues)]);
  const next = payload ? nextGame(fixtures, payload, mine, new Date()) : null;
  if (!next?.at) return null;
  // The row is from the space's team's side; the report is from the opponent's.
  return { competitionId: own.competitionId, teamId: next.opponentId, name: next.opponentName, game: { id: String(next.matchId), at: next.at, home: !next.home } };
}

export interface TeamReportTarget {
  competitionId: number;
  teamId: number;
  /** The game it prepares for, when the caller already knows it; read here otherwise. */
  game?: ReportGame | null;
}

/**
 * Makes the playlist and the draft for a report about this team and returns
 * the playlist's id. Throws when the playlist or the draft can't be written
 * (a playlist without its draft is taken away again). A read that fails on
 * the way (the roster, the season page) only leaves that part empty.
 */
export async function createTeamReport(
  target: TeamReportTarget,
  ctx: { orgId: string | null; spaceTeamId: string | null; leagues: League[]; from: ReportStartFrom },
): Promise<string> {
  const { competitionId, teamId } = target;
  const [payload, fixtures] = await Promise.all([loadSeason(competitionId), loadFixtures(competitionId)]);
  const name = teamNames(fixtures).get(teamId)?.name ?? "";
  const team: ReportTeam = { competitionId, teamId, name: name || "Opponent" };

  let game = target.game ?? null;
  let keysText = "";
  let keysCount = 0;
  if (payload) {
    const league = leagueSeason(payload);
    const profile = league.teams.get(teamId);
    if (profile) {
      const keys = teamKeys(profile, league);
      keysCount = keys.withBall.length + keys.withoutBall.length;
      keysText = teamReportKeys(keys, teamGroupLabel(league, profile.group, fixtures));
    }
    if (target.game === undefined) {
      const mine = await myTeamIdsIn(ctx.spaceTeamId, competitionId, ctx.leagues).catch(() => new Set<number>());
      game = nextMeeting(teamGameRows(fixtures, payload, teamId, new Date()), mine);
    }
  }

  const players = await startingPlayers(competitionId, teamId, team.name, ctx.leagues).catch((e) => {
    console.error("[report] the team's players couldn't be read:", e);
    return [];
  });
  const draft = buildTeamReportDraft({ team, game, players, keys: keysText });

  const playlist = await createPlaylist(teamReportName(team.name, game), undefined, ctx.orgId ?? undefined);
  try {
    await saveReportDraft(playlist.id, draft);
  } catch (e) {
    await deletePlaylist(playlist.id).catch(() => {});
    throw e;
  }
  trackEvent("playlist_created", { playlist_id: playlist.id, in_folder: false, surface: "report" });
  trackEvent("scouting_report_started", { from: ctx.from, opponent: "league", players: draft.sections.length, keys: keysCount, game: !!game });
  // The team's Plays adds into the report from now on.
  setCollectTarget(teamCollectKey(competitionId, teamId), playlist.id);
  announcePlaylistsChanged();
  return playlist.id;
}

/** The players a new report starts with, each with this season's card. */
async function startingPlayers(competitionId: number, teamId: number, teamName: string, leagues: League[]) {
  const roster = await listTeamRoster(createClient(), String(teamId));
  if (roster.length === 0) return [];
  const seasonPlayers = await loadSeasonPlayers(competitionId);
  const rows = teamPlayers(roster, seasonPlayers);
  const season = seasonOfCompetition(competitionId, leagues);
  return pickReportPlayers(rows, whoDoesWhat(rows)).map((row) => {
    const player = reportPlayerOf(row, teamName);
    const line = seasonPlayers.get(row.personId);
    return { player, stats: season && line ? makeSeasonCard(season, player, line) : null };
  });
}

/** A report about an opponent the Teams pages don't have: a playlist named after it, and a draft that knows only the name. */
export async function createNamedReport(opponent: string, ctx: { orgId: string | null }): Promise<string> {
  const name = opponent.trim();
  const playlist = await createPlaylist(name, undefined, ctx.orgId ?? undefined);
  try {
    await saveReportDraft(playlist.id, setOpponent(emptyDraft(), name));
  } catch (e) {
    await deletePlaylist(playlist.id).catch(() => {});
    throw e;
  }
  trackEvent("playlist_created", { playlist_id: playlist.id, in_folder: false, surface: "report" });
  trackEvent("scouting_report_started", { from: "reports", opponent: "typed", players: 0, keys: 0, game: false });
  announcePlaylistsChanged();
  return playlist.id;
}
