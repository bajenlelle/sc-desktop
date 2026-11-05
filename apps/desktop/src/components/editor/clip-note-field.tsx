/**
 * The note field under the player: a copy of the pill on the clip, in the
 * same font at the same width in ems, so line N here is line N on the
 * video and in the export. It grows a line at a time and stops at the
 * pill's five lines: a keystroke that would start a sixth is refused, with
 * a word of why. Return breaks a line (the note is lines), Esc finishes;
 * saving is the caller's, on every change.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  CAPTION_BACKGROUND,
  CAPTION_EM,
  CAPTION_MAX_CHARS,
  CAPTION_MAX_LINES,
  CAPTION_TEXT_EM,
} from "@scoutable/shared/lib/clip-caption";
import { loadCardFonts } from "@/lib/card-painter";

const FONT_PX = 16;
const LINE_PX = FONT_PX * CAPTION_EM.lineHeight;
const PAD_Y_PX = FONT_PX * CAPTION_EM.padY;

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** Lines the field shows for its current value (wrapped and explicit alike). */
function lineCount(el: HTMLTextAreaElement): number {
  el.style.height = "auto";
  return Math.max(1, Math.round((el.scrollHeight - 2 * PAD_Y_PX) / LINE_PX));
}

export function ClipNoteField({
  value,
  onChange,
  onFocus,
  onBlur,
  fieldRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** The caller's handle, so a key can focus the field. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [atLimit, setAtLimit] = useState(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (fieldRef.current) autosize(fieldRef.current);
  }, [value, fieldRef]);

  // The pill's font: measured again once it has loaded, or the first lines wrap in the fallback.
  useEffect(() => {
    void loadCardFonts()
      .then(() => fieldRef.current && autosize(fieldRef.current))
      .catch(() => {});
  }, [fieldRef]);

  useEffect(() => () => {
    if (limitTimer.current) clearTimeout(limitTimer.current);
  }, []);

  function showLimit() {
    setAtLimit(true);
    if (limitTimer.current) clearTimeout(limitTimer.current);
    limitTimer.current = setTimeout(() => setAtLimit(false), 1800);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <textarea
        ref={fieldRef}
        rows={1}
        maxLength={CAPTION_MAX_CHARS}
        placeholder="Note for players, shown on the clip…"
        value={value}
        aria-label="Note for players, shown on the clip"
        className="block max-w-full resize-none overflow-hidden rounded-[0.4em] px-[0.6em] py-[0.35em] font-bold text-white ring-1 ring-white/10 outline-none transition-[box-shadow] duration-150 placeholder:text-white/50 focus:ring-2 focus:ring-selection"
        style={{
          width: `${CAPTION_TEXT_EM + 2 * CAPTION_EM.padX}em`,
          fontSize: FONT_PX,
          lineHeight: CAPTION_EM.lineHeight,
          fontFamily: '"Scoutable Card", system-ui, sans-serif',
          background: CAPTION_BACKGROUND,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
        onChange={(e) => {
          const el = e.currentTarget;
          const next = el.value;
          const lines = lineCount(el);
          if (lines > CAPTION_MAX_LINES) {
            // A note that was already longer (written before the limit) may be edited, not grown.
            el.value = value;
            const before = lineCount(el);
            if (lines > before) {
              autosize(el);
              showLimit();
              return;
            }
            el.value = next;
          }
          autosize(el);
          onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {atLimit && (
        <span role="status" className="text-caption text-muted-foreground">
          Up to {CAPTION_MAX_LINES} lines fit on the clip
        </span>
      )}
    </div>
  );
}
