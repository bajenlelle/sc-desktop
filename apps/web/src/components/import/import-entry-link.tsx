"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Where the user pressed "Import a game", for the funnel. The vocabulary is
 * shared with the desktop (types/analytics.ts): `games_toolbar` and
 * `games_empty` are the Library's toolbar and empty state (the page was
 * called Games when they were named), `library_row` a game's own "Upload the
 * video" button, `home_toolbar` Home's toolbar, `get_started` the Home
 * page's getting-started nudges, `game_page` a game's page and `add_clips`
 * the editor's picker.
 */
export type ImportPlacement =
  | "games_toolbar"
  | "games_empty"
  | "get_started"
  | "game_page"
  | "library_row"
  | "home_toolbar"
  | "add_clips";

/** The import page, or the upload step for a game already in the library. */
export function importHref(matchId?: string | null): string {
  return matchId ? `/library/import?match=${encodeURIComponent(matchId)}` : "/library/import";
}

/**
 * A link into the import flow that records where it was pressed. Works as
 * the child of `Button asChild`, which hands it the button's classes.
 */
export function ImportEntryLink({
  placement,
  matchId,
  children,
  ...rest
}: { placement: ImportPlacement; matchId?: string | null; children: React.ReactNode } & Omit<ComponentProps<typeof Link>, "href" | "onClick">) {
  return (
    <Link href={importHref(matchId)} onClick={() => trackEvent("import_entry_clicked", { placement })} {...rest}>
      {children}
    </Link>
  );
}
