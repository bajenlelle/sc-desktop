"use client";

import * as React from "react";
import { Kbd } from "@/components/ui/kbd";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";

const TARGET = "data-toolbar-search";

/**
 * The toolbar's search field with its hotkey hint: a `/` key cap sits in the
 * field beside the sidebar until the field is focused or has text (touch
 * screens, which have no `/` to press, never see it). Pages focus it with
 * `focusToolbarSearch()` from their `/` hotkey.
 *
 * The Toolbar renders `search` twice (one copy per width), so the field is
 * found by attribute and the visible copy is the one focused.
 */
export function ToolbarSearch({ className, value, ...props }: React.ComponentProps<typeof SearchField>) {
  const empty = value === undefined || value === "";
  return (
    <div className={cn("group/search relative", className)}>
      <SearchField value={value} {...{ [TARGET]: "" }} {...props} />
      {empty && (
        <Kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-1.5 hidden h-4 min-w-4 -translate-y-1/2 text-caption group-focus-within/search:hidden lg:inline-flex pointer-coarse:lg:hidden"
        >
          /
        </Kbd>
      )}
    </div>
  );
}

/** Focuses the toolbar search field that is on screen, if any; true when one was. */
export function focusToolbarSearch(): boolean {
  if (typeof document === "undefined") return false;
  for (const el of document.querySelectorAll<HTMLInputElement>(`input[${TARGET}]`)) {
    if (el.offsetParent === null) continue;
    el.focus();
    el.select();
    return true;
  }
  return false;
}
