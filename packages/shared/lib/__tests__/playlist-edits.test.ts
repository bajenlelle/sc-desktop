import { describe, expect, it } from "vitest";
import type { PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../../types/match";
import { fallbackText, type GameStatsCard } from "../stats-card";
import { cardInsertKey, groupItems, insertBefore, itemKey, newTextCard, ungroupItems } from "../playlist-edits";

const clip = (eventId: number, groupId?: string): PlaylistClipItem => ({ type: "clip", matchId: "m1", eventId, ...(groupId ? { groupId } : {}) });
const keys = (items: readonly PlaylistItem[]) => items.map(itemKey);
const groupsOf = (items: readonly PlaylistItem[]) => items.map((i) => i.groupId ?? null);
const sel = (...eventIds: number[]) => new Set(eventIds.map((e) => `m1:${e}`));

describe("groupItems", () => {
  it("pulls the selection together at the first member and gives it one group", () => {
    const out = groupItems([clip(1), clip(2), clip(3), clip(4), clip(5)], sel(1, 4), "g")!;
    expect(keys(out)).toEqual(["m1:1", "m1:4", "m1:2", "m1:3", "m1:5"]);
    expect(groupsOf(out)).toEqual(["g", "g", null, null, null]);
  });

  it("keeps the first member in place and pulls the rest up behind it", () => {
    const out = groupItems([clip(1), clip(2), clip(3), clip(4), clip(5)], sel(2, 5), "g")!;
    expect(keys(out)).toEqual(["m1:1", "m1:2", "m1:5", "m1:3", "m1:4"]);
  });

  it("absorbs a group the selection touches, whole", () => {
    const out = groupItems([clip(1), clip(2, "g1"), clip(3, "g1"), clip(4)], sel(1, 3), "g")!;
    expect(keys(out)).toEqual(["m1:1", "m1:2", "m1:3", "m1:4"]);
    expect(groupsOf(out)).toEqual(["g", "g", "g", null]);
  });

  it("returns null for fewer than two selected rows, and ignores keys not in the list", () => {
    const items = [clip(1), clip(2)];
    expect(groupItems(items, sel(1), "g")).toBeNull();
    expect(groupItems(items, new Set(["m1:1", "m1:99"]), "g")).toBeNull();
  });
});

describe("ungroupItems", () => {
  it("drops the group id from its members and leaves others", () => {
    const out = ungroupItems([clip(1, "g1"), clip(2, "g1"), clip(3, "g2"), clip(4, "g2")], "g1");
    expect(groupsOf(out)).toEqual([null, null, "g2", "g2"]);
    expect("groupId" in out[0]).toBe(false);
    expect(keys(out)).toEqual(["m1:1", "m1:2", "m1:3", "m1:4"]);
  });
});

describe("cardInsertKey", () => {
  // a, b(g), c(g), d
  const items: PlaylistItem[] = [clip(1), clip(2, "g"), clip(3, "g"), clip(4)];

  it("toolbar with no focus goes to the start", () => {
    expect(cardInsertKey(items, { at: "toolbar" }, null)).toBe("m1:1");
  });

  it("toolbar after a grouped row lands after the whole run", () => {
    expect(cardInsertKey(items, { at: "toolbar" }, "m1:2")).toBe("m1:4");
  });

  it("toolbar after an ungrouped row goes right after it", () => {
    expect(cardInsertKey(items, { at: "toolbar" }, "m1:1")).toBe("m1:2");
  });

  it("above a row inside a run goes above the run", () => {
    expect(cardInsertKey(items, { at: "above", index: 2 }, null)).toBe("m1:2");
  });

  it("above the last row returns that row; start returns the first; an empty list returns null", () => {
    expect(cardInsertKey(items, { at: "above", index: 3 }, null)).toBe("m1:4");
    expect(cardInsertKey(items, { at: "start" }, "m1:3")).toBe("m1:1");
    expect(cardInsertKey([], { at: "start" }, null)).toBeNull();
  });

  it("toolbar after the last row returns null (the end)", () => {
    expect(cardInsertKey(items, { at: "toolbar" }, "m1:4")).toBeNull();
  });
});

describe("newTextCard and insertBefore", () => {
  const spec: GameStatsCard = {
    type: "stats", v: 1, source: "genius_hosted", scope: "game",
    player: { id: "1693025", name: "Alva Berg", number: "7", teamId: "187005", teamName: "Bajen Basket" },
    game: { matchId: "m-1", sourceGameId: "2668882", competitionId: 41539, opponent: "AIK", date: "2026-10-12", home: true, us: 84, them: 79 },
    line: {
      min: 31 * 60 + 2, pts: 24, fgm: 9, fga: 14, tpm: 3, tpa: 5, ftm: 3, fta: 4,
      oreb: 3, dreb: 7, ast: 5, stl: 1, blk: 0, tov: 2, pf: 3, pm: 12,
    },
    columns: ["pts", "reb", "ast", "fg"], heading: null, details: null, asOf: "2026-10-17T10:00:00Z",
  };

  it("a plain card is empty for 5 s; a stats card carries its spec and fallback line", () => {
    expect(newTextCard("t1", null)).toEqual({ type: "text", id: "t1", text: "", durationSeconds: 5 });
    const card = newTextCard("t2", spec);
    expect(card).toEqual({ type: "text", id: "t2", text: fallbackText(spec), durationSeconds: 5, card: spec });
  });

  it("insertBefore puts the item before the key, or at the end for null or an unknown key", () => {
    const items: PlaylistItem[] = [clip(1), clip(2)];
    const card: PlaylistTextCard = newTextCard("t1", null);
    expect(keys(insertBefore(items, card, "m1:2"))).toEqual(["m1:1", "text:t1", "m1:2"]);
    expect(keys(insertBefore(items, card, null))).toEqual(["m1:1", "m1:2", "text:t1"]);
    expect(keys(insertBefore(items, card, "m1:9"))).toEqual(["m1:1", "m1:2", "text:t1"]);
  });
});
