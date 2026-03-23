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

export interface League {
  id: string;
  name: string;
  baseUrl: string;
  scheduleParams: string;
  provider?: "sportradar";
  fixturesUrl?: string;
}

const COMMON_PARAMS = "seasonUuid=ye02q4jwit&gameTypeUuid=qZn-4XtW2vrrT&gamePlace=all&played=all";
const PLAYOFF_PARAMS = "seasonUuid=ye02q4jwit&gameTypeUuid=qZn-4XuTzFdn0&gamePlace=all&played=all";

export const LEAGUES: League[] = [
  {
    id: "sbl-herr",
    name: "SBL Herr",
    baseUrl: "https://www.sblherr.se",
    scheduleParams: `seriesUuid=qZn-4Xda9zkK3&${COMMON_PARAMS}`,
  },
  {
    id: "sbl-dam",
    name: "SBL Dam",
    baseUrl: "https://www.sbldam.se",
    scheduleParams: `seriesUuid=qZo-87H8Vw291&${COMMON_PARAMS}`,
  },
  {
    id: "sbl-herr-playoff",
    name: "SBL Herr Playoff",
    baseUrl: "https://www.sblherr.se",
    scheduleParams: `seriesUuid=qZn-4Xda9zkK3&${PLAYOFF_PARAMS}`,
  },
  {
    id: "sbl-dam-playoff",
    name: "SBL Dam Playoff",
    baseUrl: "https://www.sbldam.se",
    scheduleParams: `seriesUuid=qZo-87H8Vw291&${PLAYOFF_PARAMS}`,
  },
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    baseUrl: "https://www.superettanherr.se",
    scheduleParams: `seriesUuid=qZn-4XdsoSWdh&${COMMON_PARAMS}`,
  },
  {
    id: "austria-zweite-liga",
    name: "Zweite Liga",
    baseUrl: "",
    scheduleParams: "",
    provider: "sportradar",
    fixturesUrl: "https://embed-api.eui.connect.sportradar.com/v1/embed/262/fixtures_ribbon?",
  },
];

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
          period: Number(e.periodId ?? 0),
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
  );
  const tipoffRealWorldTime = (tipoffEvent?.realWorldTime as string) ?? null;

  const events: PlayByPlayEvent[] = allEvents
    .filter((e) => ACTIONABLE_TYPES.has(String(e.type ?? "")))
    .map((e) => ({
      eventId: e.eventId as number,
      type: e.type as string,
      subType: (e.subType as string) ?? "",
      period: (e.period as number) ?? 0,
      gameClockTime: (e.gameClockTime as string) || (e.time as string) || "",
      realWorldTime: (e.realWorldTime as string) ?? "",
      isSuccessful: (e.isSuccessful as number) ?? 0,
      player: (e.player as PlayByPlayEvent["player"]) ?? null,
      eventTeam: (e.eventTeam as PlayByPlayEvent["eventTeam"]) ?? null,
      qualifiers: Array.isArray(e.qualifiers) ? (e.qualifiers as string[]) : [],
    }));

  return { events, tipoffRealWorldTime };
}
