import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClipFilters } from "@scoutable/shared/lib/clip-filters";
import type { FilterPreset } from "@scoutable/shared/lib/filter-presets";
import { trackEvent } from "@/lib/analytics";
import {
  createFilterPreset,
  deleteFilterPreset,
  listFilterPresets,
  renameFilterPreset,
} from "@/lib/filter-presets-db";

export type FilterPresetSurface = "add_clips" | "game_view";

const byName = (a: FilterPreset, b: FilterPreset) => a.name.localeCompare(b.name);
/** The unique index compares lower(name); so does the check made here before writing. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** How many filter groups hold a value. */
function groupCount(f: ClipFilters): number {
  return [f.types, f.shotTypes, f.situations, f.teams, f.players, f.labels ?? new Set()].filter((g) => g.size > 0).length;
}

/**
 * Whether fitting a preset to what is on screen emptied a group it holds: a
 * "Player X" preset applied to games without X would otherwise quietly mean
 * every player. `kept` is how many of each group's values were kept.
 */
export function presetDropsGroup(preset: ClipFilters, kept: { teams: number; players: number; labels: number }): boolean {
  return (
    (preset.teams.size > 0 && kept.teams === 0) ||
    (preset.players.size > 0 && kept.players === 0) ||
    ((preset.labels?.size ?? 0) > 0 && kept.labels === 0)
  );
}

/**
 * The coach's filter presets in one space (filter_presets), read when the
 * space changes and written through at once: a failed write is taken back and
 * said. A name already in the list is refused before anything is written.
 */
export function useFilterPresets(orgId: string | null, surface: FilterPresetSurface) {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  // Writes read the latest list and space, not the ones a handler was created with.
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  useEffect(() => {
    setPresets([]);
    if (!orgId) return;
    let cancelled = false;
    void listFilterPresets(orgId)
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch(() => {
        // Filtering works without presets; the menu shows none.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  /** Changes the list only while its space is still the one on screen. */
  const update = useCallback((org: string, change: (prev: FilterPreset[]) => FilterPreset[]) => {
    if (orgRef.current === org) setPresets(change);
  }, []);

  /** Saves into `org`, the space the coach was in when they asked (Undo's may be another than the one on screen now). */
  const saveIn = useCallback(
    async (org: string | null, name: string, filters: ClipFilters): Promise<"ok" | "duplicate_name"> => {
      const trimmed = name.trim();
      if (!org || !trimmed) return "ok";
      if (orgRef.current === org && presetsRef.current.some((p) => sameName(p.name, trimmed))) return "duplicate_name";
      const pendingId = `pending:${crypto.randomUUID()}`;
      const pending: FilterPreset = { id: pendingId, name: trimmed, filters, createdAt: new Date().toISOString() };
      update(org, (prev) => [...prev, pending].sort(byName));
      try {
        const created = await createFilterPreset(org, trimmed, filters);
        update(org, (prev) => prev.map((p) => (p.id === pendingId ? created : p)));
        trackEvent("filter_preset_saved", { surface, groups: groupCount(filters) });
        return "ok";
      } catch (err) {
        update(org, (prev) => prev.filter((p) => p.id !== pendingId));
        if (err instanceof Error && err.message === "duplicate_name") return "duplicate_name";
        toast.error("Couldn't save the preset. Try again.");
        return "ok";
      }
    },
    [surface, update],
  );
  const save = useCallback((name: string, filters: ClipFilters) => saveIn(orgRef.current, name, filters), [saveIn]);

  const rename = useCallback(
    async (id: string, name: string): Promise<"ok" | "duplicate_name"> => {
      const org = orgRef.current;
      const trimmed = name.trim();
      const before = presetsRef.current.find((p) => p.id === id);
      if (!org || !trimmed || !before || before.name === trimmed) return "ok";
      if (presetsRef.current.some((p) => p.id !== id && sameName(p.name, trimmed))) return "duplicate_name";
      const setName = (n: string) => update(org, (prev) => prev.map((p) => (p.id === id ? { ...p, name: n } : p)).sort(byName));
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
      const org = orgRef.current;
      if (!org) return;
      update(org, (prev) => prev.filter((p) => p.id !== preset.id));
      const deleting = deleteFilterPreset(preset.id).then(
        () => true,
        () => {
          update(org, (prev) => (prev.some((p) => p.id === preset.id) ? prev : [...prev, preset].sort(byName)));
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
              if (deleted) void saveIn(org, preset.name, preset.filters);
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
