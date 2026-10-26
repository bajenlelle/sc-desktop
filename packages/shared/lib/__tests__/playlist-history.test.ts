import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  emptyHistory,
  itemsDiff,
  materialize,
  pasteIndexAfter,
  pasteItems,
  recordEdit,
  takeRedo,
  takeUndo,
  type ItemsEdit,
} from "../playlist-history";
import type { PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../../types/match";

const clip = (eventId: number, over: Partial<PlaylistClipItem> = {}): PlaylistClipItem => ({ type: "clip", matchId: "m1", eventId, ...over });
const card = (id: string, over: Partial<PlaylistTextCard> = {}): PlaylistTextCard => ({ type: "text", id, text: `card ${id}`, durationSeconds: 5, ...over });
const keys = (items: readonly PlaylistItem[]) => items.map((i) => (i.type === "clip" ? `${i.matchId}:${i.eventId}` : `text:${i.id}`));

const edit = (label: string, before: PlaylistItem[], after: PlaylistItem[]): ItemsEdit => ({ label, before, after });

describe("the history", () => {
  it("undoes the last edit, then redoes it", () => {
    const a = [clip(1), clip(2)];
    const b = [clip(2), clip(1)];
    const h = recordEdit(emptyHistory(), edit("Reorder", a, b));
    const u = takeUndo(h)!;
    expect(u.edit.label).toBe("Reorder");
    expect(u.history.past).toHaveLength(0);
    expect(u.history.future).toHaveLength(1);
    const r = takeRedo(u.history)!;
    expect(r.edit.after).toBe(b);
    expect(r.history.past).toHaveLength(1);
    expect(r.history.future).toHaveLength(0);
  });

  it("has nothing to undo or redo when empty", () => {
    expect(takeUndo(emptyHistory())).toBeNull();
    expect(takeRedo(emptyHistory())).toBeNull();
  });

  it("forgets what could be redone once a new edit is made", () => {
    const h1 = recordEdit(emptyHistory(), edit("one", [clip(1)], [clip(1), clip(2)]));
    const undone = takeUndo(h1)!.history;
    const h2 = recordEdit(undone, edit("two", [clip(1)], []));
    expect(h2.future).toHaveLength(0);
    expect(h2.past.map((e) => e.label)).toEqual(["two"]);
  });

  it("keeps the last HISTORY_LIMIT edits", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordEdit(h, edit(`e${i}`, [clip(i)], [clip(i + 1)]));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].label).toBe("e5");
  });

  it("records nothing for an edit that changed neither the rows, their order nor their groups", () => {
    const h = recordEdit(emptyHistory(), edit("noop", [clip(1), clip(2)], [clip(1, { note: "n" }), clip(2)]));
    expect(h.past).toHaveLength(0);
    const grouped = recordEdit(emptyHistory(), edit("group", [clip(1), clip(2)], [clip(1, { groupId: "g" }), clip(2, { groupId: "g" })]));
    expect(grouped.past).toHaveLength(1);
  });
});

describe("itemsDiff", () => {
  it("names the rows to delete and the rows to put back", () => {
    const from = [clip(1), card("a"), clip(2)];
    const to = [clip(2), clip(3, { note: "kept" }), card("b")];
    expect(itemsDiff(from, to)).toEqual({
      removedClips: [{ matchId: "m1", eventId: 1 }],
      removedTextIds: ["a"],
      addedClips: [clip(3, { note: "kept" })],
      addedText: [card("b")],
    });
  });

  it("is empty for the same rows in another order", () => {
    expect(itemsDiff([clip(1), card("a")], [card("a"), clip(1)])).toEqual({ removedClips: [], removedTextIds: [], addedClips: [], addedText: [] });
  });
});

describe("materialize", () => {
  it("takes the order and groups of the snapshot with the rows as they are now", () => {
    const now = [clip(1, { note: "edited later" }), clip(2, { r2Url: "https://x/2.mp4" })];
    const snapshot = [clip(2, { groupId: "g" }), card("a", { groupId: "g" }), clip(1)];
    const out = materialize(snapshot, now);
    expect(keys(out)).toEqual(["m1:2", "text:a", "m1:1"]);
    // Clip 2 keeps its file URL from now and takes the snapshot's group; card a comes back from the snapshot.
    expect(out[0]).toEqual(clip(2, { r2Url: "https://x/2.mp4", groupId: "g" }));
    expect(out[1]).toEqual(card("a", { groupId: "g" }));
    // Clip 1 keeps its newer note and has no group, as in the snapshot.
    expect(out[2]).toEqual(clip(1, { note: "edited later" }));
  });

  it("drops a group the snapshot didn't have", () => {
    const out = materialize([clip(1)], [clip(1, { groupId: "g" })]);
    expect(out[0]).toEqual(clip(1));
  });
});

describe("pasteItems", () => {
  const ids = () => {
    let n = 0;
    return () => `new${++n}`;
  };

  it("inserts the copied rows at the index, in their order, as fresh rows without groups", () => {
    const items = [clip(1), clip(2)];
    const { items: out, pasted } = pasteItems(items, [clip(7, { groupId: "g", note: "n" }), card("a", { groupId: "g" }), clip(8)], 1, ids());
    expect(keys(out)).toEqual(["m1:1", "m1:7", "text:new1", "m1:8", "m1:2"]);
    expect(out[1]).toEqual(clip(7, { note: "n" }));
    expect(out[2]).toEqual(card("new1", { text: "card a" }));
    expect(pasted).toHaveLength(3);
  });

  it("skips clips the playlist already has, but always pastes a card (as a copy)", () => {
    const items = [clip(1), card("a")];
    const { items: out, pasted } = pasteItems(items, [clip(1), card("a"), clip(2)], 2, ids());
    expect(keys(out)).toEqual(["m1:1", "text:a", "text:new1", "m1:2"]);
    expect(pasted.map((p) => (p.type === "clip" ? p.eventId : p.id))).toEqual(["new1", 2]);
  });

  it("clamps the index and drops a pasted clip's hosted file (the target cuts its own)", () => {
    const { items: out } = pasteItems([clip(1)], [clip(2, { r2Url: "https://x/2.mp4" })], 99, ids());
    expect(out).toEqual([clip(1), clip(2)]);
  });

  it("changes nothing when there is nothing new to paste", () => {
    const items = [clip(1)];
    const r = pasteItems(items, [clip(1)], 0, ids());
    expect(r.items).toBe(items);
    expect(r.pasted).toEqual([]);
  });
});

describe("pasteIndexAfter", () => {
  it("pastes after the focused row, past the end of its group so the group stays together", () => {
    const items = [clip(1), clip(2, { groupId: "g" }), clip(3, { groupId: "g" }), clip(4)];
    expect(pasteIndexAfter(items, "m1:1")).toBe(1);
    expect(pasteIndexAfter(items, "m1:2")).toBe(3);
    expect(pasteIndexAfter(items, "m1:4")).toBe(4);
  });

  it("pastes at the end with no focused row, or one that is gone", () => {
    expect(pasteIndexAfter([clip(1)], null)).toBe(1);
    expect(pasteIndexAfter([clip(1)], "m1:9")).toBe(1);
  });
});
