"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: React.ReactNode;
  /** Shown under the label inside the menu only. */
  description?: React.ReactNode;
  disabled?: boolean;
}

/**
 * A filter pop-up that ticks several options, on the menu primitive so it
 * is portaled, keyboard-navigable (arrows, type-ahead, Escape) and opens
 * from its trigger. The menu stays open while ticking; the trigger reads
 * the one choice by name and several as a count. A disabled option still
 * says why in its description.
 */
export function MultiSelectMenu({
  label,
  options,
  selected,
  onChange,
  emptyText,
  size = "md",
  align = "start",
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  /** What the group is called, shown while nothing is chosen ("Shot type"). */
  label: string;
  options: readonly MultiSelectOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Shown inside the menu when there are no options. */
  emptyText?: string;
  size?: "sm" | "md";
  align?: "start" | "end";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const chosen = options.filter((o) => selected.has(o.value));
  const trigger =
    chosen.length === 0 ? label : chosen.length === 1 ? chosen[0].label : `${label} · ${chosen.length}`;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel ?? label}
          className={cn(
            "inline-flex max-w-full min-w-0 items-center justify-between gap-1.5 rounded-md bg-card shadow-xs ring-1 ring-separator outline-none",
            "transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 data-[state=open]:bg-fill-2",
            "focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-50 disabled:active:scale-100",
            size === "sm" ? "h-6 pl-2 pr-1 text-callout" : "h-7 pl-2.5 pr-1.5 text-sm pointer-coarse:h-9",
            selected.size > 0 ? "text-foreground" : "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{trigger}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
        {selected.size > 0 && (
          <>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onChange(new Set());
              }}
              className="pl-7 text-muted-foreground"
            >
              Clear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {options.length === 0 && emptyText && (
          <p className="px-2 py-1.5 text-callout text-muted-foreground">{emptyText}</p>
        )}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.has(o.value)}
            disabled={o.disabled}
            // Keep the menu open while ticking several options.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.value)}
          >
            {o.description ? (
              <span className="flex flex-col">
                <span>{o.label}</span>
                <span className="text-callout opacity-70">{o.description}</span>
              </span>
            ) : (
              o.label
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
