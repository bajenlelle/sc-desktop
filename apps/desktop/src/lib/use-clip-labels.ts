import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClipKey, Label, LabelColor } from "@scoutable/shared/types/labels";
import type { ClipBrowserLabelHandlers } from "@/components/editor/clip-browser-panel";
import type { LabelTriState } from "@/components/labels/LabelPickerPopover";
import { trackEvent } from "@/lib/analytics";
import {
  bulkAssign,
  createLabel,
  deleteLabel,
  listAssignmentsForMatches,
  listLabels,
  seedDefaultLabels,
  setClipAssignments,
  setLabelHotkey,
  updateLabel,
} from "@/lib/labels-db";
import { withLabelKey } from "@scoutable/shared/lib/label-keys";

const clipKey = (matchId: string, eventId: number) => `${matchId}:${eventId}`;
const byName = (a: Label, b: Label) => a.name.localeCompare(b.name);

/**
 * A game's labels, for a page that isn't the editor: the space's vocabulary
 * and which labels sit on which of the game's plays, read once and written
 * through at once (a failed write is taken back and said). The same shape
 * the Add clips browser takes its handlers in, so the label picker works
 * unchanged. The editor keeps its own copy of this in pages/playlists.tsx;
 * only one of the two pages is ever mounted, so neither can go stale.
 */
export function useClipLabels(orgId: string | null, matchId: string, surface: string) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(() => new Map());
  // Writes read the latest sets, not the ones a handler was created with.
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    setLabels([]);
    setAssignments(new Map());
    if (!orgId) return;
    let cancelled = false;
    void Promise.all([listLabels(orgId), listAssignmentsForMatches(orgId, [matchId])])
      .then(([vocabulary, rows]) => {
        if (cancelled) return;
        setLabels([...vocabulary].sort(byName));
        const next = new Map<string, Set<string>>();
        for (const row of rows) {
          const key = clipKey(row.matchId, row.eventId);
          const set = next.get(key) ?? new Set<string>();
          set.add(row.labelId);
          next.set(key, set);
        }
        setAssignments(next);
      })
      .catch(() => {
        // The game is still watchable without its labels; the picker shows none.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, matchId]);

  const patch = useCallback((keys: string[], labelId: string, on: boolean) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      for (const key of keys) {
        const set = new Set(next.get(key) ?? []);
        if (on) set.add(labelId);
        else set.delete(labelId);
        next.set(key, set);
      }
      return next;
    });
  }, []);

  const handlers = useMemo<ClipBrowserLabelHandlers>(
    () => ({
      // "all" takes the label off; "some" and "none" put it on (as in the editor).
      onToggleClip: async (clipMatchId: string, eventId: number, labelId: string, state: LabelTriState) => {
        if (!orgId) return;
        const on = state !== "all";
        const key = clipKey(clipMatchId, eventId);
        const wanted = new Set(assignmentsRef.current.get(key) ?? []);
        if (on) wanted.add(labelId);
        else wanted.delete(labelId);
        patch([key], labelId, on);
        try {
          await setClipAssignments(orgId, clipMatchId, eventId, [...wanted]);
          if (on) {
            setApplied((n) => n + 1);
            trackEvent("label_applied", { bulk: false, surface });
          }
        } catch {
          patch([key], labelId, !on);
          toast.error("Couldn't update the label", { description: "Check the connection and try again." });
        }
      },
      onBulkToggle: async (clips: ClipKey[], labelId: string, state: LabelTriState) => {
        if (!orgId || clips.length === 0) return;
        const on = state !== "all";
        const before = new Map(clips.map((c) => [clipKey(c.matchId, c.eventId), assignmentsRef.current.get(clipKey(c.matchId, c.eventId))?.has(labelId) ?? false]));
        patch([...before.keys()], labelId, on);
        try {
          await bulkAssign(orgId, clips, labelId, on ? "add" : "remove");
          if (on) {
            setApplied((n) => n + clips.length);
            trackEvent("label_applied", { bulk: true, surface });
          }
        } catch {
          for (const [key, had] of before) patch([key], labelId, had);
          toast.error("Couldn't update the labels", { description: "Check the connection and try again." });
        }
      },
      onCreate: async (name: string, color: LabelColor) => {
        if (!orgId) throw new Error("No active space");
        const created = await createLabel(orgId, name, color);
        trackEvent("label_created", { seeded: false });
        setLabels((prev) => [...prev, created].sort(byName));
        return created;
      },
      onRename: async (id: string, name: string) => {
        await updateLabel(id, { name });
        setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)).sort(byName));
      },
      onRecolor: async (id: string, color: LabelColor) => {
        await updateLabel(id, { color });
        setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, color } : l)));
      },
      // The label that had the key loses it, here as in the database (set_label_hotkey).
      onSetKey: async (id: string, slot: number | null) => {
        const before = new Map(labelsRef.current.map((l) => [l.id, l.hotkey]));
        setLabels((prev) => withLabelKey(prev, id, slot).labels);
        try {
          await setLabelHotkey(id, slot);
        } catch {
          setLabels((prev) => prev.map((l) => (before.has(l.id) ? { ...l, hotkey: before.get(l.id) ?? null } : l)));
          toast.error("Couldn't set the key", { description: "Check the connection and try again." });
        }
      },
      onDelete: async (id: string) => {
        await deleteLabel(id);
        setLabels((prev) => prev.filter((l) => l.id !== id));
        setAssignments((prev) => {
          const next = new Map<string, Set<string>>();
          for (const [key, set] of prev) {
            if (!set.has(id)) {
              next.set(key, set);
              continue;
            }
            const without = new Set(set);
            without.delete(id);
            next.set(key, without);
          }
          return next;
        });
      },
      onSeedDefaults: async () => {
        if (!orgId) return;
        await seedDefaultLabels(orgId);
        trackEvent("label_created", { seeded: true });
        setLabels([...(await listLabels(orgId))].sort(byName));
      },
    }),
    [orgId, patch, surface],
  );

  const labelsOf = useCallback((key: string): ReadonlySet<string> | undefined => assignments.get(key), [assignments]);

  return { labels, assignments, labelsOf, handlers, applied };
}
