import { describe, expect, it } from "vitest";
import type { Playlist } from "../../types/match";
import {
  appendClips,
  clampRolls,
  clipsForCopy,
  groupItems,
  insertCardAt,
  itemKey,
  noCopyClips,
  nudgeGap,
  pinnedPair,
  playlistMatchIds,
  removeKeys,
  restoreRemoved,
  restoreStructure,
  selectionGroupAction,
  ungroupItems,
  unshippedClips,
  withCardDuration,
  withCardSpec,
  withCardText,
  withClipOffsets,
  withNote,
  withoutShippedFile,
} from "../playlist-edits";
import type { StatsCardSpec } from "../stats-card";

const playlist: Playlist = {
  id: "p",
  name: "Turnovers",
  items: [
    { type: "clip", matchId: "m1", eventId: 1, groupId: "g" },
    { type: "clip", matchId: "m1", eventId: 2, groupId: "g", r2Url: "https://cdn/clips/m1/2_pre10.0_post3.0_s80.0.mp4" },
    { type: "text", id: "c1", text: "Second half", durationSeconds: 5 },
    { type: "clip", matchId: "m2", eventId: 7 },
  ],
};

describe("keys and rolls", () => {
  it("names clips by game and event and cards by id", () => {
    expect(playlist.items.map(itemKey)).toEqual(["m1:1", "m1:2", "text:c1", "m2:7"]);
  });

  it("clamps the rolls to whole seconds within the desktop's limits", () => {
    expect(clampRolls(12.4, 3.6)).toEqual({ pre: 12, post: 4 });
    expect(clampRolls(-5, 99)).toEqual({ pre: 0, post: 60 });
    expect(clampRolls(Number.NaN, 31)).toEqual({ pre: 0, post: 31 });
  });

  it("pins the default pair the first time offsets are written, never again", () => {
    expect(pinnedPair({})).toEqual({ pre: 10, post: 3 });
    expect(pinnedPair({ preRoll: 8, postRoll: 4 })).toBeNull();
    expect(pinnedPair({ preRoll: 8 })).toEqual({ pre: 8, post: 3 });
  });
});

describe("offsets, notes, files", () => {
  it("writes offsets in hundredths and drops zeros", () => {
    const next = withClipOffsets(playlist, "m1:1", { preRollOffset: 2.004, postRollOffset: 0 });
    const clip = next.items[0];
    expect(clip).toMatchObject({ preRollOffset: 2 });
    expect("postRollOffset" in clip).toBe(false);
    expect(next.items[1]).toBe(playlist.items[1]);
  });

  it("sets and clears a note", () => {
    expect(withNote(playlist, "m1:1", " watch the help side ").items[0]).toMatchObject({ note: " watch the help side " });
    const cleared = withNote(withNote(playlist, "m1:1", "x"), "m1:1", "   ");
    expect("note" in cleared.items[0]).toBe(false);
  });

  it("forgets a clip's uploaded file when it is trimmed", () => {
    const next = withoutShippedFile(playlist, "m1:2");
    expect("r2Url" in next.items[1]).toBe(false);
    expect(withoutShippedFile(playlist, "m1:1").items[0]).toBe(playlist.items[0]);
  });

  it("lists the unshipped clips and the games", () => {
    expect(unshippedClips(playlist).map(itemKey)).toEqual(["m1:1", "m2:7"]);
    expect(playlistMatchIds(playlist)).toEqual(["m1", "m2"]);
    expect(noCopyClips(playlist, new Set(["m1"])).map(itemKey)).toEqual(["m2:7"]);
  });
});

