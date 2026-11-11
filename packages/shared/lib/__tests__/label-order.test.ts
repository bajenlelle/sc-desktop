import { describe, expect, it } from "vitest";
import type { Label } from "../../types/labels";
import { labelPickerOrder, noteLabelUsed, RECENT_LABELS_KEPT, RECENT_LABELS_SHOWN } from "../label-order";

const label = (name: string): Label => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), userId: "u", orgId: "o", name, color: "violet", createdAt: "2026-01-01T00:00:00Z" });
// The default vocabulary, alphabetical as the picker gets it.
const VOCABULARY = ["Bad Defense", "Box Out", "Closeout", "Cut", "Drive", "Good Defense", "Iso", "Off-ball Screen", "Pick & Pop", "Pick & Roll", "Switch", "Transition"].map(label);
const names = (list: Label[]) => list.map((l) => l.name);

describe("noteLabelUsed", () => {
  it("puts the label first, once", () => {
    expect(noteLabelUsed(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(noteLabelUsed(["a", "b"], "z")).toEqual(["z", "a", "b"]);
    expect(noteLabelUsed([], "a")).toEqual(["a"]);
  });

  it("forgets the oldest past what it keeps", () => {
    const full = Array.from({ length: RECENT_LABELS_KEPT }, (_, i) => `l${i}`);
    const next = noteLabelUsed(full, "new");
    expect(next).toHaveLength(RECENT_LABELS_KEPT);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`l${RECENT_LABELS_KEPT - 1}`);
  });
});

describe("labelPickerOrder", () => {
  it("lists a vocabulary nobody has used yet as it is, starting at its first label", () => {
    const order = labelPickerOrder(VOCABULARY, [], "");
    expect(order.recent).toEqual([]);
    expect(names(order.rest)).toEqual(names(VOCABULARY));
    expect(order.first).toBe("bad-defense");
  });

  it("lifts the labels used last to the top, most recent first, and takes them out of the rest", () => {
    const order = labelPickerOrder(VOCABULARY, ["pick-roll", "switch", "drive"], "");
    expect(names(order.recent)).toEqual(["Pick & Roll", "Switch", "Drive"]);
    expect(names(order.rest)).toEqual(["Bad Defense", "Box Out", "Closeout", "Cut", "Good Defense", "Iso", "Off-ball Screen", "Pick & Pop", "Transition"]);
    expect(order.first).toBe("pick-roll");
  });

  it("lifts no more than it shows, and skips labels that are gone", () => {
    const order = labelPickerOrder(VOCABULARY, ["deleted", "iso", "cut", "drive", "switch", "closeout", "iso"], "");
    expect(order.recent).toHaveLength(RECENT_LABELS_SHOWN);
    expect(names(order.recent)).toEqual(["Iso", "Cut", "Drive", "Switch"]);
    expect(names(order.rest)).toContain("Closeout");
    expect(order.recent.length + order.rest.length).toBe(VOCABULARY.length);
  });

  it("keeps a small vocabulary in one list, and still starts at the label used last", () => {
    const few = VOCABULARY.slice(0, 5);
    const order = labelPickerOrder(few, ["drive", "cut"], "");
    expect(order.recent).toEqual([]);
    expect(names(order.rest)).toEqual(names(few));
    expect(order.first).toBe("drive");
  });

  it("has nothing to start at when there are no labels", () => {
    expect(labelPickerOrder([], ["gone"], "")).toEqual({ recent: [], rest: [], first: null });
  });

  it("searches names: a name that starts with it, then a word that does, then anywhere", () => {
    expect(names(labelPickerOrder(VOCABULARY, [], "de").rest)).toEqual(["Bad Defense", "Good Defense"]);
    // "Switch" starts with it; "Transition" only holds it.
    expect(names(labelPickerOrder(VOCABULARY, [], "s").rest).slice(0, 2)).toEqual(["Switch", "Off-ball Screen"]);
    expect(names(labelPickerOrder(VOCABULARY, [], "ROLL").rest)).toEqual(["Pick & Roll"]);
    expect(names(labelPickerOrder(VOCABULARY, [], "out").rest)).toEqual(["Box Out", "Closeout"]);
  });

  it("puts the match used last first among equal matches, and Enter on it", () => {
    const plain = labelPickerOrder(VOCABULARY, [], "pick");
    expect(names(plain.rest)).toEqual(["Pick & Pop", "Pick & Roll"]);
    const used = labelPickerOrder(VOCABULARY, ["pick-roll"], "pick");
    expect(names(used.rest)).toEqual(["Pick & Roll", "Pick & Pop"]);
    expect(used.first).toBe("pick-roll");
    expect(used.recent).toEqual([]);
  });

  it("has no match to start at when the search finds none", () => {
    expect(labelPickerOrder(VOCABULARY, ["iso"], "zone")).toEqual({ recent: [], rest: [], first: null });
  });

  it("reads a search of spaces as no search", () => {
    expect(names(labelPickerOrder(VOCABULARY, ["iso"], "  ").recent)).toEqual(["Iso"]);
  });
});
