import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useNavEntryId } from "@/lib/nav-history";

/**
 * How each page in the history was left (docs/navigation.md): its scroll, the filters and the ticked games of a
 * team's plays, the playlist open in the editor. Kept per history entry (lib/nav-history.ts), so Back returns to a
 * page as it was, while a new visit to the same page (a link, the sidebar) starts fresh: it is a new entry, with
 * nothing kept. In memory only: a reload starts the history, and this, over.
 */

/** Entries kept; the oldest go first. Back rarely reaches further. */
const LIMIT = 60;

const memory = new Map<number, Map<string, unknown>>();

function slotsOf(entry: number, create: true): Map<string, unknown>;
function slotsOf(entry: number, create: false): Map<string, unknown> | undefined;
function slotsOf(entry: number, create: boolean) {
  let slots = memory.get(entry);
  if (!slots && create) {
    slots = new Map();
    memory.set(entry, slots);
    while (memory.size > LIMIT) memory.delete(memory.keys().next().value!);
  }
  return slots;
}

export function rememberPage(entry: number, slot: string, value: unknown) {
  if (!entry) return;
  slotsOf(entry, true).set(slot, value);
}

export function recallPage<T>(entry: number, slot: string): T | undefined {
  return slotsOf(entry, false)?.get(slot) as T | undefined;
}

/**
 * What this page kept in `slot` when it was left, read once as it mounts: there only when the coach came back to
 * this entry (Back, Forward), never on a new visit.
 */
export function useRecalled<T>(slot: string): T | undefined {
  const entry = useNavEntryId();
  const [value] = useState(() => recallPage<T>(entry, slot));
  return value;
}

/** Keeps `value` in `slot` for this entry, whenever it changes. */
export function useRememberPage(slot: string, value: unknown) {
  const entry = useNavEntryId();
  useEffect(() => {
    rememberPage(entry, slot, value);
  }, [entry, slot, value]);
}

/** How long a restored scroll waits for the page's content to grow tall enough (a season read from the network). */
const RESTORE_WAIT_MS = 4000;

/**
 * A scroller's position kept for its entry, and put back when the page is shown again from the history. The
 * content may still be arriving: the position is set as soon as the content is tall enough, until the coach
 * scrolls, presses, or a few seconds pass.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, slot: string) {
  const entry = useNavEntryId();
  const [target] = useState(() => recallPage<number>(entry, `scroll:${slot}`));
  const restoring = useRef(target !== undefined && target > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !restoring.current || target === undefined) return;
    const stop = () => {
      restoring.current = false;
      observer.disconnect();
      window.clearTimeout(timer);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("keydown", stop);
    };
    const tryRestore = () => {
      if (!restoring.current) return;
      const room = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.min(target, room);
      if (room >= target) stop();
    };
    const observer = new ResizeObserver(tryRestore);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    const timer = window.setTimeout(stop, RESTORE_WAIT_MS);
    // The coach taking over ends it.
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("pointerdown", stop);
    el.addEventListener("keydown", stop);
    tryRestore();
    return stop;
  }, [ref, target]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      // The position being put back is not the coach's.
      if (!restoring.current) rememberPage(entry, `scroll:${slot}`, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, entry, slot]);
}
