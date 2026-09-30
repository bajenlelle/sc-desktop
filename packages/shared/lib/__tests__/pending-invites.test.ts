import { describe, expect, it } from "vitest";
import { canManageInvite, inviteExpiryLabel, pendingEmailInvites } from "../pending-invites";
import type { OrgInvite } from "../../types/org";

function invite(partial: Partial<OrgInvite>): OrgInvite {
  return {
    id: "i1",
    orgId: "o1",
    code: "ABC123",
    role: "player",
    createdBy: "u1",
    createdAt: "2026-09-01T10:00:00Z",
    expiresAt: "2026-09-08T10:00:00Z",
    usedCount: 0,
    maxUses: 1,
    isNationalTeam: false,
    teamId: null,
    email: "anna@x.se",
    ...partial,
  };
}

describe("pendingEmailInvites", () => {
  it("keeps unused emailed invites, expired included, newest first", () => {
    const list = pendingEmailInvites([
      invite({ id: "old", createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-08T00:00:00Z" }),
      invite({ id: "new", createdAt: "2026-09-10T00:00:00Z" }),
      invite({ id: "accepted", usedCount: 1 }),
      invite({ id: "link", email: null, maxUses: null }),
    ]);
    expect(list.map((i) => i.id)).toEqual(["new", "old"]);
  });
});

describe("inviteExpiryLabel", () => {
  const now = new Date("2026-09-01T12:00:00Z").getTime();
  it("counts whole days left", () => {
    expect(inviteExpiryLabel("2026-09-06T13:00:00Z", now)).toBe("Expires in 5 days");
    expect(inviteExpiryLabel("2026-09-02T13:00:00Z", now)).toBe("Expires in 1 day");
    expect(inviteExpiryLabel("2026-09-01T18:00:00Z", now)).toBe("Expires today");
  });
  it("handles expired and open-ended invites", () => {
    expect(inviteExpiryLabel("2026-09-01T11:00:00Z", now)).toBe("Expired");
    expect(inviteExpiryLabel(null, now)).toBe("No expiry");
  });
});

describe("canManageInvite", () => {
  it("lets coaches manage coach and player invites, not admin ones", () => {
    expect(canManageInvite({ role: "player" }, false)).toBe(true);
    expect(canManageInvite({ role: "coach" }, false)).toBe(true);
    expect(canManageInvite({ role: "admin" }, false)).toBe(false);
    expect(canManageInvite({ role: "admin" }, true)).toBe(true);
  });
});
