/**
 * The draw mode's bar under the player, in place of the clip's own row:
 * the three tools, the arrow kinds (basketball diagram notation), colours,
 * how long the frame holds, undo, and Remove drawing / Done.
 */
import { Flashlight, MoveUpRight, Redo2, Trash2, Type, Undo2 } from "lucide-react";
import {
  DEFAULT_DRAWING_COLOR,
  DRAWING_COLORS,
  HOLD_MAX,
  HOLD_MIN,
  type ArrowKind,
  type DrawingColor,
} from "@scoutable/shared/lib/clip-drawing";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DrawSession, DrawTool } from "./use-draw-session";

const TOOLS: { tool: DrawTool; label: string; key: string; icon: typeof Flashlight }[] = [
  { tool: "spotlight", label: "Spotlight", key: "S", icon: Flashlight },
  { tool: "arrow", label: "Arrow", key: "A", icon: MoveUpRight },
  { tool: "text", label: "Text", key: "T", icon: Type },
];

const KINDS: { kind: ArrowKind; label: string; tip: string }[] = [
  { kind: "cut", label: "Cut", tip: "A player's run" },
  { kind: "pass", label: "Pass", tip: "The ball's path" },
  { kind: "screen", label: "Screen", tip: "Where the screen is set" },
  { kind: "dribble", label: "Dribble", tip: "The ball handler's path" },
];

const COLORS: { color: DrawingColor; label: string }[] = [
  { color: "yellow", label: "Yellow" },
  { color: "white", label: "White" },
  { color: "red", label: "Red" },
  { color: "blue", label: "Blue" },
];

const HINTS: Record<DrawTool, string> = {
  spotlight: "Click a player to spotlight them. Drag the handle to resize.",
  arrow: "Drag to draw an arrow. Drag the middle handle to bend it.",
  text: "Click where the label goes, type, then press Enter.",
};

/** The kind as it is drawn, in small. */
function KindGlyph({ kind }: { kind: ArrowKind }) {
  const common = { stroke: "currentColor", strokeWidth: 1.6, fill: "none", strokeLinecap: "round" as const };
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
      {kind === "cut" && <path d="M1 5 H17" {...common} />}
      {kind === "pass" && <path d="M1 5 H17" {...common} strokeLinecap="butt" strokeDasharray="3 2" />}
      {kind === "screen" && <path d="M1 5 H19 M19 1.5 V8.5" {...common} />}
      {kind === "dribble" && <path d="M1 5 L3 2.5 L5 7.5 L7 2.5 L9 7.5 L11 2.5 L13 5 H17" {...common} />}
      {kind !== "screen" && <path d="M16 2 L21 5 L16 8 Z" fill="currentColor" />}
    </svg>
  );
}

export function DrawBar({
  session,
  canUndo,
  canRedo,
  onTool,
  onArrowKind,
  onColor,
  onHold,
  onUndo,
  onRedo,
  onRemove,
  onDone,
}: {
  session: DrawSession;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: DrawTool) => void;
  onArrowKind: (kind: ArrowKind) => void;
  onColor: (color: DrawingColor) => void;
  onHold: (seconds: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const sel = session.drawing.shapes.find((s) => s.id === session.selectedId);
  const showKinds = session.tool === "arrow" || sel?.kind === "arrow";
  const kind = sel?.kind === "arrow" ? sel.arrow : session.arrowKind;
  const color = sel && sel.kind !== "spotlight" ? (sel.color ?? DEFAULT_DRAWING_COLOR) : session.color;
  const showColors = session.tool !== "spotlight" || (!!sel && sel.kind !== "spotlight");

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="radiogroup" aria-label="Tool" className="flex items-center gap-0.5 rounded-lg bg-fill-1 p-0.5">
          {TOOLS.map(({ tool, label, key, icon: Icon }) => (
            <Tooltip key={tool}>
              <TooltipTrigger asChild>
                <Button
                  role="radio"
                  aria-checked={session.tool === tool}
                  variant={session.tool === tool ? "default" : "ghost"}
                  size="xs"
                  onClick={() => onTool(tool)}
                >
                  <Icon />
                  {label}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                {label}
                <Kbd>{key}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {showKinds && (
          <div role="radiogroup" aria-label="Arrow" className="flex items-center gap-0.5 rounded-lg bg-fill-1 p-0.5">
            {KINDS.map(({ kind: k, label, tip }, i) => (
              <Tooltip key={k}>
                <TooltipTrigger asChild>
                  <Button
                    role="radio"
                    aria-checked={kind === k}
                    variant={kind === k ? "default" : "ghost"}
                    size="xs"
                    onClick={() => onArrowKind(k)}
                  >
                    <KindGlyph kind={k} />
                    {label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-1.5">
                  {tip}
                  <Kbd>{i + 1}</Kbd>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
        {showColors && (
          <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
            {COLORS.map(({ color: c, label }) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={label}
                title={label}
                onClick={() => onColor(c)}
                className={cn(
                  "size-5 rounded-full ring-1 ring-black/30 transition-transform duration-100 active:scale-90",
                  color === c && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                style={{ background: DRAWING_COLORS[c] }}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-callout text-muted-foreground">Hold</span>
          <Stepper
            label="Seconds the frame holds"
            value={session.drawing.hold}
            min={HOLD_MIN}
            max={HOLD_MAX}
            onChange={onHold}
            format={(n) => `${n} s`}
          />
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (⌘Z)">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">
            <Redo2 />
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={onRemove}>
            <Trash2 />
            Remove drawing
          </Button>
          <Button size="xs" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
      <p className="text-caption text-muted-foreground">{HINTS[session.tool]}</p>
    </div>
  );
}
