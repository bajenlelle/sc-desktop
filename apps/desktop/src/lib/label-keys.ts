import { useEffect, useState } from "react";
import { toast } from "sonner";
import { labelKeyHint } from "@scoutable/shared/lib/label-keys";
import { isTopKeyScope } from "@/lib/key-scope";
import { IS_MACOS } from "@/lib/platform";

/**
 * The desktop's side of a key per label (packages/shared/lib/label-keys.ts):
 * how a key is written here, the one toast its presses share, and the held
 * Option that asks to see the keys.
 */

/** A label key as this platform writes it: "⌥1" on a Mac, "Alt+1" on Windows. */
export const labelKeyText = (slot: number) => labelKeyHint(slot, IS_MACOS);

/** One toast for what a label key did: the next press replaces it. */
export const LABEL_KEY_TOAST = "label-key";

/** A key no label has yet: say so, and where a key is given. */
export function toastNoLabelOnKey(slot: number): void {
  toast(`No label has ${labelKeyText(slot)} yet`, {
    id: LABEL_KEY_TOAST,
    description: "Give a label a key from its row in the label picker.",
  });
}

/** What a label key did to one clip or to several, in the words the toasts use. */
export function labelKeyMessage(name: string, on: boolean, clips = 1): string {
  if (clips > 1) return on ? `${name} added to ${clips} clips` : `${name} removed from ${clips} clips`;
  return on ? `Labelled ${name}` : `Removed ${name}`;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || !!el.isContentEditable;
}

/** How long Option is held before it reads as a question, not as the start of a chord. */
const HELD_MS = 400;

/**
 * True while Option (Alt) has been held by itself for a moment in the key
 * scope `scope`: the cue to show which label each key puts on. A quick ⌥1
 * never shows it. Option held in a field is typing, and Option with ⌘ or
 * Control is some other chord.
 */
export function useOptionHeld(scope: string): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const clear = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setHeld(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Alt") {
        if (e.metaKey || e.ctrlKey) clear();
        return;
      }
      if (e.repeat || timer !== undefined) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (!isTopKeyScope(scope) || isEditable(e.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      timer = window.setTimeout(() => setHeld(true), HELD_MS);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") clear();
    };
    // A window that loses the keyboard never hears the key come up.
    const onHidden = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [scope]);

  return held;
}
