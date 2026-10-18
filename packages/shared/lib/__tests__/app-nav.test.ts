import { describe, expect, it } from "vitest";
import {
  MAX_TABS,
  activeDestination,
  canImportGames,
  isEditorUser,
  overflowDestinations,
  sidebarDestinations,
  tabDestinations,
  type ImportUser,
  type NavUser,
} from "../app-nav";

const base: NavUser = {
  isPlayerOnly: false,
  hasSpace: true,
  activeOrgIsPersonal: false,
  activeOrgRole: "coach",
  isPlatformAdmin: false,
  hasCloudGames: false,
  canImport: false,
};

const labels = (user: NavUser) => sidebarDestinations(user).map((d) => d.label);
const tabs = (user: NavUser) => tabDestinations(user).map((d) => d.label);
const player = { ...base, isPlayerOnly: true, activeOrgRole: "player" as const };
const clubPlayer = { ...base, activeOrgRole: "player" as const };
const personal = { ...base, activeOrgIsPersonal: true, activeOrgRole: "admin" as const };

describe("sidebarDestinations", () => {
  it("gives club staff the desktop's order: Home, Playlists, Shared playlists, Library, Club", () => {
    expect(labels(base)).toEqual(["Home", "Playlists", "Shared playlists", "Library", "Club"]);
    expect(labels({ ...base, activeOrgRole: "admin" })).toEqual(["Home", "Playlists", "Shared playlists", "Library", "Club"]);
    expect(sidebarDestinations(base).map((d) => d.id)).toEqual(["home", "editor", "shared-playlists", "library", "club"]);
  });

  it("gives a personal space Home, Playlists and Library, never a club or shared playlists", () => {
    expect(labels(personal)).toEqual(["Home", "Playlists", "Library"]);
    expect(labels({ ...personal, isPlatformAdmin: true })).toEqual(["Home", "Playlists", "Library", "Admin"]);
  });

  it("gives player-only users their playlists and highlights, whatever space is active", () => {
    expect(labels(player)).toEqual(["My playlists", "My highlights"]);
    expect(labels({ ...player, activeOrgIsPersonal: true, activeOrgRole: "admin" })).toEqual(["My playlists", "My highlights"]);
    expect(labels({ ...player, hasCloudGames: true })).toEqual(["My playlists", "Library", "My highlights"]);
  });

  it("gives a player in a club space (who also coaches elsewhere) the shared playlists, and the Library once they have a game", () => {
    expect(labels(clubPlayer)).toEqual(["My playlists"]);
    expect(sidebarDestinations(clubPlayer)[0].id).toBe("playlists");
    expect(labels({ ...clubPlayer, hasCloudGames: true })).toEqual(["My playlists", "Library"]);
  });

  it("shows the Library to staff and personal spaces whether or not they have a game yet", () => {
    expect(labels({ ...base, hasCloudGames: true, canImport: true })).toEqual(labels(base));
    expect(labels({ ...personal, hasCloudGames: false, canImport: false })).toContain("Library");
  });

  it("adds Admin last for platform admins", () => {
    expect(labels({ ...base, isPlatformAdmin: true })).toEqual(["Home", "Playlists", "Shared playlists", "Library", "Club", "Admin"]);
    expect(labels({ ...player, isPlatformAdmin: true })).toEqual(["My playlists", "My highlights", "Admin"]);
  });

  it("offers nothing but Admin to a user without a space", () => {
    expect(labels({ ...base, hasSpace: false, activeOrgRole: null })).toEqual([]);
    expect(labels({ ...base, hasSpace: false, activeOrgRole: null, isPlatformAdmin: true })).toEqual(["Admin"]);
    expect(labels({ ...base, hasSpace: false, activeOrgRole: null, hasCloudGames: true })).toEqual([]);
  });

  it("links each destination to its page", () => {
    expect(sidebarDestinations({ ...base, isPlatformAdmin: true }).map((d) => d.href)).toEqual([
      "/home",
      "/playlists",
      "/my-playlists",
      "/library",
      "/organization",
      "/admin",
    ]);
    expect(sidebarDestinations({ ...player, hasCloudGames: true }).map((d) => d.href)).toEqual(["/my-playlists", "/library", "/my-highlights"]);
  });

  it("knows who builds playlists on the web", () => {
    expect(isEditorUser(base)).toBe(true);
    expect(isEditorUser(personal)).toBe(true);
    expect(isEditorUser(clubPlayer)).toBe(false);
    expect(isEditorUser(player)).toBe(false);
    expect(isEditorUser({ ...base, hasSpace: false, activeOrgRole: null })).toBe(false);
  });
});

