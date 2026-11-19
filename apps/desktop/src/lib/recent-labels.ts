import { useSyncExternalStore } from "react";
import { noteLabelUsed } from "@scoutable/shared/lib/label-order";

/**
 * The labels this device used last, most recent first, for the label picker's
 * "Recent" group (packages/shared/lib/label-order.ts) and the game view's
 * "same label again". Kept on the device, as the collect target is: it is a
 * habit of the hand, not something to sync. Label ids are unique across
 * spaces, so one list serves every vocabulary; a reader skips the ids that
 * aren't in the one it is showing.
 */
const KEY = "scoutable_recent_labels";

let cached: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function getRecentLabelIds(): string[] {
  cached ??= read();
  return cached;
}

export function rememberLabelUsed(id: string): void {
  const next = noteLabelUsed(getRecentLabelIds(), id);
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store only costs the order after a restart.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The recently used label ids, kept current: for a view that shows which label is "the last one". */
export function useRecentLabelIds(): readonly string[] {
  return useSyncExternalStore(subscribe, getRecentLabelIds);
}
