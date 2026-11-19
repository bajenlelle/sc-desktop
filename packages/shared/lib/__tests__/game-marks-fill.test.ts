import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayByPlayEvent, StoredMatch } from "../../types/match";
import { findGeniusGameMarks, gameMarksBasis } from "../game-marks";
import { fillGameMarks, geniusGameId, updateGameMarks } from "../game-marks-fill";
import type { GeniusAction } from "../genius";
import sample from "./fixtures/genius-sample.json";

const actions = sample.actions as unknown as GeniusAction[];
const HOME = 187007;

/** A client whose genius function answers `feed` and whose matches update resolves to `update`. */
function mockClient(feed: { data: unknown; error: unknown }, update: { data: unknown; error: unknown } = { data: [{ id: "g" }], error: null }) {
  const invoke = vi.fn().mockResolvedValue(feed);
  const updates: unknown[] = [];
  const builder: Record<string, unknown> = {};
  builder.update = (row: unknown) => {
    updates.push(row);
    return builder;
  };
  builder.eq = () => builder;
  builder.select = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve(update);
  const from = vi.fn(() => builder);
  return { client: { functions: { invoke }, from } as unknown as SupabaseClient, invoke, from, updates };
}

const plays: PlayByPlayEvent[] = [
  { eventId: 9, type: "3pt", subType: "", period: 1, gameClockTime: "09:40", realWorldTime: "2025-09-19T17:06:30Z", isSuccessful: 0, qualifiers: [] },
  { eventId: 17, type: "3pt", subType: "", period: 1, gameClockTime: "09:11", realWorldTime: "2025-09-19T17:07:20Z", isSuccessful: 1, qualifiers: [] },
];
const game: Pick<StoredMatch, "id" | "events" | "gameMarks" | "isDemo" | "sourceGameId" | "leagueId"> = {
  id: "g",
  events: plays,
  sourceGameId: "2668882",
  leagueId: "sbl-herr",
};
const feed = { data: { fixture: sample.fixture, actions, players: [], pbpStatus: "ok" }, error: null };

describe("geniusGameId", () => {
  it("is the feed's id for a Genius game, and nothing for the rest", () => {
    expect(geniusGameId(game)).toBe(2668882);
    expect(geniusGameId({ ...game, isDemo: true })).toBeNull();
    expect(geniusGameId({ ...game, sourceGameId: "profixio:123" })).toBeNull();
    expect(geniusGameId({ ...game, sourceGameId: "0b5b1c9e-uuid" })).toBeNull();
    expect(geniusGameId({ ...game, sourceGameId: undefined })).toBeNull();
    expect(geniusGameId({ ...game, leagueId: "profixio-stockholm-div2" })).toBeNull();
  });
});

describe("updateGameMarks", () => {
  it("says whether the row took the marks", async () => {
    const marks = findGeniusGameMarks(actions, HOME);
    const taken = mockClient(feed);
    expect(await updateGameMarks(taken.client, "g", marks)).toBe(true);
    expect(taken.updates).toEqual([{ game_marks: marks }]);
    expect(await updateGameMarks(mockClient(feed, { data: [], error: null }).client, "g", marks)).toBe(false);
  });

  it("throws when the database refuses", async () => {
    const { client } = mockClient(feed, { data: null, error: { message: "column game_marks does not exist" } });
    await expect(updateGameMarks(client, "g", null)).rejects.toThrow("game_marks");
  });
});

describe("fillGameMarks", () => {
  it("reads the feed, stores the marks with their basis, and returns them", async () => {
    const { client, invoke, updates } = mockClient(feed);
    const fill = await fillGameMarks(client, game, 41539);
    expect(invoke).toHaveBeenCalledWith("genius", { body: { action: "match", competitionId: 41539, matchId: 2668882 } });
    expect(fill.outcome).toBe("filled");
    expect(fill.marks?.timeouts).toHaveLength(1);
    expect(fill.marks?.timeouts[0]).toMatchObject({ clock: "02:37", teamNumber: 1 });
    expect(fill.marks?.basis).toEqual(gameMarksBasis(plays));
    expect(updates).toEqual([{ game_marks: fill.marks }]);
  });

  it("asks nothing when the stored marks still match the plays", async () => {
    const stored = { ...findGeniusGameMarks(actions, HOME), basis: gameMarksBasis(plays) };
    const { client, invoke, from } = mockClient(feed);
    expect(await fillGameMarks(client, { ...game, gameMarks: stored }, 41539)).toEqual({ outcome: "fresh", marks: stored });
    expect(invoke).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("reads again when a re-import has moved the plays", async () => {
    const stored = { ...findGeniusGameMarks(actions, HOME), basis: { plays: 1, first: "x", last: "y" } };
    const { client, invoke } = mockClient(feed);
    expect((await fillGameMarks(client, { ...game, gameMarks: stored }, 41539)).outcome).toBe("filled");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("skips a game the feed can't answer for", async () => {
    const { client, invoke } = mockClient(feed);
    expect((await fillGameMarks(client, { ...game, isDemo: true }, 41539)).outcome).toBe("skipped");
    expect((await fillGameMarks(client, { ...game, sourceGameId: "old-scrape-uuid" }, 41539)).outcome).toBe("skipped");
    expect((await fillGameMarks(client, game, null)).outcome).toBe("skipped");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports the function's token when the feed can't be read, and keeps what the game had", async () => {
    const error = { context: { json: async () => ({ error: "match_not_available" }) } };
    const { client, from } = mockClient({ data: null, error });
    expect(await fillGameMarks(client, game, 41539)).toEqual({ outcome: "failed", marks: null, error: "match_not_available" });
    expect(from).not.toHaveBeenCalled();
  });

  it("stores empty marks for a game with no play-by-play upstream", async () => {
    const { client, updates } = mockClient({ data: { fixture: sample.fixture, actions: [], players: [], pbpStatus: "empty" }, error: null });
    const fill = await fillGameMarks(client, game, 41539);
    expect(fill.outcome).toBe("filled");
    expect(fill.marks?.timeouts).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("keeps the marks for this visit when they can't be stored", async () => {
    const notOwner = await fillGameMarks(mockClient(feed, { data: [], error: null }).client, game, 41539);
    expect(notOwner.outcome).toBe("unsaved");
    expect(notOwner.marks?.timeouts).toHaveLength(1);

    const noColumn = await fillGameMarks(mockClient(feed, { data: null, error: { message: "Could not find the 'game_marks' column" } }).client, game, 41539);
    expect(noColumn.outcome).toBe("unsaved");
    expect(noColumn.marks?.timeouts).toHaveLength(1);
    expect(noColumn.error).toContain("game_marks");
  });

  it("never throws, whatever the function does", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("offline"));
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    expect(await fillGameMarks(client, game, 41539)).toEqual({ outcome: "failed", marks: null, error: "offline" });
  });
});