describe("cards", () => {
  it("inserts before a key, or at the end when the key is gone", () => {
    const card = { type: "text" as const, id: "c2", text: "", durationSeconds: 5 };
    expect(insertCardAt(playlist, card, "m2:7").items.map(itemKey)).toEqual(["m1:1", "m1:2", "text:c1", "text:c2", "m2:7"]);
    expect(insertCardAt(playlist, card, "gone").items.map(itemKey).at(-1)).toBe("text:c2");
    expect(insertCardAt(playlist, card, null).items.map(itemKey).at(-1)).toBe("text:c2");
  });

  it("holds a card's duration to 1–30 whole seconds", () => {
    expect(withCardDuration(playlist, "c1", 0.2).items[2]).toMatchObject({ durationSeconds: 1 });
    expect(withCardDuration(playlist, "c1", 45).items[2]).toMatchObject({ durationSeconds: 30 });
    expect(withCardDuration(playlist, "c1", 7.6).items[2]).toMatchObject({ durationSeconds: 8 });
  });

  it("never puts a card inside a group: a key mid-run lands it above the run", () => {
    const card = { type: "text" as const, id: "c2", text: "", durationSeconds: 5 };
    expect(insertCardAt(playlist, card, "m1:2").items.map(itemKey)).toEqual(["text:c2", "m1:1", "m1:2", "text:c1", "m2:7"]);
    // The run's first item is already outside the run's middle.
    expect(insertCardAt(playlist, card, "m1:1").items.map(itemKey)).toEqual(["text:c2", "m1:1", "m1:2", "text:c1", "m2:7"]);
    const inserted = insertCardAt(playlist, card, "m1:2").items[0];
    expect("groupId" in inserted).toBe(false);
  });

  it("sets and clears a card's stats spec", () => {
    const spec = { type: "stats", scope: "game" } as unknown as StatsCardSpec;
    const withSpec = withCardText(withCardSpec(playlist, "c1", spec), "c1", "Alva Berg · 24 PTS");
    expect(withSpec.items[2]).toMatchObject({ card: spec, text: "Alva Berg · 24 PTS" });
    expect(withSpec.items[0]).toBe(playlist.items[0]);
    expect("card" in withCardSpec(withSpec, "c1", null).items[2]).toBe(false);
  });
});

describe("groups", () => {
  const list: Playlist = {
    id: "p",
    name: "Sets",
    items: [
      { type: "clip", matchId: "m", eventId: 1 },
      { type: "clip", matchId: "m", eventId: 2, groupId: "g" },
      { type: "clip", matchId: "m", eventId: 3, groupId: "g" },
      { type: "text", id: "c", text: "Defence", durationSeconds: 5 },
      { type: "clip", matchId: "m", eventId: 4 },
      { type: "clip", matchId: "m", eventId: 5 },
    ],
  };
  const keys = (p: Playlist) => p.items.map(itemKey);

  it("pulls the picked items together at the first one's place", () => {
    const res = groupItems(list, new Set(["m:1", "m:4"]), "n")!;
    expect(keys(res.playlist)).toEqual(["m:1", "m:4", "m:2", "m:3", "text:c", "m:5"]);
    expect(res.members).toEqual(["m:1", "m:4"]);
    expect(res.playlist.items.filter((i) => i.groupId === "n").map(itemKey)).toEqual(["m:1", "m:4"]);
    // The group in between stays whole.
    expect(res.playlist.items.filter((i) => i.groupId === "g").map(itemKey)).toEqual(["m:2", "m:3"]);
  });

  it("absorbs a whole group the selection touches", () => {
    const res = groupItems(list, new Set(["m:3", "text:c", "m:5"]), "n")!;
    expect(keys(res.playlist)).toEqual(["m:1", "m:2", "m:3", "text:c", "m:5", "m:4"]);
    expect(res.members).toEqual(["m:2", "m:3", "text:c", "m:5"]);
    expect(res.playlist.items.some((i) => i.groupId === "g")).toBe(false);
  });

  it("does nothing for one item, or for a group that is already exactly that", () => {
    expect(groupItems(list, new Set(["m:1"]), "n")).toBeNull();
    expect(groupItems(list, new Set(["m:2", "m:3"]), "n")).toBeNull();
    expect(groupItems(list, new Set(["m:2", "zz"]), "n")).toBeNull();
  });

  it("ungroups in place", () => {
    const { playlist: next, count } = ungroupItems(list, "g");
    expect(count).toBe(2);
    expect(keys(next)).toEqual(keys(list));
    expect(next.items.some((i) => i.groupId)).toBe(false);
    expect(ungroupItems(list, "none")).toEqual({ playlist: list, count: 0 });
  });

  it("offers Ungroup for a selection inside one group, Group for two or more, else nothing", () => {
    expect(selectionGroupAction(list, new Set(["m:2", "m:3"]))).toEqual({ kind: "ungroup", groupId: "g", count: 2 });
    expect(selectionGroupAction(list, new Set(["m:3"]))).toEqual({ kind: "ungroup", groupId: "g", count: 2 });
    expect(selectionGroupAction(list, new Set(["m:3", "m:4"]))).toEqual({ kind: "group" });
    expect(selectionGroupAction(list, new Set(["m:1"]))).toBeNull();
    expect(selectionGroupAction(list, new Set())).toBeNull();
  });

  it("puts the order and groups back over later edits when a write fails", () => {
    const grouped = groupItems(list, new Set(["m:1", "m:4"]), "n")!.playlist;
    // A note lands and a clip is added after the grouping, before its write fails.
    const later = appendClips(withNote(grouped, "m:4", "help side"), [{ type: "clip", matchId: "m", eventId: 9 }]).playlist;
    const back = restoreStructure(later, list);
    expect(keys(back)).toEqual([...keys(list), "m:9"]);
    expect(back.items[4]).toMatchObject({ note: "help side" });
    expect("groupId" in back.items[0]).toBe(false);
    expect(back.items.filter((i) => i.groupId === "g").map(itemKey)).toEqual(["m:2", "m:3"]);
    // An item removed meanwhile stays gone, and a group left with one member dissolves.
    const removed = removeKeys(grouped, new Set(["m:2"])).playlist;
    const restored = restoreStructure(removed, list);
    expect(keys(restored)).toEqual(["m:1", "m:3", "text:c", "m:4", "m:5"]);
    expect(restored.items.some((i) => i.groupId)).toBe(false);
  });
});

