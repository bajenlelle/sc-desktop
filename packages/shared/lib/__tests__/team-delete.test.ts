import { describe, expect, it } from "vitest";
import { teamDeleteWarning, type TeamDeleteImpact } from "../team-delete";

const impact = (partial: Partial<TeamDeleteImpact> = {}): TeamDeleteImpact => ({
  memberCount: 0,
  sharedPlaylistCount: 0,
  inviteLinkCount: 0,
  ...partial,
});

describe("teamDeleteWarning", () => {
  it("leads with the lost playlists — the consequence an admin least expects", () => {
    const text = teamDeleteWarning(impact({ memberCount: 12, sharedPlaylistCount: 7 }));
    expect(text).toBe(
      "Players lose access to 7 playlists shared with this team. " +
        "This removes 12 members from the team. This can't be undone.",
    );
  });

  it("always states irreversibility, even for an empty team", () => {
    expect(teamDeleteWarning(impact())).toBe("This can't be undone.");
  });

  it("never claims to remove anything that isn't there", () => {
    const text = teamDeleteWarning(impact());
    expect(text).not.toMatch(/member|playlist|invite/);
  });

  it("singularizes every count", () => {
    expect(teamDeleteWarning(impact({ memberCount: 1, sharedPlaylistCount: 1, inviteLinkCount: 1 }))).toBe(
      "Players lose access to 1 playlist shared with this team. " +
        "This removes 1 member from the team. 1 invite link stops working. This can't be undone.",
    );
  });

  it("pluralizes every count, with subject-verb agreement on invite links", () => {
    const text = teamDeleteWarning(impact({ memberCount: 2, sharedPlaylistCount: 3, inviteLinkCount: 4 }));
    expect(text).toContain("3 playlists");
    expect(text).toContain("2 members");
    expect(text).toContain("4 invite links stop working.");
  });

  it("mentions members alone when nothing is shared", () => {
    expect(teamDeleteWarning(impact({ memberCount: 5 }))).toBe(
      "This removes 5 members from the team. This can't be undone.",
    );
  });

  it("mentions shared playlists even when the team has no members left", () => {
    expect(teamDeleteWarning(impact({ sharedPlaylistCount: 2 }))).toBe(
      "Players lose access to 2 playlists shared with this team. This can't be undone.",
    );
  });
});
