import { describe, expect, it } from "vitest";
import { compareVersions, shouldOfferFoundUpdate } from "../update-offer";

describe("compareVersions", () => {
  it("orders by numeric parts, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.9.2", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("treats a leading v and missing parts as the same version", () => {
    expect(compareVersions("v1.10.0", "1.10.0")).toBe(0);
    expect(compareVersions("1.10", "1.10.0")).toBe(0);
  });
});

describe("shouldOfferFoundUpdate", () => {
  it("shows a found release when nothing was dismissed", () => {
    expect(shouldOfferFoundUpdate({ found: "1.11.0", showing: false, dismissed: null })).toBe(true);
  });

  it("leaves the card alone while it is already showing", () => {
    expect(shouldOfferFoundUpdate({ found: "1.12.0", showing: true, dismissed: null })).toBe(false);
  });

  it("keeps a dismissed version dismissed", () => {
    expect(shouldOfferFoundUpdate({ found: "1.11.0", showing: false, dismissed: "1.11.0" })).toBe(false);
    expect(shouldOfferFoundUpdate({ found: "v1.11.0", showing: false, dismissed: "1.11.0" })).toBe(false);
  });

  it("brings the card back for a newer release than the dismissed one", () => {
    expect(shouldOfferFoundUpdate({ found: "1.12.0", showing: false, dismissed: "1.11.0" })).toBe(true);
    expect(shouldOfferFoundUpdate({ found: "1.10.0", showing: false, dismissed: "1.11.0" })).toBe(false);
  });
});