describe("clipsForCopy", () => {
  const source: Playlist = {
    id: "a",
    name: "Source",
    preRoll: 8,
    postRoll: 4,
    items: [
      { type: "clip", matchId: "m", eventId: 1, groupId: "g", note: "Ball screen", r2Url: "https://cdn/clips/m/1.mp4" },
      { type: "text", id: "c", text: "Card", durationSeconds: 5, groupId: "g" },
      { type: "clip", matchId: "m", eventId: 2, preRollOffset: 2 },
      { type: "clip", matchId: "m", eventId: 3 },
    ],
  };

  it("copies the picked clips in order, without cards, groups or files, keeping their length", () => {
    const target: Playlist = { id: "b", name: "Target", preRoll: 10, postRoll: 3, items: [{ type: "clip", matchId: "m", eventId: 3 }] };
    const copies = clipsForCopy(source, new Set(["m:2", "text:c", "m:1", "m:3"]), target);
    expect(copies.map(itemKey)).toEqual(["m:1", "m:2"]);
    expect(copies[0]).toEqual({ type: "clip", matchId: "m", eventId: 1, note: "Ball screen", preRollOffset: -2, postRollOffset: 1 });
    expect(copies[1]).toEqual({ type: "clip", matchId: "m", eventId: 2, postRollOffset: 1 });
  });

  it("leaves offsets alone between playlists with the same pair", () => {
    const target: Playlist = { id: "b", name: "Target", preRoll: 8, postRoll: 4, items: [] };
    expect(clipsForCopy(source, new Set(["m:2", "m:3"]), target)).toEqual([
      { type: "clip", matchId: "m", eventId: 2, preRollOffset: 2 },
      { type: "clip", matchId: "m", eventId: 3 },
    ]);
  });
});

describe("adding and removing", () => {
  it("appends only clips that are not there yet", () => {
    const { playlist: next, added } = appendClips(playlist, [
      { type: "clip", matchId: "m1", eventId: 2 },
      { type: "clip", matchId: "m3", eventId: 9 },
    ]);
    expect(added.map(itemKey)).toEqual(["m3:9"]);
    expect(next.items.map(itemKey)).toEqual(["m1:1", "m1:2", "text:c1", "m2:7", "m3:9"]);
  });

  it("removes by key, dissolves a broken group, and Undo restores the exact list", () => {
    const { playlist: next, removed } = removeKeys(playlist, new Set(["m1:2", "text:c1"]));
    expect(next.items.map(itemKey)).toEqual(["m1:1", "m2:7"]);
    // A group of one is no group.
    expect("groupId" in next.items[0]).toBe(false);
    expect(removed.map((r) => [r.index, itemKey(r.item)])).toEqual([
      [1, "m1:2"],
      [2, "text:c1"],
    ]);
    const back = restoreRemoved(next, removed);
    expect(back.items.map(itemKey)).toEqual(playlist.items.map(itemKey));
    expect(back.items[1]).toMatchObject({ groupId: "g" });
  });
});

describe("nudgeGap", () => {
  const order = ["a", "b", "c", "d"];
  it("moves a row one slot up or down", () => {
    expect(nudgeGap(order, ["b"], -1)).toBe(0);
    expect(nudgeGap(order, ["b"], 1)).toBe(3);
  });
  it("refuses at the ends", () => {
    expect(nudgeGap(order, ["a"], -1)).toBeNull();
    expect(nudgeGap(order, ["d"], 1)).toBeNull();
  });
  it("counts a block from its outer rows", () => {
    expect(nudgeGap(order, ["b", "c"], -1)).toBe(0);
    expect(nudgeGap(order, ["b", "c"], 1)).toBe(4);
    expect(nudgeGap(order, ["a", "c"], 1)).toBe(4);
    expect(nudgeGap(order, ["c", "d"], 1)).toBeNull();
  });
  it("answers null for rows that are not shown", () => {
    expect(nudgeGap(order, ["zz"], 1)).toBeNull();
    expect(nudgeGap([], ["a"], -1)).toBeNull();
  });
});
