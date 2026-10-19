/**
 * What every program the container runs shares (src/convert.ts, src/render.ts):
 * the env reader, the single progress figure with its log lines, the Worker's
 * alive pings, the health server, the progress heartbeat to the function,
 * SIGTERM handling and the main() wrapper that settles the exit code.
 */
import http from "node:http";
import { Cancelled, StaleAttempt } from "./function-client.ts";
import type { Logger, Program } from "./log.ts";

/** The exit code after SIGTERM: ffmpeg killed, the failure reported, like a shell would say. */
export const SIGTERM_EXIT = 143;
/** How long a SIGTERM'd run may spend reporting before the process is forced out. */
export const SIGTERM_GRACE_MS = 5000;
/** The report after SIGTERM gets one try, this long. */
export const SIGTERM_REPORT_TIMEOUT_MS = 4000;
/** The health server's port unless PORT says otherwise. */
export const DEFAULT_PORT = 8080;
const ALIVE_INTERVAL_MS = 5 * 60 * 1000;
const ALIVE_TIMEOUT_MS = 10_000;
const EXIT_GRACE_MS = 1500;

/** An env var, trimmed; unset and blank read the same. */
export const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

/** PORT as a program reads it: the env's value, else the default, else none in a dry run. */
export function readPort(dryRun: boolean): number | null {
  const raw = env("PORT");
  const port = raw ? Number(raw) : dryRun ? null : DEFAULT_PORT;
  return port && Number.isInteger(port) && port > 0 ? port : null;
}

/**
 * The job's single progress figure (0..1), with a log line whenever a phase
 * starts or passes another tenth. `scale` places a phase's own fraction on
 * the job's bar (the converter's phases have fixed spans; a render is linear).
 */
export class Progress<P extends string> {
  phase: P | "start" = "start";
  value = 0;
  detail: Record<string, unknown> = {};
  private logged = { phase: "" as string, step: -1 };

  constructor(
    private readonly log: Logger,
    private readonly scale: (phase: P, fraction: number) => number = (_phase, fraction) => fraction,
  ) {}

  set(phase: P, fraction: number, detail: Record<string, unknown> = {}): void {
    const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    this.phase = phase;
    this.value = Math.min(1, Math.max(0, this.scale(phase, f)));
    this.detail = detail;
    const step = Math.floor(f * 10);
    if (phase !== this.logged.phase || step !== this.logged.step) {
      this.logged = { phase, step };
      this.line();
    }
  }

  line(extra: Record<string, unknown> = {}): void {
    this.log({ phase: this.phase, pct: Math.round(this.value * 100), ...this.detail, ...extra });
  }
}

/** Keeps the Worker's inactivity clock running while the job lasts, and tells it when the job has reported. */
export class AlivePinger {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly attempt: number,
    private readonly log: Logger,
  ) {}

  start(): void {
    void this.ping();
    this.timer = setInterval(() => void this.ping(), ALIVE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async ping(final = false): Promise<void> {
    try {
      const u = new URL(this.url);
      u.searchParams.set("attempt", String(this.attempt));
      if (final) u.searchParams.set("final", "1");
      const res = await fetch(u, { method: "POST", signal: AbortSignal.timeout(ALIVE_TIMEOUT_MS) });
      if (!res.ok) this.log({ phase: "alive", status: res.status });
    } catch (e) {
      this.log({ phase: "alive", error: this.log.safe(e) });
    }
  }
}

/** Answers every request with the snapshot, as JSON: the container's health endpoint. */
export function startHealthServer(port: number, snapshot: () => unknown, log: Logger): http.Server {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(snapshot()));
  });
  server.on("error", (e) => log({ phase: "health", error: log.safe(e) }));
  server.listen(port, "0.0.0.0");
  server.unref();
  return server;
}

/** SIGTERM and SIGINT abort the run with reason `sigterm`; the process is forced out after the grace period. */
export function installSignalHandlers(abort: AbortController, log: Logger): void {
  const onSignal = (signal: NodeJS.Signals) => {
    if (abort.signal.aborted) return;
    log({ phase: "signal", signal });
    abort.abort("sigterm");
    setTimeout(() => process.exit(SIGTERM_EXIT), SIGTERM_GRACE_MS).unref();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

export interface HeartbeatOptions {
  intervalMs: number;
  progress: { value: number; line(extra?: Record<string, unknown>): void };
  /** Posts the figure to the function (job_progress / render_progress). */
  report: (value: number) => Promise<unknown>;
  abort: AbortController;
  log: Logger;
}

export interface Heartbeat {
  /** One report now, outside the interval (after a milestone, say). */
  beat(): void;
  stop(): void;
}

/**
 * Progress and heartbeat together, on the wire's interval, whatever phase
 * the job is in. A `stale_attempt` answer means another attempt owns the
 * row, a `cancelled` one that the owner stopped the render: either way the
 * run is aborted with that reason and stops without a report.
 */
export function startHeartbeat(o: HeartbeatOptions): Heartbeat {
  const beat = () => {
    o.progress.line({ heartbeat: true });
    o.report(o.progress.value).catch((e: unknown) => {
      if (e instanceof StaleAttempt || e instanceof Cancelled) {
        if (!o.abort.signal.aborted) o.abort.abort(e.token);
        return;
      }
      o.log({ phase: "progress", error: o.log.safe(e) });
    });
  };
  const timer = setInterval(beat, o.intervalMs);
  return {
    beat,
    stop: () => clearInterval(timer),
  };
}

/**
 * Reports between heartbeats (an export's progress): at once when the phase
 * changes, otherwise at most once every `everyMs`.
 */
export function throttledReporter<P extends string>(beat: () => void, everyMs: number, now: () => number = Date.now): (phase: P) => void {
  let lastPhase: P | null = null;
  let lastAt = -Infinity;
  return (phase) => {
    const t = now();
    if (phase === lastPhase && t - lastAt < everyMs) return;
    lastPhase = phase;
    lastAt = t;
    beat();
  };
}

/**
 * Runs a program's main(): the exit code it resolves with is the process's.
 * Stdout drains and sockets close on their own; the exit is forced if
 * something lingers. A crash outside main's own handling exits 1.
 */
export function runMain(program: Program, main: () => Promise<number>, redactCrash: (message: string) => string = (m) => m): void {
  main().then(
    (code) => {
      process.exitCode = code;
      setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
    },
    (e) => {
      console.error(`[${program}] crashed: ${redactCrash(e instanceof Error ? e.message : String(e))}`);
      process.exitCode = 1;
      setTimeout(() => process.exit(1), EXIT_GRACE_MS).unref();
    },
  );
}
