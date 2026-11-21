/**
 * A team's games, the league's tables and their groups, from the fixture list
 * joined to the season's per-game rows by match id (the design:
 * docs/superpowers/specs/2026-11-21-team-page-design.md). The two come from
 * caches that can be hours apart, so a finished game may have its score before
 * its totals: it then shows the score alone.
 */
import { factorsOf } from "./game-box";
import { toIsoUtc, type GeniusFixture } from "./genius";
import type { LeagueSeason } from "./league-season";
import { geniusTotals } from "./season-context";
import type { SeasonPayload } from "./season-payload";

/** The season strip's bars stop growing here, in points. */
export const FORM_MARGIN_CAP = 20;

/** A fixture still "scheduled" this long after its tip-off is taken as off. */
const OVERDUE_MS = 24 * 60 * 60 * 1000;

export interface TeamGameRow {
  matchId: number;
  /** ISO UTC; "" when the fixture has no time. */
  at: string;
  /** The team played at home. */
  home: boolean;
  opponentId: number;
  opponentName: string;
  status: "played" | "upcoming" | "off";
  regular: boolean;
  /** From the team's side; null without two whole-number scores (a walkover). */
  score: { own: number; opp: number } | null;
  result: "W" | "L" | null;
  /** Points per possession scored and allowed; null until the season has the game's rows. */
  ppp: { own: number; opp: number } | null;
  /** Played, with play-by-play upstream: it can become clips. */
  importable: boolean;
}

const isRegular = (matchType: string) => matchType === "REGULAR" || matchType === "";
const timeOf = (f: GeniusFixture) => {
  const t = new Date(toIsoUtc(f.matchTimeUTC)).getTime();
  return Number.isFinite(t) ? t : 0;
};
const byTime = (a: GeniusFixture, b: GeniusFixture) => timeOf(a) - timeOf(b) || a.matchId - b.matchId;
const whole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : null);

/** Every team's name and logo as its newest fixture gives them. */
export function teamNames(fixtures: readonly GeniusFixture[]): Map<number, { name: string; logoUrl: string }> {
  const out = new Map<number, { name: string; logoUrl: string }>();
  for (const f of [...fixtures].sort(byTime)) {
    for (const c of f.competitors) out.set(c.teamId, { name: c.teamName, logoUrl: c.logoUrl });
  }
  return out;
}

/** Each group's name by its number (poolNumber → phaseName), from the fixtures that carry both. */
export function groupNames(fixtures: readonly GeniusFixture[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const f of fixtures) {
    if (f.poolNumber !== null && f.poolNumber !== undefined && f.phaseName) out.set(f.poolNumber, f.phaseName);
  }
  return out;
}

function statusOf(f: GeniusFixture, now: Date): TeamGameRow["status"] {
  if (f.matchStatus === "COMPLETE") return "played";
  if (f.matchStatus === "CANCELLED") return "off";
  const t = timeOf(f);
  return t > 0 && t > now.getTime() - OVERDUE_MS ? "upcoming" : "off";
}

/** The team's games, oldest first. */
export function teamGameRows(fixtures: readonly GeniusFixture[], payload: SeasonPayload, teamId: number, now: Date): TeamGameRow[] {
  const games = new Map(payload.games.map((g) => [g.matchId, g]));
  const rows: TeamGameRow[] = [];
  for (const f of [...fixtures].sort(byTime)) {
    const own = f.competitors.find((c) => c.teamId === teamId);
    const opp = f.competitors.find((c) => c.teamId !== teamId);
    if (!own || !opp || f.competitors.length !== 2) continue;
    const status = statusOf(f, now);
    const ownScore = whole(own.scoreString);
    const oppScore = whole(opp.scoreString);
    const score = status === "played" && ownScore !== null && oppScore !== null ? { own: ownScore, opp: oppScore } : null;

    let ppp: TeamGameRow["ppp"] = null;
    const game = games.get(f.matchId);
    if (game?.home && game.away) {
      const mine = game.homeTeamId === teamId ? game.home : game.away;
      const theirs = game.homeTeamId === teamId ? game.away : game.home;
      const a = factorsOf(geniusTotals(mine), geniusTotals(theirs)).ppp;
      const b = factorsOf(geniusTotals(theirs), geniusTotals(mine)).ppp;
      if (a !== null && b !== null) ppp = { own: a, opp: b };
    }

    rows.push({
      matchId: f.matchId,
      at: toIsoUtc(f.matchTimeUTC),
      home: own.isHomeCompetitor === 1,
      opponentId: opp.teamId,
      opponentName: opp.teamName,
      status,
      regular: isRegular(f.matchType),
      score,
      result: score && score.own !== score.opp ? (score.own > score.opp ? "W" : "L") : null,
      ppp,
      importable: status === "played" && f.statsSource !== "",
    });
  }
  return rows;
}

