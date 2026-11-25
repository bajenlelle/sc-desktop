import { describe, expect, it } from "vitest";
import { teamStateToRestore, teamTabId, teamTabOfPath, teamTabPath } from "../team-tabs";

describe("team tabs", () => {
  it("an open team's id is its season and team", () => {
    expect(teamTabId(4121, 7)).toBe("4121:7");
  });

  it("an id leads back to its team's page", () => {
    expect(teamTabPath("4121:7")).toBe("/teams/4121/7");
  });

  it("an id that isn't one leads nowhere", () => {
    expect(teamTabPath("")).toBeNull();
    expect(teamTabPath("4121")).toBeNull();
    expect(teamTabPath("a:b")).toBeNull();
    expect(teamTabPath("4121:7:1")).toBeNull();
  });

  it("a team's page is that team's tab, whatever its view", () => {
    expect(teamTabOfPath("/teams/4121/7")).toBe("4121:7");
  });

  it("the league table and a stable team id's lookup are no team's tab", () => {
    expect(teamTabOfPath("/teams")).toBeNull();
    expect(teamTabOfPath("/teams/find/55")).toBeNull();
    expect(teamTabOfPath("/matches/abc")).toBeNull();
    expect(teamTabOfPath("/teams/4121/7/extra")).toBeNull();
  });
});

describe("a team as it was left", () => {
  it("keeps the side and the pick", () => {
    const pick = { kind: "stat", stat: "threes", side: "with" };
    expect(teamStateToRestore({ side: "without", pick })).toEqual({ side: "without", pick });
  });

  it("drops a Back from before Back was the history's (the row is a new way in)", () => {
    expect(teamStateToRestore({ back: { label: "Alfa", path: "/teams/1/1" } })).toEqual({});
  });

  it("drops how it was first opened", () => {
    expect(teamStateToRestore({ from: "game", playsFrom: "key" })).toEqual({});
  });

  it("anything else is nothing to restore", () => {
    expect(teamStateToRestore(null)).toEqual({});
    expect(teamStateToRestore("x")).toEqual({});
  });
});
