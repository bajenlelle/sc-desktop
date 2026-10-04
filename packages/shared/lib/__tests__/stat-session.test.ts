import { describe, expect, it } from "vitest";
import type { StatEvent, StatIntent, StatSession } from "../../types/stat-session";
import { computeLeaders } from "../leaders";
import { playerName } from "../events";
import {
  boxScore,
  createStatSession,
  currentEvents,
  findVoiceSyncAnchor,
  initialState,
  reduceStatSession,
  statEventsToPlayByPlay,
  statSessionToScheduleGame,
  voiceSessionToGameData,
  type StatSessionState,
} from "../stat-session";

const T0 = Date.parse("2026-10-03T14:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

let ids = 0;
const uid = () => `c${++ids}`;

function session(over: Partial<StatSession> = {}): StatSession {
  return createStatSession({
    id: "s1",
    createdBy: "u1",
    sourceGameId: "profixio:32578145",
    homeName: "Fryshuset Svart",
    awayName: "Örebro",
    ourSide: 1,
    trackingMode: "ours",
    homeRoster: [
      { jerseyNumber: "9", playerName: "Elsa Svensson" },
      { jerseyNumber: "12", playerName: "Noor Ali" },
      { jerseyNumber: "23", playerName: "" },
    ],
    awayRoster: [{ jerseyNumber: "4", playerName: "Lo Berg" }],
    gameDate: "2026-10-03",
    keeperLabel: "Anna L.",
    ...over,
  });
}

function record(state: StatSessionState, intents: StatIntent[], seconds: number, side: "ours" | "opponent" = "ours") {
  return reduceStatSession(state, { type: "record", intents, side, at: at(seconds), source: "live", newClientId: uid });
}

describe("reduceStatSession", () => {
  it("records a made shot with its assist linked to the shot, seq increasing", () => {
    let s = initialState(session());
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }, { kind: "assist", jersey: 12 }], 10);
    const ev = currentEvents(s.events);
    expect(ev.map((e) => [e.seq, e.kind, e.jersey, e.isSuccessful])).toEqual([
      [1, "2pt", "9", 1],
      [2, "assist", "12", 1],
    ]);
    expect(ev[1].linkedSeq).toBe(1);
    expect(ev[0].playerName).toBe("Elsa Svensson");
    expect(ev[0].teamSide).toBe(1);
    expect(ev[0].recordedAt).toBe(at(10));
    expect(s.nextSeq).toBe(3);
  });

  it("maps every intent kind to the event vocabulary", () => {
    let s = initialState(session());
    s = record(s, [{ kind: "shot", points: 3, made: false, jersey: 9 }], 1);
    s = record(s, [{ kind: "shot", points: 1, made: true, jersey: 9 }], 2);
    s = record(s, [{ kind: "rebound", offensive: true, jersey: 12 }], 3);
    s = record(s, [{ kind: "rebound", offensive: false, jersey: 12 }], 4);
    s = record(s, [{ kind: "steal", jersey: 23 }], 5);
    s = record(s, [{ kind: "block", jersey: 23 }], 6);
    s = record(s, [{ kind: "turnover", jersey: 9 }], 7);
    s = record(s, [{ kind: "foul", jersey: 9 }], 8);
    s = record(s, [{ kind: "foulon", jersey: 12 }], 9);
    s = record(s, [{ kind: "timeout" }], 10);
    expect(currentEvents(s.events).map((e) => [e.kind, e.subType, e.isSuccessful, e.jersey])).toEqual([
      ["3pt", "", 0, "9"],
      ["freethrow", "", 1, "9"],
      ["rebound", "offensive", 1, "12"],
      ["rebound", "defensive", 1, "12"],
      ["steal", "", 1, "23"],
      ["block", "", 1, "23"],
      ["turnover", "", 1, "9"],
      ["foul", "personal", 1, "9"],
      ["foulon", "", 1, "12"],
      ["timeout", "", 1, null],
    ]);
  });

  it("undo voids the newest event (never deletes) and redo restores it; a new record clears redo", () => {
    let s = initialState(session());
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }], 1);
    s = record(s, [{ kind: "rebound", offensive: false, jersey: 12 }], 2);
    s = reduceStatSession(s, { type: "undo", at: at(3) });
    expect(s.events).toHaveLength(2);
    expect(currentEvents(s.events).map((e) => e.seq)).toEqual([1]);
    expect(s.events[1].voidedAt).toBe(at(3));
    s = reduceStatSession(s, { type: "redo" });
    expect(currentEvents(s.events).map((e) => e.seq)).toEqual([1, 2]);
    s = reduceStatSession(s, { type: "undo", at: at(4) });
    s = record(s, [{ kind: "steal", jersey: 23 }], 5);
    s = reduceStatSession(s, { type: "redo" });
    expect(currentEvents(s.events).map((e) => e.seq)).toEqual([1, 3]);
    expect(s.nextSeq).toBe(4);
  });

  it("a spoken 'ångra' is an undo", () => {
    let s = initialState(session());
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }], 1);
    s = record(s, [{ kind: "undo" }], 2);
    expect(currentEvents(s.events)).toHaveLength(0);
  });

  it("void by seq and correct by superseding keep old seqs out of the current set", () => {
    let s = initialState(session());
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }], 1);
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 12 }], 2);
    s = reduceStatSession(s, { type: "void", seq: 1, at: at(3) });
    s = reduceStatSession(s, { type: "correct", seq: 2, patch: { jersey: "23", isSuccessful: 0 }, at: at(4), newClientId: uid });
    const cur = currentEvents(s.events);
    expect(cur.map((e) => e.seq)).toEqual([3]);
    expect(cur[0]).toMatchObject({ kind: "2pt", jersey: "23", playerName: null, isSuccessful: 0, recordedAt: at(2) });
    expect(s.events.find((e) => e.seq === 2)?.supersededBy).toBe(3);
  });

  it("tip-off sets the anchor and period 1; period intents move the period; events inherit it", () => {
    let s = initialState(session());
    expect(s.period).toBe(1);
    s = reduceStatSession(s, { type: "tipoff", at: at(0), newClientId: uid });
    expect(s.session.tipoffAt).toBe(at(0));
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }], 30);
    s = record(s, [{ kind: "period", period: null }], 600);
    expect(s.period).toBe(2);
    s = record(s, [{ kind: "period", period: 4 }], 1800);
    expect(s.period).toBe(4);
    s = record(s, [{ kind: "shot", points: 3, made: true, jersey: 9 }], 1900);
    const shots = currentEvents(s.events).filter((e) => e.kind !== "period");
    expect(shots.map((e) => e.period)).toEqual([1, 4]);
    s = reduceStatSession(s, { type: "undo", at: at(1901) });
    s = reduceStatSession(s, { type: "undo", at: at(1902) });
    expect(s.period).toBe(2);
  });

  it("opponent events land on the other side with the opponent roster's names", () => {
    let s = initialState(session({ trackingMode: "both" }));
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 4 }], 1, "opponent");
    const e = currentEvents(s.events)[0];
    expect(e.teamSide).toBe(2);
    expect(e.playerName).toBe("Lo Berg");
  });
});

