/**
 * Profixio (SBBF district basketball) — normalisers.
 *
 * The `profixio` edge function serves the wire shapes in profixio-wire.ts;
 * this module turns a match into the app's own shapes (PlayByPlayEvent,
 * rosters, schedule rows, stages) exactly as genius.ts does for Genius. Pure
 * functions only, so everything is unit-testable without network or Supabase.
 *
 * What the district protocol records (verified on a live match 2026-02-15):
 *   - made 1/2/3-pointers (never misses), personal/technical/… fouls with
 *     the player (or coach) attached, team timeouts, period markers,
 *     substitutions. No rebounds, assists, coordinates or game clock.
 *   - every event carries a wall-clock `startedAt`, so the sync model works
 *     unchanged; the "Start period 1" marker is the tip-off anchor.
 *   - the scorer's table types events 10–20 s after the play — see
 *     defaultPreRoll in provider.ts.
 */
import type { Stage } from "../types/league";
import type { PlayByPlayEvent } from "../types/match";
import type { ScheduleGame } from "./genius";
import { PROFIXIO_SOURCE_PREFIX } from "./provider";
import {
  deriveHomeWebId,
  otherTeamId,
  sortEvents,
  type ProfixioCategory,
  type ProfixioEvent,
  type ProfixioLineupRow,
  type ProfixioMatchResponse,
  type ProfixioScheduleRow,
} from "./profixio-wire";

export type { ProfixioCategory, ProfixioEvent, ProfixioLineupRow, ProfixioMatchResponse, ProfixioScheduleRow };

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** "profixio:32406189" — namespaced so it can never collide with a bare Genius id in source_game_id / import_log. */
export function profixioSourceGameId(matchId: number): string {
  return `${PROFIXIO_SOURCE_PREFIX}${matchId}`;
}

