import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import {
  eventColors,
  eventLabel,
  formatGameClock,
  isBookkeepingEvent,
  parseGameClock,
  periodLabel,
  playerName,
} from "../events";

function ev(partial: Partial<PlayByPlayEvent>): PlayByPlayEvent {
  return partial as PlayByPlayEvent;
}

describe("isBookkeepingEvent", () => {
  it("flags team dead-ball rebounds", () => {
    expect(isBookkeepingEvent(ev({ type: "rebound", subType: "offensiveDeadBall" }))).toBe(true);
    expect(isBookkeepingEvent(ev({ type: "rebound", subType: "offensivedeadball" }))).toBe(true);
  });

  it("keeps real rebounds and other events", () => {
    expect(isBookkeepingEvent(ev({ type: "rebound", subType: "offensive" }))).toBe(false);
    expect(isBookkeepingEvent(ev({ type: "rebound", subType: "defensive" }))).toBe(false);
    expect(isBookkeepingEvent(ev({ type: "rebound" }))).toBe(false);
    expect(isBookkeepingEvent(ev({ type: "turnover", subType: "offensivedeadball" }))).toBe(false);
  });
});

describe("eventLabel", () => {
  it("splits shots by outcome", () => {
    expect(eventLabel(ev({ type: "2pt", isSuccessful: 1 }))).toBe("2PT Made");
    expect(eventLabel(ev({ type: "2pt", isSuccessful: 0 }))).toBe("2PT Miss");
    expect(eventLabel(ev({ type: "3pt", isSuccessful: 1 }))).toBe("3PT Made");
    expect(eventLabel(ev({ type: "freethrow", isSuccessful: 0 }))).toBe("FT Miss");
  });

  it("decodes meaningful subtypes", () => {
    expect(eventLabel(ev({ type: "turnover", subType: "badPass" }))).toBe("Bad Pass");
    expect(eventLabel(ev({ type: "foul", subType: "offensive" }))).toBe("Charge");
    expect(eventLabel(ev({ type: "rebound", subType: "offensiveDeadBall" }))).toBe("Inbound Play");
    expect(eventLabel(ev({ type: "rebound", subType: "defensive" }))).toBe("Def Rebound");
  });

  it("falls back to the raw type when unknown", () => {
    expect(eventLabel(ev({ type: "jumpball" as PlayByPlayEvent["type"] }))).toBe("jumpball");
  });
});

describe("periodLabel", () => {
  it("labels quarters then overtimes", () => {
    expect(periodLabel(1)).toBe("Q1");
    expect(periodLabel(4)).toBe("Q4");
    expect(periodLabel(5)).toBe("OT1");
    expect(periodLabel(7)).toBe("OT3");
  });
});

describe("formatGameClock", () => {
  it("trims centiseconds and tolerates empty input", () => {
    expect(formatGameClock("08:24:00")).toBe("08:24");
    expect(formatGameClock("10:00")).toBe("10:00");
    expect(formatGameClock("")).toBe("—");
  });
});

describe("eventColors", () => {
  it("deepens shot strips with value, green for makes and red for misses", () => {
    expect(eventColors(ev({ type: "freethrow", isSuccessful: 1 })).strip).toBe("bg-emerald-300");
    expect(eventColors(ev({ type: "freethrow", isSuccessful: 0 })).strip).toBe("bg-red-300");
    expect(eventColors(ev({ type: "2pt", isSuccessful: 1 })).strip).toBe("bg-emerald-400");
    expect(eventColors(ev({ type: "2pt", isSuccessful: 0 })).strip).toBe("bg-red-400");
    expect(eventColors(ev({ type: "3pt", isSuccessful: 1 })).strip).toBe("bg-emerald-600");
    expect(eventColors(ev({ type: "3pt", isSuccessful: 0 })).strip).toBe("bg-red-600");
  });

  it("splits rebounds by side and shades unknowns slate", () => {
    expect(eventColors(ev({ type: "rebound", subType: "offensive" })).strip).toBe("bg-sky-400");
    expect(eventColors(ev({ type: "rebound", subType: "defensive" })).strip).toBe("bg-blue-500");
    expect(eventColors(ev({ type: "rebound" })).strip).toBe("bg-slate-400");
  });

  it("gives fouls committed and drawn the same orange strip", () => {
    expect(eventColors(ev({ type: "foul" })).strip).toBe("bg-orange-400");
    expect(eventColors(ev({ type: "foulon" })).strip).toBe("bg-orange-400");
    expect(eventColors(ev({ type: "foul" }))).toEqual(eventColors(ev({ type: "foulon" })));
  });

  it("falls back to slate/muted for unknown types", () => {
    expect(eventColors(ev({ type: "jumpball" as PlayByPlayEvent["type"] }))).toEqual({
      strip: "bg-slate-300",
      badge: "bg-muted text-muted-foreground",
    });
  });
});

describe("playerName", () => {
  it("joins first and family name, trimmed", () => {
    expect(
      playerName(ev({ player: { firstName: "Leo", familyName: "Halling" } as PlayByPlayEvent["player"] })),
    ).toBe("Leo Halling");
    expect(
      playerName(ev({ player: { firstName: "Leo", familyName: "" } as PlayByPlayEvent["player"] })),
    ).toBe("Leo");
  });

  it("renders an em dash without a player", () => {
    expect(playerName(ev({}))).toBe("—");
    expect(playerName(ev({ player: null }))).toBe("—");
  });
});

describe("parseGameClock", () => {
  it("converts MM:SS to seconds", () => {
    expect(parseGameClock("09:41")).toBe(581);
    expect(parseGameClock("00:07")).toBe(7);
  });

  it("returns the -1 sentinel for dashes and unparseable input", () => {
    expect(parseGameClock("—")).toBe(-1);
    expect(parseGameClock("")).toBe(-1);
    expect(parseGameClock("9")).toBe(-1);
  });

  it("round-trips through formatGameClock", () => {
    expect(parseGameClock(formatGameClock("09:41:30"))).toBe(581);
  });
});
