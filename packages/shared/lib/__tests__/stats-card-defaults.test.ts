import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { statsCardSuggestion, statsCardTarget, type StatsClip } from "../stats-card-defaults";

type Person = NonNullable<PlayByPlayEvent["player"]>;
let nextId = 1;
function clip(matchId: string, player: Person | null): StatsClip {
  return {
    matchId,
    event: {
      eventId: nextId++,
      type: "2pt",
      subType: "jumpshot",
      period: 1,
      gameClockTime: "05:00",
      realWorldTime: "2026-10-12T18:00:00Z",
      isSuccessful: 1,
      qualifiers: [],
      ...(player ? { player } : {}),
    },
  };
}

const alva: Person = { playerId: 11, pno: 21, firstName: "Alva", familyName: "Berg", teamNumber: 1 };
const ines: Person = { playerId: 22, pno: 6, firstName: "Ines", familyName: "Ek", teamNumber: 2 };

describe("statsCardTarget", () => {
  it("takes a row's clip: its player, its game, the game's line", () => {
    const anchor = clip("m2", ines);
    const clips = [clip("m1", alva), clip("m1", alva), anchor];
    expect(statsCardTarget(clips, { anchor })).toEqual({ matchId: "m2", playerId: "22", events: [anchor.event], defaultScope: "game" });
  });

  it("falls back to the playlist's player when the row's clip has none", () => {
    const clips = [clip("m1", alva), clip("m1", alva)];
    expect(statsCardTarget(clips, { anchor: clip("m1", null) })?.playerId).toBe("11");
  });

  it("picks the player with the most clips, in their most-clipped game, first in the events", () => {
    const clips = [clip("m1", ines), clip("m1", alva), clip("m2", alva), clip("m2", alva)];
    const target = statsCardTarget(clips)!;
    expect(target.playerId).toBe("11");
    expect(target.matchId).toBe("m2");
    expect(target.events.map((e) => e.player?.playerId)).toEqual([11, 11, 11, 22]);
    expect(target.defaultScope).toBe("season");
  });

  it("gives a tie to the playing clip's player, and one game its line", () => {
    const clips = [clip("m1", alva), clip("m1", ines)];
    expect(statsCardTarget(clips)?.playerId).toBe("11");
    const target = statsCardTarget(clips, { activePlayerId: "22" })!;
    expect(target.playerId).toBe("22");
    expect(target.events[0].player?.playerId).toBe(22);
    expect(target.defaultScope).toBe("game");
  });

  it("has nothing to offer without a player", () => {
    expect(statsCardTarget([])).toBeNull();
    expect(statsCardTarget([clip("m1", null)])).toBeNull();
  });
});

describe("statsCardSuggestion", () => {
  const three = [clip("m1", alva), clip("m1", alva), clip("m1", alva), clip("m1", ines)];
  const open = { personal: true, dismissed: false, hasStatsCard: false };

  it("suggests one game's line once a player has three clips", () => {
    expect(statsCardSuggestion(three, open)).toEqual({ playerId: "11", severalGames: false, lineMatchId: "m1" });
    expect(statsCardSuggestion(three.slice(1), open)).toBeNull();
  });

  it("suggests season averages, with no single line, for clips from several games", () => {
    expect(statsCardSuggestion([...three, clip("m2", ines)], open)).toEqual({ playerId: "11", severalGames: true, lineMatchId: null });
  });

  it("stays away from club spaces, dismissed playlists and playlists that have a card", () => {
    expect(statsCardSuggestion(three, { ...open, personal: false })).toBeNull();
    expect(statsCardSuggestion(three, { ...open, dismissed: true })).toBeNull();
    expect(statsCardSuggestion(three, { ...open, hasStatsCard: true })).toBeNull();
  });
});
