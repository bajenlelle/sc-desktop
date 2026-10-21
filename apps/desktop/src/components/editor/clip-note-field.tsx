import { useState } from "react";

/**
 * The active clip's note. The draft lives here while the coach types: the
 * Playlists page held it, and re-rendered whole (both lists, the player,
 * the toolbars) on every keystroke. The page saves through `onChange` on
 * its own debounce. Key it by playlist and clip, so another clip starts
 * from its own note.
 */
export function ClipNoteField({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <textarea
      className="w-full resize-none rounded-md bg-card px-3 py-2 text-sm text-foreground ring-1 ring-separator outline-none transition-[box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-selection"
      rows={2}
      placeholder="Add a note for this clip…"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}