/** The match id behind a namespaced uuid; null for anything else (incl. bare Genius ids). */
export function parseProfixioSourceGameId(uuid: string): number | null {
  const m = /^profixio:(\d+)$/.exec(uuid);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

/**
 * Profixio BB foul type ids → the app's foul subTypes. camelCase on the two
 * bench variants is deliberate: `eventLabel` lower-cases before matching,
 * while the clip browser's "Technical Foul" filter compares case-sensitively
 * against ["technical", "benchTechnical", "coachTechnical"].
 */
export const FOUL_SUBTYPE_BY_TYPE_ID: Record<number, string> = {
  109: "personal",
  110: "other",
  111: "unsportsmanlike",
  112: "technical",
  114: "disqualifying",
  116: "coachTechnical",
  117: "benchTechnical",
  691: "disruptive",
  692: "flagrant",
  693: "technical",
  694: "technical",
  695: "disqualifying",
};

const TIMEOUT_TYPE_ID = 108;
const GOAL_TYPE_BY_POINTS: Record<number, string> = { 1: "freethrow", 2: "2pt", 3: "3pt" };

/** The app type/subType for an event, or null when it isn't a clip (markers, substitutions, lineup changes). */
export function classifyEvent(e: ProfixioEvent): { type: string; subType: string } | null {
  if (e.goals != null) {
    const type = GOAL_TYPE_BY_POINTS[e.goals];
    return type ? { type, subType: "" } : null;
  }
  if (e.timeout || e.typeId === TIMEOUT_TYPE_ID) return { type: "timeout", subType: "" };
  const foulSubType = FOUL_SUBTYPE_BY_TYPE_ID[e.typeId];
  if (foulSubType || e.isPersonFoul || e.isTeamFoul) {
    return { type: "foul", subType: foulSubType ?? "personal" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ordering, periods, sides
// ---------------------------------------------------------------------------

/** Oldest first (upstream serves newest first). Pure. */
export const sortProfixioEvents: (events: ProfixioEvent[]) => ProfixioEvent[] = sortEvents;

/**
 * Global period per event id. Regulation periods pass through; after the
 * n-th `startsExtraPeriod` marker every event of that raw period becomes
 * 4 + n, whatever Profixio numbers it (OT numbering is unverified upstream).
 * Raw periods above the regulation count are globalised the same way, and
 * nothing ever becomes period 0.
 */
export function assignGlobalPeriods(sorted: ProfixioEvent[], matchPeriods: number): Map<number, number> {
  const regulation = matchPeriods > 0 ? matchPeriods : 4;
  const globalise = (p: number) => (p > regulation ? 4 + (p - regulation) : Math.max(1, p || 1));
  const out = new Map<number, number>();
  let otCount = 0;
  let current: { raw: number; global: number } | null = null;
  for (const e of sorted) {
    if (e.startsExtraPeriod) {
      otCount += 1;
      current = { raw: e.period, global: 4 + otCount };
    } else if (e.startsMatch || e.startsPeriod) {
      current = { raw: e.period, global: globalise(e.period) };
    }
    out.set(e.id, current && e.period === current.raw ? current.global : globalise(e.period));
  }
  return out;
}

/**
 * Home/away web team ids. Trusts the page's `homewebid`/`awaywebid`; falls
 * back to the scoreboard (first home-score increment), then to lineup order,
 * so the API driver — which may not know the sides — still works.
 */
export function resolveSides(
  m: Pick<ProfixioMatchResponse, "homeWebId" | "awayWebId" | "events" | "lineup">,
): { homeWebId: number; awayWebId: number } {
  let home = m.homeWebId && m.homeWebId > 0 ? m.homeWebId : null;
  let away = m.awayWebId && m.awayWebId > 0 ? m.awayWebId : null;
  if (home == null) home = deriveHomeWebId(m.events);
  if (away == null && home != null) away = otherTeamId(m.events, home);
  const lineupIds = [...new Set(m.lineup.map((l) => l.webTeamId).filter((id) => id > 0))];
  if (home == null) home = lineupIds.find((id) => id !== away) ?? 0;
  if (away == null) away = lineupIds.find((id) => id !== home) ?? otherTeamId(m.events, home) ?? 0;
  return { homeWebId: home, awayWebId: away };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** "Martin Lind" → Martin / Lind; a lone token is a first name. */
export function splitName(full: string): { firstName: string; familyName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", familyName: "" };
  return { firstName: parts[0], familyName: parts.slice(1).join(" ") };
}

/** "7.32" / "07:32" / "7:32" → "07:32"; anything else → "". */
function gameClockOf(e: ProfixioEvent): string {
  const raw = e.clock?.display ?? e.clock?.timeInPeriod ?? "";
  const m = raw.match(/^(\d{1,2})[:.](\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

export interface NormalizeContext {
  homeName: string;
  awayName: string;
}

/**
 * Wire match → the app's PlayByPlayEvent[], oldest first. Only goals, fouls
 * and timeouts become clips; eventId is the Profixio event id (stable across
 * re-imports). Sides: goals trust the scoreboard delta (covers a missing
 * teamId and "points for the other team"), fouls and timeouts trust the
 * event's team, then the player's lineup team.
 */
export function normalizeProfixioEvents(
  m: ProfixioMatchResponse,
  ctx: NormalizeContext,
): PlayByPlayEvent[] {
  const sorted = sortEvents(m.events);
  const periods = assignGlobalPeriods(sorted, m.matchPeriods || 4);
  const sides = resolveSides(m);
  const sideByTeam = new Map<number, 1 | 2>([
    [sides.homeWebId, 1],
    [sides.awayWebId, 2],
  ]);
  const sideByPerson = new Map<number, 1 | 2 | undefined>(
    m.lineup.map((l) => [l.personId, sideByTeam.get(l.webTeamId)]),
  );
  const teamName = (side: 1 | 2) => (side === 1 ? ctx.homeName : ctx.awayName).trim();

  const out: PlayByPlayEvent[] = [];
  const seen = new Set<number>();
  let prev = { home: 0, away: 0 };

  for (const e of sorted) {
    const score = { home: e.scoreHome ?? prev.home, away: e.scoreAway ?? prev.away };
    const delta = { home: score.home - prev.home, away: score.away - prev.away };
    prev = score;

    const cls = classifyEvent(e);
    if (!cls || seen.has(e.id)) continue;
    seen.add(e.id);

    let side: 1 | 2 | undefined;
    if (e.goals != null && (delta.home > 0) !== (delta.away > 0)) side = delta.home > 0 ? 1 : 2;
    side ??= e.teamId != null ? sideByTeam.get(e.teamId) : undefined;
    side ??= e.person ? sideByPerson.get(e.person.personId) : undefined;

    const isPlayer = !!e.person && e.person.isPlayer && !e.person.isStaff;
    const name = e.person ? splitName(e.person.name) : null;

    out.push({
      eventId: e.id,
      type: cls.type,
      subType: cls.subType,
      period: periods.get(e.id) ?? Math.max(1, e.period || 1),
      gameClockTime: gameClockOf(e),
      realWorldTime: e.startedAt,
      isSuccessful: 1,
      player:
        isPlayer && name && e.person
          ? {
              playerId: e.person.personId,
              pno: parseInt(e.person.number, 10) || 0,
              firstName: name.firstName,
              familyName: name.familyName,
              teamNumber: side ?? 1,
            }
          : null,
      eventTeam: side ? { teamCode: "", teamName: teamName(side), teamNumber: side } : null,
      qualifiers: [],
      x: null,
      y: null,
      area: null,
      shotClock: null,
      previousAction: null,
      onCourtHome: null,
      onCourtAway: null,
      scoreHome: e.scoreHome,
      scoreAway: e.scoreAway,
    });
  }
  return out;
}

export interface ProfixioSyncAnchor {
  /** ISO UTC of the reference event. */
  realWorldTime: string;
  kind: "first_basket" | "match_start";
  /** Short phrase a coach can find in the video, e.g. "Örebro's first basket (2–0)". */
  label: string;
}

/**
 * The reference moment for video sync. NOT the "Start period 1" marker: the
 * table presses it when it opens the protocol, 3–4 minutes before the jump
 * ball (measured on three games), which would land every clip minutes late.
 * The first made basket is unambiguous on video and is stamped within the
 * table's usual 5–20 s entry lag, which the 20 s pre-roll covers. Falls back
 * to the start marker (with a label that says so) when nobody scored.
 */
export function findProfixioSyncAnchor(
  m: Pick<ProfixioMatchResponse, "homeWebId" | "awayWebId" | "events" | "lineup">,
  ctx: NormalizeContext,
): ProfixioSyncAnchor | null {
  const sorted = sortEvents(m.events);
  const sides = resolveSides(m);
  let prev = { home: 0, away: 0 };
  for (const e of sorted) {
    const home = e.scoreHome ?? prev.home;
    const away = e.scoreAway ?? prev.away;
    if (e.goals != null && GOAL_TYPE_BY_POINTS[e.goals] && e.startedAt) {
      const homeScored = home > prev.home;
      const awayScored = away > prev.away;
      const side: 1 | 2 =
        homeScored !== awayScored
          ? homeScored ? 1 : 2
          : e.teamId === sides.awayWebId ? 2 : 1;
      const team = (side === 1 ? ctx.homeName : ctx.awayName).trim();
      return {
        realWorldTime: e.startedAt,
        kind: "first_basket",
        label: `${team}'s first basket (${home}–${away})`,
      };
    }
    prev = { home, away };
  }
  const start = findProfixioTipoff(m.events);
  return start
    ? { realWorldTime: start, kind: "match_start", label: "the start of period 1 as logged by the table" }
    : null;
}

/**
 * Q1 "Start period 1" wall-clock: the `startsMatch` marker, else a regulation
 * period-1 start. Null when the protocol has neither. Only a fallback for
 * sync — see findProfixioSyncAnchor for why.
 */
export function findProfixioTipoff(events: ProfixioEvent[]): string | null {
  const sorted = sortEvents(events);
  const start = sorted.find((e) => e.startsMatch);
  if (start?.startedAt) return start.startedAt;
  const p1 = sorted.find((e) => e.startsPeriod && !e.startsExtraPeriod && e.period === 1);
  return p1?.startedAt || null;
}

/** Lineup → the {jerseyNumber, playerName} rosters saveMatch stores (players only, by jersey number). */
export function buildProfixioRosters(
  lineup: ProfixioLineupRow[],
  sides: { homeWebId: number; awayWebId: number },
): {
  home: Array<{ jerseyNumber: string; playerName: string }>;
  away: Array<{ jerseyNumber: string; playerName: string }>;
} {
  const home: Array<{ jerseyNumber: string; playerName: string }> = [];
  const away: Array<{ jerseyNumber: string; playerName: string }> = [];
  for (const l of lineup) {
    if (l.type !== "player") continue;
    const entry = { jerseyNumber: l.number, playerName: l.name };
    if (l.webTeamId === sides.homeWebId) home.push(entry);
    else if (l.webTeamId === sides.awayWebId) away.push(entry);
  }
  const byNumber = (a: { jerseyNumber: string }, b: { jerseyNumber: string }) =>
    (Number(a.jerseyNumber) || 0) - (Number(b.jerseyNumber) || 0);
  home.sort(byNumber);
  away.sort(byNumber);
  return { home, away };
}

// ---------------------------------------------------------------------------
// Schedule rows and categories
// ---------------------------------------------------------------------------

/** Wire schedule row → the schedule row the import UI renders. */
export function profixioRowToScheduleGame(row: ProfixioScheduleRow): ScheduleGame {
  const status = row.hasResult ? "COMPLETE" : "SCHEDULED";
  return {
    uuid: profixioSourceGameId(row.matchId),
    rawStartDateTime: row.kickoff,
    startDateTime: row.kickoff,
    homeTeamInfo: {
      names: { short: row.homeName, long: row.homeName },
      score: row.homeScore ?? 0,
      icon: row.homeLogo,
      status,
    },
    awayTeamInfo: {
      names: { short: row.awayName, long: row.awayName },
      score: row.awayScore ?? 0,
      icon: row.awayLogo,
      status,
    },
    venueInfo: { name: row.venue },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Nivå 2A Herrar U19" in league "Herrar U19" → "Nivå 2A"; never empty. */
export function categoryLabel(name: string, leagueName: string): string {
  const trimmedName = name.replace(/\s+/g, " ").trim();
  const league = leagueName.trim();
  if (!league) return trimmedName;
  const stripped = trimmedName
    .replace(new RegExp(`\\s*${escapeRegExp(league)}\\s*`, "i"), " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || trimmedName;
}

/** Categories → the season's stages (the picker's Stage dropdown); empty categories are dropped. */
export function categoriesToStages(categories: ProfixioCategory[], leagueName: string): Stage[] {
  return categories
    .filter((c) => c.matchCount !== 0)
    .map((c) => ({ id: String(c.categoryId), label: categoryLabel(c.name, leagueName), categoryId: c.categoryId }));
}
