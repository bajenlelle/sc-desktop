import { describe, expect, it } from "vitest";
import { emptyHistory, type History } from "../playlist-history";
import { failedSidebarStep, nextHistoryStep, recordSidebarEdit, takeSidebarStep, type SidebarEdit } from "../sidebar-history";

const rename = (seq: number, before = "Old", after = "New"): SidebarEdit =>
  ({ label: "Rename playlist", seq, target: "playlist", id: "p1", field: "name", before, after });
const move = (seq: number, before: string | null, after: string | null): SidebarEdit =>
  ({ label: "Move playlist", seq, target: "playlist", id: "p1", field: "parent", before, after });
const moveFolder = (seq: number, before: string | null, after: string | null): SidebarEdit =>
  ({ label: "Move folder", seq, target: "folder", id: "g1", field: "parent", before, after });
const rows = (past: number[], future: number[] = []): History<{ seq?: number }> =>
  ({ past: past.map((seq) => ({ seq })), future: future.map((seq) => ({ seq })) });

describe("recordSidebarEdit", () => {
  it("records a rename, and nothing for one that kept the name", () => {
    expect(recordSidebarEdit(emptyHistory(), rename(1)).past).toHaveLength(1);
    expect(recordSidebarEdit(emptyHistory(), rename(1, "Same", "Same")).past).toHaveLength(0);
  });
  it("forgets what could be redone", () => {
    const h = recordSidebarEdit({ past: [], future: [rename(1)] }, rename(2));
    expect(h.future).toHaveLength(0);
  });
});

describe("nextHistoryStep", () => {
  it("undoes the newest edit of either history", () => {
    const sidebar = recordSidebarEdit(emptyHistory(), rename(2));
    expect(nextHistoryStep("undo", rows([1, 3]), sidebar)).toBe("rows");
    expect(nextHistoryStep("undo", rows([1]), sidebar)).toBe("sidebar");
    expect(nextHistoryStep("undo", rows([]), sidebar)).toBe("sidebar");
  });
  it("redoes the edit undone last", () => {
    const sidebar = { past: [], future: [rename(2)] };
    expect(nextHistoryStep("redo", rows([], [1]), sidebar)).toBe("rows");
    expect(nextHistoryStep("redo", rows([]), sidebar)).toBe("sidebar");
  });
  it("has nothing to step to when both are empty", () => {
    expect(nextHistoryStep("undo", emptyHistory(), emptyHistory())).toBeNull();
    expect(nextHistoryStep("redo", emptyHistory(), emptyHistory())).toBeNull();
  });
});

