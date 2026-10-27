import { describe, expect, it } from "vitest";
import { IN_PLAYLIST_MAX, gameGroups, orderForAdd, startGame, type BrowserGame } from "../add-clips-games";
import type { PlayByPlayEvent, PlaylistItem } from "../../types/match";

function game(id: string, date: string, home: string, away: string, eventIds: number[] = []): BrowserGame {
  return {
    id,
    title: `${home} – ${away}`,
    date,
    homeTeam: { name: home, color: "#000" },
    awayTeam: { name: away, color: "#fff" },
    events: eventIds.map((eventId) => ({ eventId }) as PlayByPlayEvent),
  };
}

const clip = (matchId: string, eventId: number): PlaylistItem => ({ type: "clip", matchId, eventId });
const text = (id: string): PlaylistItem => ({ type: "text", id, text: "x", durationSeconds: 5 });

// Imported in this order (the app lists games by import, newest import first).
const AIK = game("aik", "2026-10-04", "AIK", "Djurgården", [1, 2, 3]);
const SOD = game("sod", "2026-10-18", "Södertälje", "Norrköping", [1, 2]);
const UME = game("ume", "2026-09-27", "Umeå", "Luleå", [5, 6]);
const BOR = game("bor", "2026-10-11", "Borås", "Jämtland");
const matches = [AIK, SOD, UME, BOR];

describe("startGame", () => {
  it("starts on the game last browsed for the playlist", () => {
    expect(startGame(matches, [clip("aik", 1)], "ume")).toEqual({ id: "ume", source: "remembered" });
  });

  it("falls back to the game with the most clips in the playlist when the remembered one is gone", () => {
    const items = [clip("aik", 1), text("t"), clip("ume", 5), clip("ume", 6)];
    expect(startGame(matches, items, "deleted")).toEqual({ id: "ume", source: "most_clips" });
    expect(startGame(matches, items, null)).toEqual({ id: "ume", source: "most_clips" });
  });

  it("breaks a tie in clips by the later game", () => {
    expect(startGame(matches, [clip("aik", 1), clip("ume", 5)], null)).toEqual({ id: "aik", source: "most_clips" });
  });

  it("starts an empty playlist on the latest game played, not the latest imported", () => {
    expect(startGame(matches, [], null)).toEqual({ id: "sod", source: "newest" });
    // Clips from a game that is no longer listed count for nothing.
    expect(startGame(matches, [clip("gone", 1)], null)).toEqual({ id: "sod", source: "newest" });
  });

  it("has nothing to start on without games", () => {
    expect(startGame([], [clip("aik", 1)], "aik")).toEqual({ id: null, source: "newest" });
  });
});

describe("gameGroups", () => {
  it("puts the playlist's games first, most clips first, and every game below by date", () => {
    const items = [clip("aik", 1), clip("ume", 5), clip("ume", 6)];
    const { inPlaylist, all } = gameGroups(matches, items, "");
    expect(inPlaylist.map((g) => [g.match.id, g.clips])).toEqual([
      ["ume", 2],
      ["aik", 1],
    ]);
    expect(all.map((m) => m.id)).toEqual(["sod", "bor", "aik", "ume"]);
  });

  it("keeps the top group short", () => {
    const many = Array.from({ length: IN_PLAYLIST_MAX + 2 }, (_, i) => game(`g${i}`, `2026-10-${10 + i}`, `Home ${i}`, `Away ${i}`));
    const items = many.map((m) => clip(m.id, 1));
    expect(gameGroups(many, items, "").inPlaylist).toHaveLength(IN_PLAYLIST_MAX);
  });

  it("finds games by any word of the title or the teams, without minding case or accents", () => {
    expect(gameGroups(matches, [], "sodertalje").all.map((m) => m.id)).toEqual(["sod"]);
    expect(gameGroups(matches, [], "LULEA ume").all.map((m) => m.id)).toEqual(["ume"]);
    expect(gameGroups(matches, [clip("aik", 1)], "jamt").inPlaylist).toEqual([]);
    expect(gameGroups(matches, [], "zzz").all).toEqual([]);
  });
});

describe("orderForAdd", () => {
  it("adds the ticked clips in game order, whatever order they were ticked in", () => {
    expect(orderForAdd(["sod:2", "aik:3", "sod:1", "aik:1"], matches)).toEqual([
      { type: "clip", matchId: "aik", eventId: 1 },
      { type: "clip", matchId: "aik", eventId: 3 },
      { type: "clip", matchId: "sod", eventId: 1 },
      { type: "clip", matchId: "sod", eventId: 2 },
    ]);
  });

  it("drops what isn't a play of a listed game", () => {
    expect(orderForAdd(["aik:9", "gone:1", "nonsense", "ume:6"], matches)).toEqual([{ type: "clip", matchId: "ume", eventId: 6 }]);
  });
});
