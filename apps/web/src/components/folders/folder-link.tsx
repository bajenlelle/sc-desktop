"use client";

import type * as React from "react";
import { goToFolder, playlistsHref } from "./folder-nav";

/**
 * A link to a folder of the Playlists page, for use on that page: a real
 * <a href> (new tabs, copied links and modified clicks work as links do),
 * but a plain click moves there through the History API (goToFolder), with
 * no wait for the server.
 */
export function FolderLink({
  folderId,
  onClick,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { folderId: string | null }) {
  return (
    <a
      {...props}
      href={playlistsHref(folderId)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        goToFolder(folderId);
      }}
    />
  );
}
