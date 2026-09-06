import { describe, expect, it, vi } from "vitest";
import type { TouchVerdict, UserDevice } from "../devices-db";
import {
  DEVICE_ID_SOURCE_HARDWARE,
  appKindLabel,
  applyVerdict,
  partitionDevicesByActivity,
  planDeviceTouch,
  reconcileWebDeviceId,
} from "../device-boot";

const okVerdict: TouchVerdict = { status: "ok", deviceId: "canon-1", activeCount: 1, cap: 3 };

describe("planDeviceTouch", () => {
  it("falls back to the legacy passthrough when no hardware id is available", () => {
    expect(planDeviceTouch({ storedId: "legacy-1", source: null }, null)).toEqual({
      deviceId: "legacy-1",
      hardwareId: null,
      replacesDeviceId: null,
    });
  });

  it("resends replaces = stored id every boot until migrated", () => {
    expect(planDeviceTouch({ storedId: "legacy-1", source: null }, "dt:abc")).toEqual({
      deviceId: "legacy-1",
      hardwareId: "dt:abc",
      replacesDeviceId: "legacy-1",
    });
  });

  it("stops sending replaces once the source marker says hardware", () => {
    expect(
      planDeviceTouch({ storedId: "canon-1", source: DEVICE_ID_SOURCE_HARDWARE }, "dt:abc"),
    ).toEqual({ deviceId: "canon-1", hardwareId: "dt:abc", replacesDeviceId: null });
  });

  it("sends the hardware id on first boot even with no stored id", () => {
    expect(planDeviceTouch({ storedId: null, source: null }, "ios:idfv")).toEqual({
      deviceId: null,
      hardwareId: "ios:idfv",
      replacesDeviceId: null,
    });
  });
});

describe("applyVerdict", () => {
  const fresh = { storedId: "legacy-1", source: null };
  const migrated = { storedId: "canon-1", source: DEVICE_ID_SOURCE_HARDWARE };

  it("writes nothing when the touch failed (null verdict)", () => {
    expect(applyVerdict(fresh, "dt:abc", null)).toBeNull();
  });

  it("writes nothing on a blocked verdict", () => {
    expect(
      applyVerdict(fresh, "dt:abc", { status: "blocked", deviceId: "canon-1", activeCount: 4, cap: 3 }),
    ).toBeNull();
  });

  it("writes nothing on the legacy path (no hardware id was sent)", () => {
    expect(applyVerdict(fresh, null, okVerdict)).toBeNull();
  });

  it("adopts the server-canonical id and the hardware marker on a fresh migration", () => {
    expect(applyVerdict(fresh, "dt:abc", okVerdict)).toEqual({
      nextId: "canon-1",
      nextSource: DEVICE_ID_SOURCE_HARDWARE,
    });
  });

  it("is a no-op once already migrated to the same id", () => {
    expect(applyVerdict(migrated, "dt:abc", okVerdict)).toBeNull();
  });

  it("rewrites the id when a migrated device gets a different canonical id back", () => {
    expect(
      applyVerdict(migrated, "dt:abc", { ...okVerdict, deviceId: "canon-2" }),
    ).toEqual({ nextId: "canon-2", nextSource: DEVICE_ID_SOURCE_HARDWARE });
  });
});

describe("partitionDevicesByActivity", () => {
  const NOW = new Date("2026-03-31T00:00:00.000Z");

  function device(partial: Partial<UserDevice>): UserDevice {
    return {
      deviceId: "d1",
      app: "desktop",
      platform: "macOS",
      deviceName: "MacBook",
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: "2026-03-15T00:00:00.000Z",
      ...partial,
    };
  }

  it("counts a row last seen exactly 30 days ago as inactive (strict > cutoff)", () => {
    const atCutoff = device({ deviceId: "old", lastSeen: "2026-03-01T00:00:00.000Z" });
    const justInside = device({ deviceId: "new", lastSeen: "2026-03-01T00:00:00.001Z" });
    expect(partitionDevicesByActivity([atCutoff, justInside], NOW)).toEqual({
      active: [justInside],
      inactive: [atCutoff],
    });
  });

  it("honors a custom window", () => {
    const d = device({ lastSeen: "2026-03-15T00:00:00.000Z" });
    expect(partitionDevicesByActivity([d], NOW, 30).active).toEqual([d]);
    expect(partitionDevicesByActivity([d], NOW, 7).inactive).toEqual([d]);
  });

  it("returns two empty buckets for an empty list", () => {
    expect(partitionDevicesByActivity([], NOW)).toEqual({ active: [], inactive: [] });
  });
});

describe("appKindLabel", () => {
  it("labels a web row as a browser, not a device", () => {
    expect(appKindLabel("web")).toBe("Browser");
    expect(appKindLabel("desktop")).toBe("Desktop app");
    expect(appKindLabel("mobile")).toBe("Mobile app");
  });
});

describe("reconcileWebDeviceId", () => {
  const mint = () => "minted-uuid";

  it("keeps the localStorage id and mirrors it into a missing cookie", () => {
    expect(reconcileWebDeviceId("ls-1", null, mint)).toEqual({
      id: "ls-1",
      writeLs: false,
      writeCookie: true,
    });
  });

  it("writes nothing when both stores already agree", () => {
    expect(reconcileWebDeviceId("ls-1", "ls-1", mint)).toEqual({
      id: "ls-1",
      writeLs: false,
      writeCookie: false,
    });
  });

  it("restores localStorage from the cookie after a localStorage clear", () => {
    expect(reconcileWebDeviceId(null, "cookie-1", mint)).toEqual({
      id: "cookie-1",
      writeLs: true,
      writeCookie: false,
    });
  });

  it("lets localStorage win a mismatch and rewrites the cookie", () => {
    expect(reconcileWebDeviceId("ls-1", "cookie-1", mint)).toEqual({
      id: "ls-1",
      writeLs: false,
      writeCookie: true,
    });
  });

  it("mints a fresh id and writes both stores when neither exists", () => {
    const mintSpy = vi.fn(() => "minted-uuid");
    expect(reconcileWebDeviceId(null, null, mintSpy)).toEqual({
      id: "minted-uuid",
      writeLs: true,
      writeCookie: true,
    });
    expect(mintSpy).toHaveBeenCalledTimes(1);
  });
});
