/**
 * Genius Sports Warehouse — payload types and normalizers.
 *
 * The genius edge function (supabase/functions/genius) proxies and caches the
 * Warehouse REST API; this module turns its responses into the app's own
 * shapes (PlayByPlayEvent, rosters, schedule rows). Pure functions only, so
 * everything here is unit-testable without network or Supabase.
 *
 * Facts verified against live SBF data (2026-09-02), which the mappings rely on:
 *   - timestamps (`timeActual`, `matchTimeUTC`) are UTC but BARE — no "Z", no
 *     offset. `new Date("2025-09-19 17:06:08")` parses as LOCAL time in JS, so
 *     every timestamp must go through toIsoUtc() before it reaches
 *     realWorldTime / computeVideoTime, or clips land hours off.
 *   - score1/playersTeam1 are the HOME side (checked against fixture results
 *     and starters' teamIds).
 *   - OT periods reset to 1 with periodType "OVERTIME" → global period is
 *     4 + period (OT1 = 5, OT2 = 6).
 *   - actionNumber is monotonic across the whole match including OT, so it is
 *     collision-free as event_id without any offset hack.
 */

import type { PlayByPlayEvent } from "../types/match";

// ---------------------------------------------------------------------------
// Payload shapes returned by the genius edge function
// ---------------------------------------------------------------------------

/** One fixture, trimmed server-side from /competitions/{id}/matches. */
export interface GeniusFixture {
  matchId: number;
  /** Bare UTC, "YYYY-MM-DD HH:MM:SS". */
  matchTimeUTC: string;
  /** COMPLETE | CANCELLED | SCHEDULED */
  matchStatus: string;
  /** REGULAR | FINALS */
  matchType: string;
  /** Empty string means the match has no play-by-play upstream. */
  statsSource: string;
  venueName: string;
  competitors: Array<{
    teamId: number;
    teamName: string;
    scoreString: string;
    isHomeCompetitor: number;
    logoUrl: string;
  }>;
}

/** One raw action from /matches/{id}/actions — only the fields we read. */
export interface GeniusAction {
  actionNumber: number;
  actionType: string;
  subType: string;
  period: number;
  periodType: string;
  /** Countdown, "MM:SS:cc" (centiseconds). */
  clock: string;
  shotClock: string;
  /** Bare UTC, "YYYY-MM-DD HH:MM:SS". */
  timeActual: string;
  success: number;
  personId: number;
  shirtNumber: string;
  firstName?: string;
  familyName?: string;
  teamId: number;
  teamName?: string;
  /** Semicolon-joined, e.g. "2ndchance;pointsinthepaint". */
  qualifiers: string;
  previousAction: number;
  x: number;
  y: number;
  area: string;
  /** Semicolon-joined personIds of the five on court. Team1 = home. */
  playersTeam1: string;
  playersTeam2: string;
  score1: string;
  score2: string;
}

/** One raw participant from /matches/{id}/players — only the fields we read. */
export interface GeniusPlayer {
  personId: number;
  firstName: string;
  familyName: string;
  shirtNumber: string;
  teamId: number;
  isPlayer: number;
}

/** Schedule row shape the import UI renders (kept from the scrape era). */
export interface ScheduleGame {
  uuid: string;
  rawStartDateTime: string;
  startDateTime: string;
  homeTeamInfo: {
    names: { short: string; long: string };
    score: number;
    icon: string;
    status: string;
  };
  awayTeamInfo: {
    names: { short: string; long: string };
    score: number;
    icon: string;
    status: string;
  };
  venueInfo: { name: string };
  seasonId?: string;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/** Event types that can become clips. Everything else is discarded on import. */
export const ACTIONABLE_TYPES = new Set([
  "2pt", "3pt", "freethrow", "rebound", "turnover", "steal", "foul", "foulon", "block", "assist",
]);

/**
 * Bare Genius UTC timestamp → ISO-8601 with explicit Z.
 * "2025-09-19 17:06:08" → "2025-09-19T17:06:08Z". Anything empty or already
 * carrying a zone designator passes through unchanged.
 */
export function toIsoUtc(geniusTs: string): string {
  if (!geniusTs) return "";
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(geniusTs)) return geniusTs;
  return geniusTs.replace(" ", "T") + "Z";
}

/** Genius countdown clock "MM:SS:cc" → the app's "MM:SS". */
export function gameClock(clock: string): string {
  const m = clock.match(/^(\d+):(\d+)(?::\d+)?$/);
  if (!m) return clock;
  return `${m[1]}:${m[2]}`;
}

/** OT periods reset to 1 with periodType OVERTIME; globalize like the app expects. */
export function globalPeriod(period: number, periodType: string): number {
  if (!periodType.toUpperCase().includes("OVERTIME")) return period;
  return period > 4 ? period : 4 + period;
}

