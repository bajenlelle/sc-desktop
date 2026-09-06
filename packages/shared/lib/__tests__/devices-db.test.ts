import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTouchVerdict, removeDevice, touchDevice } from "../devices-db";

// Error paths run reportDbError as-is (no reporter is registered in tests, it
// just console.errors) — same as the other *-db suites.

/** Minimal Supabase double for the rpc-only helpers under test. */
function mockClient(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("parseTouchVerdict", () => {
  it("maps a well-formed ok verdict from snake_case to camelCase", () => {
    expect(parseTouchVerdict({ status: "ok", device_id: "d1", active_count: 2, cap: 3 })).toEqual({
      status: "ok",
      deviceId: "d1",
      activeCount: 2,
      cap: 3,
    });
  });

  it("accepts blocked as a valid status", () => {
    expect(
      parseTouchVerdict({ status: "blocked", device_id: "d1", active_count: 4, cap: 3 }),
    ).toEqual({ status: "blocked", deviceId: "d1", activeCount: 4, cap: 3 });
  });

  it("returns null for non-verdict payloads (old server void, proxy junk)", () => {
    expect(parseTouchVerdict(null)).toBeNull();
    expect(parseTouchVerdict(undefined)).toBeNull();
    expect(parseTouchVerdict([])).toBeNull();
    expect(parseTouchVerdict("ok")).toBeNull();
  });

  it("returns null when device_id is missing", () => {
    expect(parseTouchVerdict({ status: "ok", active_count: 2, cap: 3 })).toBeNull();
  });

  it("returns null when active_count is not a number", () => {
    expect(
      parseTouchVerdict({ status: "ok", device_id: "d1", active_count: "2", cap: 3 }),
    ).toBeNull();
  });

  it("returns null for an unknown status", () => {
    expect(
      parseTouchVerdict({ status: "pending", device_id: "d1", active_count: 2, cap: 3 }),
    ).toBeNull();
  });
});

describe("touchDevice", () => {
  it("defaults every optional param to null in the p_* mapping", async () => {
    const { client, rpc } = mockClient({ data: null, error: null });
    await touchDevice(client, { deviceId: "d1", app: "web" });
    expect(rpc).toHaveBeenCalledWith("touch_device", {
      p_device_id: "d1",
      p_app: "web",
      p_platform: null,
      p_device_name: null,
      p_hardware_id: null,
      p_replaces_device_id: null,
    });
  });

  it("forwards the full param set including hardware and replaces ids", async () => {
    const { client, rpc } = mockClient({ data: null, error: null });
    await touchDevice(client, {
      deviceId: "d1",
      app: "desktop",
      platform: "macOS",
      deviceName: "MacBook",
      hardwareId: "dt:abc",
      replacesDeviceId: "legacy-1",
    });
    expect(rpc).toHaveBeenCalledWith("touch_device", {
      p_device_id: "d1",
      p_app: "desktop",
      p_platform: "macOS",
      p_device_name: "MacBook",
      p_hardware_id: "dt:abc",
      p_replaces_device_id: "legacy-1",
    });
  });

  it("returns the parsed verdict on success", async () => {
    const { client } = mockClient({
      data: { status: "ok", device_id: "canon-1", active_count: 1, cap: 3 },
      error: null,
    });
    await expect(touchDevice(client, { deviceId: "d1", app: "mobile" })).resolves.toEqual({
      status: "ok",
      deviceId: "canon-1",
      activeCount: 1,
      cap: 3,
    });
  });

  it("returns null when an old server returns void", async () => {
    const { client } = mockClient({ data: null, error: null });
    await expect(touchDevice(client, { deviceId: "d1", app: "web" })).resolves.toBeNull();
  });

  it("resolves null instead of throwing on an rpc error (must not break sign-in)", async () => {
    const { client } = mockClient({ data: null, error: { message: "boom" } });
    await expect(touchDevice(client, { deviceId: "d1", app: "web" })).resolves.toBeNull();
  });
});

describe("removeDevice", () => {
  it("calls remove_device with the device id", async () => {
    const { client, rpc } = mockClient({ data: null, error: null });
    await removeDevice(client, "d1");
    expect(rpc).toHaveBeenCalledWith("remove_device", { p_device_id: "d1" });
  });

  it("throws the rpc error so callers can toast", async () => {
    const error = { message: "device_not_found" };
    const { client } = mockClient({ data: null, error });
    await expect(removeDevice(client, "d1")).rejects.toBe(error);
  });
});