describe("boxScore", () => {
  it("tallies per player and per team from current events only", () => {
    let s = initialState(session());
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }, { kind: "assist", jersey: 12 }], 1);
    s = record(s, [{ kind: "shot", points: 3, made: false, jersey: 9 }], 2);
    s = record(s, [{ kind: "rebound", offensive: true, jersey: 9 }], 3);
    s = record(s, [{ kind: "shot", points: 1, made: true, jersey: 9 }], 4);
    s = record(s, [{ kind: "shot", points: 1, made: true, jersey: 9 }], 5);
    s = reduceStatSession(s, { type: "undo", at: at(6) });
    const box = boxScore(s.session, s.events);
    const elsa = box.players.find((p) => p.jersey === "9")!;
    expect(elsa).toMatchObject({ pts: 3, fgm: 1, fga: 2, tpm: 0, tpa: 1, ftm: 1, fta: 1, oreb: 1, dreb: 0, ast: 0 });
    expect(box.players.find((p) => p.jersey === "12")!.ast).toBe(1);
    expect(box.team[1].pts).toBe(3);
    expect(box.team[2].pts).toBe(0);
  });
});

describe("statEventsToPlayByPlay", () => {
  function sample() {
    let s = initialState(session());
    s = reduceStatSession(s, { type: "tipoff", at: at(0), newClientId: uid });
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }, { kind: "assist", jersey: 12 }], 12.4);
    s = record(s, [{ kind: "shot", points: 3, made: false, jersey: 23 }], 40);
    s = record(s, [{ kind: "rebound", offensive: false, jersey: 12 }], 42);
    s = record(s, [{ kind: "shot", points: 3, made: true, jersey: 23 }], 60);
    s = record(s, [{ kind: "timeout" }], 70);
    s = reduceStatSession(s, { type: "undo", at: at(71) });
    s = record(s, [{ kind: "foul", jersey: 9 }], 80);
    return s;
  }

  it("exports current, non-period rows in time order with the PlayByPlay contract", () => {
    const s = sample();
    const pbp = statEventsToPlayByPlay(s.session, s.events);
    expect(pbp.map((e) => [e.eventId, e.type, e.subType, e.isSuccessful])).toEqual([
      [2, "2pt", "", 1],
      [3, "assist", "", 1],
      [4, "3pt", "", 0],
      [5, "rebound", "defensive", 1],
      [6, "3pt", "", 1],
      [8, "foul", "personal", 1],
    ]);
    for (const e of pbp) {
      expect(e.eventId).toBeGreaterThan(0);
      expect(e.realWorldTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(e.gameClockTime).toBe("");
      expect(e.period).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(e.qualifiers)).toBe(true);
      expect(e.eventTeam?.teamName).toBe("Fryshuset Svart");
      expect(e.eventTeam?.teamNumber).toBe(1);
      if (e.player) expect(playerName(e).length).toBeGreaterThan(0);
    }
    const assist = pbp[1];
    expect(assist.previousAction).toBe(2);
    expect(assist.realWorldTime).toBe(pbp[0].realWorldTime);
    expect(pbp[0].player).toEqual({ playerId: 1009, pno: 9, firstName: "Elsa", familyName: "Svensson", teamNumber: 1 });
    expect(pbp[2].player).toEqual({ playerId: 1023, pno: 23, firstName: "#23", familyName: "", teamNumber: 1 });
    expect(pbp.map((e) => [e.scoreHome, e.scoreAway])).toEqual([[2, 0], [2, 0], [2, 0], [2, 0], [5, 0], [5, 0]]);
  });

  it("applies the lead time to every realWorldTime", () => {
    const s = sample();
    const pbp = statEventsToPlayByPlay(s.session, s.events, { leadMs: 1500 });
    expect(pbp[0].realWorldTime).toBe(new Date(T0 + 12400 - 1500).toISOString());
  });

  it("agrees with computeLeaders on points, assists and rebounds", () => {
    const s = sample();
    const pbp = statEventsToPlayByPlay(s.session, s.events);
    const box = boxScore(s.session, s.events);
    const pts = Object.fromEntries(computeLeaders(pbp, "points").map((r) => [r.name, r.value]));
    const ast = Object.fromEntries(computeLeaders(pbp, "assists").map((r) => [r.name, r.value]));
    const reb = Object.fromEntries(computeLeaders(pbp, "rebounds").map((r) => [r.name, r.value]));
    for (const p of box.players) {
      const name = p.playerName || `#${p.jersey}`;
      expect(pts[name] ?? 0).toBe(p.pts);
      expect(ast[name] ?? 0).toBe(p.ast);
      expect(reb[name] ?? 0).toBe(p.oreb + p.dreb);
    }
  });
});

