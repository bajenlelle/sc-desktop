import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { eventLabel, formatGameClock, isBookkeepingEvent, periodLabel } from "../events";

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
