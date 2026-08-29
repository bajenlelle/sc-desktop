import { describe, expect, it } from "vitest";
import { isPlayerOnly, sortOrgsClubFirst } from "../orgs";
import type { OrgMembership } from "../../types/org";

function om(partial: Partial<OrgMembership>): OrgMembership {
  return {
    orgId: "o1",
    orgName: "Bajen",
    role: "coach",
    isNtOrg: false,
    planTier: "free",
    isPersonal: false,
    ...partial,
  };
}

describe("sortOrgsClubFirst", () => {
  it("puts club orgs before personal, each group sorted by orgName", () => {
    const sorted = sortOrgsClubFirst([
      om({ orgId: "p1", orgName: "Aaa Personal", isPersonal: true }),
      om({ orgId: "c1", orgName: "Vasa" }),
      om({ orgId: "c2", orgName: "Alvik" }),
    ]);
    expect(sorted.map((o) => o.orgId)).toEqual(["c2", "c1", "p1"]);
  });

  it("sorts personal orgs among themselves by name too", () => {
    const sorted = sortOrgsClubFirst([
      om({ orgId: "p2", orgName: "Zeta", isPersonal: true }),
      om({ orgId: "p1", orgName: "Alpha", isPersonal: true }),
      om({ orgId: "c1", orgName: "Bajen" }),
    ]);
    expect(sorted.map((o) => o.orgId)).toEqual(["c1", "p1", "p2"]);
  });

  it("keeps insertion order for identically named orgs (stable sort)", () => {
    const sorted = sortOrgsClubFirst([
      om({ orgId: "first", orgName: "Bajen" }),
      om({ orgId: "second", orgName: "Bajen" }),
    ]);
    expect(sorted.map((o) => o.orgId)).toEqual(["first", "second"]);
  });

  it("returns a new array without mutating the input", () => {
    const input = [
      om({ orgId: "p1", orgName: "Me", isPersonal: true }),
      om({ orgId: "c1", orgName: "Bajen" }),
    ];
    const sorted = sortOrgsClubFirst(input);
    expect(sorted).not.toBe(input);
    expect(input.map((o) => o.orgId)).toEqual(["p1", "c1"]);
    expect(sorted[0]).toBe(input[1]); // same membership objects, just reordered
  });

  it("handles an empty list", () => {
    expect(sortOrgsClubFirst([])).toEqual([]);
  });
});

describe("isPlayerOnly", () => {
  it("is true when every club membership is player", () => {
    expect(isPlayerOnly([om({ role: "player" })])).toBe(true);
    expect(
      isPlayerOnly([
        om({ orgId: "c1", role: "player" }),
        om({ orgId: "c2", orgName: "Alvik", role: "player" }),
      ]),
    ).toBe(true);
  });

  it("ignores personal orgs — even with a non-player role", () => {
    expect(
      isPlayerOnly([
        om({ orgId: "c1", role: "player" }),
        om({ orgId: "p1", orgName: "Me", role: "coach", isPersonal: true }),
      ]),
    ).toBe(true);
  });

  it("is false without at least one club org", () => {
    expect(isPlayerOnly([])).toBe(false);
    expect(isPlayerOnly([om({ role: "player", isPersonal: true })])).toBe(false);
  });

  it("is false when any club role is coach or admin", () => {
    expect(
      isPlayerOnly([
        om({ orgId: "c1", role: "player" }),
        om({ orgId: "c2", orgName: "Alvik", role: "coach" }),
      ]),
    ).toBe(false);
    expect(isPlayerOnly([om({ role: "admin" })])).toBe(false);
  });
});
