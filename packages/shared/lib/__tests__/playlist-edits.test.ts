import { describe, expect, it } from "vitest";
import type { Playlist } from "../../types/match";
import {
  appendClips,
  clampRolls,
  insertCardAt,
  itemKey,
  noCopyClips,
  nudgeGap,
  pinnedPair,
  playlistMatchIds,
  removeKeys,
  restoreRemoved,
  unshippedClips,
  withCardDuration,
  withClipOffsets,
  withNote,
  withoutShippedFile,
} from "../playlist-edits";

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
