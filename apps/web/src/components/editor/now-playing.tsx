"use client";

import * as React from "react";
import { RotateCcw, Scissors, Type } from "lucide-react";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { describeTrim, formatSeconds } from "@scoutable/shared/lib/trim-math";
import type { WatchItem } from "@scoutable/shared/lib/watch-queue";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The note is saved this long after the last keystroke (and on blur). */
const SAVE_MS = 600;

/**
 * The clip's note for players, under the footage where the eye already is:
 * what is typed shows at once, the write follows a moment after the last
 * keystroke, on blur, and when the field goes. Keyed by clip by the caller,
 * so each clip's draft is its own.
 */
function NoteField({ value, onSave, readOnly }: { value: string; onSave: (note: string, opts?: { flush?: boolean }) => void; readOnly: boolean }) {
  const [draft, setDraft] = React.useState(value);
  const timer = React.useRef<number | null>(null);
  const draftRef = React.useRef(draft);
  const savedRef = React.useRef(value);
  const onSaveRef = React.useRef(onSave);
  React.useLayoutEffect(() => {
    draftRef.current = draft;
    onSaveRef.current = onSave;
  });

  // Another device's edit arrives: take it unless this one is mid-typing.
  React.useEffect(() => {
    if (value !== savedRef.current && timer.current === null) {
      savedRef.current = value;
      setDraft(value);
    }
  }, [value]);

  const flush = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (draftRef.current === savedRef.current) return;
    savedRef.current = draftRef.current;
    onSaveRef.current(draftRef.current, { flush: true });
  }, []);

  React.useEffect(() => flush, [flush]);

  function change(next: string) {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_MS);
  }

  return (
    <Textarea
      value={draft}
      readOnly={readOnly}
      rows={2}
      aria-label="Note for players"
      placeholder="Add a note players see under this clip…"
      className="min-h-0 py-1.5 text-callout"
      onChange={(e) => change(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        // The editor's keys stay out of the field; Esc leaves it.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * What's playing, under the player: the play's badge and player, where it
 * sits in the game, how long the clip is and how it lies around the play
 * ("12 s · 10 s before, 2 s after"), Trim and Reset, and the note players
 * read under it. A text card shows its text and length; nothing playing
 * shows how to start. The block keeps one height so the list below never
 * jumps as clips change.
 */
export function NowPlaying({
  item,
  matchTitle,
  window,
  hasOffsets,
  canTrim,
  trimming,
  readOnly,
  onTrim,
  onReset,
  onNote,
}: {
  item: WatchItem | null;
  /** The game's title, for multi-game playlists. */
  matchTitle?: string;
  /** The clip's window in its game's copy, with the play's time; null for a clip that plays from its own file. */
  window: { eventTime: number; start: number; end: number } | null;
  hasOffsets: boolean;
  canTrim: boolean;
  trimming: boolean;
  readOnly: boolean;
  onTrim: () => void;
  onReset: () => void;
  onNote: (key: string, note: string, opts?: { flush?: boolean }) => void;
}) {
  const kbd = "h-4 min-w-4 px-0.5 text-footnote";
  if (!item) {
    return (
      <div className="flex min-h-[7.5rem] flex-col justify-center gap-1 px-4 py-3 @min-[860px]/editor:px-1 @min-[860px]/editor:py-0">
        <p className="text-callout text-muted-foreground">
          Choose a clip to play it here. <Kbd className={kbd}>Space</Kbd> plays the whole playlist.
        </p>
      </div>
    );
  }

  if (item.kind === "text") {
    return (
      <div className="flex min-h-[7.5rem] flex-col gap-1.5 px-4 py-3 @min-[860px]/editor:px-1 @min-[860px]/editor:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-fill-2">
            <Type className="size-3.5 text-muted-foreground" />
          </span>
          <span className="truncate text-headline">Text card</span>
          <span className="shrink-0 text-callout text-muted-foreground nums">{item.card.durationSeconds} s</span>
        </div>
        <p className="line-clamp-2 whitespace-pre-wrap text-callout text-muted-foreground">{item.card.text || "Type the card's text in its row."}</p>
      </div>
    );
  }

  const colors = eventColors(item.event);
  const where = [periodLabel(item.event.period), formatGameClock(item.event.gameClockTime), item.event.eventTeam?.teamName, matchTitle].filter(Boolean).join(" · ");
  const length = window ? describeTrim({ eventTime: window.eventTime, start: window.start, end: window.end }) : null;

  return (
    <div className="flex min-h-[7.5rem] flex-col gap-2 px-4 py-3 @min-[860px]/editor:px-1 @min-[860px]/editor:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-callout font-medium", colors.badge)}>{eventLabel(item.event)}</span>
        <span className="min-w-0 flex-1 truncate text-headline @min-[860px]/editor:text-title-3">{playerName(item.event)}</span>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1">
            {canTrim && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="xs" variant="outline" onClick={onTrim} disabled={trimming}>
                    <Scissors />
                    Trim
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex items-center gap-1.5 pointer-coarse:hidden">
                  Trim the clip&apos;s ends
                  <Kbd className={kbd}>T</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
            {hasOffsets && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="xs" variant="ghost" onClick={onReset} disabled={trimming} className="text-muted-foreground">
                    <RotateCcw />
                    Reset
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Back to the playlist&apos;s clip length</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      <p className="truncate text-callout text-muted-foreground nums">
        {where}
        {window && (
          <>
            <span aria-hidden> · </span>
            <span className="text-foreground">{formatSeconds(window.end - window.start)}</span>
            {length && <span> · {length}</span>}
          </>
        )}
        {!window && <span> · Plays from its uploaded file</span>}
      </p>
      <NoteField key={item.key} value={item.note ?? ""} readOnly={readOnly} onSave={(note, opts) => onNote(item.key, note, opts)} />
    </div>
  );
}
