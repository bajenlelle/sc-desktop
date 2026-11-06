/**
 * The drawing being made in the editor: its shapes, the tool, the arrow kind
 * and colour for the next shape, the selection, and an undo history of its
 * own (⌘Z while drawing undoes the last shape change, not the playlist's).
 * State only; the page saves the drawing. The ref is the source of truth so
 * `end()` sees a change made in the same event.
 */
import { useCallback, useState } from "react";
import { useRef } from "react";
import {
  clampShape,
  DEFAULT_DRAWING_COLOR,
  HOLD_MAX,
  HOLD_MIN,
  type ArrowKind,
  type ClipDrawing,
  type DrawingColor,
  type DrawingShape,
} from "@scoutable/shared/lib/clip-drawing";

export type DrawTool = "spotlight" | "arrow" | "text";

export interface DrawSession {
  /** `matchId:eventId` of the clip drawn on. */
  clipKey: string;
  drawing: ClipDrawing;
  tool: DrawTool;
  arrowKind: ArrowKind;
  color: DrawingColor;
  selectedId: string | null;
  past: DrawingShape[][];
  future: DrawingShape[][];
}

const HISTORY = 50;

function recorded(s: DrawSession, shapes: DrawingShape[], selectedId: string | null = s.selectedId): DrawSession {
  return { ...s, drawing: { ...s.drawing, shapes }, past: [...s.past, s.drawing.shapes].slice(-HISTORY), future: [], selectedId };
}

export function useDrawSession() {
  const [session, setSession] = useState<DrawSession | null>(null);
  const ref = useRef<DrawSession | null>(null);

  const update = useCallback((fn: (s: DrawSession) => DrawSession) => {
    const s = ref.current;
    if (!s) return;
    const next = fn(s);
    ref.current = next;
    setSession(next);
  }, []);

  const start = useCallback((clipKey: string, drawing: ClipDrawing) => {
    const s: DrawSession = {
      clipKey,
      drawing,
      tool: "spotlight",
      arrowKind: "cut",
      color: DEFAULT_DRAWING_COLOR,
      selectedId: null,
      past: [],
      future: [],
    };
    ref.current = s;
    setSession(s);
  }, []);

  /** Ends the session and hands back the drawing (possibly without shapes); null when none was open. */
  const end = useCallback((): ClipDrawing | null => {
    const s = ref.current;
    ref.current = null;
    setSession(null);
    return s?.drawing ?? null;
  }, []);

  const addShape = useCallback((shape: DrawingShape) => {
    update((s) => recorded(s, [...s.drawing.shapes, clampShape(shape)], shape.id));
  }, [update]);

  /** A change to one shape; `record: false` while dragging (pushHistory records the drag when it ends). */
  const updateShape = useCallback(
    (id: string, patch: Partial<DrawingShape>, opts: { record?: boolean } = {}) => {
      update((s) => {
        const shapes = s.drawing.shapes.map((x) => (x.id === id ? clampShape({ ...x, ...patch } as DrawingShape) : x));
        return opts.record === false ? { ...s, drawing: { ...s.drawing, shapes } } : recorded(s, shapes);
      });
    },
    [update],
  );

  /** Records the shapes as they were before a drag, unless the drag changed nothing. */
  const pushHistory = useCallback(
    (snapshot: DrawingShape[]) => {
      update((s) =>
        JSON.stringify(snapshot) === JSON.stringify(s.drawing.shapes)
          ? s
          : { ...s, past: [...s.past, snapshot].slice(-HISTORY), future: [] },
      );
    },
    [update],
  );

  const removeShape = useCallback((id: string) => {
    update((s) => recorded(s, s.drawing.shapes.filter((x) => x.id !== id), s.selectedId === id ? null : s.selectedId));
  }, [update]);

  const select = useCallback((id: string | null) => update((s) => ({ ...s, selectedId: id })), [update]);

  const setTool = useCallback((tool: DrawTool) => update((s) => ({ ...s, tool, selectedId: null })), [update]);

  /** The kind for the next arrow, and for the selected arrow. */
  const setArrowKind = useCallback(
    (kind: ArrowKind) => {
      update((s) => {
        const sel = s.drawing.shapes.find((x) => x.id === s.selectedId);
        const base: DrawSession = { ...s, arrowKind: kind, tool: "arrow", selectedId: sel?.kind === "arrow" ? sel.id : null };
        return sel?.kind === "arrow" && sel.arrow !== kind
          ? recorded(base, s.drawing.shapes.map((x) => (x.id === sel.id ? { ...sel, arrow: kind } : x)))
          : base;
      });
    },
    [update],
  );

  /** The colour for the next arrow or label, and for the selected one. */
  const setColor = useCallback(
    (color: DrawingColor) => {
      update((s) => {
        const sel = s.drawing.shapes.find((x) => x.id === s.selectedId);
        const base = { ...s, color };
        return sel && sel.kind !== "spotlight" && sel.color !== color
          ? recorded(base, s.drawing.shapes.map((x) => (x.id === sel.id ? { ...sel, color } : x)))
          : base;
      });
    },
    [update],
  );

  const setHold = useCallback(
    (hold: number) => update((s) => ({ ...s, drawing: { ...s.drawing, hold: Math.min(HOLD_MAX, Math.max(HOLD_MIN, hold)) } })),
    [update],
  );

  const undo = useCallback(() => {
    update((s) =>
      s.past.length === 0
        ? s
        : {
            ...s,
            drawing: { ...s.drawing, shapes: s.past[s.past.length - 1] },
            past: s.past.slice(0, -1),
            future: [s.drawing.shapes, ...s.future],
            selectedId: null,
          },
    );
  }, [update]);

  const redo = useCallback(() => {
    update((s) =>
      s.future.length === 0
        ? s
        : {
            ...s,
            drawing: { ...s.drawing, shapes: s.future[0] },
            past: [...s.past, s.drawing.shapes],
            future: s.future.slice(1),
            selectedId: null,
          },
    );
  }, [update]);

  return {
    session,
    start,
    end,
    addShape,
    updateShape,
    pushHistory,
    removeShape,
    select,
    setTool,
    setArrowKind,
    setColor,
    setHold,
    undo,
    redo,
    canUndo: !!session && session.past.length > 0,
    canRedo: !!session && session.future.length > 0,
  };
}
