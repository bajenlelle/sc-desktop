"use client";

/**
 * Labels on the web: the space's vocabulary (one per user and space, shared
 * by both scopes) and the labels on clips in one scope, the playlist's own
 * (`playlist_id` = the playlist, what the editor shows) or the bank's
 * (`playlist_id IS NULL`, what the add-clips panel filters by), as the
 * desktop keeps them (labels-db.ts). Every change shows at once and is put
 * back with a toast if its write fails.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  bulkAssign,
  createLabel,
  deleteLabel,
  listAssignmentsForClips,
  listLabels,
  seedDefaultLabels,
  updateLabel,
  type LabelScope,
} from "@scoutable/shared/lib/labels-db";
import type { ClipKey, Label, LabelColor } from "@scoutable/shared/types/labels";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/** A label's place across the clips it is offered for: on all of them, some, or none. */
export type LabelTriState = "all" | "some" | "none";

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name, "sv");
const clipKey = (c: ClipKey) => `${c.matchId}:${c.eventId}`;
const RETRY = "Check your connection and try again.";

/** What the picker does to the vocabulary; each resolves once the write has landed or been put back. */
export interface LabelActions {
  /** The new label, or null when it couldn't be made (the toast says so). */
  create: (name: string, color: LabelColor) => Promise<Label | null>;
  rename: (id: string, name: string) => void;
  recolor: (id: string, color: LabelColor) => void;
  /** Asks first: deleting takes the label off every clip. */
  requestDelete: (label: Label) => void;
  seedDefaults: () => Promise<void>;
}

/**
 * The space's labels, sorted by name. Deleting asks first through
 * `deleting` (the caller shows the one confirmation), then calls
 * `onDeleted` so the clips' sets drop the label; its undo runs if the
 * delete fails.
 */
