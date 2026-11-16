/**
 * A key per label.
 *
 * A coach who tags a game with three or four labels at once needs each of
 * them one press away, not one picker away. So a label can be given a key,
 * 1 to 9, and Option (Alt) with that digit puts the label on the clip on
 * screen, or takes it off again, without opening anything.
 *
 * The rules, as the tools that have this agree on them (docs/game-view.md):
 * the coach chooses the keys and they never move by themselves; there are
 * nine; one label has one key and one key has one label, so giving a taken
 * key to another label moves it; and a press toggles.
 *
 * Option with a digit because nothing else is free: the digits alone are the
 * quarters in the game view, ⌘ with a digit is the Go menu, Control with a
 * digit switches desktops on a Mac, and the letters are the player's.
 *
 * The key is kept on the label (`labels.hotkey`, set through
 * `set_label_hotkey`), so it follows the account.
 */
import type { Label } from "../types/labels";
import type { KeyChord } from "./player-keys";

/** The keys are the digits 1 to this. */
export const LABEL_KEY_COUNT = 9;

/** Whether `n` is a key a label can have. */
export function isLabelKey(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= LABEL_KEY_COUNT;
}

/**
 * The label key a key press means, else null: Option (Alt) with a digit of
 * the number row and nothing else held. By the key's place, not its
 * character: Option makes "1" a "©" on a Swedish layout. AltGr reports as
 * Control with Alt, so the characters it types on Windows are left alone.
 */
export function labelKeySlot(e: KeyChord): number | null {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  return digit ? Number(digit[1]) : null;
}

/** The label that has this key in the vocabulary, else null. */
export function labelForKey(labels: readonly Label[], slot: number): Label | null {
  return labels.find((l) => l.hotkey === slot) ?? null;
}

/** The nine keys in order, each with the label that has it (null: free). */
export function labelKeySlots(labels: readonly Label[]): Array<{ slot: number; label: Label | null }> {
  return Array.from({ length: LABEL_KEY_COUNT }, (_, i) => ({ slot: i + 1, label: labelForKey(labels, i + 1) }));
}

/**
 * The vocabulary after `labelId` was given key `slot` (null: its key taken
 * away), as `set_label_hotkey` leaves it: the label that had the key loses
 * it. `displaced` is that label, for saying so.
 */
export function withLabelKey(labels: readonly Label[], labelId: string, slot: number | null): { labels: Label[]; displaced: Label | null } {
  if (!labels.some((l) => l.id === labelId)) return { labels: [...labels], displaced: null };
  const displaced = slot === null ? null : (labels.find((l) => l.hotkey === slot && l.id !== labelId) ?? null);
  return {
    labels: labels.map((l) => (l.id === labelId ? { ...l, hotkey: slot } : displaced && l.id === displaced.id ? { ...l, hotkey: null } : l)),
    displaced,
  };
}

/** How a label key is written: "⌥1" on a Mac, "Alt+1" elsewhere. */
export function labelKeyHint(slot: number, mac: boolean): string {
  return mac ? `⌥${slot}` : `Alt+${slot}`;
}
