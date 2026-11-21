import { describe, expect, it } from "vitest";
import { GO_PAGES, goKeyOrder, isBrowserShortcut, menuIdForChord, sidebarPages, type KeyChord } from "../menu-shortcuts";

const chord = (key: string, mods: Partial<KeyChord> = {}): KeyChord => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("menuIdForChord", () => {
  it("maps every CmdOrCtrl accelerator in menu.rs when Ctrl is held", () => {
    const table: Array<[string, string]> = [
      [",", "settings"],
      ["n", "new-playlist"],
      ["o", "add-game"],
      ["e", "export-playlist"],
      ["b", "toggle-playlist-browser"],
      ["=", "zoom-in"],
      ["-", "zoom-out"],
      ["0", "zoom-reset"],
      // The sidebar's pages when every row is shown (a coach in a club): Playlists, Reports, Shared playlists, Library, Teams.
      ["1", "go-playlists"],
      ["2", "go-reports"],
      ["3", "go-my-playlists"],
      ["4", "go-library"],
      ["5", "go-teams"],
      ["6", "go-organization"],
      ["w", "close-tab"],
      ["t", "new-game-tab"],
      ["k", "search"],
    ];
    for (const [key, id] of table) {
      expect(menuIdForChord(chord(key, { ctrlKey: true })), key).toBe(id);
    }
  });

  it("requires Shift for fullscreen-player and accepts the uppercase key the browser reports", () => {
    expect(menuIdForChord(chord("F", { ctrlKey: true, shiftKey: true }))).toBe("fullscreen-player");
    expect(menuIdForChord(chord("f", { ctrlKey: true }))).toBeNull();
  });

  it("maps Shift with [ and ] to the game tabs, shifted or not", () => {
    expect(menuIdForChord(chord("{", { ctrlKey: true, shiftKey: true }))).toBe("game-tab-prev");
    expect(menuIdForChord(chord("[", { ctrlKey: true, shiftKey: true }))).toBe("game-tab-prev");
    expect(menuIdForChord(chord("}", { ctrlKey: true, shiftKey: true }))).toBe("game-tab-next");
    expect(menuIdForChord(chord("]", { metaKey: true, shiftKey: true }))).toBe("game-tab-next");
    expect(menuIdForChord(chord("[", { ctrlKey: true }))).toBeNull();
  });

  it("treats Cmd like Ctrl, matching CmdOrCtrl", () => {
    expect(menuIdForChord(chord("n", { metaKey: true }))).toBe("new-playlist");
  });

  it("maps Shift with T to reopening a closed game tab, and T alone to a new one", () => {
    expect(menuIdForChord(chord("T", { ctrlKey: true, shiftKey: true }))).toBe("reopen-game-tab");
    expect(menuIdForChord(chord("g", { ctrlKey: true }))).toBe("show-clip-in-game");
    expect(menuIdForChord(chord("t", { ctrlKey: true, shiftKey: true }))).toBe("reopen-game-tab");
    expect(menuIdForChord(chord("t", { ctrlKey: true }))).toBe("new-game-tab");
  });

  it("accepts + for zoom in — Swedish keyboards only reach = through Shift", () => {
    expect(menuIdForChord(chord("+", { ctrlKey: true }))).toBe("zoom-in");
    expect(menuIdForChord(chord("=", { ctrlKey: true, shiftKey: true }))).toBe("zoom-in");
  });

  it("ignores chords without a command modifier, or with Alt", () => {
    expect(menuIdForChord(chord("n"))).toBeNull();
    expect(menuIdForChord(chord("n", { shiftKey: true }))).toBeNull();
    expect(menuIdForChord(chord("n", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("does not let Shift promote a plain letter shortcut", () => {
    // Ctrl+Shift+N is not Ctrl+N; only fullscreen-player is a Shift chord.
    expect(menuIdForChord(chord("N", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("isBrowserShortcut", () => {
  it("flags the WebView2 keys that would reload or print the app", () => {
    expect(isBrowserShortcut(chord("F5"))).toBe(true);
    expect(isBrowserShortcut(chord("r", { ctrlKey: true }))).toBe(true);
    expect(isBrowserShortcut(chord("R", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isBrowserShortcut(chord("p", { ctrlKey: true }))).toBe(true);
  });

  it("leaves ordinary editing keys alone", () => {
    expect(isBrowserShortcut(chord("c", { ctrlKey: true }))).toBe(false);
    expect(isBrowserShortcut(chord("r"))).toBe(false);
    expect(isBrowserShortcut(chord("F2"))).toBe(false);
  });
});

const coachInClub = { staff: true, personal: false };
const coachAlone = { staff: true, personal: true };
const playerInClub = { staff: false, personal: false };

describe("sidebarPages", () => {
  it("is every page for a coach in a club, in the sidebar's order", () => {
    expect(sidebarPages(coachInClub)).toEqual(["go-playlists", "go-reports", "go-my-playlists", "go-library", "go-teams"]);
    expect(sidebarPages(coachInClub)).toEqual([...GO_PAGES]);
  });

  it("has no shared playlists in a personal space", () => {
    expect(sidebarPages(coachAlone)).toEqual(["go-playlists", "go-reports", "go-library", "go-teams"]);
  });

  it("is only their playlists for a player in a club: no Teams row", () => {
    expect(sidebarPages(playerInClub)).toEqual(["go-my-playlists"]);
  });
});

describe("goKeyOrder", () => {
  it("gives the rows shown the first keys in the sidebar's order, and the pages not shown the keys after them", () => {
    expect(goKeyOrder(coachInClub)).toEqual(["go-playlists", "go-reports", "go-my-playlists", "go-library", "go-teams"]);
    expect(goKeyOrder(coachAlone)).toEqual(["go-playlists", "go-reports", "go-library", "go-teams", "go-my-playlists"]);
    expect(goKeyOrder(playerInClub)).toEqual(["go-my-playlists", "go-playlists", "go-reports", "go-library", "go-teams"]);
  });

  it("always holds every page once, so each keeps a key of its own", () => {
    for (const who of [coachInClub, coachAlone, playerInClub, { staff: false, personal: true }]) {
      expect([...goKeyOrder(who)].sort()).toEqual([...GO_PAGES].sort());
    }
  });
});

describe("menuIdForChord with the rows a sidebar shows", () => {
  const press = (key: string, who: { staff: boolean; personal: boolean }) => menuIdForChord(chord(key, { ctrlKey: true }), goKeyOrder(who));

  it("opens the nth row: the Library is the third in a personal space and the fourth in a club", () => {
    expect(press("3", coachAlone)).toBe("go-library");
    expect(press("4", coachInClub)).toBe("go-library");
    expect(press("3", coachInClub)).toBe("go-my-playlists");
  });

  it("opens a player's playlists with the first key", () => {
    expect(press("1", playerInClub)).toBe("go-my-playlists");
  });

  it("opens Teams with the fifth key in a club and the fourth in a personal space", () => {
    expect(press("5", coachInClub)).toBe("go-teams");
    expect(press("4", coachAlone)).toBe("go-teams");
  });

  it("opens Playlists with the first key, for a coach in a club or on their own", () => {
    expect(press("1", coachInClub)).toBe("go-playlists");
    expect(press("1", coachAlone)).toBe("go-playlists");
  });

  it("keeps Organization on 6, after the rows, whatever they are", () => {
    for (const who of [coachInClub, coachAlone, playerInClub]) expect(press("6", who)).toBe("go-organization");
  });
});
