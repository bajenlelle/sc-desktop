/**
 * What became of an update the coach started installing on the desktop.
 *
 * Installing ends the app: on Windows the updater exits the process and the
 * installer takes over, so the app that started the install can never say how
 * it went. It leaves a note (which version it ran, which one it was installing,
 * when) and the next start reads it: running the new version means the install
 * worked, still running the old one means it didn't.
 */
import { compareVersions } from "./update-offer";

/** The note an install leaves for the next start. */
export interface PendingUpdate {
  /** The version that started the install. */
  from: string;
  /** The version being installed. */
  to: string;
  /** When the install started, in ms since the epoch. */
  at: number;
}

export interface UpdateOutcome {
  kind: "installed" | "failed";
  /** installed: the version now running. failed: the version that didn't install. */
  version: string;
  fromVersion: string;
  /** From the start of the install to this start of the app. */
  seconds: number;
}

/** Reads a stored note; null when there is none or it isn't one. */
export function parsePendingUpdate(raw: string | null): PendingUpdate | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { from, to, at } = value as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string" || typeof at !== "number") return null;
  return { from, to, at };
}

/**
 * How the install a note describes went, told from the version now running.
 * A version newer than the one being installed also counts as installed (the
 * coach ran a later installer by hand). Null when no install was started.
 */
export function resolvePendingUpdate(
  pending: PendingUpdate | null,
  currentVersion: string,
  now: number,
): UpdateOutcome | null {
  if (!pending) return null;
  const seconds = Math.max(0, Math.round((now - pending.at) / 1000));
  const installed = compareVersions(currentVersion, pending.to) >= 0;
  return {
    kind: installed ? "installed" : "failed",
    version: installed ? currentVersion.trim().replace(/^v/i, "") : pending.to,
    fromVersion: pending.from,
    seconds,
  };
}

/** An error as one short line for analytics: its message, at most `max` characters. */
export function shortError(e: unknown, max = 200): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/\s+/g, " ").trim().slice(0, max);
}
