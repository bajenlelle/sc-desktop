import { describe, expect, it } from "vitest";
import { getImportWindow, getOrgImportLimit, orgPlanLabel } from "../plan-tier";

// Display fallbacks for the `_import_allowance` SQL function — if these
// change, the migration must change with them (see plan-tier.ts docs).
describe("getOrgImportLimit", () => {
  it("caps free at 3 and rookie at 10", () => {
    expect(getOrgImportLimit("free")).toBe(3);
    expect(getOrgImportLimit("rookie")).toBe(10);
  });

  it("leaves paid club tiers unlimited", () => {
    expect(getOrgImportLimit("pro")).toBeNull();
    expect(getOrgImportLimit("franchise")).toBeNull();
  });
});

describe("getImportWindow", () => {
  it("free is a lifetime pool, rookie resets monthly", () => {
    expect(getImportWindow("free")).toBe("lifetime");
    expect(getImportWindow("rookie")).toBe("month");
  });

  it("paid club tiers are unlimited", () => {
    expect(getImportWindow("pro")).toBe("unlimited");
    expect(getImportWindow("franchise")).toBe("unlimited");
  });
});

describe("orgPlanLabel", () => {
  it("renders every tier", () => {
    expect(orgPlanLabel("free")).toBe("Free");
    expect(orgPlanLabel("rookie")).toBe("Rookie");
    expect(orgPlanLabel("pro")).toBe("Pro");
    expect(orgPlanLabel("franchise")).toBe("Franchise");
  });
});
