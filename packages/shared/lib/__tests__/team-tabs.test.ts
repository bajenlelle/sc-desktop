import { describe, expect, it } from "vitest";
import { teamTabId, teamTabOfPath, teamTabPath } from "../team-tabs";

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
