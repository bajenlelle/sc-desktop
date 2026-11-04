import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "../../types/match";
import {
  buildRosters,
  findGeniusPeriodMarks,
  findTipoff,
  homeCompetitor,
  normalizeGeniusActions,
  type GeniusAction,
  type GeniusFixture,
  type GeniusPlayer,
  type ScheduleGame,
} from "../genius";
import { importedMatch, importGame, loadGeniusGame, type ImportInput } from "../genius-import";
import sample from "./fixtures/genius-sample.json";

const T = "2026-10-12T17:00:00Z";
const marks: SyncPoint["marks"] = {
  "2": { startRealWorldTime: "2026-10-12T17:24:00Z", anchor: { realWorldTime: "2026-10-12T17:24:00Z", kind: "period_start", label: "Start of Q2" } },
};
const q2 = { syncVideoTime: 700, syncRealWorldTime: "2026-10-12T17:24:00Z" };
const base: ImportInput = {
  id: "new-id",
  sourceGameId: "2668882",
  title: "Högsbo vs AIK",
  date: "2026-10-12",
  homeTeam: { name: "Högsbo", color: "#f00" },
  awayTeam: { name: "AIK", color: "#00f" },
  homeRoster: [{ jerseyNumber: "7", playerName: "Alva" }],
  awayRoster: [],
  videoUrl: "/v.mp4",
  events: [],
  leagueId: "basketettan-dam",
  seasonId: "2026-27",
  stageId: "regular",
  orgId: "org1",
  syncSeconds: 42,
  tipoffRealWorldTime: T,
  periodMarks: marks,
  breaksCut: false,
  breaksCutChoice: null,
  periodSyncs: {},
  existing: null,
};

describe("importedMatch", () => {
  it("builds the sync with marks, breaksCut and quarters", () => {
    const m = importedMatch({ ...base, breaksCut: true, breaksCutChoice: true, periodSyncs: { "2": q2 } });
    expect(m.syncPoint).toEqual({ syncVideoTime: 42, syncRealWorldTime: T, marks, breaksCut: true, periods: { "2": q2 } });
    expect("periods" in importedMatch({ ...base, breaksCut: true, breaksCutChoice: true }).syncPoint!).toBe(false);
  });

  it("breaksCutChoice false is saved as breaksCut false; null leaves it out", () => {
    expect(importedMatch({ ...base, breaksCutChoice: false }).syncPoint).toEqual({ syncVideoTime: 42, syncRealWorldTime: T, marks, breaksCut: false });
    expect("breaksCut" in importedMatch(base).syncPoint!).toBe(false);
    expect("marks" in importedMatch({ ...base, periodMarks: {} }).syncPoint!).toBe(false);
  });

  it("no syncSeconds means no sync point", () => {
    expect(importedMatch({ ...base, syncSeconds: null }).syncPoint).toBeUndefined();
  });

  it("a re-import on the same video keeps the quarters already fixed; another video does not", () => {
    const existing = { syncPoint: { syncVideoTime: 40, syncRealWorldTime: T, periods: { "2": q2 }, breaksCut: true }, videoUrl: "/v.mp4" };
    const same = importedMatch({ ...base, existing });
    expect(same.syncPoint).toEqual({ syncVideoTime: 42, syncRealWorldTime: T, marks, periods: { "2": q2 }, breaksCut: true });
    const other = importedMatch({ ...base, existing, videoUrl: "/other.mp4" });
    expect(other.syncPoint).toEqual({ syncVideoTime: 42, syncRealWorldTime: T, marks });
  });

  it("a re-import on the same video where the coach now says it holds the whole game drops the quarters", () => {
    const existing = { syncPoint: { syncVideoTime: 40, syncRealWorldTime: T, periods: { "2": q2 }, breaksCut: true }, videoUrl: "/v.mp4" };
    expect(importedMatch({ ...base, existing, breaksCutChoice: false }).syncPoint).toEqual({ syncVideoTime: 42, syncRealWorldTime: T, marks, breaksCut: false });
  });

  it("keeps the given id, the source game id and the video path, and the rest as given", () => {
    const m = importedMatch({ ...base, id: "old-id" });
    expect(m).toMatchObject({
      id: "old-id", sourceGameId: "2668882", title: "Högsbo vs AIK", date: "2026-10-12", videoUrl: "/v.mp4",
      homeTeam: { name: "Högsbo", color: "#f00" }, awayTeam: { name: "AIK", color: "#00f" },
      homeRoster: [{ jerseyNumber: "7", playerName: "Alva" }], awayRoster: [], events: [],
      leagueId: "basketettan-dam", seasonId: "2026-27", stageId: "regular", orgId: "org1",
    });
    expect(importedMatch({ ...base, videoUrl: null }).videoUrl).toBeUndefined();
  });
});

