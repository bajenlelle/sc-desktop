import { describe, expect, it } from "vitest";
import { keepIfSame } from "../keep-if-same";

describe("keepIfSame", () => {
  it("keeps the previous object when the next one holds the same data", () => {
    const prev = { id: "u1", email: "a@b.se", meta: { role: "coach" } };
    const next = { id: "u1", email: "a@b.se", meta: { role: "coach" } };
    expect(keepIfSame(prev, next)).toBe(prev);
  });

  it("takes the next object when anything changed", () => {
    const prev = { id: "u1", email: "a@b.se" };
    const next = { id: "u1", email: "c@d.se" };
    expect(keepIfSame(prev, next)).toBe(next);
  });

  it("compares arrays by contents and order", () => {
    const prev = [{ orgId: "a" }, { orgId: "b" }];
    expect(keepIfSame(prev, [{ orgId: "a" }, { orgId: "b" }])).toBe(prev);
    const reordered = [{ orgId: "b" }, { orgId: "a" }];
    expect(keepIfSame(prev, reordered)).toBe(reordered);
  });

  it("handles null on either side", () => {
    const row = { id: "u1" };
    expect(keepIfSame<typeof row | null>(null, row)).toBe(row);
    expect(keepIfSame<typeof row | null>(row, null)).toBeNull();
    expect(keepIfSame(null, null)).toBeNull();
  });

  it("takes the next value when it can't be serialized", () => {
    const prev: Record<string, unknown> = { id: "u1" };
    const next: Record<string, unknown> = { id: "u1" };
    next.self = next;
    expect(keepIfSame(prev, next)).toBe(next);
  });
});
