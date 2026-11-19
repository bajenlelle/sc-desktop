import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShipScheduler, SHIP_IDLE_MS, type ShipJob } from "../ship-scheduler";

const ID = "pl1";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createShipScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits 30 s by default", () => {
    expect(SHIP_IDLE_MS).toBe(30_000);
  });

  it("runs once after idleMs without a new schedule", async () => {
    const s = createShipScheduler();
    const job = vi.fn<ShipJob>(async () => "sent");
    s.schedule(ID, job);
    expect(s.status(ID)).toEqual({ phase: "waiting", done: 0, total: 0 });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(1);
    expect(job.mock.calls[0][0].trigger).toBe("idle");
    expect(s.status(ID)).toBeNull();
  });

  it("a new schedule restarts the timer", async () => {
    const s = createShipScheduler();
    const job = vi.fn<ShipJob>(async () => "sent");
    s.schedule(ID, job);
    await vi.advanceTimersByTimeAsync(20_000);
    s.schedule(ID, job);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("flush runs at once and clears the timer", async () => {
    const s = createShipScheduler();
    const job = vi.fn<ShipJob>(async () => "sent");
    s.schedule(ID, job);
    await s.flush(ID, "switch");
    expect(job).toHaveBeenCalledTimes(1);
    expect(job.mock.calls[0][0].trigger).toBe("switch");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("job reads state at run time", async () => {
    const s = createShipScheduler();
    let items = ["a"];
    let seen: string[] = [];
    s.schedule(ID, async () => {
      seen = items;
      return "sent";
    });
    items = ["a", "b"];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen).toEqual(["a", "b"]);
  });

  it("no second run while one is sending; the next waits for idle after it", async () => {
    const s = createShipScheduler();
    const gate = deferred<"sent">();
    const job = vi.fn<ShipJob>(() => gate.promise);
    s.schedule(ID, job);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.busy(ID)).toBe(true);
    s.schedule(ID, job);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job).toHaveBeenCalledTimes(1);
    expect(s.status(ID)?.phase).toBe("sending");
    gate.resolve("sent");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.busy(ID)).toBe(false);
    expect(s.status(ID)?.phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it("a flush while sending runs the next job right after", async () => {
    const s = createShipScheduler();
    const gate = deferred<"sent">();
    const job = vi.fn<ShipJob>(() => gate.promise);
    s.schedule(ID, job);
    void s.flush(ID, "manual");
    s.schedule(ID, job);
    const second = s.flush(ID, "leave");
    expect(job).toHaveBeenCalledTimes(1);
    gate.resolve("sent");
    await second;
    expect(job).toHaveBeenCalledTimes(2);
    expect(job.mock.calls[1][0].trigger).toBe("leave");
  });

  it("failed stays until the next schedule", async () => {
    const s = createShipScheduler();
    s.schedule(ID, async () => "failed");
    await s.flush(ID, "manual");
    expect(s.status(ID)?.phase).toBe("failed");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.status(ID)?.phase).toBe("failed");
    s.schedule(ID, async () => "sent");
    expect(s.status(ID)?.phase).toBe("waiting");
  });

  it("a throwing job counts as failed", async () => {
    const s = createShipScheduler();
    s.schedule(ID, async () => {
      throw new Error("boom");
    });
    await s.flush(ID, "manual");
    expect(s.status(ID)?.phase).toBe("failed");
    expect(s.busy(ID)).toBe(false);
  });

  it("report updates done/total and notifies", async () => {
    const s = createShipScheduler();
    const listener = vi.fn();
    s.subscribe(listener);
    const gate = deferred<"sent">();
    let report!: (done: number, total: number) => void;
    s.schedule(ID, (ctx) => {
      report = ctx.report;
      return gate.promise;
    });
    void s.flush(ID, "manual");
    const before = listener.mock.calls.length;
    report(2, 3);
    expect(s.status(ID)).toEqual({ phase: "sending", done: 2, total: 3 });
    expect(listener.mock.calls.length).toBe(before + 1);
    gate.resolve("sent");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.status(ID)).toBeNull();
  });

  it("status objects stay the same between changes", () => {
    const s = createShipScheduler();
    s.schedule(ID, async () => "sent");
    expect(s.status(ID)).toBe(s.status(ID));
  });

  it("cancelAll drops timers and statuses", async () => {
    const s = createShipScheduler();
    const job = vi.fn<ShipJob>(async () => "sent");
    s.schedule(ID, job);
    s.schedule("pl2", job);
    s.cancelAll();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(job).not.toHaveBeenCalled();
    expect(s.status(ID)).toBeNull();
    expect(s.status("pl2")).toBeNull();
  });

  it("flush without a job is a no-op", async () => {
    const s = createShipScheduler();
    await s.flush(ID, "switch");
    expect(s.status(ID)).toBeNull();
  });

  it("flushAll runs every waiting playlist", async () => {
    const s = createShipScheduler();
    const job = vi.fn<ShipJob>(async () => "sent");
    s.schedule("a", job);
    s.schedule("b", job);
    await s.flushAll("leave");
    expect(job).toHaveBeenCalledTimes(2);
  });

  it("idle waits for every send in progress, not for waiting ones", async () => {
    const s = createShipScheduler();
    const gate = deferred<"sent">();
    s.schedule("a", () => gate.promise);
    void s.flush("a", "manual");
    s.schedule("b", async () => "sent");
    let settled = false;
    const idle = s.idle().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    gate.resolve("sent");
    await idle;
    expect(settled).toBe(true);
    expect(s.status("b")?.phase).toBe("waiting");
  });

  it("idle with nothing running resolves at once", async () => {
    await expect(createShipScheduler().idle()).resolves.toBeUndefined();
  });

  it("an unsubscribed listener hears nothing", () => {
    const s = createShipScheduler();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    off();
    s.schedule(ID, async () => "sent");
    expect(listener).not.toHaveBeenCalled();
  });
});
