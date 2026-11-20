import { describe, expect, it } from "vitest";
import { playlistGames } from "../playlist-games";
import type { PlaylistItem } from "../../types/match";

const clip = (matchId: string, eventId = 1): PlaylistItem => ({ type: "clip", matchId, eventId });
const text: PlaylistItem = { type: "text", id: "t", text: "Note", durationSeconds: 3 };
const lookup = new Map([
  ["a", { title: "Fryshuset vs AIK" }],
  ["b", { title: "Djurgården vs Södertälje" }],
  ["c", { title: "" }],
]);

describe("playlistGames", () => {
  it("names each game once, with its clip count, in the order its first clip stands", () => {
    expect(playlistGames([clip("b"), text, clip("a"), clip("b", 2), clip("a", 3), clip("b", 4)], lookup)).toEqual([
      { id: "b", title: "Djurgården vs Södertälje", clips: 3 },
      { id: "a", title: "Fryshuset vs AIK", clips: 2 },
    ]);
  });

  it("leaves out games the library doesn't hold", () => {
    expect(playlistGames([clip("a"), clip("gone")], lookup)).toEqual([{ id: "a", title: "Fryshuset vs AIK", clips: 1 }]);
  });

  it("calls an untitled game a game", () => {
    expect(playlistGames([clip("c")], lookup)[0].title).toBe("Game");
  });

  it("has no games with no clips", () => {
    expect(playlistGames([text], lookup)).toEqual([]);
    expect(playlistGames([], lookup)).toEqual([]);
  });
});
