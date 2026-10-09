import { describe, expect, it } from "vitest";
import { nextShuttleRate, resolvePlayerKey } from "../player-keys";

const key = (code: string, mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  code,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("resolvePlayerKey", () => {
  it("maps the playback keys", () => {
    expect(resolvePlayerKey(key("ArrowDown"))).toBe("next");
    expect(resolvePlayerKey(key("ArrowUp"))).toBe("prev");
    expect(resolvePlayerKey(key("ArrowLeft"))).toBe("nudge-back");
    expect(resolvePlayerKey(key("ArrowRight"))).toBe("nudge-forward");
    expect(resolvePlayerKey(key("ArrowLeft", { shiftKey: true }))).toBe("nudge-back-far");
    expect(resolvePlayerKey(key("KeyJ"))).toBe("shuttle-back");
    expect(resolvePlayerKey(key("KeyK"))).toBe("shuttle-pause");
    expect(resolvePlayerKey(key("KeyL"))).toBe("shuttle-forward");
    expect(resolvePlayerKey(key("KeyR"))).toBe("replay");
    expect(resolvePlayerKey(key("Space"))).toBe("toggle-play");
    expect(resolvePlayerKey(key("KeyF"))).toBe("fullscreen");
    expect(resolvePlayerKey(key("Escape"))).toBe("escape");
    expect(resolvePlayerKey(key("Backspace"))).toBe("remove");
    expect(resolvePlayerKey(key("Delete"))).toBe("remove");
  });

  it("leaves native menu chords alone, except select-all", () => {
    expect(resolvePlayerKey(key("KeyF", { metaKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("KeyB", { metaKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("ArrowDown", { ctrlKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("KeyA", { metaKey: true }))).toBe("select-all");
    expect(resolvePlayerKey(key("KeyA", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("KeyA"))).toBeNull();
  });

  it("maps the clip list's table keys", () => {
    expect(resolvePlayerKey(key("ArrowDown", { shiftKey: true }))).toBe("extend-next");
    expect(resolvePlayerKey(key("ArrowUp", { shiftKey: true }))).toBe("extend-prev");
    expect(resolvePlayerKey(key("ArrowUp", { metaKey: true }))).toBe("first");
    expect(resolvePlayerKey(key("ArrowDown", { metaKey: true }))).toBe("last");
    expect(resolvePlayerKey(key("ArrowUp", { metaKey: true, shiftKey: true }))).toBe("extend-first");
    expect(resolvePlayerKey(key("ArrowDown", { metaKey: true, shiftKey: true }))).toBe("extend-last");
    expect(resolvePlayerKey(key("Home"))).toBe("first");
    expect(resolvePlayerKey(key("End"))).toBe("last");
    expect(resolvePlayerKey(key("Home", { shiftKey: true }))).toBe("extend-first");
    expect(resolvePlayerKey(key("End", { shiftKey: true }))).toBe("extend-last");
    expect(resolvePlayerKey(key("Enter"))).toBe("play-focused");
    expect(resolvePlayerKey(key("NumpadEnter"))).toBe("play-focused");
    expect(resolvePlayerKey(key("Enter", { shiftKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("F10", { shiftKey: true }))).toBe("row-menu");
    expect(resolvePlayerKey(key("F10"))).toBeNull();
    expect(resolvePlayerKey(key("ContextMenu"))).toBe("row-menu");
    expect(resolvePlayerKey(key("KeyT"))).toBe("trim");
    expect(resolvePlayerKey(key("KeyT", { shiftKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("KeyT", { metaKey: true }))).toBeNull();
  });

  it("leaves Control-arrows and option chords to the system", () => {
    expect(resolvePlayerKey(key("ArrowUp", { ctrlKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("ArrowDown", { metaKey: true, altKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("KeyA", { metaKey: true, altKey: true }))).toBeNull();
  });

  it("ignores option chords and unknown keys", () => {
    expect(resolvePlayerKey(key("Space", { altKey: true }))).toBeNull();
    expect(resolvePlayerKey(key("KeyQ"))).toBeNull();
  });
});

describe("nextShuttleRate", () => {
  it("cycles 1 → 1.5 → 2 → 1", () => {
    expect(nextShuttleRate(1)).toBe(1.5);
    expect(nextShuttleRate(1.5)).toBe(2);
    expect(nextShuttleRate(2)).toBe(1);
  });

  it("starts the cycle from an unknown rate", () => {
    expect(nextShuttleRate(0.5)).toBe(1);
  });
});
