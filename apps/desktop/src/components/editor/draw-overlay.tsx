/**
 * Drawing on the frame: the layer over the footage while the editor is in
 * draw mode. A click with Spotlight places one, a drag with Arrow draws one,
 * a click with Text opens a field; a click on a shape selects it (drag to
 * move, drag a handle to resize, move an end or bend), Delete removes it.
 * Points are fractions of the 16:9 frame inside the stage, like every
 * player's. Divs and inline SVG only: nothing canvas-backed may sit over
 * the editor's video. Its own key scope (like trim's) keeps the editor's
 * keys quiet: T is not trim here, and Backspace never takes the clip.
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  arrowPolyline,
  hitTest,
  labelText,
  LABEL_MAX_CHARS,
  SPOTLIGHT_ASPECT,
  SPOTLIGHT_DEFAULT_R,
  spotlightEllipse,
  type ArrowKind,
  type DrawingPoint,
  type DrawingShape,
} from "@scoutable/shared/lib/clip-drawing";
import { loadCardFonts } from "@/lib/card-painter";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { DrawingLabels, DrawingShapes, type Frame } from "@/components/player/drawing-svg";
import { useFrameBox } from "@/components/player/frame-box";
import type { DrawSession, DrawTool } from "./use-draw-session";

type Handle = "r" | "from" | "to" | "bend";
type Drag =
  | { mode: "move"; id: string; start: DrawingPoint; orig: DrawingShape; snapshot: DrawingShape[] }
  | { mode: "handle"; id: string; handle: Handle; snapshot: DrawingShape[] }
  | { mode: "new-arrow"; from: DrawingPoint; to: DrawingPoint };

const TOOL_KEYS: Record<string, DrawTool> = { KeyS: "spotlight", KeyA: "arrow", KeyT: "text" };
const ARROW_KEYS: Record<string, ArrowKind> = { Digit1: "cut", Digit2: "pass", Digit3: "screen", Digit4: "dribble" };
/** Pixels of slack around thin shapes when picking them. */
const PICK = 4;
const HANDLE_R = 6;

function Selection({ shape, frame }: { shape: DrawingShape; frame: Frame }) {
  const handle = (name: Handle, x: number, y: number, hollow = false) => (
    <circle
      key={name}
      data-handle={name}
      cx={x}
      cy={y}
      r={hollow ? HANDLE_R - 1 : HANDLE_R}
      fill={hollow ? "rgba(255,255,255,0.35)" : "#fff"}
      stroke={hollow ? "#fff" : "rgba(0,0,0,0.6)"}
      strokeWidth={1.5}
      style={{ pointerEvents: "all", cursor: name === "r" ? "nwse-resize" : "grab" }}
    />
  );
  return (
    <svg
      width={frame.width}
      height={frame.height}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      className="pointer-events-none absolute inset-0 overflow-visible"
      aria-hidden
    >
      {shape.kind === "spotlight" &&
        (() => {
          const e = spotlightEllipse(shape, frame);
          return (
            <>
              <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray="5 4" />
              {handle("r", e.cx + e.rx * Math.SQRT1_2, e.cy + e.ry * Math.SQRT1_2)}
            </>
          );
        })()}
      {shape.kind === "arrow" &&
        (() => {
          const pts = arrowPolyline(shape, frame);
          const a = pts[0];
          const b = pts[pts.length - 1];
          const mid = pts.length > 2 ? pts[Math.floor(pts.length / 2)] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <>
              {handle("bend", mid.x, mid.y, true)}
              {handle("from", a.x, a.y)}
              {handle("to", b.x, b.y)}
            </>
          );
        })()}
    </svg>
  );
}

