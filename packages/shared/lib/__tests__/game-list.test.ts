import { describe, expect, it } from "vitest";
import type { GameMarks, GameTimeout } from "../../types/game-marks";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { EMPTY_CLIP_FILTERS } from "../clip-filters";
import { gameFlow, gameMoments } from "../game-flow";
import { EMPTY_GAME_FILTERS, gameFilterCount, gameFiltersActive, gameRows, keepPlay, type GameFilters } from "../game-list";
import { buildGameTimeline } from "../game-timeline";

const TIP = "2026-01-10T17:00:00Z";
const sync: SyncPoint = { syncVideoTime: 100, syncRealWorldTime: TIP };
const at = (seconds: number) => new Date(new Date(TIP).getTime() + seconds * 1000).toISOString();

/** A play `seconds` after tip-off; the game clock counts down from 10:00 in step with it. */
function ev(eventId: number, period: number, seconds: number, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  const inPeriod = seconds - (period - 1) * 1000;
  const left = 600 - inPeriod;
  const clock = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  return {
    eventId,
    type: "2pt",
    subType: "layup",
    period,
    gameClockTime: clock,
    realWorldTime: at(seconds),
    isSuccessful: 1,
    eventTeam: { teamCode: "", teamName: "Home", teamNumber: 1 },
    qualifiers: [],
    ...extra,
  };
}
const away = { eventTeam: { teamCode: "", teamName: "Away", teamNumber: 2 } };
const player = (id: number, pno: number, first: string, last: string, teamNumber = 1) => ({
  player: { playerId: id, pno, firstName: first, familyName: last, teamNumber },
});

function timeout(eventId: number, period: number, seconds: number, extra: Partial<GameTimeout> = {}): GameTimeout {
  const left = 600 - (seconds - (period - 1) * 1000);
  return {
    eventId,
    period,
    clock: `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`,
    realWorldTime: at(seconds),
    kind: "team",
    teamNumber: 1,
    scoreHome: null,
    scoreAway: null,
    ...extra,
  };
}
const marksOf = (...timeouts: GameTimeout[]): GameMarks => ({ v: 1, source: "genius", periods: {}, timeouts });

function setup(events: PlayByPlayEvent[], marks: GameMarks | null = null) {
  const timeline = buildGameTimeline({ matchId: "m", events, sync, marks });
  const flow = gameFlow(events);
  const moments = gameMoments(flow, marks);
  return { timeline, flow, moments, marks };
}
const withFilters = (patch: Partial<GameFilters>): GameFilters => ({ ...EMPTY_GAME_FILTERS, ...patch });
const kept = (s: ReturnType<typeof setup>, filters: GameFilters, ctx: Partial<Parameters<typeof keepPlay>[1]> = {}) =>
  s.timeline.plays.filter(keepPlay(filters, { moments: s.moments, ...ctx })).map((p) => p.event.eventId);

describe("filters", () => {
  it("counts the sheet's groups and knows when anything narrows the list", () => {
    expect(gameFiltersActive(EMPTY_GAME_FILTERS)).toBe(false);
    expect(gameFilterCount(EMPTY_GAME_FILTERS)).toBe(0);
    expect(gameFiltersActive(withFilters({ team: 2 }))).toBe(true);
    expect(gameFiltersActive(withFilters({ search: "  " }))).toBe(false);
    expect(gameFiltersActive(withFilters({ search: "berg" }))).toBe(true);
    expect(gameFiltersActive(withFilters({ moment: "clutch" }))).toBe(true);
    const sheet = withFilters({ periods: new Set([2]), clip: { ...EMPTY_CLIP_FILTERS, types: new Set(["2pt-made", "3pt-made"]), labels: new Set(["l1"]) } });
    expect(gameFilterCount(sheet)).toBe(3);
    expect(gameFiltersActive(sheet)).toBe(true);
  });
});

