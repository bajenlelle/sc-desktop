import { describe, expect, it } from "vitest";
import { rememberablePath, startPath, type StartInput } from "../start-page";

const base: StartInput = { remembered: null, openGameIds: [], clubPlayer: false, personal: false };

describe("rememberablePath", () => {
  it("keeps the pages worth reopening as given", () => {
    for (const p of ["/playlists", "/reports", "/my-playlists", "/matches", "/matches/abc", "/teams", "/teams/12/34"]) {
      expect(rememberablePath(p)).toBe(p);
    }
  });

  it("drops everything else", () => {
    for (const p of ["/", "/upload", "/settings/move-to-club", "/profile", "/organization", "/auth/login", "/onboarding", "/teams/find/9", "/matches/abc/extra"]) {
      expect(rememberablePath(p)).toBeNull();
    }
  });
});

describe("startPath", () => {
  it("opens Playlists with nothing remembered", () => {
    expect(startPath(base)).toEqual({ path: "/playlists", restored: false });
  });

  it("opens My playlists for a club player, whatever was remembered", () => {
    expect(startPath({ ...base, clubPlayer: true, remembered: "/reports" })).toEqual({ path: "/my-playlists", restored: false });
  });

  it("restores a remembered page", () => {
    expect(startPath({ ...base, remembered: "/reports" })).toEqual({ path: "/reports", restored: true });
  });

  it("restores a game only while it is still open", () => {
    expect(startPath({ ...base, remembered: "/matches/g1", openGameIds: ["g1"] })).toEqual({ path: "/matches/g1", restored: true });
    expect(startPath({ ...base, remembered: "/matches/g1", openGameIds: [] })).toEqual({ path: "/matches", restored: false });
  });

  it("does not restore My playlists in a personal space", () => {
    expect(startPath({ ...base, remembered: "/my-playlists", personal: true })).toEqual({ path: "/playlists", restored: false });
  });

  it("ignores a path that is not rememberable", () => {
    expect(startPath({ ...base, remembered: "/upload" })).toEqual({ path: "/playlists", restored: false });
  });
});
