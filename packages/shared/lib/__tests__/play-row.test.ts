import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { teamCode } from "../play-row";

function ev(extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: 1,
    type: "2pt",
    subType: "layup",
    period: 1,
    gameClockTime: "09:47",
    realWorldTime: "2026-01-10T17:00:00Z",
    isSuccessful: 1,
    eventTeam: { teamCode: "", teamName: "Home", teamNumber: 1 },
    qualifiers: [],
    ...extra,
  };
}

describe("teamCode", () => {
  it("uses the feed's code", () => {
    expect(teamCode(ev({ eventTeam: { teamCode: "SÖD ", teamName: "Södertälje BBK", teamNumber: 1 } }))).toBe("SÖD");
  });
  it("falls back to the name's first three letters", () => {
    expect(teamCode(ev({ eventTeam: { teamCode: "", teamName: "Köping Stars", teamNumber: 2 } }))).toBe("KÖP");
  });
  it("skips what isn't a letter", () => {
    expect(teamCode(ev({ eventTeam: { teamCode: "", teamName: "08 Stockholm", teamNumber: 2 } }))).toBe("STO");
  });
  it("has no code for a play with no team", () => {
    expect(teamCode(ev({ eventTeam: null }))).toBeNull();
  });
});