/** The season strip: each regular-season game played with a score, oldest first. */
export function formStrip(rows: readonly TeamGameRow[]): { matchId: number; won: boolean; margin: number }[] {
  return rows
    .filter((r) => r.status === "played" && r.regular && r.score !== null)
    .map((r) => ({ matchId: r.matchId, won: r.score!.own > r.score!.opp, margin: Math.min(FORM_MARGIN_CAP, Math.abs(r.score!.own - r.score!.opp)) }));
}

/** The next game against one of the coach's teams, else the last one played; null when they don't meet. */
export function meeting(rows: readonly TeamGameRow[], mine: ReadonlySet<number>): { kind: "next" | "last"; row: TeamGameRow } | null {
  const theirs = rows.filter((r) => mine.has(r.opponentId));
  const next = theirs.find((r) => r.status === "upcoming");
  if (next) return { kind: "next", row: next };
  const last = theirs.filter((r) => r.status === "played" && r.score !== null).at(-1);
  return last ? { kind: "last", row: last } : null;
}

export interface LeagueTableRow {
  teamId: number;
  name: string;
  logoUrl: string;
  position: number | null;
  won: number;
  lost: number;
  /** "LWWLW", oldest first; "" when absent. */
  last5: string;
  /** Points per possession this season, scored and allowed. */
  scores: number | null;
  allows: number | null;
  /** The team's games in the coach's library. */
  libraryGames: number;
  /** The space's own team. */
  mine: boolean;
}

export interface LeagueTable {
  group: number | null;
  /** The group's name; null when the league is one table. */
  title: string | null;
  rows: LeagueTableRow[];
}

/**
 * One table per group, in standings order (teams without a standing last).
 * `library` holds the Genius match ids of the coach's games, `mine` the space's
 * team ids in this competition.
 */
export function leagueTables(
  league: LeagueSeason,
  fixtures: readonly GeniusFixture[],
  library: ReadonlySet<number>,
  mine: ReadonlySet<number>,
): LeagueTable[] {
  const names = teamNames(fixtures);
  const titles = groupNames(fixtures);
  const libraryGames = new Map<number, number>();
  for (const f of fixtures) {
    if (!library.has(f.matchId)) continue;
    for (const c of f.competitors) libraryGames.set(c.teamId, (libraryGames.get(c.teamId) ?? 0) + 1);
  }

  const tables: LeagueTable[] = league.groups.map((group, i) => {
    const rows = group.teamIds.map((teamId): LeagueTableRow => {
      const p = league.teams.get(teamId)!;
      return {
        teamId,
        name: names.get(teamId)?.name ?? "",
        logoUrl: names.get(teamId)?.logoUrl ?? "",
        position: p.standing?.position ?? null,
        won: p.standing?.won ?? 0,
        lost: p.standing?.lost ?? 0,
        last5: p.standing?.last5 ?? "",
        scores: p.own.ppp,
        allows: p.allowed.ppp,
        libraryGames: libraryGames.get(teamId) ?? 0,
        mine: mine.has(teamId),
      };
    });
    rows.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name, "sv"));
    const named = group.group !== null ? titles.get(group.group) : undefined;
    return { group: group.group, title: league.groups.length === 1 ? null : (named ?? `Group ${i + 1}`), rows };
  });

  // Named groups read in their names' order; unnamed ones keep their numbers' order.
  if (tables.length > 1 && tables.every((t) => t.group !== null && titles.has(t.group))) {
    tables.sort((a, b) => a.title!.localeCompare(b.title!, "sv"));
  }
  return tables;
}

/** The space's next game in this competition, from its team's side; null without a team here or a game to come. */
export function nextGame(fixtures: readonly GeniusFixture[], payload: SeasonPayload, mine: ReadonlySet<number>, now: Date): TeamGameRow | null {
  const upcoming = [...mine]
    .flatMap((teamId) => teamGameRows(fixtures, payload, teamId, now))
    .filter((r) => r.status === "upcoming")
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return upcoming[0] ?? null;
}
