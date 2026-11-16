import { describe, expect, it } from "vitest";
import type { Label } from "../../types/labels";
import { isLabelKey, LABEL_KEY_COUNT, labelForKey, labelKeyHint, labelKeySlot, labelKeySlots, withLabelKey } from "../label-keys";

const label = (name: string, hotkey: number | null = null): Label => ({
  id: name.toLowerCase(),
  userId: "u",
  orgId: "o",
  name,
  color: "violet",
  createdAt: "2026-01-01T00:00:00Z",
  hotkey,
});
const press = (code: string, held: Partial<Record<"altKey" | "shiftKey" | "metaKey" | "ctrlKey", boolean>> = {}) => ({
  code,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...held,
});
const keys = (list: Label[]) => Object.fromEntries(list.map((l) => [l.name, l.hotkey]));

describe("labelKeySlot", () => {
  it("is Option with a digit of the number row", () => {
    for (let n = 1; n <= LABEL_KEY_COUNT; n++) expect(labelKeySlot(press(`Digit${n}`, { altKey: true }))).toBe(n);
  });

  it("leaves the digit alone: that is the quarter", () => {
    expect(labelKeySlot(press("Digit1"))).toBeNull();
  });

  it("has no key 0, and none on the number pad, where Alt types character codes on Windows", () => {
    expect(labelKeySlot(press("Digit0", { altKey: true }))).toBeNull();
    expect(labelKeySlot(press("Numpad1", { altKey: true }))).toBeNull();
    expect(labelKeySlot(press("KeyG", { altKey: true }))).toBeNull();
  });

  it("leaves every other chord alone", () => {
    // ⌘1 is the Go menu; AltGr reports as Control with Alt and types "@" on a Swedish Windows layout.
    expect(labelKeySlot(press("Digit1", { altKey: true, metaKey: true }))).toBeNull();
    expect(labelKeySlot(press("Digit2", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(labelKeySlot(press("Digit1", { altKey: true, shiftKey: true }))).toBeNull();
    expect(labelKeySlot(press("Digit1", { metaKey: true }))).toBeNull();
  });
});

describe("isLabelKey", () => {
  it("is a whole number from 1 to 9", () => {
    expect([1, 5, 9].every(isLabelKey)).toBe(true);
    expect([0, 10, 1.5, -1, Number.NaN, "1", null, undefined].some(isLabelKey)).toBe(false);
  });
});

describe("labelForKey and labelKeySlots", () => {
  const vocabulary = [label("Cut", 3), label("Drive"), label("Iso", 1)];

  it("finds the label a key belongs to", () => {
    expect(labelForKey(vocabulary, 1)?.name).toBe("Iso");
    expect(labelForKey(vocabulary, 3)?.name).toBe("Cut");
    expect(labelForKey(vocabulary, 2)).toBeNull();
  });

  it("lists the nine keys in order with their labels", () => {
    const slots = labelKeySlots(vocabulary);
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(slots.map((s) => s.label?.name ?? null)).toEqual(["Iso", null, "Cut", null, null, null, null, null, null]);
  });
});

describe("withLabelKey", () => {
  const vocabulary = [label("Cut", 3), label("Drive"), label("Iso", 1)];

  it("gives a label a free key", () => {
    const { labels, displaced } = withLabelKey(vocabulary, "drive", 2);
    expect(keys(labels)).toEqual({ Cut: 3, Drive: 2, Iso: 1 });
    expect(displaced).toBeNull();
  });

  it("moves a taken key: the label that had it has none", () => {
    const { labels, displaced } = withLabelKey(vocabulary, "drive", 1);
    expect(keys(labels)).toEqual({ Cut: 3, Drive: 1, Iso: null });
    expect(displaced?.name).toBe("Iso");
  });

  it("changes a label's key, which frees its old one", () => {
    const { labels, displaced } = withLabelKey(vocabulary, "cut", 5);
    expect(keys(labels)).toEqual({ Cut: 5, Drive: null, Iso: 1 });
    expect(displaced).toBeNull();
    expect(labelForKey(labels, 3)).toBeNull();
  });

  it("swaps nothing when a label takes the key it has", () => {
    const { labels, displaced } = withLabelKey(vocabulary, "cut", 3);
    expect(keys(labels)).toEqual(keys(vocabulary));
    expect(displaced).toBeNull();
  });

  it("takes a key away", () => {
    const { labels, displaced } = withLabelKey(vocabulary, "iso", null);
    expect(keys(labels)).toEqual({ Cut: 3, Drive: null, Iso: null });
    expect(displaced).toBeNull();
  });

  it("leaves the vocabulary alone for a label that isn't in it, and never changes what it was given", () => {
    const before = keys(vocabulary);
    expect(keys(withLabelKey(vocabulary, "gone", 1).labels)).toEqual(before);
    withLabelKey(vocabulary, "drive", 1);
    expect(keys(vocabulary)).toEqual(before);
  });

  it("keeps one label per key whatever is asked", () => {
    let labels = vocabulary;
    for (const [id, slot] of [["drive", 1], ["cut", 1], ["iso", 3], ["drive", 3], ["cut", null]] as const) {
      labels = withLabelKey(labels, id, slot).labels;
      const held = labels.map((l) => l.hotkey).filter((k) => k !== null);
      expect(new Set(held).size).toBe(held.length);
    }
    expect(keys(labels)).toEqual({ Cut: null, Drive: 3, Iso: null });
  });
});

describe("labelKeyHint", () => {
  it("is written the platform's way", () => {
    expect(labelKeyHint(1, true)).toBe("⌥1");
    expect(labelKeyHint(9, false)).toBe("Alt+9");
  });
});
