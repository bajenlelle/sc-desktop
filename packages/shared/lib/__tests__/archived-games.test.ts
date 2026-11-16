import { describe, expect, it } from "vitest";
import { addClipsGames } from "../archived-games";

const game = (id: string, archivedAt?: string) => (archivedAt ? { id, archivedAt } : { id });
const ARCHIVED = "2026-11-12T09:00:00+00:00";
const none = new Set<string>();

describe("addClipsGames", () => {
  it("leaves archived games out", () => {
    const games = [game("a"), game("b", ARCHIVED), game("c")];
    expect(addClipsGames(games, null, none).map((g) => g.id)).toEqual(["a", "c"]);
  });

  it("keeps the game the coach came from, even if archived", () => {
    const games = [game("a"), game("b", ARCHIVED), game("c", ARCHIVED)];
    expect(addClipsGames(games, "b", none).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("keeps a game the playlist already uses, even if archived", () => {
    const games = [game("a"), game("b", ARCHIVED), game("c", ARCHIVED)];
    expect(addClipsGames(games, null, new Set(["c"])).map((g) => g.id)).toEqual(["a", "c"]);
  });

  it("lists every game when all are archived and none is excepted", () => {
    const games = [game("a", ARCHIVED), game("b", ARCHIVED)];
    expect(addClipsGames(games, null, none).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("lists nothing when there are no games", () => {
    expect(addClipsGames([], null, none)).toEqual([]);
  });
});