function personIdList(joined: string): number[] | null {
  const ids = joined.split(";").filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : null;
}

/**
 * Raw Genius actions → the app's PlayByPlayEvent[]. Filters to
 * ACTIONABLE_TYPES; eventId is the raw actionNumber (unique per match).
 */
export function normalizeGeniusActions(
  actions: GeniusAction[],
  homeTeamId: number,
): PlayByPlayEvent[] {
  return actions
    .filter((a) => ACTIONABLE_TYPES.has(a.actionType))
    .map((a) => {
      const teamNumber = a.teamId === homeTeamId ? 1 : 2;
      return {
        eventId: a.actionNumber,
        type: a.actionType,
        subType: a.subType ?? "",
        period: globalPeriod(a.period, a.periodType ?? ""),
        gameClockTime: gameClock(a.clock ?? ""),
        realWorldTime: toIsoUtc(a.timeActual ?? ""),
        isSuccessful: a.success ? 1 : 0,
        player: a.personId
          ? {
              playerId: a.personId,
              pno: Number(a.shirtNumber) || 0,
              firstName: a.firstName ?? "",
              familyName: a.familyName ?? "",
              teamNumber,
            }
          : null,
        eventTeam: a.teamId
          ? { teamCode: "", teamName: a.teamName ?? "", teamNumber }
          : null,
        qualifiers: (a.qualifiers ?? "").split(";").filter(Boolean),
        x: a.x || null,
        y: a.y || null,
        area: a.area || null,
        shotClock: a.shotClock && a.shotClock !== "00:00:00" ? a.shotClock : null,
        previousAction: a.previousAction || null,
        onCourtHome: personIdList(a.playersTeam1 ?? ""),
        onCourtAway: personIdList(a.playersTeam2 ?? ""),
        scoreHome: a.score1 !== "" && a.score1 != null ? Number(a.score1) : null,
        scoreAway: a.score2 !== "" && a.score2 != null ? Number(a.score2) : null,
      };
    });
}

/**
 * Q1 tipoff wall-clock, for the video sync hint — same semantics as the old
 * scrape's finder (regulation period 1 start). Returns ISO UTC or null.
 */
export function findTipoff(actions: GeniusAction[]): string | null {
  const tip = actions.find(
    (a) =>
      a.actionType === "period" &&
      a.subType === "start" &&
      a.period === 1 &&
      !(a.periodType ?? "").toUpperCase().includes("OVERTIME"),
  );
  return tip?.timeActual ? toIsoUtc(tip.timeActual) : null;
}

/** Match participants → the {jerseyNumber, playerName} rosters saveMatch stores. */
export function buildRosters(
  players: GeniusPlayer[],
  homeTeamId: number,
): {
  home: Array<{ jerseyNumber: string; playerName: string }>;
  away: Array<{ jerseyNumber: string; playerName: string }>;
} {
  const home: Array<{ jerseyNumber: string; playerName: string }> = [];
  const away: Array<{ jerseyNumber: string; playerName: string }> = [];
  for (const p of players) {
    if (p.isPlayer !== 1) continue;
    const entry = {
      jerseyNumber: p.shirtNumber ?? "",
      playerName: `${p.firstName ?? ""} ${p.familyName ?? ""}`.trim(),
    };
    (p.teamId === homeTeamId ? home : away).push(entry);
  }
  const byNumber = (a: { jerseyNumber: string }, b: { jerseyNumber: string }) =>
    (Number(a.jerseyNumber) || 0) - (Number(b.jerseyNumber) || 0);
  home.sort(byNumber);
  away.sort(byNumber);
  return { home, away };
}

/** The home competitor of a fixture (falls back to the first entry). */
export function homeCompetitor(fixture: GeniusFixture): GeniusFixture["competitors"][number] | undefined {
  return fixture.competitors.find((c) => c.isHomeCompetitor === 1) ?? fixture.competitors[0];
}

/** Trimmed fixture → the schedule row the import UI renders. */
export function fixtureToScheduleGame(fixture: GeniusFixture): ScheduleGame {
  const home = homeCompetitor(fixture);
  const away = fixture.competitors.find((c) => c !== home);
  const side = (c?: GeniusFixture["competitors"][number]) => ({
    names: { short: c?.teamName ?? "", long: c?.teamName ?? "" },
    score: Number(c?.scoreString) || 0,
    icon: c?.logoUrl ?? "",
    status: fixture.matchStatus,
  });
  return {
    uuid: String(fixture.matchId),
    rawStartDateTime: toIsoUtc(fixture.matchTimeUTC),
    startDateTime: toIsoUtc(fixture.matchTimeUTC),
    homeTeamInfo: side(home),
    awayTeamInfo: side(away),
    venueInfo: { name: fixture.venueName ?? "" },
  };
}
