import { describe, expect, it } from "vitest";
import { deriveOrgSetupProgress, type OrgSetupInvite } from "../org-setup";

const team = (id: string) => ({ id });
const member = (role: string) => ({ role });
const invite = (
  role: string,
  fields: Partial<Pick<OrgSetupInvite, "email" | "copiedAt">> = {},
): OrgSetupInvite => ({ role, email: null, copiedAt: null, ...fields });

describe("deriveOrgSetupProgress", () => {
  it("empty org: every step pending, doneCount 0", () => {
    expect(deriveOrgSetupProgress([], [])).toEqual({
      teamsDone: false,
      coachesDone: false,
      playersDone: false,
      doneCount: 0,
      total: 3,
      allDone: false,
    });
  });

  it("teams alone only complete the teams step", () => {
    const progress = deriveOrgSetupProgress([team("t1")], []);
    expect(progress).toEqual({
      teamsDone: true,
      coachesDone: false,
      playersDone: false,
      doneCount: 1,
      total: 3,
      allDone: false,
    });
  });

  it("admin members do not count toward the coaches step", () => {
    const progress = deriveOrgSetupProgress([], [member("admin")]);
    expect(progress.coachesDone).toBe(false);
    expect(progress.doneCount).toBe(0);
  });

  it("a coach member completes the coaches step", () => {
    const progress = deriveOrgSetupProgress([], [member("admin"), member("coach")]);
    expect(progress.coachesDone).toBe(true);
    expect(progress.playersDone).toBe(false);
    expect(progress.doneCount).toBe(1);
  });

  it("a player member completes the players step", () => {
    const progress = deriveOrgSetupProgress([], [member("player")]);
    expect(progress.playersDone).toBe(true);
    expect(progress.coachesDone).toBe(false);
    expect(progress.doneCount).toBe(1);
  });

  it("fully set-up org: all steps done, 3 of 3", () => {
    const progress = deriveOrgSetupProgress(
      [team("t1"), team("t2")],
      [member("admin"), member("coach"), member("player")],
    );
    expect(progress).toEqual({
      teamsDone: true,
      coachesDone: true,
      playersDone: true,
      doneCount: 3,
      total: 3,
      allDone: true,
    });
  });

  describe("invites (third argument)", () => {
    it("a coach email invite completes the coaches step with zero coach members", () => {
      const progress = deriveOrgSetupProgress([], [], [
        invite("coach", { email: "coach@club.se" }),
      ]);
      expect(progress.coachesDone).toBe(true);
      expect(progress.playersDone).toBe(false);
      expect(progress.doneCount).toBe(1);
    });

    it("a copied coach invite link completes the coaches step", () => {
      const progress = deriveOrgSetupProgress([], [], [
        invite("coach", { copiedAt: "2026-09-05T10:00:00Z" }),
      ]);
      expect(progress.coachesDone).toBe(true);
      expect(progress.doneCount).toBe(1);
    });

    it("a player email invite completes the players step", () => {
      const progress = deriveOrgSetupProgress([], [], [
        invite("player", { email: "player@club.se" }),
      ]);
      expect(progress.playersDone).toBe(true);
      expect(progress.coachesDone).toBe(false);
      expect(progress.doneCount).toBe(1);
    });

    it("a copied player invite link completes the players step", () => {
      const progress = deriveOrgSetupProgress([], [], [
        invite("player", { copiedAt: "2026-09-05T10:00:00Z" }),
      ]);
      expect(progress.playersDone).toBe(true);
      expect(progress.doneCount).toBe(1);
    });

    it("an untouched link row (no email, never copied) does not complete a step", () => {
      // The invite modal eagerly creates a link row on open; row existence
      // alone must never self-complete the step.
      const progress = deriveOrgSetupProgress([], [], [
        invite("coach"),
        invite("player"),
      ]);
      expect(progress.coachesDone).toBe(false);
      expect(progress.playersDone).toBe(false);
      expect(progress.doneCount).toBe(0);
    });

    it("a player invite does not complete the coaches step, and vice versa", () => {
      const viaPlayer = deriveOrgSetupProgress([], [], [
        invite("player", { email: "player@club.se" }),
      ]);
      expect(viaPlayer.coachesDone).toBe(false);

      const viaCoach = deriveOrgSetupProgress([], [], [
        invite("coach", { email: "coach@club.se" }),
      ]);
      expect(viaCoach.playersDone).toBe(false);
    });

    it("teams + coach invite + player invite: all steps done, allDone true", () => {
      const progress = deriveOrgSetupProgress([team("t1")], [], [
        invite("coach", { copiedAt: "2026-09-05T10:00:00Z" }),
        invite("player", { email: "player@club.se" }),
      ]);
      expect(progress).toEqual({
        teamsDone: true,
        coachesDone: true,
        playersDone: true,
        doneCount: 3,
        total: 3,
        allDone: true,
      });
    });
  });
});