export function DrawOverlay({
  session,
  onAdd,
  onUpdate,
  onRecord,
  onRemove,
  onSelect,
  onUndo,
  onRedo,
  onTool,
  onArrowKind,
  onDone,
}: {
  session: DrawSession;
  onAdd: (shape: DrawingShape) => void;
  onUpdate: (id: string, patch: Partial<DrawingShape>, opts?: { record?: boolean }) => void;
  onRecord: (snapshot: DrawingShape[]) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onTool: (tool: DrawTool) => void;
  onArrowKind: (kind: ArrowKind) => void;
  onDone: () => void;
}) {
  const [ref, frame] = useFrameBox();
  const boxRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [text, setText] = useState<{ at: DrawingPoint; value: string; editId?: string } | null>(null);
  const textRef = useRef(text);
  const [hover, setHover] = useState(false);
  const shapes = session.drawing.shapes;
  const selected = shapes.find((s) => s.id === session.selectedId) ?? null;
  // A spotlight is picked only with its own tool: with Arrow or Text the
  // press starts on the spotlighted player (its handle still resizes it).
  const pick = (p: DrawingPoint, f: Frame) => hitTest(shapes, p, f, PICK, { spotlights: session.tool === "spotlight" });

  useEffect(() => {
    void loadCardFonts().catch(() => {});
  }, []);

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const setTextState = (t: typeof text) => {
    textRef.current = t;
    setText(t);
  };

  useKeyScope("draw", true);
  useHotkeys("draw", (e) => {
    const onButton = e.target instanceof Element && !!e.target.closest("button");
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.code) {
      case "Escape":
        e.preventDefault();
        onDone();
        return;
      case "Enter":
      case "NumpadEnter":
        if (onButton) return;
        e.preventDefault();
        onDone();
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (session.selectedId) onRemove(session.selectedId);
        return;
      case "Space":
        if (onButton) return;
        e.preventDefault();
        return;
      default:
        if (e.shiftKey) return;
        if (TOOL_KEYS[e.code]) {
          e.preventDefault();
          onTool(TOOL_KEYS[e.code]);
        } else if (ARROW_KEYS[e.code]) {
          e.preventDefault();
          onArrowKind(ARROW_KEYS[e.code]);
        }
    }
  });

  const toPoint = (e: { clientX: number; clientY: number }): DrawingPoint => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  function commitText() {
    const t = textRef.current;
    setTextState(null);
    if (!t) return;
    const value = labelText(t.value);
    if (t.editId) {
      if (value) onUpdate(t.editId, { text: value });
      else onRemove(t.editId);
    } else if (value) {
      onAdd({ kind: "text", id: crypto.randomUUID(), at: t.at, text: value, color: session.color });
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !frame) return;
    e.stopPropagation();
    if (textRef.current) {
      commitText();
      return;
    }
    const p = toPoint(e);
    const handle = (e.target as Element).getAttribute?.("data-handle") as Handle | null;
    if (handle && selected) {
      setDragState({ mode: "handle", id: selected.id, handle, snapshot: shapes });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const hit = pick(p, frame);
    if (hit) {
      onSelect(hit.id);
      setDragState({ mode: "move", id: hit.id, start: p, orig: hit, snapshot: shapes });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (session.tool === "spotlight") {
      onAdd({ kind: "spotlight", id: crypto.randomUUID(), at: p, r: SPOTLIGHT_DEFAULT_R });
      return;
    }
    onSelect(null);
    if (session.tool === "text") {
      // The mouse events that follow this press would focus nothing and blur the new field.
      e.preventDefault();
      setTextState({ at: p, value: "" });
      return;
    }
    setDragState({ mode: "new-arrow", from: p, to: p });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!frame) return;
    const d = dragRef.current;
    const p = toPoint(e);
    if (!d) {
      const over = !!pick(p, frame);
      if (over !== hover) setHover(over);
      return;
    }
    if (d.mode === "new-arrow") {
      setDragState({ ...d, to: p });
      return;
    }
    if (d.mode === "move") {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      const shift = (q: DrawingPoint) => ({ x: q.x + dx, y: q.y + dy });
      const o = d.orig;
      onUpdate(d.id, o.kind === "arrow" ? { from: shift(o.from), to: shift(o.to) } : { at: shift(o.at) }, { record: false });
      return;
    }
    const s = shapes.find((x) => x.id === d.id);
    if (!s) return;
    const P = { x: p.x * frame.width, y: p.y * frame.height };
    if (s.kind === "spotlight" && d.handle === "r") {
      const ry = Math.hypot((P.x - s.at.x * frame.width) / SPOTLIGHT_ASPECT, P.y - s.at.y * frame.height);
      onUpdate(s.id, { r: ry / frame.height }, { record: false });
    } else if (s.kind === "arrow" && (d.handle === "from" || d.handle === "to")) {
      onUpdate(s.id, { [d.handle]: p }, { record: false });
    } else if (s.kind === "arrow" && d.handle === "bend") {
      const A = { x: s.from.x * frame.width, y: s.from.y * frame.height };
      const B = { x: s.to.x * frame.width, y: s.to.y * frame.height };
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      if (len < 1) return;
      const n = { x: (B.y - A.y) / len, y: -(B.x - A.x) / len };
      // The curve's middle is M + bend·len/2 along the normal (clip-drawing.ts).
      let bend = (2 * ((P.x - (A.x + B.x) / 2) * n.x + (P.y - (A.y + B.y) / 2) * n.y)) / len;
      if (Math.abs(bend) < 0.05) bend = 0;
      onUpdate(s.id, { bend }, { record: false });
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    setDragState(null);
    if (!d || !frame) return;
    if (d.mode === "new-arrow") {
      const long = Math.hypot((d.to.x - d.from.x) * frame.width, (d.to.y - d.from.y) * frame.height) >= 0.02 * frame.width;
      if (long) onAdd({ kind: "arrow", id: crypto.randomUUID(), arrow: session.arrowKind, from: d.from, to: d.to, color: session.color });
      return;
    }
    onRecord(d.snapshot);
  }

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!frame) return;
    const hit = hitTest(shapes, toPoint(e), frame, PICK);
    if (hit?.kind === "text") setTextState({ at: hit.at, value: hit.text, editId: hit.id });
  }

  const draft: DrawingShape | null =
    drag?.mode === "new-arrow"
      ? { kind: "arrow", id: "draft", arrow: session.arrowKind, from: drag.from, to: drag.to, color: session.color }
      : null;
  const visible = [...shapes.filter((s) => s.id !== text?.editId), ...(draft ? [draft] : [])];
  const cursor = drag?.mode === "move" ? "grabbing" : hover ? "move" : session.tool === "text" ? "text" : "crosshair";

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[11]"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {frame && (
        <div
          ref={boxRef}
          className="absolute inset-0 m-auto touch-none select-none"
          style={{ width: frame.width, height: frame.height, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          // A press on the frame never takes focus from the label's field (the field's own presses do).
          onMouseDown={(e) => {
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
          }}
        >
          <DrawingShapes shapes={visible} frame={frame} animate={false} idPrefix={`do${id}`} />
          <DrawingLabels shapes={visible} frame={frame} animate={false} selectedId={session.selectedId} />
          {selected && selected.id !== text?.editId && <Selection shape={selected} frame={frame} />}
          {text && (
            <input
              autoFocus
              value={text.value}
              maxLength={LABEL_MAX_CHARS}
              placeholder="Label"
              aria-label="Label text"
              onChange={(e) => setTextState({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  commitText();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setTextState(null);
                }
              }}
              onBlur={commitText}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute rounded-md bg-black/75 px-2 py-1 text-center font-bold text-white outline-none ring-2 ring-white/70 placeholder:text-white/50"
              style={{
                left: text.at.x * frame.width,
                top: text.at.y * frame.height,
                transform: "translate(-50%, -50%)",
                fontSize: 16,
                width: "14em",
                fontFamily: '"Scoutable Card", system-ui, sans-serif',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