describe("tabDestinations", () => {
  it("ends with Profile for every user", () => {
    expect(tabs(player)).toEqual(["My playlists", "My highlights", "Profile"]);
    expect(tabs(personal)).toEqual(["Home", "Playlists", "Library", "Profile"]);
    expect(tabs({ ...base, hasSpace: false, activeOrgRole: null })).toEqual(["Profile"]);
  });

  it("holds at most five tabs, dropping Club and then Admin before anything else", () => {
    expect(MAX_TABS).toBe(5);
    // Six sidebar rows + Profile: Club goes, then Admin.
    expect(tabs(base)).toEqual(["Home", "Playlists", "Shared playlists", "Library", "Profile"]);
    expect(tabs({ ...base, isPlatformAdmin: true })).toEqual(["Home", "Playlists", "Shared playlists", "Library", "Profile"]);
    // Four rows + Profile fit, Admin stays.
    expect(tabs({ ...personal, isPlatformAdmin: true })).toEqual(["Home", "Playlists", "Library", "Admin", "Profile"]);
    expect(tabs({ ...player, hasCloudGames: true, isPlatformAdmin: true })).toEqual(["My playlists", "Library", "My highlights", "Admin", "Profile"]);
    for (const u of [base, personal, player, clubPlayer, { ...base, isPlatformAdmin: true }, { ...player, hasCloudGames: true, isPlatformAdmin: true }]) {
      expect(tabDestinations(u).length).toBeLessThanOrEqual(MAX_TABS);
    }
  });

  it("names the dropped destinations in sidebar order so the Profile page can list them", () => {
    expect(overflowDestinations(base).map((d) => d.id)).toEqual(["club"]);
    expect(overflowDestinations({ ...base, isPlatformAdmin: true }).map((d) => d.id)).toEqual(["club", "admin"]);
    expect(overflowDestinations(personal)).toEqual([]);
    expect(overflowDestinations({ ...personal, isPlatformAdmin: true })).toEqual([]);
    expect(overflowDestinations(player)).toEqual([]);
  });
});

describe("activeDestination", () => {
  const all = sidebarDestinations({ ...base, isPlatformAdmin: true });

  it("matches a destination's page and the pages under it", () => {
    expect(activeDestination("/home", all)).toBe("home");
    expect(activeDestination("/playlists", all)).toBe("editor");
    expect(activeDestination("/playlists/abc-123", all)).toBe("editor");
    expect(activeDestination("/my-playlists", all)).toBe("shared-playlists");
    expect(activeDestination("/library", all)).toBe("library");
    expect(activeDestination("/library/2583394", all)).toBe("library");
    expect(activeDestination("/library/import", all)).toBe("library");
    expect(activeDestination("/admin/orgs/42", all)).toBe("admin");
    expect(activeDestination("/organization", all)).toBe("club");
    expect(activeDestination("/profile", tabDestinations(base))).toBe("profile");
  });

  it("matches nothing for pages outside the navigation or lookalike paths", () => {
    expect(activeDestination("/onboarding", all)).toBeNull();
    expect(activeDestination("/my-playlistsx", all)).toBeNull();
    expect(activeDestination("/playlistsx", all)).toBeNull();
    expect(activeDestination("/my-highlights", all)).toBeNull();
    expect(activeDestination("/games/1", all)).toBeNull();
  });
});

describe("canImportGames", () => {
  const coach: ImportUser = { isPlayerOnly: false, hasSpace: true, activeOrgIsPersonal: false, activeOrgRole: "coach", activeOrgIsNt: false };

  it("lets club staff and anyone in their personal space import", () => {
    expect(canImportGames(coach)).toBe(true);
    expect(canImportGames({ ...coach, activeOrgRole: "admin" })).toBe(true);
    expect(canImportGames({ ...coach, activeOrgIsPersonal: true, activeOrgRole: "admin" })).toBe(true);
  });

  it("refuses players, player-only users, national-team spaces and users without a space", () => {
    expect(canImportGames({ ...coach, activeOrgRole: "player" })).toBe(false);
    expect(canImportGames({ ...coach, isPlayerOnly: true, activeOrgRole: "player" })).toBe(false);
    expect(canImportGames({ ...coach, activeOrgIsNt: true })).toBe(false);
    expect(canImportGames({ ...coach, hasSpace: false, activeOrgRole: null })).toBe(false);
    // A player-only user in their personal space still can't: the import is a coach's tool.
    expect(canImportGames({ ...coach, isPlayerOnly: true, activeOrgIsPersonal: true, activeOrgRole: "admin" })).toBe(false);
  });
});
