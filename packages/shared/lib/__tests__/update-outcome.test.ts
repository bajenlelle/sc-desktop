import { describe, expect, it } from "vitest";
import { parsePendingUpdate, resolvePendingUpdate, shortError } from "../update-outcome";

const AT = Date.UTC(2026, 10, 20, 9, 0, 0);

describe("parsePendingUpdate", () => {
  it("reads back a stored install", () => {
    expect(parsePendingUpdate('{"from":"2.0.0","to":"2.1.0","at":1795165200000}')).toEqual({
      from: "2.0.0",
      to: "2.1.0",
      at: 1795165200000,
    });
  });

  it("is nothing when no install was stored", () => {
    expect(parsePendingUpdate(null)).toBeNull();
    expect(parsePendingUpdate("")).toBeNull();
  });

  it("is nothing for a value that isn't a stored install", () => {
    expect(parsePendingUpdate("not json")).toBeNull();
    expect(parsePendingUpdate("null")).toBeNull();
    expect(parsePendingUpdate('"2.1.0"')).toBeNull();
    expect(parsePendingUpdate('{"from":"2.0.0","at":1795165200000}')).toBeNull();
    expect(parsePendingUpdate('{"from":"2.0.0","to":"2.1.0","at":"yesterday"}')).toBeNull();
    expect(parsePendingUpdate('{"from":2,"to":"2.1.0","at":1795165200000}')).toBeNull();
  });
});

describe("resolvePendingUpdate", () => {
  const pending = { from: "2.0.0", to: "2.1.0", at: AT };

  it("reports nothing when no install was started", () => {
    expect(resolvePendingUpdate(null, "2.1.0", AT + 60_000)).toBeNull();
  });

  it("counts the install as done when the app now runs the new version", () => {
    expect(resolvePendingUpdate(pending, "2.1.0", AT + 42_400)).toEqual({
      kind: "installed",
      version: "2.1.0",
      fromVersion: "2.0.0",
      seconds: 42,
    });
  });

  it("counts a still newer running version as done, and names the one running", () => {
    expect(resolvePendingUpdate(pending, "2.2.0", AT + 3_600_000)).toEqual({
      kind: "installed",
      version: "2.2.0",
      fromVersion: "2.0.0",
      seconds: 3600,
    });
  });

  it("counts the install as failed when the app came back on the old version", () => {
    expect(resolvePendingUpdate(pending, "2.0.0", AT + 3 * 86_400_000)).toEqual({
      kind: "failed",
      version: "2.1.0",
      fromVersion: "2.0.0",
      seconds: 259_200,
    });
  });

  it("compares versions by their numbers, not as text", () => {
    const toTen = { from: "1.9.0", to: "1.10.0", at: AT };
    expect(resolvePendingUpdate(toTen, "1.9.0", AT + 1000)?.kind).toBe("failed");
    expect(resolvePendingUpdate(toTen, "v1.10.0", AT + 1000)?.kind).toBe("installed");
  });

  it("never reports a negative time when the clock moved back", () => {
    expect(resolvePendingUpdate(pending, "2.1.0", AT - 5000)?.seconds).toBe(0);
  });
});

describe("shortError", () => {
  it("takes an error's message", () => {
    expect(shortError(new Error("Compression method not supported"))).toBe("Compression method not supported");
  });

  it("takes a thrown string as it is", () => {
    expect(shortError("signature mismatch")).toBe("signature mismatch");
  });

  it("puts a message of several lines on one", () => {
    expect(shortError(new Error("download failed:\n  connection reset\n"))).toBe("download failed: connection reset");
  });

  it("cuts a long message at 200 characters", () => {
    const cut = shortError(new Error("x".repeat(500)));
    expect(cut).toHaveLength(200);
    expect(cut).toBe("x".repeat(200));
  });
});
