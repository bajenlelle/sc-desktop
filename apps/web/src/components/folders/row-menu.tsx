"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * A row's ⋯ menu on the Playlists page. Controlled, so a right-click on the
 * row and Shift+F10 open the same menu, anchored to this button either way.
 * Its clicks (the trigger's, and the items' that React bubbles through the
 * portal) are not the row's.
 */
export function RowMenu({
  label,
  open,
  onOpenChange,
  disabled,
  children,
}: {
  /** The button's accessible name: "More for Scouting". */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="flex" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="icon-xs" aria-label={label} className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
