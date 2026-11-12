import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { playerKey, playersByTeam } from "../clip-filters";

function ev(partial: Partial<PlayByPlayEvent> & { eventId: number }): PlayByPlayEvent {
  return {
    type: "2pt",
    subType: "jumpshot",
    period: 1,
    gameClockTime: "09:00",
    realWorldTime: "2026-10-04T13:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    ...partial,
  };
}

const made2 = ev({ eventId: 1, type: "2pt", subType: "layup", isSuccessful: 1, qualifiers: ["fastbreak", "pointsinthepaint"], eventTeam: { teamCode: "FRY", teamName: "Fryshuset", teamNumber: 1 }, player: { playerId: 1, pno: 4, firstName: "Pedro", familyName: "Lelo", teamNumber: 1 } });
const defReb = ev({ eventId: 3, type: "rebound", subType: "defensive", isSuccessful: 1, eventTeam: { teamCode: "FRY", teamName: "Fryshuset", teamNumber: 1 } });

const p = (playerId: number, pno: number, first: string, family: string, teamNumber = 1) => ({ playerId, pno, firstName: first, familyName: family, teamNumber });
const fry = { teamCode: "", teamName: "Fryshuset", teamNumber: 1 };
const sol = { teamCode: "", teamName: "Sollentuna", teamNumber: 2 };

describe("playerKey", () => {
  it("keys a player by Genius person id, and by name when the play has no id", () => {
    expect(playerKey(made2)).toBe("id:1");
    expect(playerKey(ev({ eventId: 9, player: p(0, 5, "Ada", "Lind") }))).toBe("name:Ada Lind");
    expect(playerKey(defReb)).toBeNull();
  });
});

describe("playersByTeam", () => {
  it("groups players by team in order of first appearance, numbers first, players without one last", () => {
    const events = [
      ev({ eventId: 1, eventTeam: sol, player: p(7, 7, "Finn", "Eriksson", 2) }),
      ev({ eventId: 2, eventTeam: fry, player: p(12, 12, "Alva", "Berg") }),
      ev({ eventId: 3, eventTeam: fry, player: p(4, 4, "Pedro", "Lelo") }),
      ev({ eventId: 4, eventTeam: fry, player: p(30, 0, "Sam", "Ek") }),
    ];
    expect(playersByTeam(events)).toEqual([
      { teamName: "Sollentuna", players: [{ key: "id:7", name: "Finn Eriksson", number: "7" }] },
      { teamName: "Fryshuset", players: [
        { key: "id:4", name: "Pedro Lelo", number: "4" },
        { key: "id:12", name: "Alva Berg", number: "12" },
        { key: "id:30", name: "Sam Ek", number: null },
      ] },
    ]);
  });

  it("lists a player once per team across games, with the first number on record", () => {
    const events = [
      ev({ eventId: 1, eventTeam: fry, player: p(4, 0, "Pedro", "Lelo") }),
      ev({ eventId: 1, eventTeam: fry, player: p(4, 4, "Pedro", "Lelo") }),
    ];
    expect(playersByTeam(events)[0].players).toEqual([{ key: "id:4", name: "Pedro Lelo", number: "4" }]);
  });

  it("keeps two players with one name apart by id", () => {
    const events = [
      ev({ eventId: 1, eventTeam: fry, player: p(10, 5, "Erik", "Berg") }),
      ev({ eventId: 2, eventTeam: fry, player: p(11, 6, "Erik", "Berg") }),
    ];
    expect(playersByTeam(events)[0].players.map((x) => x.key)).toEqual(["id:10", "id:11"]);
  });

  it("puts players on plays without a team in a last group with an empty name", () => {
    const events = [
      ev({ eventId: 1, eventTeam: null, player: p(2, 2, "No", "Team") }),
      ev({ eventId: 2, eventTeam: fry, player: p(4, 4, "Pedro", "Lelo") }),
    ];
    expect(playersByTeam(events).map((g) => g.teamName)).toEqual(["Fryshuset", ""]);
  });
});
