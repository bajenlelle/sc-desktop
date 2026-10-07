/**
 * "Your team": the real-world team a user coaches or plays for, one answer per
 * space (league_teams / space_team_choices, migration 20261009100000).
 * Pure helpers shared by the desktop, web and mobile team step and Profile.
 * Copy lives here too so the three apps word it the same way.
 */
import type { LeagueTeam, TeamChoice, TeamRole } from '../types/league-team';
import type { OrgMembership } from '../types/org';

/**
 * Catalogue order of the leagues we import from, top tier first. Leagues not
 * listed (a future source) follow, alphabetically, so a new source still shows.
 */
export const LEAGUE_DISPLAY_ORDER = [
  'sbl-herr',
  'sbl-dam',
  'superettan-herr',
  'basketettan-herr',
  'basketettan-dam',
];

/** Teams seen in their league's newest season; relegated or folded teams drop out. */
export function currentTeams(teams: LeagueTeam[]): LeagueTeam[] {
  const newest = new Map<string, string>();
  for (const t of teams) {
    const seen = newest.get(t.leagueId);
    if (!seen || t.seasonId > seen) newest.set(t.leagueId, t.seasonId);
  }
  return teams.filter((t) => t.seasonId === newest.get(t.leagueId));
}

/** Lowercase without accents, so "umea" finds "Umeå". */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Teams whose name, club or league contain every word of the query. */
export function searchTeams(teams: LeagueTeam[], query: string): LeagueTeam[] {
  const words = foldForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return teams;
  return teams.filter((t) => {
    const haystack = foldForSearch(`${t.name} ${t.clubName ?? ''} ${t.leagueName}`);
    return words.every((w) => haystack.includes(w));
  });
}

export type TeamSection =
  | { kind: 'club'; teams: LeagueTeam[] }
  | { kind: 'league'; leagueId: string; leagueName: string; teams: LeagueTeam[] };

function leagueRank(leagueId: string): number {
  const i = LEAGUE_DISPLAY_ORDER.indexOf(leagueId);
  return i === -1 ? LEAGUE_DISPLAY_ORDER.length : i;
}

function byLeagueThenName(a: LeagueTeam, b: LeagueTeam): number {
  return (
    leagueRank(a.leagueId) - leagueRank(b.leagueId) ||
    a.leagueName.localeCompare(b.leagueName, 'sv') ||
    a.name.localeCompare(b.name, 'sv')
  );
}

/**
 * Picker sections: the club's teams first (when the space has suggestions),
 * then one section per league. A suggested team appears only in the first.
 */
export function groupTeams(teams: LeagueTeam[], suggestedIds: ReadonlySet<string>): TeamSection[] {
  const sorted = [...teams].sort(byLeagueThenName);
  const sections: TeamSection[] = [];
  const clubTeams = sorted.filter((t) => suggestedIds.has(t.id));
  if (clubTeams.length > 0) sections.push({ kind: 'club', teams: clubTeams });
  for (const t of sorted) {
    if (suggestedIds.has(t.id)) continue;
    const last = sections[sections.length - 1];
    if (last?.kind === 'league' && last.leagueId === t.leagueId) last.teams.push(t);
    else sections.push({ kind: 'league', leagueId: t.leagueId, leagueName: t.leagueName, teams: [t] });
  }
  return sections;
}

/** Spaces that get a team. National-team spaces have no league team, so they are never asked. */
export function teamSpaces(orgs: OrgMembership[]): OrgMembership[] {
  return orgs.filter((o) => !o.isNtOrg);
}

export function choiceFor(choices: TeamChoice[], orgId: string | null): TeamChoice | null {
  return choices.find((c) => c.orgId === orgId) ?? null;
}

/** True while the active space has no answer yet. A skip is an answer. */
export function needsTeamStep(choices: TeamChoice[], orgId: string | null): boolean {
  return orgId !== null && choiceFor(choices, orgId) === null;
}

/**
 * Coach or player, for copy only: the membership role in a club space, the
 * signup choice in the personal space (where everyone is admin).
 */
export function teamRoleIn(
  org: OrgMembership | undefined,
  declaredRole: TeamRole | null | undefined,
): TeamRole | null {
  if (org && !org.isPersonal) return org.role === 'player' ? 'player' : 'coach';
  return declaredRole ?? null;
}

export function teamStepTitle(role: TeamRole | null): string {
  if (role === 'coach') return 'Which team do you coach?';
  if (role === 'player') return 'Which team do you play for?';
  return 'Which team are you part of?';
}

export const TEAM_STEP_SUBTITLE = "We'll use it to find your games when you import. You can change it in Profile.";

export function teamRoleLine(role: TeamRole | null): string | null {
  if (role === 'coach') return 'You coach this team';
  if (role === 'player') return 'You play for this team';
  return null;
}

/** A space named as a place: its name, or "your personal space". */
export function spaceLabel(org: OrgMembership): string {
  return org.isPersonal ? 'your personal space' : org.orgName;
}

/** "Sollentuna Basketklubb, Alvik and your personal space". */
export function spaceListLabel(orgs: OrgMembership[]): string {
  const names = orgs.map(spaceLabel);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function alsoUseLabel(org: OrgMembership): string {
  return `Also use this team in ${spaceLabel(org)}`;
}

/** Other spaces with no answer yet: the step's "Also use this team in …" boxes. */
export function spacesWithoutChoice(
  orgs: OrgMembership[],
  choices: TeamChoice[],
  exceptOrgId: string,
): OrgMembership[] {
  return orgs.filter((o) => o.orgId !== exceptOrgId && choiceFor(choices, o.orgId) === null);
}

/** Same team, same note, or no team at all. */
function answerKey(choice: TeamChoice | null): string {
  if (choice?.team) return `team:${choice.team.id}`;
  if (choice?.unlistedTeam) return `note:${foldForSearch(choice.unlistedTeam)}`;
  return 'none';
}

/** Spaces that share the answer of `orgId`: pre-selected when that answer is changed. */
export function spacesSharingAnswer(orgs: OrgMembership[], choices: TeamChoice[], orgId: string): string[] {
  const key = answerKey(choiceFor(choices, orgId));
  return orgs.filter((o) => answerKey(choiceFor(choices, o.orgId)) === key).map((o) => o.orgId);
}

export interface ProfileTeamRow {
  key: string;
  team: LeagueTeam | null;
  unlistedTeam: string | null;
  /** Spaces using this answer, in the order given (club first). */
  orgs: OrgMembership[];
}

/**
 * Profile rows: one per distinct answer, so a user with the same team
 * everywhere sees one row. Spaces without a team come last, together.
 */
export function groupChoicesForProfile(orgs: OrgMembership[], choices: TeamChoice[]): ProfileTeamRow[] {
  const rows = new Map<string, ProfileTeamRow>();
  for (const org of orgs) {
    const choice = choiceFor(choices, org.orgId);
    const key = answerKey(choice);
    const row = rows.get(key);
    if (row) row.orgs.push(org);
    else rows.set(key, { key, team: choice?.team ?? null, unlistedTeam: choice?.team ? null : choice?.unlistedTeam ?? null, orgs: [org] });
  }
  const all = [...rows.values()];
  return [...all.filter((r) => r.key !== 'none'), ...all.filter((r) => r.key === 'none')];
}
