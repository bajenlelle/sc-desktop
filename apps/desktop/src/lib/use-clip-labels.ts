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
  setLabelHotkey,
  updateLabel,
} from "@/lib/labels-db";
import { withLabelKey } from "@scoutable/shared/lib/label-keys";

const clipKey = (matchId: string, eventId: number) => `${matchId}:${eventId}`;
const byName = (a: Label, b: Label) => a.name.localeCompare(b.name);

type GameLabels = { labels: Label[]; assignments: Map<string, Set<string>> };

/** Puts `labelId` on (or takes it off) each of `keys`, in `map` itself. */
function toggleIn(map: Map<string, Set<string>>, keys: readonly string[], labelId: string, on: boolean) {
  for (const key of keys) {
    const set = new Set(map.get(key) ?? []);
    if (on) set.add(labelId);
    else set.delete(labelId);
    map.set(key, set);
  }
}

/** This session's last look at each game's (or set of games') labels, by `${orgId}|${matchIds}`: a visit shows them at once and reads again behind. */
const lastRead = new Map<string, GameLabels>();

/** Forgets every game's labels, so another user signing in never sees this one's. */
export function forgetLabelsRead(): void {
  lastRead.clear();
}

/**
 * A game's labels (or a team's games', in its Plays view), for a page that isn't the editor: the space's vocabulary
 * and which labels sit on which of the game's plays, read once and written
 * through at once (a failed write is taken back and said). The same shape
 * the Add clips browser takes its handlers in, so the label picker works
 * unchanged. The editor keeps its own copy of this in pages/playlists.tsx;
 * only one of the two pages is ever mounted, so neither can go stale.
 *
 * A game seen before on this run starts from what it showed then (no flash
 * of chips on a tab switch) and is read again behind it. A toggle writes only
 * its own change, never the clip's whole set from what is shown, and toggles
 * made before the fresh read lands are made again on what it brings.
 */
export function useClipLabels(orgId: string | null, matchIds: readonly string[], surface: string) {
  // One key for the set of games: a single game's is what it always was.
  const gamesKey = matchIds.join(",");
  const cacheKey = `${orgId}|${gamesKey}`;
  const [labels, setLabels] = useState<Label[]>(() => lastRead.get(cacheKey)?.labels ?? []);
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(() => lastRead.get(cacheKey)?.assignments ?? new Map());
  /** The game and space the shown labels belong to, so they are never kept under another's key. */
  const shownKey = useRef<string | null>(orgId && lastRead.has(cacheKey) ? cacheKey : null);
  // Writes read the latest sets, not the ones a handler was created with.
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  /** Toggles shown before the fresh read landed, made again on the sets it brings; null once it has. */
  const early = useRef<{ keys: string[]; labelId: string; on: boolean }[] | null>(null);
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    const cached = orgId ? lastRead.get(cacheKey) : undefined;
    shownKey.current = cached ? cacheKey : null;
    setLabels(cached?.labels ?? []);
    setAssignments(cached?.assignments ?? new Map());
    early.current = orgId ? [] : null;
    if (!orgId) return;
    let cancelled = false;
    void Promise.all([listLabels(orgId), listAssignmentsForMatches(orgId, gamesKey ? gamesKey.split(",") : [])])
      .then(([vocabulary, rows]) => {
        if (cancelled) return;
        shownKey.current = cacheKey;
        setLabels([...vocabulary].sort(byName));
        const next = new Map<string, Set<string>>();
        for (const row of rows) {
          const key = clipKey(row.matchId, row.eventId);
          const set = next.get(key) ?? new Set<string>();
          set.add(row.labelId);
          next.set(key, set);
        }
        for (const t of early.current ?? []) toggleIn(next, t.keys, t.labelId, t.on);
        early.current = null;
        setAssignments(next);
      })
      .catch(() => {
        // The game is still watchable without its labels; the picker shows none.
        if (!cancelled) early.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, orgId, gamesKey]);

  // Kept current through every write, for the next visit.
  useEffect(() => {
    if (shownKey.current) lastRead.set(shownKey.current, { labels, assignments });
  }, [labels, assignments]);

  const patch = useCallback((keys: string[], labelId: string, on: boolean) => {
    early.current?.push({ keys, labelId, on });
    setAssignments((prev) => {
      const next = new Map(prev);
      toggleIn(next, keys, labelId, on);
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
        patch([key], labelId, on);
        try {
          // This label alone: the shown set may be an earlier visit's, and a label put on or taken off elsewhere since stays so.
          await bulkAssign(orgId, [{ matchId: clipMatchId, eventId }], labelId, on ? "add" : "remove");
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