describe("loadGeniusGame", () => {
  const fixture = sample.fixture as GeniusFixture;
  const actions = sample.actions as GeniusAction[];
  const players = sample.players as GeniusPlayer[];
  const game: ScheduleGame = {
    uuid: "2668882",
    rawStartDateTime: "2025-09-19T17:04:00Z",
    startDateTime: "2025-09-19 19:04",
    homeTeamInfo: { names: { short: "HOM", long: "Home long" }, score: 0, icon: "", status: "" },
    awayTeamInfo: { names: { short: "AWY", long: "Away long" }, score: 0, icon: "", status: "" },
    venueInfo: { name: "Arena" },
  };

  it("normalizes the edge function's match into game data", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { fixture, actions, players, pbpStatus: "ok" }, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const data = await loadGeniusGame(client, 41539, game);
    expect(invoke).toHaveBeenCalledWith("genius", { body: { action: "match", competitionId: 41539, matchId: 2668882 } });
    const home = homeCompetitor(fixture)!;
    const rosters = buildRosters(players, home.teamId);
    expect(data).toEqual({
      homeName: home.teamName,
      awayName: fixture.competitors.find((c) => c !== home)!.teamName,
      date: "2025-09-19",
      homeRoster: rosters.home,
      awayRoster: rosters.away,
      events: normalizeGeniusActions(actions, home.teamId),
      tipoffRealWorldTime: findTipoff(actions),
      periodMarks: findGeniusPeriodMarks(actions),
      pbpStatus: "ok",
    });
    expect(data.events.length).toBeGreaterThan(0);
  });

  it("throws with the function's error token", async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: new Error("nope") }) } } as unknown as SupabaseClient;
    await expect(loadGeniusGame(client, 41539, game)).rejects.toThrow("Failed to fetch game data: request_failed");
  });
});

describe("importGame", () => {
  /** A client that accepts any query and records which tables were written how. */
  function recordingClient(failing: string | null = null) {
    const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
    const chain = (table: string) => {
      const b: Record<string, unknown> = {
        then(res: (x: { data: null; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve({ data: null, error: table === failing ? { message: "db down" } : null }).then(res, rej);
        },
      };
      for (const op of ["upsert", "insert", "update", "delete", "select", "eq", "not", "in", "order"]) {
        b[op] = (...args: unknown[]) => {
          if (["upsert", "insert", "update", "delete", "select"].includes(op)) calls.push({ table, op, args });
          return b;
        };
      }
      return b;
    };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) },
      from: (table: string) => chain(table),
    } as unknown as SupabaseClient;
    return { client, calls };
  }
  const event: PlayByPlayEvent = { eventId: 1, type: "2pt", subType: "jumpshot", period: 1, gameClockTime: "09:00", realWorldTime: T, isSuccessful: 1, qualifiers: [] };
  const match = (syncPoint?: SyncPoint): StoredMatch => ({
    id: "m1", title: "A vs B", date: "2026-10-12", homeTeam: { name: "A", color: "" }, awayTeam: { name: "B", color: "" },
    homeRoster: [], awayRoster: [], events: [event], ...(syncPoint ? { syncPoint } : {}),
  });
  const sync: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: T };

  it("saves a fresh import, keeping plays the league already sent", async () => {
    const { client, calls } = recordingClient();
    expect(await importGame(client, match(sync), null)).toEqual({ followSync: false });
    expect(calls.map((c) => [c.table, c.op])).toEqual([["matches", "upsert"], ["play_by_play_events", "upsert"]]);
    expect(calls[0].args[0]).toMatchObject({ id: "m1", user_id: "me", title: "A vs B", sync_point: sync });
    expect(calls[1].args[1]).toEqual({ onConflict: "match_id,event_id", ignoreDuplicates: true });
  });

  it("a re-import refreshes the plays, and says when the clips should follow; old uploads stop being served", async () => {
    const { client, calls } = recordingClient();
    expect(await importGame(client, match(sync), { syncPoint: { syncVideoTime: 40, syncRealWorldTime: T } })).toEqual({ followSync: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[1].args[1]).toEqual({ onConflict: "match_id,event_id", ignoreDuplicates: false });
    expect(calls.map((c) => [c.table, c.op])).toContainEqual(["playlist_clips", "select"]);
  });

  it("reports a failed clear of old uploads to the host, with the error", async () => {
    const { client } = recordingClient("playlist_clips");
    const reported: unknown[] = [];
    expect(await importGame(client, match(sync), { syncPoint: sync }, { report: (e) => reported.push(e) })).toEqual({ followSync: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);
  });

  it("a re-import of a game that had no sync changes nothing about uploads", async () => {
    const { client, calls } = recordingClient();
    expect(await importGame(client, match(sync), {})).toEqual({ followSync: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.map((c) => c.table)).not.toContain("playlist_clips");
  });
});
