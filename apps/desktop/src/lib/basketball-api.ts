import { fetch } from "@tauri-apps/plugin-http";
import type { PlayByPlayEvent } from "@/types/match";

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

/** A phase within a season — regular season, playoffs, cup, etc. */
export interface Stage {
  id: string;
  label: string;
  /** Swedish provider only — identifies the game type in the schedule query. */
  gameTypeUuid?: string;
}

/**
 * One season of a league. Seasons carry the provider-specific handle for
 * fetching their schedule, so adding next season is a single array entry.
 */
export interface Season {
  id: string;
  label: string;
  /** Swedish provider. */
  seasonUuid?: string;
  /** Sportradar provider. */
  fixturesUrl?: string;
  stages: Stage[];
}

export interface League {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 — drives grouping and the flag in the picker. */
  country: string;
  gender?: "men" | "women";
  provider?: "sportradar";
  /** Swedish provider. */
  baseUrl?: string;
  /** Swedish provider — identifies the competition itself. */
  seriesUuid?: string;
  /** Ordered newest-first; seasons[0] is treated as the current season. */
  seasons: Season[];
}

const SWE_REGULAR: Stage = { id: "regular", label: "Regular season", gameTypeUuid: "qZn-4XtW2vrrT" };
const SWE_PLAYOFF: Stage = { id: "playoff", label: "Playoffs", gameTypeUuid: "qZn-4XuTzFdn0" };

/** Seasons shared by the Swedish leagues — they run on a common season calendar. */
const SWE_SEASONS: Season[] = [
  { id: "2025-26", label: "2025/26", seasonUuid: "ye02q4jwit", stages: [SWE_REGULAR, SWE_PLAYOFF] },
];

export const LEAGUES: League[] = [
  {
    id: "sbl-herr",
    name: "SBL Herr",
    country: "SE",
    gender: "men",
    baseUrl: "https://www.sblherr.se",
    seriesUuid: "qZn-4Xda9zkK3",
    seasons: SWE_SEASONS,
  },
  {
    id: "sbl-dam",
    name: "SBL Dam",
    country: "SE",
    gender: "women",
    baseUrl: "https://www.sbldam.se",
    seriesUuid: "qZo-87H8Vw291",
    seasons: SWE_SEASONS,
  },
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    country: "SE",
    gender: "men",
    baseUrl: "https://www.superettanherr.se",
    seriesUuid: "qZn-4XdsoSWdh",
    seasons: SWE_SEASONS,
  },
  {
    id: "austria-zweite-liga",
    name: "Zweite Liga",
    country: "AT",
    gender: "men",
    provider: "sportradar",
    seasons: [
      {
        id: "current",
        label: "Current",
        fixturesUrl: "https://embed-api.eui.connect.sportradar.com/v1/embed/262/fixtures_ribbon?",
        stages: [{ id: "regular", label: "Regular season" }],
      },
    ],
  },
];

// Placeholder leagues for national team coaches — fill in the season handles
// once the data source (provider TBD) is decided.
const NT_PLACEHOLDER_SEASONS: Season[] = [
  { id: "current", label: "Current", stages: [{ id: "regular", label: "All games" }] },
];

// NOTE: keep these ids in sync with NT_LEAGUE_IDS in
// packages/shared/lib/plan-tier.ts — that list is what exempts a match from
// the monthly club-import cap.
export const NATIONAL_TEAM_LEAGUES: League[] = [
  {
    id: "sweden-national-men",
    name: "Sweden Men",
    country: "SE",
    gender: "men",
    seasons: NT_PLACEHOLDER_SEASONS,
  },
  {
    id: "sweden-national-women",
    name: "Sweden Women",
    country: "SE",
    gender: "women",
    seasons: NT_PLACEHOLDER_SEASONS,
  },
];

/** Display names for the country codes used above. Drives picker grouping. */
export const COUNTRY_NAMES: Record<string, string> = {
  SE: "Sweden",
  AT: "Austria",
};