export function useLabels(orgId: string | null, { onDeleted }: { onDeleted?: (labelId: string) => () => void } = {}) {
  // Keyed by space, so another space reads as empty at once rather than showing the last one's.
  const [state, setState] = useState<{ orgId: string | null; labels: Label[]; loaded: boolean }>({ orgId: null, labels: [], loaded: false });
  const labels = useMemo(() => (state.orgId === orgId ? state.labels : []), [state, orgId]);
  const loaded = state.orgId === orgId && state.loaded;
  const labelsRef = useRef(labels);
  const onDeletedRef = useRef(onDeleted);
  useLayoutEffect(() => {
    labelsRef.current = labels;
    onDeletedRef.current = onDeleted;
  });

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void listLabels(createClient(), orgId).then((rows) => {
      if (!cancelled) setState({ orgId, labels: [...rows].sort(byName), loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const setLabels = useCallback(
    (fn: (prev: Label[]) => Label[]) =>
      setState((s) => (s.orgId === orgId ? { ...s, labels: fn(s.labels) } : { orgId, labels: fn([]), loaded: false })),
    [orgId],
  );

  const create = useCallback(
    async (name: string, color: LabelColor): Promise<Label | null> => {
      if (!orgId) return null;
      try {
        const made = await createLabel(createClient(), orgId, name, color);
        setLabels((prev) => [...prev.filter((l) => l.id !== made.id), made].sort(byName));
        trackEvent("label_created", { seeded: false, origin: "web" });
        return made;
      } catch {
        toast.error("Couldn't create the label", { description: RETRY });
        return null;
      }
    },
    [orgId, setLabels],
  );

  /** A name or colour shown at once and written behind; put back when the write fails. */
  const change = useCallback(
    function change(id: string, patch: { name?: string; color?: LabelColor }) {
      const was = labelsRef.current.find((l) => l.id === id);
      if (!was) return;
      const next = { ...was, ...patch };
      if (next.name === was.name && next.color === was.color) return;
      setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)).sort(byName));
      updateLabel(createClient(), id, patch).catch(() => {
        // Only what this change set: a later one may have landed since.
        setLabels((prev) =>
          prev
            .map((l) => (l.id === id && (patch.name === undefined || l.name === patch.name) && (patch.color === undefined || l.color === patch.color) ? { ...l, name: was.name, color: was.color } : l))
            .sort(byName),
        );
        toast.error(patch.name !== undefined ? "Couldn't rename the label" : "Couldn't change the label's colour", {
          description: RETRY,
          action: { label: "Try again", onClick: () => change(id, patch) },
        });
      });
    },
    [setLabels],
  );
  const rename = useCallback((id: string, name: string) => change(id, { name: name.trim() }), [change]);
  const recolor = useCallback((id: string, color: LabelColor) => change(id, { color }), [change]);

  // Kept, closed, after an answer, so the dialog's words stay put on the way out.
  const [deleting, setDeleting] = useState<{ label: Label; open: boolean } | null>(null);
  const requestDelete = useCallback((label: Label) => setDeleting({ label, open: true }), []);

  const remove = useCallback(
    function remove(label: Label) {
      const undoStrip = onDeletedRef.current?.(label.id);
      setLabels((prev) => prev.filter((l) => l.id !== label.id));
      deleteLabel(createClient(), label.id).catch(() => {
        setLabels((prev) => (prev.some((l) => l.id === label.id) ? prev : [...prev, label].sort(byName)));
        undoStrip?.();
        toast.error("Couldn't delete the label", {
          description: "It's back on its clips.",
          action: { label: "Try again", onClick: () => remove(label) },
        });
      });
    },
    [setLabels],
  );

  const seedDefaults = useCallback(async () => {
    if (!orgId) return;
    const supabase = createClient();
    try {
      await seedDefaultLabels(supabase, orgId);
    } catch {
      toast.error("Couldn't add the labels", { description: RETRY });
      return;
    }
    trackEvent("label_created", { seeded: true, origin: "web" });
    const rows = await listLabels(supabase, orgId);
    setLabels(() => [...rows].sort(byName));
  }, [orgId, setLabels]);

  const actions = useMemo<LabelActions>(() => ({ create, rename, recolor, requestDelete, seedDefaults }), [create, rename, recolor, requestDelete, seedDefaults]);

  return {
    labels,
    loaded,
    actions,
    /** The label whose delete is being asked about, and whether the question is still up. */
    deleting,
    cancelDelete: () => setDeleting((d) => (d ? { ...d, open: false } : d)),
    confirmDelete: () => {
      if (deleting?.open) remove(deleting.label);
      setDeleting((d) => (d ? { ...d, open: false } : d));
    },
  };
}

export type LabelsApi = ReturnType<typeof useLabels>;

/** The last thing done to one label on one clip here: what the clip should show, and whether its write is still out. */
type Op = { mode: "add" | "remove"; token: number; inFlight: boolean };

function setOp(all: Map<string, Map<string, Op>>, key: string, labelId: string, op: Op): void {
  const ops = all.get(key) ?? new Map<string, Op>();
  ops.set(labelId, op);
  all.set(key, ops);
}

/**
 * The labels on a set of clips in one scope, keyed `matchId:eventId`. Clips
 * are read the first time they appear (so the editor's list growing, or the
 * add-clips panel moving to another game, reads only what is new). A toggle
 * is per label (`bulkAssign`), never a replace of a clip's whole set, so it
 * is safe before the clip's labels have arrived; a read that answers after
 * a toggle keeps the toggle (any whose write was still out when the read
 * began, or that came after it).
 */
export function useLabelAssignments({
  orgId,
  scope,
  clips,
  enabled = true,
}: {
  orgId: string | null;
  /** The playlist's id for its own labels, null for the bank. */
  scope: LabelScope;
  clips: readonly ClipKey[];
  enabled?: boolean;
}) {
  const id = enabled && orgId ? `${orgId}|${scope ?? "bank"}` : null;
  const [state, setState] = useState<{ id: string | null; byClip: Map<string, Set<string>> }>(() => ({ id: null, byClip: new Map() }));
  const byClip = useMemo<ReadonlyMap<string, ReadonlySet<string>>>(() => (state.id === id ? state.byClip : new Map()), [state, id]);
  const byClipRef = useRef(byClip);
  useLayoutEffect(() => {
    byClipRef.current = byClip;
  });

  const fetchedRef = useRef<{ id: string | null; keys: Set<string> }>({ id: null, keys: new Set() });
  /** The toggles made here, laid over whatever a read brings back. */
  const opsRef = useRef<Map<string, Map<string, Op>>>(new Map());
  const tokenRef = useRef(0);

  /** Applies a change to the sets, starting from an empty map when the scope changed. */
  const update = useCallback(
    (fn: (map: Map<string, Set<string>>) => void) => {
      setState((s) => {
        const map = new Map(s.id === id ? s.byClip : []);
        fn(map);
        return { id, byClip: map };
      });
    },
    [id],
  );

  const clipsKey = clips.map(clipKey).join(",");
  useEffect(() => {
    if (!id || !orgId) return;
    if (fetchedRef.current.id !== id) {
      fetchedRef.current = { id, keys: new Set() };
      opsRef.current = new Map();
    }
    const fetched = fetchedRef.current.keys;
    const missing = clips.filter((c) => !fetched.has(clipKey(c)));
    if (missing.length === 0) return;
    for (const c of missing) fetched.add(clipKey(c));
    let cancelled = false;
    const since = tokenRef.current;
    void listAssignmentsForClips(createClient(), orgId, missing, scope).then((rows) => {
      if (cancelled || fetchedRef.current.id !== id) return;
      const fresh = new Map<string, Set<string>>(missing.map((c) => [clipKey(c), new Set<string>()]));
      for (const r of rows) fresh.get(`${r.matchId}:${r.eventId}`)?.add(r.labelId);
      update((map) => {
        for (const [key, set] of fresh) {
          // The read may predate these: a write still out when it began, or a toggle since.
          for (const [labelId, op] of opsRef.current.get(key) ?? []) {
            if (!op.inFlight && op.token <= since) continue;
            if (op.mode === "add") set.add(labelId);
            else set.delete(labelId);
          }
          map.set(key, set);
        }
      });
    });
    return () => {
      cancelled = true;
      // Not read after all: the next run asks again.
      if (fetchedRef.current.id === id) for (const c of missing) fetchedRef.current.keys.delete(clipKey(c));
    };
    // clipsKey stands for the clips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId, clipsKey, update]);

  /**
   * One label on or off for `targets`: "all" takes it off, "some" and
   * "none" put it on every one of them (the desktop's rule). `bulk` says
   * whether a selection asked, for the analytics.
   */
  const toggle = useCallback(
    function toggle(targets: readonly ClipKey[], labelId: string, current: LabelTriState, bulk: boolean) {
      if (!orgId || !id || targets.length === 0) return;
      const mode = current === "all" ? "remove" : "add";
      const keys = targets.map(clipKey);
      const had = new Map(keys.map((k) => [k, byClipRef.current.get(k)?.has(labelId) ?? false]));
      const token = ++tokenRef.current;
      for (const k of keys) setOp(opsRef.current, k, labelId, { mode, token, inFlight: true });
      /** This toggle's write is done; `back` marks the clips as they were (it failed). */
      const settle = (back: boolean) => {
        const next = back ? ++tokenRef.current : token;
        for (const k of keys) {
          if (opsRef.current.get(k)?.get(labelId)?.token !== token) continue;
          setOp(opsRef.current, k, labelId, { mode: back ? (had.get(k) ? "add" : "remove") : mode, token: next, inFlight: false });
        }
      };
      update((map) => {
        for (const k of keys) {
          const set = new Set(map.get(k) ?? []);
          if (mode === "add") set.add(labelId);
          else set.delete(labelId);
          map.set(k, set);
        }
      });
      bulkAssign(createClient(), orgId, [...targets], labelId, mode, scope)
        .then(() => {
          settle(false);
          if (mode === "add") trackEvent("label_applied", { bulk, origin: "web" });
        })
        .catch(() => {
          // Back to what each clip had, unless a later toggle of this label has taken it over since.
          const mine = keys.filter((k) => opsRef.current.get(k)?.get(labelId)?.token === token);
          settle(true);
          update((map) => {
            for (const k of mine) {
              const set = new Set(map.get(k) ?? []);
              if (had.get(k)) set.add(labelId);
              else set.delete(labelId);
              map.set(k, set);
            }
          });
          toast.error(mode === "add" ? "Couldn't add the label" : "Couldn't remove the label", {
            description: RETRY,
            action: { label: "Try again", onClick: () => toggle(targets, labelId, current, bulk) },
          });
        });
    },
    [orgId, id, scope, update],
  );

  /** A deleted label off every clip at once; answers how to put it back if the delete fails. */
  const forget = useCallback(
    (labelId: string) => {
      const had = [...byClipRef.current].filter(([, set]) => set.has(labelId)).map(([k]) => k);
      if (had.length === 0) return () => {};
      update((map) => {
        for (const k of had) {
          const set = new Set(map.get(k) ?? []);
          set.delete(labelId);
          map.set(k, set);
        }
      });
      return () =>
        update((map) => {
          for (const k of had) map.set(k, new Set([...(map.get(k) ?? []), labelId]));
        });
    },
    [update],
  );

  return { byClip, toggle, forget };
}

export type LabelAssignments = ReturnType<typeof useLabelAssignments>;

/** Which labels sit on all of the clips and which on only some of them, for a selection's picker. */
export function triStateOf(keys: readonly string[], byClip: ReadonlyMap<string, ReadonlySet<string>>): { all: Set<string>; some: Set<string> } {
  const all = new Set<string>();
  const some = new Set<string>();
  if (keys.length === 0) return { all, some };
  const counts = new Map<string, number>();
  for (const k of keys) for (const labelId of byClip.get(k) ?? []) counts.set(labelId, (counts.get(labelId) ?? 0) + 1);
  for (const [labelId, n] of counts) (n === keys.length ? all : some).add(labelId);
  return { all, some };
}

/** `matchId:eventId` back into its parts (clip keys only; a card's key is not one). */
export function clipKeyOf(key: string): ClipKey | null {
  if (key.startsWith("text:")) return null;
  const colon = key.lastIndexOf(":");
  const eventId = Number(key.slice(colon + 1));
  return colon > 0 && Number.isFinite(eventId) ? { matchId: key.slice(0, colon), eventId } : null;
}
