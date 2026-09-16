import { describe, expect, it } from "vitest";
import { isPlayerOnly, resolveGateState, sortOrgsClubFirst } from "../orgs";
import type { GateSnapshot } from "../orgs";
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

/** A healthy, signed-in user with one personal org and nothing wrong. */
function snap(partial: Partial<GateSnapshot> = {}): GateSnapshot {
  return {
    hasUser: true,
    sessionLoading: false,
    profileLoading: false,
    hasProfile: true,
    orgsLoaded: true,
    orgCount: 1,
    deviceBlocked: false,
    ...partial,
  };
}

describe("resolveGateState", () => {
  it("renders the app for a signed-in user whose only org is personal", () => {
    expect(resolveGateState(snap())).toBe("app");
  });

  it("NEVER blocks a user who belongs to no club — the whole point", () => {
    // Regression guard: this snapshot is what a healthy club-less user looks
    // like, and it used to redirect to the full-screen invite-code page.
    expect(resolveGateState(snap({ orgCount: 0 }))).toBe("app");
  });

  it("treats an unknown org list as retryable, not as 'no orgs'", () => {
    // The org read failed. Before, this was indistinguishable from a user
    // with zero memberships and produced the invite-code wall.
    expect(resolveGateState(snap({ orgsLoaded: false, orgCount: 0 }))).toBe("unavailable");
  });

  it("treats a missing profile as retryable rather than an inert shell", () => {
    expect(resolveGateState(snap({ hasProfile: false }))).toBe("unavailable");
  });

  it("waits while the session or the first profile load is in flight", () => {
    expect(resolveGateState(snap({ sessionLoading: true }))).toBe("loading");
    expect(resolveGateState(snap({ profileLoading: true }))).toBe("loading");
  });

  it("sends a signed-out visitor to login, even mid-load", () => {
    expect(resolveGateState(snap({ hasUser: false }))).toBe("login");
    expect(resolveGateState(snap({ hasUser: false, profileLoading: true }))).toBe("login");
  });

  it("puts session checks ahead of everything else", () => {
    expect(resolveGateState(snap({ sessionLoading: true, hasUser: false }))).toBe("loading");
  });

  it("shows the device gate ahead of a failed read, since it is a real refusal", () => {
    expect(resolveGateState(snap({ deviceBlocked: true, orgsLoaded: false }))).toBe("device-blocked");
  });

  it("does not show the device gate to someone who isn't signed in", () => {
    expect(resolveGateState(snap({ hasUser: false, deviceBlocked: true }))).toBe("login");
  });

  it("never returns a state that demands an invite code", () => {
    // Exhaustive sweep of the flag space: no combination may produce a
    // blocking state purely because the user has no orgs.
    const bools = [true, false];
    for (const orgsLoaded of bools) {
      for (const hasProfile of bools) {
        for (const orgCount of [0, 1, 3]) {
          const state = resolveGateState(snap({ orgsLoaded, hasProfile, orgCount }));
          if (orgsLoaded && hasProfile) expect(state).toBe("app");
          else expect(state).toBe("unavailable");
        }
      }
    }
  });
});