/** Regional-indicator flag emoji for an ISO-2 code — no image assets needed. */
export function countryFlag(code: string): string {
  if (code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Builds the schedule query string the Swedish provider expects. */
export function buildScheduleParams(league: League, season: Season, stage: Stage): string {
  return [
    `seriesUuid=${league.seriesUuid ?? ""}`,
    `seasonUuid=${season.seasonUuid ?? ""}`,
    `gameTypeUuid=${stage.gameTypeUuid ?? ""}`,
    "gamePlace=all",
    "played=all",
  ].join("&");
}

/**
 * Single entry point for loading a schedule — picks the provider and builds
 * whatever handle it needs, so callers stay free of provider knowledge.
 */
export function getLeagueSchedule(
  league: League,
  season: Season,
  stage: Stage,
): Promise<ScheduleGame[]> {
  if (league.provider === "sportradar") {
    if (!season.fixturesUrl) return Promise.resolve([]);
    return fetchScheduleSportradar(season.fixturesUrl);
  }
  if (!league.baseUrl) return Promise.resolve([]);
  return fetchSchedule(league.baseUrl, buildScheduleParams(league, season, stage));
}

export async function fetchScheduleSportradar(fixturesUrl: string): Promise<ScheduleGame[]> {
  const res = await fetch(fixturesUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Failed to fetch fixtures");
  const data = (await res.json() as { data: { fixtures: unknown[] } }).data;

  return (data.fixtures ?? [])
    .filter((entry: unknown) => {
      const fixture = ((entry as Record<string, unknown>).fixture as Record<string, unknown>) ?? {};
      return fixture.isFinal === true;
    })
    .map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      const competitors = (e.competitors as Record<string, unknown>[]) ?? [];
      const fixture = (e.fixture as Record<string, unknown>) ?? {};
      const home = competitors.find((c) => c.isHome) ?? competitors[0] ?? {};
      const away = competitors.find((c) => !c.isHome) ?? competitors[1] ?? {};
      return {
        uuid: String(fixture.fixtureId ?? ""),
        rawStartDateTime: String(fixture.startTimeUTC ?? ""),
        startDateTime: String(fixture.date ?? fixture.startTimeUTC ?? ""),
        homeTeamInfo: {
          names: { short: String(home.name ?? ""), long: String(home.name ?? "") },
          score: Number(home.score ?? 0),
          icon: String(home.logoUrl ?? ""),
          status: String((fixture.status as Record<string, unknown>)?.value ?? ""),
        },
        awayTeamInfo: {
          names: { short: String(away.name ?? ""), long: String(away.name ?? "") },
          score: Number(away.score ?? 0),
          icon: String(away.logoUrl ?? ""),
          status: String((fixture.status as Record<string, unknown>)?.value ?? ""),
        },
        venueInfo: { name: "" },
        seasonId: String(fixture.seasonId ?? ""),
      } satisfies ScheduleGame;
    })
    .sort((a, b) =>
      new Date(b.rawStartDateTime).getTime() - new Date(a.rawStartDateTime).getTime()
    );
}

function parseSportradarClock(clock: string): string {
  const m = clock.match(/PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return clock;
  const mins = m[1] ?? "0";
  const secs = Math.floor(Number(m[2] ?? "0")).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

async function buildSportradarState(fixtureId: string, seasonId: string): Promise<string> {
  const json = JSON.stringify({ s: seasonId, l: "de-AT", z: "pbp", f: fixtureId });
  const bytes = new TextEncoder().encode(json);
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  let binary = "";
  for (const b of new Uint8Array(buf)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function fetchPlayByPlaySportradar(fixtureId: string, seasonId: string): Promise<{
  events: PlayByPlayEvent[];
  tipoffRealWorldTime: string | null;
}> {
  const state = await buildSportradarState(fixtureId, seasonId);
  const url = `https://embed-api.eui.connect.sportradar.com/v1/embed/262/fixture_detail?state=${state}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Failed to fetch play-by-play");

  const pbp = (await res.json() as { data: { pbp: Record<string, { events: unknown[] }> } }).data.pbp ?? {};

  let idx = 0;
  const events: PlayByPlayEvent[] = [];
  for (const period of Object.keys(pbp).sort((a, b) => Number(a) - Number(b))) {
    for (const raw of pbp[period].events ?? []) {
      const e = raw as Record<string, unknown>;
      const type = String(e.eventType ?? "").replace("freeThrow", "freethrow");
      if (ACTIONABLE_TYPES.has(type)) {
        events.push({
          eventId: idx,
          type,
          subType: String(e.eventSubType ?? ""),
          period: Number(period),  // outer loop key = global period (OT1 = 5, OT2 = 6, …)
          gameClockTime: parseSportradarClock(String(e.clock ?? "")),
          realWorldTime: "",
          isSuccessful: e.success === true ? 1 : 0,
          player: e.personId ? {
            playerId: 0,
            pno: Number(e.bib ?? 0),
            firstName: String(e.name ?? "").split(" ").slice(0, -1).join(" "),
            familyName: String(e.name ?? "").split(" ").at(-1) ?? "",
            teamNumber: 0,
          } : null,
          eventTeam: e.entityId ? {
            teamCode: String(e.entityId),
            teamName: "",
            teamNumber: 0,
          } : null,
          qualifiers: [],
        });
      }
      idx++;
    }
  }

  return { events, tipoffRealWorldTime: null };
}

export async function fetchSchedule(baseUrl: string, scheduleParams: string): Promise<ScheduleGame[]> {
  const url = `${baseUrl}/api/sports-v2/game-schedule?${scheduleParams}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Failed to fetch schedule");
  const data = await res.json() as { gameInfo?: unknown[] };

  return (data.gameInfo ?? [])
    .filter((g: unknown) => (g as Record<string, unknown>).state === "post-game")
    .sort((a: unknown, b: unknown) =>
      new Date((b as ScheduleGame).rawStartDateTime).getTime() -
      new Date((a as ScheduleGame).rawStartDateTime).getTime()
    ) as ScheduleGame[];
}

const ACTIONABLE_TYPES = new Set([
  "2pt", "3pt", "freethrow", "rebound", "turnover", "steal", "foul", "foulon", "block", "assist",
]);

type RawEvent = Record<string, unknown>;

export async function fetchBoxscore(gameId: string, baseUrl: string) {
  const [statsRes, infoRes] = await Promise.all([
    fetch(`${baseUrl}/api/gameday/player-stats/${gameId}`, {
      headers: { Accept: "application/json" },
    }),
    fetch(`${baseUrl}/api/sports-v2/game-info/${gameId}`, {
      headers: { Accept: "application/json" },
    }).catch(() => null),
  ]);

  if (!statsRes.ok) throw new Error("Failed to fetch box score");

  const stats = await statsRes.json() as object;
  let date: string | null = null;

  if (infoRes?.ok) {
    const info = await infoRes.json() as { gameInfo?: { startDateTime?: string } };
    date = info.gameInfo?.startDateTime ?? null;
  }

  return { ...(stats as object), date };
}

export async function fetchPlayByPlay(gameId: string, baseUrl: string): Promise<{
  events: PlayByPlayEvent[];
  tipoffRealWorldTime: string | null;
}> {
  const res = await fetch(
    `${baseUrl}/api/gameday/play-by-play/${gameId}`,
    { headers: { Accept: "application/json" } }
  );

  if (!res.ok) throw new Error("Failed to fetch play-by-play");

  const rawData = await res.json() as unknown;

  // Extract the events array from whatever structure the API returns
  let allEvents: RawEvent[] = [];
  if (Array.isArray(rawData)) {
    allEvents = rawData as RawEvent[];
  } else if (rawData && typeof rawData === "object") {
    const obj = rawData as Record<string, unknown>;
    for (const key of ["events", "playByPlay", "data", "plays", "actions"]) {
      if (Array.isArray(obj[key])) {
        allEvents = obj[key] as RawEvent[];
        break;
      }
    }
    if (allEvents.length === 0) {
      for (const val of Object.values(obj)) {
        if (Array.isArray(val) && (val as unknown[]).length > 0) {
          allEvents = val as RawEvent[];
          break;
        }
      }
    }
  }

  const tipoffEvent = allEvents.find(
    (e) => e.type === "period" && e.subType === "start" && e.period === 1
      && !String(e.periodType ?? "").toUpperCase().includes("OVERTIME")
  );
  const tipoffRealWorldTime = (tipoffEvent?.realWorldTime as string) ?? null;

  const events: PlayByPlayEvent[] = allEvents
    .filter((e) => ACTIONABLE_TYPES.has(String(e.type ?? "")))
    .map((e) => {
      const rawPeriod = (e.period as number) ?? 0;
      const isOT = String(e.periodType ?? "").toUpperCase().includes("OVERTIME");
      const globalPeriod = isOT ? 4 + rawPeriod : rawPeriod;
      // Only offset OT event IDs — regulation IDs are globally unique within a match,
      // but OT resets per-period IDs from 1, colliding with Q1. Prefix keeps them distinct.
      const globalEventId = isOT
        ? globalPeriod * 100000 + ((e.eventId as number) ?? 0)
        : ((e.eventId as number) ?? 0);
      return {
        eventId: globalEventId,
        type: e.type as string,
        subType: (e.subType as string) ?? "",
        period: globalPeriod,
        gameClockTime: (e.gameClockTime as string) || (e.time as string) || "",
        realWorldTime: (e.realWorldTime as string) ?? "",
        isSuccessful: (e.isSuccessful as number) ?? 0,
        player: (e.player as PlayByPlayEvent["player"]) ?? null,
        eventTeam: (e.eventTeam as PlayByPlayEvent["eventTeam"]) ?? null,
        qualifiers: Array.isArray(e.qualifiers) ? (e.qualifiers as string[]) : [],
      };
    });

  return { events, tipoffRealWorldTime };
}