describe("keepPlay", () => {
  const events = [
    ev(1, 1, 30, player(7, 7, "Ida", "Andersson")),
    ev(2, 1, 60, { ...away, ...player(12, 12, "Lo", "Berg", 2), type: "rebound", subType: "defensive" }),
    ev(3, 2, 1100, { ...player(7, 7, "Ida", "Andersson"), type: "3pt", isSuccessful: 0 }),
    ev(4, 2, 1200, { ...away, type: "turnover", subType: "badpass", eventTeam: null, ...player(12, 12, "Lo", "Berg", 2) }),
  ];
  const s = setup(events);

  it("keeps everything with no filter", () => {
    expect(kept(s, EMPTY_GAME_FILTERS)).toEqual([1, 2, 3, 4]);
  });

  it("filters by team, reading the player's side when the play names no team", () => {
    expect(kept(s, withFilters({ team: 1 }))).toEqual([1, 3]);
    expect(kept(s, withFilters({ team: 2 }))).toEqual([2, 4]);
  });

  it("filters by period", () => {
    expect(kept(s, withFilters({ periods: new Set([2]) }))).toEqual([3, 4]);
  });

  it("searches a player by name or shirt number", () => {
    expect(kept(s, withFilters({ search: "berg" }))).toEqual([2, 4]);
    expect(kept(s, withFilters({ search: " IDA " }))).toEqual([1, 3]);
    expect(kept(s, withFilters({ search: "#7" }))).toEqual([1, 3]);
    expect(kept(s, withFilters({ search: "12" }))).toEqual([2, 4]);
    expect(kept(s, withFilters({ search: "1" }))).toEqual([]);
  });

  it("applies the Add clips filters, and combines groups", () => {
    const types = withFilters({ clip: { ...EMPTY_CLIP_FILTERS, types: new Set(["2pt-made", "turnover"]) } });
    expect(kept(s, types)).toEqual([1, 4]);
    expect(kept(s, { ...types, team: 2 })).toEqual([4]);
    const players = withFilters({ clip: { ...EMPTY_CLIP_FILTERS, players: new Set(["Ida Andersson"]) } });
    expect(kept(s, players)).toEqual([1, 3]);
  });

  it("filters by a moment", () => {
    const moments = new Map([[3, new Set(["clutch"] as const)]]);
    expect(kept(s, withFilters({ moment: "clutch" }), { moments })).toEqual([3]);
    expect(kept(s, withFilters({ moment: "run" }), { moments })).toEqual([]);
  });

  it("filters by label through the clip keys", () => {
    const labelled = withFilters({ clip: { ...EMPTY_CLIP_FILTERS, labels: new Set(["pnr"]) } });
    const labelsOf = (key: string) => (key === "m:2" ? new Set(["pnr", "x"]) : key === "m:3" ? new Set(["x"]) : undefined);
    expect(kept(s, labelled, { labelsOf })).toEqual([2]);
    expect(kept(s, labelled)).toEqual([]);
  });

  it("turns the player filter into 'while on the floor' when asked", () => {
    const players = { ...EMPTY_CLIP_FILTERS, players: new Set(["Ida Andersson"]) };
    const onCourtIds = new Set([2, 3]);
    expect(kept(s, withFilters({ clip: players, onCourt: true }), { onCourtIds })).toEqual([2, 3]);
    // Without the on-court plays, or with no player chosen, the switch changes nothing.
    expect(kept(s, withFilters({ clip: players, onCourt: true }))).toEqual([1, 3]);
    expect(kept(s, withFilters({ onCourt: true }), { onCourtIds })).toEqual([1, 2, 3, 4]);
  });
});

