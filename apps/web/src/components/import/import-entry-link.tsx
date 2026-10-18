"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackEvent } from "@/lib/analytics";

/** Where the user pressed "Import a game", for the funnel. */
export type ImportPlacement = "games_toolbar" | "games_empty" | "get_started" | "game_page";

/** The import page, or the upload step for a game already in the library. */
export function importHref(matchId?: string | null): string {
  return matchId ? `/games/import?match=${encodeURIComponent(matchId)}` : "/games/import";
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
