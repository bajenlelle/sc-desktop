"use client";

import * as React from "react";
import { BarChart3, ChevronDown, FileDown, MoreHorizontal, Pencil, Plus, Share2, SquareCheckBig, Timer, Trash2, Type } from "lucide-react";
import type { RollPair } from "@scoutable/shared/lib/clip-timing";
import { MAX_POST_ROLL_SECONDS, MAX_PRE_ROLL_SECONDS } from "@scoutable/shared/lib/playlist-edits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ShipPill } from "./ship-pill";
import type { UseShip } from "./use-ship";

/** "Shared with 2 teams and 3 people", for the Share button's tooltip. */
export function sharedWithLabel(teams: number, people: number): string {
  const parts: string[] = [];
  if (teams > 0) parts.push(`${teams} ${teams === 1 ? "team" : "teams"}`);
  if (people > 0) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  return parts.length > 0 ? `Shared with ${parts.join(" and ")}` : "Share with your team or members";
}

/**
 * The editor's toolbar actions, the desktop's in the web's bar: where the
 * server is with the shared clips, the playlist's clip length, Add clips
 * with the cards behind its chevron, Share (filled once anyone receives
 * it; hidden in a personal space, which has nobody to share with), and the
 * rest behind ⋯. Export waits for M3b and the stats card for M3c.
 */
export function EditorActions({
  rolls,
  onRolls,
  onAddClips,
  onAddTextCard,
  canShare,
  sharedTeams,
  sharedPeople,
  onShare,
  ship,
  onSelectAll,
  onRename,
  onDelete,
}: {
  rolls: RollPair;
  onRolls: (next: Partial<RollPair>) => void;
  /** Opens the add-clips panel; the button's box is where it grows out of. */
  onAddClips: (from: DOMRect) => void;
  onAddTextCard: () => void;
  canShare: boolean;
  sharedTeams: number;
  sharedPeople: number;
  onShare: () => void;
  ship: UseShip;
  onSelectAll: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const shared = sharedTeams + sharedPeople > 0;
  return (
    <>
      <ShipPill ship={ship} />

      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Clip length" className="text-muted-foreground">
                <Timer />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Clip length: {rolls.pre} s before, {rolls.post} s after
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-64 space-y-3">
          <div>
            <p className="text-headline">Clip length</p>
            <p className="mt-0.5 text-callout text-muted-foreground">Seconds of footage before and after each play. Trimmed clips keep their own ends.</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">Before</span>
            <Stepper label="Seconds before" value={rolls.pre} min={0} max={MAX_PRE_ROLL_SECONDS} onChange={(v) => onRolls({ pre: v })} format={(v) => `${v} s`} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">After</span>
            <Stepper label="Seconds after" value={rolls.post} min={0} max={MAX_POST_ROLL_SECONDS} onChange={(v) => onRolls({ post: v })} format={(v) => `${v} s`} />
          </div>
        </PopoverContent>
      </Popover>

      {/* Add clips, with the cards one chevron away: everything that goes into the playlist in one place. */}
      <div className="flex items-center">
        <Button size="sm" aria-label="Add clips" className="rounded-r-none" onClick={(e) => onAddClips(e.currentTarget.getBoundingClientRect())}>
          <Plus />
          <span className="hidden sm:inline">Add clips</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" aria-label="Add a card" className="rounded-l-none border-l border-primary-foreground/25 px-1.5 has-[>svg]:px-1.5">
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onAddTextCard}>
              <Type />
              Add text card
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <BarChart3 />
              <span className="flex flex-col">
                <span>Add stats card</span>
                <span className="text-callout opacity-70">Coming soon</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {canShare && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={shared ? "default" : "outline"} size="icon-sm" aria-label="Share" onClick={onShare}>
              <Share2 className={cn(shared && "fill-current")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{sharedWithLabel(sharedTeams, sharedPeople)}</TooltipContent>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More" className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onSelectAll}>
            <SquareCheckBig />
            Select all
            <DropdownMenuShortcut>
              <Kbd className="h-4 min-w-4 px-0.5 text-footnote">⌘A</Kbd>
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FileDown />
            <span className="flex flex-col">
              <span>Export…</span>
              <span className="text-callout opacity-70">Coming soon</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:bg-destructive focus:text-white">
            <Trash2 />
            Delete playlist…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
