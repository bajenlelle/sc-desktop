import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchPlayerPhotos } from "@scoutable/shared/lib/player-photos";

// Module scope: photos change at most weekly (the roster sync), and the report
// view and its picker mount and unmount often. An id asked for once is never
// asked for again this session, with or without a photo.
const known = new Map<string, string | null>();
const listeners = new Set<() => void>();
let inFlight: Promise<void> = Promise.resolve();

function load(ids: readonly string[]): void {
  const todo = [...new Set(ids)].filter((id) => !known.has(id));
  if (todo.length === 0) return;
  for (const id of todo) known.set(id, null); // claimed: no second request while this one runs
  inFlight = inFlight.then(async () => {
    const found = await fetchPlayerPhotos(createClient(), todo);
    for (const [id, key] of found) known.set(id, key);
    if (found.size > 0) for (const l of listeners) l();
  });
}

/** Photo keys (lib/player-photos.ts) by player id, for the ids given; ids without a photo are absent. */
export function usePlayerPhotos(ids: readonly string[]): ReadonlyMap<string, string> {
  const [version, setVersion] = useState(0);
  const idKey = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (idKey) load(idKey.split(","));
  }, [idKey]);

  return useMemo(() => {
    const out = new Map<string, string>();
    for (const id of idKey ? idKey.split(",") : []) {
      const key = known.get(id);
      if (key) out.set(id, key);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version marks new arrivals in `known`
  }, [idKey, version]);
}