describe("gameRows", () => {
  const kinds = (rows: ReturnType<typeof gameRows>) =>
    rows.map((r) => (r.kind === "play" ? `play:${r.play.event.eventId}` : r.kind === "timeout" ? `timeout:${r.timeout.eventId}` : r.key));
  const rowsFor = (s: ReturnType<typeof setup>, filters: GameFilters = EMPTY_GAME_FILTERS) =>
    gameRows({ timeline: s.timeline, keep: keepPlay(filters, { moments: s.moments }), filters, flow: s.flow, marks: s.marks });

  it("lists a period's plays under its header, with its score, and closes each period", () => {
    const s = setup([ev(1, 1, 30), ev(2, 1, 60, { ...away, type: "3pt" }), ev(3, 2, 1100)]);
    const rows = rowsFor(s);
    expect(kinds(rows)).toEqual(["period:1", "play:1", "play:2", "end:1", "period:2", "play:3", "end:2"]);
    expect(rows[0]).toMatchObject({ kind: "period", plays: 2, score: { home: 2, away: 3 } });
    expect(rows[3]).toMatchObject({ kind: "period_end", score: { home: 2, away: 3 }, half: false, final: false });
    expect(rows[6]).toMatchObject({ kind: "period_end", score: { home: 4, away: 3 }, half: false, final: true });
  });

  it("marks half-time after the second period of a longer game", () => {
    const s = setup([ev(1, 1, 30), ev(2, 2, 1100), ev(3, 3, 2100)]);
    const ends = rowsFor(s).filter((r) => r.kind === "period_end");
    expect(ends.map((r) => (r.kind === "period_end" ? [r.period, r.half, r.final] : null))).toEqual([
      [1, false, false],
      [2, true, false],
      [3, false, true],
    ]);
  });

  it("puts each timeout where it fell, the last one after the period's plays", () => {
    const s = setup([ev(1, 1, 30), ev(4, 1, 200), ev(8, 1, 400)], marksOf(timeout(3, 1, 100), timeout(9, 1, 500, { kind: "officials", teamNumber: null })));
    expect(kinds(rowsFor(s))).toEqual(["period:1", "play:1", "timeout:3", "play:4", "play:8", "timeout:9", "end:1"]);
  });

  it("heads a run with its row, above the first basket", () => {
    const s = setup([ev(1, 1, 30, away), ev(2, 1, 60, { type: "3pt" }), ev(3, 1, 90, { type: "3pt" }), ev(4, 1, 120), ev(5, 1, 150, away)]);
    const rows = rowsFor(s);
    expect(kinds(rows)).toEqual(["period:1", "play:1", "run:2", "play:2", "play:3", "play:4", "play:5", "end:1"]);
    expect(rows[2]).toMatchObject({ kind: "run", run: { team: 1, points: 8 } });
  });

  it("drops the markers and the empty periods when a filter is on", () => {
    const s = setup([ev(1, 1, 30), ev(4, 1, 200, away), ev(5, 2, 1100, away)], marksOf(timeout(3, 1, 100)));
    expect(kinds(rowsFor(s, withFilters({ team: 1 })))).toEqual(["period:1", "play:1"]);
    expect(rowsFor(s, withFilters({ team: 1 }))[0]).toMatchObject({ plays: 1 });
  });

  it("heads each play after a timeout with its timeout", () => {
    const events = [ev(1, 1, 30), ev(4, 1, 200, { type: "rebound", subType: "defensive" }), ev(5, 1, 210, { ...away, type: "turnover" }), ev(8, 1, 400)];
    const s = setup(events, marksOf(timeout(3, 1, 100), timeout(7, 1, 380, { kind: "officials", teamNumber: null })));
    const filters = withFilters({ moment: "after_timeout" });
    expect(kinds(rowsFor(s, filters))).toEqual(["period:1", "timeout:3", "play:5"]);
  });

  it("keeps the run rows when the list is filtered to runs", () => {
    const s = setup([ev(1, 1, 30, away), ev(2, 1, 60, { type: "3pt" }), ev(3, 1, 90, { type: "3pt" }), ev(4, 1, 120), ev(5, 1, 150, away)]);
    expect(kinds(rowsFor(s, withFilters({ moment: "run" })))).toEqual(["period:1", "run:2", "play:2", "play:3", "play:4"]);
  });

  it("is empty when nothing matches", () => {
    const s = setup([ev(1, 1, 30)]);
    expect(rowsFor(s, withFilters({ team: 2 }))).toEqual([]);
  });

  it("orders a timeout the timeline can't place by action number", () => {
    const events = [ev(1, 1, 30), ev(4, 1, 200)];
    const flow = gameFlow(events);
    const timeline = { plays: buildGameTimeline({ matchId: "m", events, sync }).plays, timeOf: () => null };
    const rows = gameRows({ timeline, keep: () => true, filters: EMPTY_GAME_FILTERS, flow, marks: marksOf(timeout(3, 1, 100)) });
    expect(kinds(rows)).toEqual(["period:1", "play:1", "timeout:3", "play:4", "end:1"]);
  });
});
