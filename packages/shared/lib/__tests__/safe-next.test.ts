import { describe, expect, it } from "vitest";
import { safeNext } from "../safe-next";

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/join/ABC123")).toBe("/join/ABC123");
    expect(safeNext("/my-playlists?p=1")).toBe("/my-playlists?p=1");
  });

  it("refuses anything that could leave the site", () => {
    expect(safeNext("//evil.com")).toBeNull();
    expect(safeNext("/\\evil.com")).toBeNull();
    expect(safeNext("https://evil.com")).toBeNull();
    expect(safeNext("javascript:alert(1)")).toBeNull();
    expect(safeNext("evil.com")).toBeNull();
    expect(safeNext("@evil.com")).toBeNull();
  });

  it("refuses nothing, blanks, whitespace and control characters", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext("")).toBeNull();
    expect(safeNext(" /x")).toBeNull();
    expect(safeNext("/x\n")).toBeNull();
    expect(safeNext("/x\u0000")).toBeNull();
  });

  it("refuses a path longer than a URL should be", () => {
    expect(safeNext("/" + "a".repeat(2047))).not.toBeNull();
    expect(safeNext("/" + "a".repeat(2048))).toBeNull();
  });
});
