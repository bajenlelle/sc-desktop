import { noteLabelUsed } from "@scoutable/shared/lib/label-order";

/**
 * The labels this device used last, most recent first, for the label picker's
 * "Recent" group (packages/shared/lib/label-order.ts). Kept on the device, as
 * the collect target is: it is a habit of the hand, not something to sync.
 * Label ids are unique across spaces, so one list serves every vocabulary;
 * the picker skips the ids that aren't in the one it is showing.
 */
const KEY = "scoutable_recent_labels";

export function getRecentLabelIds(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberLabelUsed(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(noteLabelUsed(getRecentLabelIds(), id)));
  } catch {
    // A full or blocked store only costs the order.
  }
}
