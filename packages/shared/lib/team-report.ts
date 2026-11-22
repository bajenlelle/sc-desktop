/**
 * A scouting report started from a team (docs/scouting-reports.md, "Starting
 * from a team"): the Team page's New report, Teams' next game and Reports'
 * New report make a playlist and a draft that already knows the opponent,
 * the game it prepares for, what stands out about the team and the players
 * worth a section. The coach edits from there.
 *
 * Pure: the desktop reads the season, the roster and the keys, and writes
 * the playlist and the draft (apps/desktop/src/lib/team-report.ts).
 */
import { addSections, emptyDraft, setIntro, setOpponent, setStats, type ReportDraft, type ReportGame, type ReportTeam } from "./report-draft";
import type { ReportDraftRow } from "./scouting-report-list";
import type { StatsCardPlayer, StatsCardSpec } from "./stats-card";
import { keySentence, type TeamKey, type TeamKeys } from "./team-keys";
import type { TeamPlayerRow, WhoDoesWhat } from "./team-players";

/** The players a new report starts with. */
export const REPORT_START_PLAYERS = 3;
/** The keys its intro starts with. */
export const REPORT_START_KEYS = 3;

/** "Sat 28 Nov", as the Teams pages write a game still to play. */
export function reportGameDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** The playlist's name, which the report takes as its title: "AIK · Sat 28 Nov", or "AIK" without a game. */
export function teamReportName(teamName: string, game: ReportGame | null): string {
  const name = teamName.trim() || "Opponent";
  return game?.at ? `${name} · ${reportGameDay(game.at)}` : name;
}

/**
 * Who a new report starts with: the team's leading three-point shooter,
 * offensive rebounder and free-throw getter (the players who most change
 * how you defend), then the players with the most minutes. Each once, at
 * most `max`.
 */
export function pickReportPlayers(rows: readonly TeamPlayerRow[], who: WhoDoesWhat, max = REPORT_START_PLAYERS): TeamPlayerRow[] {
  const byId = new Map(rows.map((r) => [r.personId, r]));
  const picked: TeamPlayerRow[] = [];
  const take = (personId: string | undefined) => {
    const row = personId === undefined ? undefined : byId.get(personId);
    if (!row || picked.length >= max || picked.includes(row)) return;
    picked.push(row);
  };
  take(who.threes[0]?.personId);
  take(who.offensiveGlass[0]?.personId);
  take(who.toTheLine[0]?.personId);
  for (const r of rows) take(r.personId);
  return picked;
}

/**
 * The intro a new report starts with: "What stands out" and up to three of
 * the team's keys, surest first, as lines the coach rewrites. Empty when the
 * keys say nothing yet (under five games, or nothing that qualifies).
 */
export function teamReportIntro(keys: TeamKeys | null, where: string | null, max = REPORT_START_KEYS): string {
  if (!keys || keys.status !== "ready") return "";
  const all: TeamKey[] = [...keys.withBall, ...keys.withoutBall].sort((a, b) => b.score - a.score);
  const lines = all
    .map((k) => keySentence(k, where))
    .filter((s) => s !== "")
    .slice(0, max);
  return lines.length === 0 ? "" : ["What stands out:", ...lines.map((s) => `• ${s}`)].join("\n");
}

/** A roster row as a report section names its player. */
export function reportPlayerOf(row: TeamPlayerRow, teamName: string): StatsCardPlayer {
  return { id: row.personId, name: row.name, number: row.number, teamId: null, teamName };
}

export interface TeamReportStart {
  team: ReportTeam;
  game: ReportGame | null;
  /** In report order, each with its season card (null where it couldn't be made). */
  players: readonly { player: StatsCardPlayer; stats: StatsCardSpec | null }[];
  intro: string;
}

/** The draft a report started from a team is saved with. */
export function buildTeamReportDraft(start: TeamReportStart, newId?: () => string): ReportDraft {
  let draft: ReportDraft = { ...emptyDraft(), team: start.team, game: start.game };
  draft = setOpponent(draft, start.team.name);
  draft = setIntro(draft, start.intro);
  draft = addSections(
    draft,
    start.players.map((p) => p.player),
    newId,
  );
  for (const p of start.players) {
    const section = draft.sections.find((s) => s.player.id === p.player.id);
    if (section && p.stats) draft = setStats(draft, section.id, p.stats);
  }
  return draft;
}

/**
 * The report this team already has in this space: the one for `gameId`, or,
 * without a game, the one started for the team with no game. The newest
 * when there are several; null when there is none. `inSpace` is the space's
 * playlist ids (a draft belongs to its playlist's space).
 */
export function findTeamReport(
  rows: readonly ReportDraftRow[],
  inSpace: ReadonlySet<string>,
  team: Pick<ReportTeam, "competitionId" | "teamId">,
  gameId: string | null,
): string | null {
  let best: ReportDraftRow | null = null;
  for (const r of rows) {
    if (!inSpace.has(r.playlistId) || !r.team) continue;
    if (r.team.competitionId !== team.competitionId || r.team.teamId !== team.teamId) continue;
    if (gameId === null ? !!r.game : r.game?.id !== gameId) continue;
    if (!best || r.updatedAt > best.updatedAt) best = r;
  }
  return best?.playlistId ?? null;
}
