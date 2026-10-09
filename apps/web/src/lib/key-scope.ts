/**
 * One owner for document-level keys at a time.
 *
 * Surfaces register a scope while they are open (the editor page, the Add
 * Clips sheet, the tip-off picker); only the most recently opened scope's
 * hotkeys fire, so Space never toggles two players and arrows never move
 * two lists. Keys typed into fields are always left alone, and a scope with
 * no container of its own yields to any open dialog.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const stack: string[] = [];
const containers = new Map<string, RefObject<HTMLElement | null> | undefined>();

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

export function isTopKeyScope(id: string): boolean {
  return stack[stack.length - 1] === id;
}

export function useKeyScope(id: string, active = true, container?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!active) return;
    stack.push(id);
    containers.set(id, container);
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      containers.delete(id);
    };
  }, [id, active, container]);
}

export function useHotkeys(id: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (!isTopKeyScope(id)) return;
      if (isEditable(e.target)) return;
      const container = containers.get(id)?.current;
      if (container) {
        // Scoped to a surface: keys from elsewhere (a dialog stacked on top)
        // are not ours.
        if (e.target instanceof Node && e.target !== document.body && !container.contains(e.target)) return;
      } else if (document.querySelector('[role="dialog"][data-state="open"]')) {
        return;
      }
      handlerRef.current(e);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [id, enabled]);
}
