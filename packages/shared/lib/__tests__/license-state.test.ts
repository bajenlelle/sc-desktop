import { describe, expect, it } from "vitest";
import {
  daysUntilExpiry,
  getLicenseState,
  graceEndsAt,
  seatsLeftLabel,
  seatsRunningLow,
} from "../license-state";

const NOW = new Date("2026-08-30T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

describe("getLicenseState", () => {
  it("is active with no expiry", () => {
    expect(getLicenseState(null, 14, NOW)).toBe("active");
    expect(getLicenseState(undefined, 14, NOW)).toBe("active");
  });

  it("is active more than 30 days out", () => {
    expect(getLicenseState(days(31), 14, NOW)).toBe("active");
  });

  it("is expiring inside the 30-day window", () => {
    expect(getLicenseState(days(30), 14, NOW)).toBe("expiring");
    expect(getLicenseState(days(1), 14, NOW)).toBe("expiring");
  });

  it("is grace after expiry until grace days pass", () => {
    expect(getLicenseState(days(-1), 14, NOW)).toBe("grace");
    expect(getLicenseState(days(-13), 14, NOW)).toBe("grace");
  });

  it("is locked once expiry + grace has passed", () => {
    expect(getLicenseState(days(-14), 14, NOW)).toBe("locked");
    expect(getLicenseState(days(-100), 14, NOW)).toBe("locked");
  });

  it("respects a custom grace window", () => {
    expect(getLicenseState(days(-5), 3, NOW)).toBe("locked");
    expect(getLicenseState(days(-5), 7, NOW)).toBe("grace");
  });

  it("treats junk dates as active (server enforces anyway)", () => {
    expect(getLicenseState("not-a-date", 14, NOW)).toBe("active");
  });
});

describe("daysUntilExpiry", () => {
  it("returns null with no expiry", () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull();
  });

  it("rounds partial days up", () => {
    expect(daysUntilExpiry(days(0.5), NOW)).toBe(1);
    expect(daysUntilExpiry(days(6.1), NOW)).toBe(7);
  });

  it("goes negative after expiry", () => {
    expect(daysUntilExpiry(days(-2), NOW)).toBeLessThanOrEqual(-1);
  });
});

describe("graceEndsAt", () => {
  it("is expiry plus grace days", () => {
    const end = graceEndsAt(days(-1), 14);
    expect(end?.toISOString()).toBe(days(13));
  });

  it("returns null with no expiry", () => {
    expect(graceEndsAt(null)).toBeNull();
  });
});

describe("seat labels", () => {
  it("phrases remaining-oriented per house convention", () => {
    expect(seatsLeftLabel(8, 10, "coach")).toBe("2 of 10 coach seats left");
  });

  it("clamps at zero when over cap", () => {
    expect(seatsLeftLabel(12, 10, "player")).toBe("0 of 10 player seats left");
  });

  it("returns null when unlimited", () => {
    expect(seatsLeftLabel(8, null, "coach")).toBeNull();
  });

  it("flags low seats at 2 or fewer left", () => {
    expect(seatsRunningLow(8, 10)).toBe(true);
    expect(seatsRunningLow(7, 10)).toBe(false);
    expect(seatsRunningLow(5, null)).toBe(false);
  });
});