describe("takeSidebarStep", () => {
  it("goes back to the old name while the new one stands, and forward again", () => {
    const u = takeSidebarStep(recordSidebarEdit(emptyHistory(), rename(1)), "undo", () => "New")!;
    expect(u).toMatchObject({ to: "Old" });
    expect(u.history.future).toHaveLength(1);
    const r = takeSidebarStep(u.history, "redo", () => "Old")!;
    expect(r).toMatchObject({ to: "New" });
    expect(r.history.past).toHaveLength(1);
  });
  it("undoes nothing when the name changed since, and forgets the edit", () => {
    const u = takeSidebarStep(recordSidebarEdit(emptyHistory(), rename(1)), "undo", () => "Newer")!;
    expect(u).toMatchObject({ blocked: "changed" });
    expect(u.history).toEqual({ past: [], future: [] });
  });
  it("undoes nothing when the playlist or folder is gone", () => {
    const u = takeSidebarStep(recordSidebarEdit(emptyHistory(), rename(1)), "undo", () => undefined)!;
    expect(u).toMatchObject({ blocked: "gone" });
    expect(u.history).toEqual({ past: [], future: [] });
  });
  it("treats the top level (null) as a place", () => {
    const h = recordSidebarEdit(emptyHistory(), move(1, null, "f1"));
    expect(takeSidebarStep(h, "undo", () => "f1")).toMatchObject({ to: null });
    expect(takeSidebarStep(h, "undo", () => null)).toMatchObject({ blocked: "changed" });
  });
  it("has nothing to step to when empty", () => {
    expect(takeSidebarStep(emptyHistory(), "undo", () => "x")).toBeNull();
  });
  it("redoes nothing when the name changed since, and forgets the edit", () => {
    const r = takeSidebarStep({ past: [], future: [rename(1)] }, "redo", () => "Other")!;
    expect(r).toMatchObject({ blocked: "changed" });
    expect(r.history).toEqual({ past: [], future: [] });
  });
  it("redoes nothing when the playlist or folder is gone", () => {
    const r = takeSidebarStep({ past: [], future: [rename(1)] }, "redo", () => undefined)!;
    expect(r).toMatchObject({ blocked: "gone" });
    expect(r.history).toEqual({ past: [], future: [] });
  });
  it("undoes nothing when the folder it was in is gone, and forgets the edit", () => {
    const h = recordSidebarEdit(emptyHistory(), move(1, "f1", null));
    const u = takeSidebarStep(h, "undo", () => null, (id) => id !== "f1")!;
    expect(u).toMatchObject({ blocked: "place_gone" });
    expect(u.history).toEqual({ past: [], future: [] });
    expect(takeSidebarStep(h, "undo", () => null, () => true)).toMatchObject({ to: "f1" });
  });
  it("redoes nothing when the folder it went into is gone, and forgets the edit", () => {
    const r = takeSidebarStep({ past: [], future: [move(1, null, "f1")] }, "redo", () => null, () => false)!;
    expect(r).toMatchObject({ blocked: "place_gone" });
    expect(r.history).toEqual({ past: [], future: [] });
  });
  it("asks about no place for a rename or a step to the top level", () => {
    const gone = () => false;
    expect(takeSidebarStep(recordSidebarEdit(emptyHistory(), rename(1)), "undo", () => "New", gone)).toMatchObject({ to: "Old" });
    expect(takeSidebarStep(recordSidebarEdit(emptyHistory(), move(1, null, "f1")), "undo", () => "f1", gone)).toMatchObject({ to: null });
  });
  it("puts no folder inside itself, and forgets the edit", () => {
    const h = recordSidebarEdit(emptyHistory(), moveFolder(1, "f2", null));
    const u = takeSidebarStep(h, "undo", () => null, () => true, (id, parent) => id === "g1" && parent === "f2")!;
    expect(u).toMatchObject({ blocked: "cycle" });
    expect(u.history).toEqual({ past: [], future: [] });
    expect(takeSidebarStep(h, "undo", () => null, () => true, () => false)).toMatchObject({ to: "f2" });
  });
  it("checks that a place exists before it checks for a cycle", () => {
    const h = recordSidebarEdit(emptyHistory(), moveFolder(1, "f2", null));
    expect(takeSidebarStep(h, "undo", () => null, () => false, () => true)).toMatchObject({ blocked: "place_gone" });
  });
});

describe("failedSidebarStep", () => {
  it("puts the history back as it was when nothing happened since the step", () => {
    const prior = recordSidebarEdit(recordSidebarEdit(emptyHistory(), rename(1, "X", "Y")), rename(2, "Y", "Z"));
    const step = takeSidebarStep(prior, "undo", () => "Z")!;
    expect(failedSidebarStep(step.history, prior, step)).toBe(prior);
  });
  it("forgets the edit from both stacks when the history moved on", () => {
    const prior = recordSidebarEdit(recordSidebarEdit(emptyHistory(), rename(1, "X", "Y")), rename(2, "Y", "Z"));
    const step = takeSidebarStep(prior, "undo", () => "Z")!;
    const later = takeSidebarStep(step.history, "undo", () => "Y")!;
    expect(failedSidebarStep(later.history, prior, step)).toEqual({ past: [], future: [prior.past[0]] });
  });
});
