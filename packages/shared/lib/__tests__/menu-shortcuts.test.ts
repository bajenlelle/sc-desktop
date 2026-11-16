import { describe, expect, it } from "vitest";
import { isBrowserShortcut, menuIdForChord, type KeyChord } from "../menu-shortcuts";

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
      // The Go menu's pages, numbered in the sidebar's order: Home, Playlists, Reports, Shared playlists, Library.
      ["1", "go-home"],
      ["2", "go-playlists"],
      ["3", "go-reports"],
      ["4", "go-my-playlists"],
      ["5", "go-library"],
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
