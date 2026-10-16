import { describe, expect, it } from "vitest";
import { activeDestination, sidebarDestinations, tabDestinations, type NavUser } from "../app-nav";

const base: NavUser = {
  isPlayerOnly: false,
  hasSpace: true,
  activeOrgIsPersonal: false,
  activeOrgRole: "coach",
  isPlatformAdmin: false,
};

const labels = (user: NavUser) => sidebarDestinations(user).map((d) => d.label);
const tabs = (user: NavUser) => tabDestinations(user).map((d) => d.label);

describe("sidebarDestinations", () => {
  it("gives player-only users their playlists and highlights, whatever space is active", () => {
    const player = { ...base, isPlayerOnly: true, activeOrgRole: "player" as const };
    expect(labels(player)).toEqual(["My playlists", "My highlights"]);
    expect(labels({ ...player, activeOrgIsPersonal: true, activeOrgRole: "admin" })).toEqual([
      "My playlists",
      "My highlights",
    ]);
  });

  it("gives club staff the shared playlists and the club", () => {
    expect(labels(base)).toEqual(["Shared playlists", "Club"]);
    expect(labels({ ...base, activeOrgRole: "admin" })).toEqual(["Shared playlists", "Club"]);
  });

  it("gives a player in a club space (who also coaches elsewhere) their playlists only", () => {
    expect(labels({ ...base, activeOrgRole: "player" })).toEqual(["My playlists"]);
    expect(sidebarDestinations({ ...base, activeOrgRole: "player" })[0].id).toBe("playlists");
    expect(sidebarDestinations(base)[0].id).toBe("shared-playlists");
  });

  it("sends a personal space to get started, never to playlists or a club", () => {
    expect(labels({ ...base, activeOrgIsPersonal: true, activeOrgRole: "admin" })).toEqual(["Get started"]);
  });

  it("adds Admin last for platform admins", () => {
    expect(labels({ ...base, isPlatformAdmin: true })).toEqual(["Shared playlists", "Club", "Admin"]);
    expect(labels({ ...base, activeOrgIsPersonal: true, isPlatformAdmin: true })).toEqual(["Get started", "Admin"]);
    expect(labels({ ...base, isPlayerOnly: true, isPlatformAdmin: true })).toEqual([
      "My playlists",
      "My highlights",
      "Admin",
    ]);
  });

  it("offers nothing but Admin to a user without a space", () => {
    expect(labels({ ...base, hasSpace: false, activeOrgRole: null })).toEqual([]);
    expect(labels({ ...base, hasSpace: false, activeOrgRole: null, isPlatformAdmin: true })).toEqual(["Admin"]);
  });

  it("links each destination to its page", () => {
    const all = sidebarDestinations({ ...base, isPlatformAdmin: true });
    expect(all.map((d) => d.href)).toEqual(["/my-playlists", "/organization", "/admin"]);
    expect(sidebarDestinations({ ...base, isPlayerOnly: true })[1].href).toBe("/my-highlights");
  });
});

describe("tabDestinations", () => {
  it("ends with Profile for every user", () => {
    expect(tabs({ ...base, isPlayerOnly: true })).toEqual(["My playlists", "My highlights", "Profile"]);
    expect(tabs(base)).toEqual(["Shared playlists", "Club", "Profile"]);
    expect(tabs({ ...base, isPlatformAdmin: true })).toEqual(["Shared playlists", "Club", "Admin", "Profile"]);
    expect(tabs({ ...base, hasSpace: false, activeOrgRole: null })).toEqual(["Profile"]);
  });
});

describe("activeDestination", () => {
  const all = tabDestinations({ ...base, isPlatformAdmin: true });

  it("matches a destination's page and the pages under it", () => {
    expect(activeDestination("/my-playlists", all)).toBe("shared-playlists");
    expect(activeDestination("/admin", all)).toBe("admin");
    expect(activeDestination("/admin/orgs/42", all)).toBe("admin");
    expect(activeDestination("/organization", all)).toBe("club");
    expect(activeDestination("/profile", all)).toBe("profile");
  });

  it("matches nothing for pages outside the navigation or lookalike paths", () => {
    expect(activeDestination("/onboarding", all)).toBeNull();
    expect(activeDestination("/my-playlistsx", all)).toBeNull();
    expect(activeDestination("/my-highlights", all)).toBeNull();
  });
});
