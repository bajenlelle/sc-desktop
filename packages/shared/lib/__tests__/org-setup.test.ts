import { describe, expect, it } from "vitest";
import { deriveOrgSetupProgress } from "../org-setup";

const team = (id: string) => ({ id });
const member = (role: string) => ({ role });

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
});
