import { describe, expect, it } from "vitest";
import { pickableGames, type PickerGame } from "../game-picker";

const game = (id: string, home: string, away: string, more: Partial<PickerGame> = {}): PickerGame => ({
  id,
  title: `${home} vs ${away}`,
  date: "2026-09-27",
  homeTeam: { name: home },
  awayTeam: { name: away },
  ...more,
});

// The Library's order: the game imported last comes first.
const library = [
  game("a", "Sloga Uppsala", "Uppsala Basket"),
  game("b", "Högsbo Basket", "Borås Basket"),
  game("c", "Nässjö Basket", "Norrköping Dolphins", { archivedAt: "2026-11-01T10:00:00Z" }),
  game("d", "BC Luleå", "Köping Stars", { title: "Cup final" }),
];
const none = new Set<string>();
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("pickableGames", () => {
  it("lists the Library's games in the Library's order, without the archived ones", () => {
    expect(ids(pickableGames(library, "", none))).toEqual(["a", "b", "d"]);
  });

  it("carries each game's title and date", () => {
    expect(pickableGames(library, "", none)[0]).toEqual({ id: "a", title: "Sloga Uppsala vs Uppsala Basket", date: "2026-09-27", open: false });
  });

  it("marks the games that already have a tab", () => {
    const rows = pickableGames(library, "", new Set(["b"]));
    expect(rows.map((r) => r.open)).toEqual([false, true, false]);
  });

  it("finds a game by its title, in any case", () => {
    expect(ids(pickableGames(library, "cup FINAL", none))).toEqual(["d"]);
  });

  it("finds a game by either team, whatever it is titled", () => {
    expect(ids(pickableGames(library, "luleå", none))).toEqual(["d"]);
    expect(ids(pickableGames(library, "köping", none))).toEqual(["d"]);
  });

  it("ignores the spaces around what was typed", () => {
    expect(ids(pickableGames(library, "  borås ", none))).toEqual(["b"]);
  });

  it("never brings back an archived game, even by name", () => {
    expect(pickableGames(library, "nässjö", none)).toEqual([]);
  });

  it("lists nothing when nothing matches", () => {
    expect(pickableGames(library, "zzz", none)).toEqual([]);
  });
});
