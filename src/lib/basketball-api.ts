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
}

const SCHEDULE_URL =
  "https://www.superettanherr.se/api/sports-v2/game-schedule" +
  "?seasonUuid=ye02q4jwit&seriesUuid=qZn-4XdsoSWdh" +
  "&gameTypeUuid=qZn-4XtW2vrrT&gamePlace=all&played=all";

export async function fetchSchedule(): Promise<ScheduleGame[]> {
  const res = await fetch(SCHEDULE_URL, { headers: { Accept: "application/json" } });
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

export async function fetchBoxscore(gameId: string) {
  const [statsRes, infoRes] = await Promise.all([
    fetch(`https://www.superettanherr.se/api/gameday/player-stats/${gameId}`, {
      headers: { Accept: "application/json" },
    }),
    fetch(`https://www.superettanherr.se/api/sports-v2/game-info/${gameId}`, {
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

export async function fetchPlayByPlay(gameId: string): Promise<{
  events: PlayByPlayEvent[];
  tipoffRealWorldTime: string | null;
}> {
  const res = await fetch(
    `https://www.superettanherr.se/api/gameday/play-by-play/${gameId}`,
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
      gameClockTime: (e.gameClockTime as string) ?? "",
      realWorldTime: (e.realWorldTime as string) ?? "",
      isSuccessful: (e.isSuccessful as number) ?? 0,
      player: (e.player as PlayByPlayEvent["player"]) ?? null,
      eventTeam: (e.eventTeam as PlayByPlayEvent["eventTeam"]) ?? null,
      qualifiers: Array.isArray(e.qualifiers) ? (e.qualifiers as string[]) : [],
    }));

  return { events, tipoffRealWorldTime };
}
