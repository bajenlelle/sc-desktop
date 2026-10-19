"use client";

import { Fragment } from "react";
import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
import type { PlaylistFolder } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FolderLink } from "./folder-link";
import { goToFolder, TOP_LEVEL_NAME } from "./folder-nav";
import { dropTargetProps } from "./use-folder-drag";

/** A step of the path lit as a drop target while a card is over it. */
const DROP_LIT =
  "data-[drop-active]:bg-primary/10 data-[drop-active]:text-foreground data-[drop-active]:ring-2 data-[drop-active]:ring-selection";

const CRUMB =
  "max-w-44 truncate rounded-md px-1.5 py-0.5 text-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 hover:text-foreground active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection";

function Separator() {
  return <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />;
}

/**
 * The way back up from a folder, for the toolbar's leading slot. On narrow
 * screens it is iOS's back button, named after the parent; beside the
 * sidebar it is the path from Playlists down to the parent, as Finder's
 * path bar shows it, with the open folder's name as the title after it.
 * Every step is a link (Back, new tabs and copied links work) and a drop
 * target: a playlist or folder dragged onto a step moves there. A deep path
 * folds its middle into a … menu.
 */
export function FolderTrail({
  trail,
}: {
  /** The folders from the top level down to the open one, inclusive. */
  trail: PlaylistFolder[];
}) {
  const ancestors = trail.slice(0, -1);
  const parent = ancestors.at(-1) ?? null;
  const folded = ancestors.length > 2 ? ancestors.slice(0, -1) : [];
  const shown = ancestors.length > 2 ? ancestors.slice(-1) : ancestors;

  return (
    <>
      {/* Bounded, so a long folder name ends in an ellipsis instead of crowding the title. */}
      <Button
        asChild
        variant="ghost"
        size="sm"
        className={cn("-ml-1 min-w-0 max-w-40 shrink gap-0.5 px-1.5 text-primary sm:max-w-56 lg:hidden", DROP_LIT)}
      >
        <FolderLink folderId={parent?.id ?? null} {...dropTargetProps(parent?.id ?? null)}>
          <ChevronLeft className="size-5" />
          <span className="truncate">{parent?.name ?? TOP_LEVEL_NAME}</span>
        </FolderLink>
      </Button>

      <nav aria-label="Folder path" className="hidden min-w-0 items-center gap-0.5 lg:flex">
        <FolderLink folderId={null} className={cn(CRUMB, DROP_LIT)} {...dropTargetProps(null)}>
          {TOP_LEVEL_NAME}
        </FolderLink>
        {folded.length > 0 && (
          <>
            <Separator />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="More folders in the path" className={CRUMB}>
                  …
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {folded.map((folder) => (
                  <DropdownMenuItem key={folder.id} onSelect={() => goToFolder(folder.id)}>
                    <Folder className="fill-primary/15 text-primary" />
                    <span className="truncate">{folder.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {shown.map((folder) => (
          <Fragment key={folder.id}>
            <Separator />
            <FolderLink folderId={folder.id} className={cn(CRUMB, DROP_LIT)} {...dropTargetProps(folder.id)}>
              {folder.name}
            </FolderLink>
          </Fragment>
        ))}
        <Separator />
      </nav>
    </>
  );
}
