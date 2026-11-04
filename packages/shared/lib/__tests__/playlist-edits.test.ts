import { describe, expect, it } from "vitest";
import type { PlaylistClipItem, PlaylistItem } from "../../types/match";
import { groupItems, itemKey, ungroupItems } from "../playlist-edits";

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
