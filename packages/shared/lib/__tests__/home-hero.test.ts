import { describe, expect, it } from "vitest";
import { computeHomeHero, type HomeHeroInput } from "../home-hero";

const base: HomeHeroInput = {
  ownGameCount: 1,
  demoMatchId: null,
  playlists: [],
  isClubSpace: true,
  hasSharedAny: false,
  behindCount: 0,
  hasExported: false,
};

const pl = (id: string, clipCount: number) => ({ id, name: `Playlist ${id}`, clipCount });

describe("computeHomeHero", () => {
  it("asks for the first import before anything else", () => {
    const hero = computeHomeHero({
      ...base,
      ownGameCount: 0,
      demoMatchId: "demo-1",
      playlists: [pl("a", 5)],
      hasSharedAny: true,
    });
    expect(hero).toEqual({ kind: "import-first", demoMatchId: "demo-1" });
  });

  it("suggests building a playlist once a game exists", () => {
    expect(computeHomeHero(base)).toEqual({ kind: "build-playlist" });
  });

  it("suggests adding clips when every playlist is empty, targeting the newest", () => {
    const hero = computeHomeHero({ ...base, playlists: [pl("new", 0), pl("old", 0)] });
    expect(hero).toEqual({ kind: "add-clips", playlist: pl("new", 0) });
  });

  it("club space: suggests sharing the newest playlist that has clips", () => {
    const hero = computeHomeHero({
      ...base,
      playlists: [pl("empty", 0), pl("full", 4)],
    });
    expect(hero).toEqual({ kind: "share", playlist: pl("full", 4) });
  });

  it("club space: nudges reminders when players are behind", () => {
    const hero = computeHomeHero({
      ...base,
      playlists: [pl("a", 4)],
      hasSharedAny: true,
      behindCount: 3,
    });
    expect(hero).toEqual({ kind: "remind", behindCount: 3 });
  });

  it("club space: caught up when shared and nobody is behind", () => {
    const hero = computeHomeHero({
      ...base,
      playlists: [pl("a", 4)],
      hasSharedAny: true,
    });
    expect(hero).toEqual({ kind: "caught-up" });
  });

  it("personal space: suggests exporting, then goes quiet once exported", () => {
    const personal: HomeHeroInput = {
      ...base,
      isClubSpace: false,
      playlists: [pl("a", 4)],
    };
    expect(computeHomeHero(personal)).toEqual({ kind: "export", playlist: pl("a", 4) });
    expect(computeHomeHero({ ...personal, hasExported: true })).toEqual({ kind: "caught-up" });
  });

  it("personal space: sharing state never appears", () => {
    const hero = computeHomeHero({
      ...base,
      isClubSpace: false,
      playlists: [pl("a", 4)],
      hasSharedAny: false,
      hasExported: true,
    });
    expect(hero.kind).toBe("caught-up");
  });
});
