import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClipFilters } from "@scoutable/shared/lib/clip-filters";
import { PRESET_GROUPS, presetFilters, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  createFilterPreset,
  deleteFilterPreset,
  listFilterPresets,
  renameFilterPreset,
} from "@/lib/filter-presets-db";

export type FilterPresetSurface = "add_clips" | "game_view" | "team_plays" | "playlist";

const byName = (a: FilterPreset, b: FilterPreset) => a.name.localeCompare(b.name);
/** The unique index compares lower(name); so does the check made here before writing. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The last list of each space's presets, per signed-in user: what a mounted
 * hook last read or wrote. A hook starts from it, so a menu opened again is
 * filled at once while the new read runs; every change a hook makes is written
 * here too, for the space it was made in, so the list never goes stale. It
 * lives as long as the page, and a key names its user, so one user's list is
 * never another's.
 */
const kept = new Map<string, FilterPreset[]>();
const keptKey = (userId: string | null, orgId: string | null) => (userId && orgId ? `${userId}:${orgId}` : null);

/** How many of the preset's groups hold a value. */
function groupCount(f: ClipFilters): number {
  return PRESET_GROUPS.filter((g) => (f[g]?.size ?? 0) > 0).length;
}

/**
 * The coach's filter presets in one space (filter_presets), shown from the
 * last list kept for the space and read again when the space changes, written
 * through at once: a failed write is taken back and said. A name already in
 * the list is refused before anything is written.
 * `save` keeps the preset groups of the filters it is given (plays, shot
 * types, situations, labels), never the team or players.
 */
export function useFilterPresets(orgId: string | null, surface: FilterPresetSurface) {
  const userId = useAuth().user?.id ?? null;
  const [presets, setPresets] = useState<FilterPreset[]>(() => {
    const key = keptKey(userId, orgId);
    return (key && kept.get(key)) || [];
  });
  // Writes read the latest list, space and user, not the ones a handler was created with.
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  const orgRef = useRef(orgId);
  orgRef.current = orgId;
  const userRef = useRef(userId);
  userRef.current = userId;

  useEffect(() => {
    const key = keptKey(userId, orgId);
    setPresets((key && kept.get(key)) || []);
    if (!key || !orgId) return;
    let cancelled = false;
    void listFilterPresets(orgId)
      .then((list) => {
        if (cancelled) return;
        kept.set(key, list);
        setPresets(list);
      })
      .catch(() => {
        // Filtering works without presets; the menu keeps what it showed.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  const isShown = useCallback((user: string | null, org: string) => userRef.current === user && orgRef.current === org, []);

  /**
   * Changes the list of `org` for `user` (the space and user the coach asked in): the kept list
   * always, the one on screen only while that space and user are still the ones on screen.
   */
  const update = useCallback((user: string | null, org: string, change: (prev: FilterPreset[]) => FilterPreset[]) => {
    const onScreen = isShown(user, org);
    const key = keptKey(user, org);
    if (!key) {
      if (onScreen) setPresets(change);
      return;
    }
    const next = change(kept.get(key) ?? (onScreen ? presetsRef.current : []));
    kept.set(key, next);
    if (onScreen) setPresets(next);
  }, [isShown]);

  /** Saves into `org`, the space the coach was in when they asked (Undo's may be another than the one on screen now). */
  const saveIn = useCallback(
    async (user: string | null, org: string | null, name: string, current: ClipFilters): Promise<"ok" | "duplicate_name"> => {
      const trimmed = name.trim();
      if (!org || !trimmed) return "ok";
      if (isShown(user, org) && presetsRef.current.some((p) => sameName(p.name, trimmed))) return "duplicate_name";
      const filters = presetFilters(current);
      const pendingId = `pending:${crypto.randomUUID()}`;
      const pending: FilterPreset = { id: pendingId, name: trimmed, filters, createdAt: new Date().toISOString() };
      update(user, org, (prev) => [...prev, pending].sort(byName));
      try {
        const created = await createFilterPreset(org, trimmed, filters);
        update(user, org, (prev) => prev.map((p) => (p.id === pendingId ? created : p)));
        trackEvent("filter_preset_saved", { surface, groups: groupCount(filters) });
        return "ok";
      } catch (err) {
        update(user, org, (prev) => prev.filter((p) => p.id !== pendingId));
        if (err instanceof Error && err.message === "duplicate_name") return "duplicate_name";
        toast.error("Couldn't save the preset. Try again.");
        return "ok";
      }
    },
    [surface, update, isShown],
  );
  const save = useCallback((name: string, filters: ClipFilters) => saveIn(userRef.current, orgRef.current, name, filters), [saveIn]);

  const rename = useCallback(
    async (id: string, name: string): Promise<"ok" | "duplicate_name"> => {
      const user = userRef.current;
      const org = orgRef.current;
      const trimmed = name.trim();
      const before = presetsRef.current.find((p) => p.id === id);
      if (!org || !trimmed || !before || before.name === trimmed) return "ok";
      if (presetsRef.current.some((p) => p.id !== id && sameName(p.name, trimmed))) return "duplicate_name";
      const setName = (n: string) => update(user, org, (prev) => prev.map((p) => (p.id === id ? { ...p, name: n } : p)).sort(byName));
      setName(trimmed);
      try {
        await renameFilterPreset(id, trimmed);
        return "ok";
      } catch (err) {
        setName(before.name);
        if (err instanceof Error && err.message === "duplicate_name") return "duplicate_name";
        toast.error("Couldn't rename the preset. Try again.");
        return "ok";
      }
    },
    [update],
  );

  const remove = useCallback(
    (preset: FilterPreset) => {
      const user = userRef.current;
      const org = orgRef.current;
      if (!org) return;
      update(user, org, (prev) => prev.filter((p) => p.id !== preset.id));
      const deleting = deleteFilterPreset(preset.id).then(
        () => true,
        () => {
          update(user, org, (prev) => (prev.some((p) => p.id === preset.id) ? prev : [...prev, preset].sort(byName)));
          toast.error("Couldn't delete the preset. Try again.");
          return false;
        },
      );
      toast(`Deleted “${preset.name}”`, {
        // Undo makes it again (same name and filters, a new id) once the delete has gone through,
        // so the name is free; a delete that failed has already put it back.
        action: {
          label: "Undo",
          onClick: () => {
            void deleting.then((deleted) => {
              if (deleted) void saveIn(user, org, preset.name, preset.filters);
            });
          },
        },
      });
    },
    [saveIn, update],
  );

  const applied = useCallback(
    (_preset: FilterPreset) => {
      trackEvent("filter_preset_applied", { surface });
    },
    [surface],
  );

  return { presets, save, rename, remove, applied };
}