describe("findVoiceSyncAnchor", () => {
  it("prefers the tip-off tap, then our first made basket, else null", () => {
    let s = initialState(session());
    expect(findVoiceSyncAnchor(s.session, s.events)).toBeNull();
    s = record(s, [{ kind: "shot", points: 3, made: false, jersey: 9 }], 5);
    expect(findVoiceSyncAnchor(s.session, s.events)).toBeNull();
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }], 20);
    expect(findVoiceSyncAnchor(s.session, s.events)).toEqual({
      realWorldTime: at(20),
      kind: "first_basket",
      label: "Fryshuset Svart's first basket (2–0)",
    });
    s = reduceStatSession(s, { type: "tipoff", at: at(1), newClientId: uid });
    expect(findVoiceSyncAnchor(s.session, s.events)).toEqual({
      realWorldTime: at(1),
      kind: "match_start",
      label: "the tip-off the stat keeper tapped",
    });
  });
});

describe("voiceSessionToGameData / statSessionToScheduleGame", () => {
  it("builds the desktop GameData shape with rosters, anchor and pbpStatus", () => {
    let s = initialState(session());
    s = reduceStatSession(s, { type: "tipoff", at: at(0), newClientId: uid });
    s = record(s, [{ kind: "shot", points: 2, made: true, jersey: 9 }], 10);
    const gd = voiceSessionToGameData(s.session, s.events);
    expect(gd).toMatchObject({
      homeName: "Fryshuset Svart",
      awayName: "Örebro",
      date: "2026-10-03",
      tipoffRealWorldTime: at(0),
      syncAnchor: { kind: "match_start", label: "the tip-off the stat keeper tapped" },
      pbpStatus: "ok",
    });
    expect(gd.homeRoster).toEqual([
      { jerseyNumber: "9", playerName: "Elsa Svensson" },
      { jerseyNumber: "12", playerName: "Noor Ali" },
      { jerseyNumber: "23", playerName: "" },
    ]);
    expect(gd.events).toHaveLength(1);
  });

  it("prefers official lineup names over the keeper's snapshot, matched by jersey", () => {
    const s = initialState(session());
    const gd = voiceSessionToGameData(s.session, s.events, {
      lineups: { home: [{ jerseyNumber: "23", playerName: "Maja Lind" }], away: [] },
    });
    expect(gd.homeRoster.find((r) => r.jerseyNumber === "23")?.playerName).toBe("Maja Lind");
    expect(gd.homeRoster.find((r) => r.jerseyNumber === "9")?.playerName).toBe("Elsa Svensson");
    expect(gd.pbpStatus).toBe("empty");
    expect(gd.tipoffRealWorldTime).toBeNull();
  });

  it("lists an unlinked session as a voice: schedule game with the running score", () => {
    let s = initialState(session({ sourceGameId: null, status: "final" }));
    s = record(s, [{ kind: "shot", points: 3, made: true, jersey: 9 }], 10);
    const g = statSessionToScheduleGame(s.session, s.events);
    expect(g.uuid).toBe("voice:s1");
    expect(g.homeTeamInfo.names.long).toBe("Fryshuset Svart");
    expect(g.homeTeamInfo.score).toBe(3);
    expect(g.awayTeamInfo.score).toBe(0);
    expect(g.rawStartDateTime).toBe("2026-10-03T00:00:00.000Z");
    expect(g.venueInfo.name).toBe("Anna L.");
    expect(g.homeTeamInfo.status).toBe("COMPLETE");
  });
});

describe("currentEvents", () => {
  it("excludes voided and superseded rows and keeps seq order", () => {
    const base = { sessionId: "s", clientId: "c", kind: "2pt", subType: "", isSuccessful: 1, teamSide: 1, jersey: "9", playerName: null, period: 1, recordedAt: at(0), source: "live", linkedSeq: null, voidedAt: null, supersededBy: null } as const;
    const rows: StatEvent[] = [
      { ...base, seq: 3 },
      { ...base, seq: 1, voidedAt: at(1) },
      { ...base, seq: 2, supersededBy: 3 },
    ];
    expect(currentEvents(rows).map((e) => e.seq)).toEqual([3]);
  });
});
