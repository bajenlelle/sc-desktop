/**
 * When a shared playlist's new clips are cut and uploaded for its players,
 * without a Send button: a quiet spell after the last add (`SHIP_IDLE_MS`),
 * or at once when the coach moves on (another playlist, another page). One
 * run per playlist at a time; clips added while one runs go in the next.
 *
 * Pure scheduling: the job (cut, upload, say how it went) is the caller's,
 * and it reads what to send when it runs, not when it was scheduled, so a
 * clip taken back meanwhile is never sent. The game view schedules; the
 * editor checks `busy` so the two never cut the same playlist at once
 * (docs/game-view.md).
 */

/** The quiet spell after the last add before a playlist's new clips go out. */
export const SHIP_IDLE_MS = 30_000;

export type ShipTrigger = "idle" | "switch" | "leave" | "manual";

export type ShipStatus = { phase: "waiting" | "sending" | "failed"; done: number; total: number };

/** Cuts and uploads; resolves "failed" (or throws) when any clip didn't go up. */
export type ShipJob = (ctx: { trigger: ShipTrigger; report: (done: number, total: number) => void }) => Promise<"sent" | "failed">;

export interface ShipScheduler {
  /** Replaces the playlist's job and starts the quiet spell again (after the run in progress, if any). */
  schedule(playlistId: string, job: ShipJob): void;
  /** Runs the playlist's job now (after the run in progress, if any); nothing when none is waiting. */
  flush(playlistId: string, trigger: Exclude<ShipTrigger, "idle">): Promise<void>;
  flushAll(trigger: "leave"): Promise<void>;
  /** Drops every timer, job and status (signing out). A run in progress finishes but says nothing. */
  cancelAll(): void;
  /** Null: nothing waiting, running or failed. The same object until it changes. */
  status(playlistId: string): ShipStatus | null;
  busy(playlistId: string): boolean;
  /** Settles once no send is running (a sync change waits for it before it re-cuts); waiting ones don't count. */
  idle(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

type Entry = {
  job?: ShipJob;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
  status: ShipStatus | null;
};

export function createShipScheduler(opts?: { idleMs?: number }): ShipScheduler {
  const idleMs = opts?.idleMs ?? SHIP_IDLE_MS;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const clearTimer = (e: Entry) => {
    if (e.timer !== undefined) clearTimeout(e.timer);
    e.timer = undefined;
  };

  /** A job waiting and no run: the quiet spell starts. */
  const wait = (id: string, e: Entry) => {
    clearTimer(e);
    e.status = { phase: "waiting", done: 0, total: 0 };
    e.timer = setTimeout(() => {
      e.timer = undefined;
      void run(id, e, "idle");
    }, idleMs);
  };

  const run = (id: string, e: Entry, trigger: ShipTrigger): Promise<void> => {
    const job = e.job;
    if (!job) return Promise.resolve();
    e.job = undefined;
    clearTimer(e);
    e.status = { phase: "sending", done: 0, total: 0 };
    notify();
    const report = (done: number, total: number) => {
      if (entries.get(id) !== e || e.status?.phase !== "sending") return;
      e.status = { phase: "sending", done, total };
      notify();
    };
    const running = (async () => {
      let outcome: "sent" | "failed";
      try {
        outcome = await job({ trigger, report });
      } catch {
        outcome = "failed";
      }
      e.running = undefined;
      // Signed out meanwhile: this run belongs to no one now.
      if (entries.get(id) !== e) return;
      if (e.job) wait(id, e);
      else if (outcome === "failed") e.status = { phase: "failed", done: 0, total: 0 };
      else entries.delete(id);
      notify();
    })();
    e.running = running;
    return running;
  };

  const flush = async (id: string, trigger: Exclude<ShipTrigger, "idle">): Promise<void> => {
    const e = entries.get(id);
    if (!e) return;
    clearTimer(e);
    if (e.running) await e.running;
    if (entries.get(id) !== e || !e.job) return;
    await run(id, e, trigger);
  };

  return {
    schedule(id, job) {
      let e = entries.get(id);
      if (!e) {
        e = { status: null };
        entries.set(id, e);
      }
      e.job = job;
      if (!e.running) wait(id, e);
      notify();
    },
    flush,
    async flushAll(trigger) {
      await Promise.all([...entries.keys()].map((id) => flush(id, trigger)));
    },
    cancelAll() {
      for (const e of entries.values()) clearTimer(e);
      entries.clear();
      notify();
    },
    status: (id) => entries.get(id)?.status ?? null,
    busy: (id) => entries.get(id)?.running !== undefined,
    async idle() {
      // A run may start while another ends (a flush waiting on it): look again until none is left.
      for (;;) {
        const running = [...entries.values()].map((e) => e.running).filter((r): r is Promise<void> => r !== undefined);
        if (running.length === 0) return;
        await Promise.all(running);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
