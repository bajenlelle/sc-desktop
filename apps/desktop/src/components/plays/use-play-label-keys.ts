import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { labelForKey } from "@scoutable/shared/lib/label-keys";
import type { Label } from "@scoutable/shared/types/labels";
import type { ClipBrowserLabelHandlers } from "@/components/editor/clip-browser-panel";
import { trackEvent } from "@/lib/analytics";
import { LABEL_KEY_TOAST, labelKeyMessage, toastNoLabelOnKey, useOptionHeld } from "@/lib/label-keys";
import { rememberLabelUsed, useRecentLabelIds } from "@/lib/recent-labels";

/** A play a label key acts on: its row's key, and the clip it is in the label tables. */
export interface LabelTarget {
  key: string;
  matchId: string;
  eventId: number;
}

/**
 * The label keys of a page that plays plays (the game view, Teams' Plays): ⌥1–⌥9 put a label on
 * the plays they act on or take it off, ⇧G puts the label used last on them, and Option held for a
 * moment shows which key is which label. One hook, so the pages answer a key the same way: a toast
 * that says what happened, with Undo on the plays it changed and on no others.
 */
export function usePlayLabelKeys({
  scope,
  labels,
  labelsOf,
  targets,
  handlers,
  openPicker,
}: {
  /** The key scope the page's keys are in: Option held elsewhere shows nothing. */
  scope: string;
  /** The space's labels. */
  labels: readonly Label[];
  labelsOf: (key: string) => ReadonlySet<string> | undefined;
  /** What a key acts on now: the play on screen, or the selection. */
  targets: () => LabelTarget[];
  handlers: Pick<ClipBrowserLabelHandlers, "onToggleClip" | "onBulkToggle">;
  /** ⇧G before any label has been used: the picker, on the play on screen. */
  openPicker: () => void;
}) {
  // The label used last, of this space's vocabulary: what "the same label again" puts on.
  const recentLabelIds = useRecentLabelIds();
  const lastLabel = useMemo(() => {
    const byId = new Map(labels.map((l) => [l.id, l]));
    for (const id of recentLabelIds) {
      const label = byId.get(id);
      if (label) return label;
    }
    return null;
  }, [recentLabelIds, labels]);

  /** Puts `label` on (on) or takes it off the plays in `changed`, with a toast whose Undo names those plays. */
  const apply = useCallback(
    (label: Label, on: boolean, changed: LabelTarget[]) => {
      const set = (put: boolean) => {
        // The state handed over is the one the plays are in: "none" puts the label on, "all" takes it off.
        if (changed.length === 1) return handlers.onToggleClip(changed[0].matchId, changed[0].eventId, label.id, put ? "none" : "all");
        return handlers.onBulkToggle(
          changed.map((t) => ({ matchId: t.matchId, eventId: t.eventId })),
          label.id,
          put ? "none" : "all",
        );
      };
      void set(on);
      toast(labelKeyMessage(label.name, on, changed.length), {
        id: LABEL_KEY_TOAST,
        action: { label: "Undo", onClick: () => void set(!on) },
      });
    },
    [handlers],
  );

  /**
   * The same label again, on the plays a key acts on, without the picker: one key (or one click) per play
   * for a coach looking for one thing through a game. It only ever puts the label on; with no label used
   * yet it opens the picker.
   */
  const labelAgain = useCallback(() => {
    const ts = targets();
    if (ts.length === 0) return;
    if (!lastLabel) {
      openPicker();
      return;
    }
    const lacking = ts.filter((t) => !labelsOf(t.key)?.has(lastLabel.id));
    if (lacking.length === 0) return;
    apply(lastLabel, true, lacking);
    rememberLabelUsed(lastLabel.id);
    trackEvent("label_picked", { by: "repeat", position: 0, recent: true, searched: false, created: false });
  }, [targets, lastLabel, openPicker, labelsOf, apply]);

  /**
   * A label's own key (⌥1–⌥9): the label goes on the plays, or comes off them when every one has it,
   * while the footage plays on. Undo names the plays the key was pressed on: by then another may be on screen.
   */
  const labelByKey = useCallback(
    (slot: number) => {
      const label = labelForKey(labels, slot);
      if (!label) {
        toastNoLabelOnKey(slot);
        return;
      }
      const ts = targets();
      if (ts.length === 0) return;
      const on = !ts.every((t) => labelsOf(t.key)?.has(label.id));
      apply(label, on, on ? ts.filter((t) => !labelsOf(t.key)?.has(label.id)) : ts);
      if (on) {
        rememberLabelUsed(label.id);
        trackEvent("label_picked", { by: "hotkey", position: slot, recent: false, searched: false, created: false });
      }
    },
    [labels, targets, labelsOf, apply],
  );

  // Option held for a moment asks which key is which label.
  const keysShown = useOptionHeld(scope);

  return { lastLabel, labelAgain, labelByKey, keysShown };
}
