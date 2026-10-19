"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The field the name is typed into. Mounted for one edit at a time, so it
 * starts from the name as it was when the edit began (a rename landing
 * meanwhile must not reset what is being typed) and takes focus on arrival.
 */
function TitleField({
  initial,
  onCommit,
  onCancel,
  className,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(initial);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const doneRef = React.useRef(false);

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(draft);
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label="Playlist name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className={cn(
        // The size comes from the bar's heading it sits in (a small title on phones, the window title beside the sidebar).
        "h-7 w-full min-w-0 max-w-[24rem] rounded-md bg-card px-2 text-foreground ring-2 ring-selection outline-none lg:min-w-48",
        className,
      )}
    />
  );
}

/**
 * The playlist's name in the toolbar: a click turns it into a field in
 * place (as the desktop's editor-toolbar does). Return and leaving the
 * field keep the name, Esc puts the old one back. A playlist that was just
 * created arrives with the field open (`?rename=1`).
 */
export function EditorTitle({
  name,
  editing,
  onEditingChange,
  onRename,
  className,
}: {
  name: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (name: string) => void;
  className?: string;
}) {
  if (editing) {
    return (
      <TitleField
        initial={name}
        className={className}
        onCommit={(next) => {
          onRename(next);
          onEditingChange(false);
        }}
        onCancel={() => onEditingChange(false)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => onEditingChange(true)}
      title="Rename playlist"
      className={cn(
        // From lg the hover fill reaches past the text (the negative margin), so
        // the width it may take reaches past the heading's by the same amount:
        // a name that fits isn't cut by those 8 px.
        "inline-block max-w-full truncate rounded-md px-1 align-top text-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection lg:-mx-1 lg:max-w-[calc(100%_+_0.5rem)]",
        className,
      )}
    >
      {name}
    </button>
  );
}
