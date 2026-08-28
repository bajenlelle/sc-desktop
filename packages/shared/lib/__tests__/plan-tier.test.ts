import { describe, expect, it } from "vitest";
import type { OrgPlanTier } from "../../types/org";
import {
  getImportWindow,
  getOrgImportLimit,
  NT_LEAGUE_IDS,
  orgPlanColors,
  orgPlanLabel,
} from "../plan-tier";

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

describe("orgPlanColors", () => {
  const tiers: OrgPlanTier[] = ["free", "rookie", "pro", "franchise"];

  it("gives every tier a dot and badge", () => {
    expect(orgPlanColors("free")).toEqual({
      dot: "bg-muted-foreground",
      badge: "bg-muted text-muted-foreground",
    });
    expect(orgPlanColors("rookie")).toEqual({
      dot: "bg-violet-500",
      badge: "bg-violet-500/10 text-violet-500",
    });
    expect(orgPlanColors("pro")).toEqual({
      dot: "bg-blue-500",
      badge: "bg-blue-500/10 text-blue-500",
    });
    expect(orgPlanColors("franchise")).toEqual({
      dot: "bg-amber-500",
      badge: "bg-amber-500/10 text-amber-500",
    });
  });

  it("keeps tiers visually distinct", () => {
    expect(new Set(tiers.map((t) => orgPlanColors(t).dot)).size).toBe(tiers.length);
    expect(new Set(tiers.map((t) => orgPlanColors(t).badge)).size).toBe(tiers.length);
  });
});

describe("NT_LEAGUE_IDS", () => {
  it("matches the national-team league ids the quota SQL exempts", () => {
    // GOLDEN: the SQL twin `v_nt` in `_import_allowance`/`log_match_import`
    // (supabase/migrations/20260826200000_import_grants_and_quota.sql) hardcodes
    // the same ids — change both together.
    expect(NT_LEAGUE_IDS).toEqual(["sweden-national-men", "sweden-national-women"]);
  });
});
