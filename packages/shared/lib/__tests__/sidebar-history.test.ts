import { describe, expect, it } from "vitest";
import { emptyHistory, type History } from "../playlist-history";
import { nextHistoryStep, recordSidebarEdit, takeSidebarStep, type SidebarEdit } from "../sidebar-history";

const rename = (seq: number, before = "Old", after = "New"): SidebarEdit =>
  ({ label: "Rename playlist", seq, target: "playlist", id: "p1", field: "name", before, after });
const move = (seq: number, before: string | null, after: string | null): SidebarEdit =>
  ({ label: "Move playlist", seq, target: "playlist", id: "p1", field: "parent", before, after });
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
});
