import * as React from "react";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { quietControl } from "@/components/ui/filter-button";
import { cn } from "@/lib/utils";

export interface PopUpOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Shown under the label inside the menu only. */
  description?: React.ReactNode;
  disabled?: boolean;
}

/**
 * The macOS pop-up button: shows the current choice with up/down chevrons and
 * opens a menu of the alternatives, the checked one marked. Replaces native
 * <select>s (which ignore the app's materials and keyboard scopes) and
 * hand-rolled dropdown triggers.
 *
 * `quiet` (the default) is for bars and toolbars: no border at rest, the
 * neutral fill on hover and while open, a plain down chevron. `field` keeps the
 * bordered look with up/down chevrons for forms (dialogs, settings rows),
 * where it lines up with the text fields beside it.
 */
export function PopUpButton<T extends string>({
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  size = "md",
  variant = "quiet",
  align = "start",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: T | null;
  onValueChange: (value: T) => void;
  options: readonly PopUpOption<T>[];
  placeholder?: React.ReactNode;
  size?: "sm" | "md";
  variant?: "quiet" | "field";
  align?: "start" | "end";
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          className={cn(
            variant === "quiet"
              ? [quietControl, "max-w-full text-foreground", size === "sm" ? "h-6 px-1.5 text-callout" : "px-2"]
              : [
                  "inline-flex max-w-full min-w-0 items-center justify-between gap-1.5 rounded-md bg-card text-foreground shadow-xs ring-1 ring-separator outline-none",
                  "transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 data-[state=open]:bg-fill-2",
                  "focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-50 disabled:active:scale-100",
                  size === "sm" ? "h-6 pl-2 pr-1 text-callout" : "h-7 pl-2.5 pr-1.5 text-sm",
                ],
            className,
          )}
        >
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current ? current.label : placeholder}
          </span>
          {variant === "quiet" ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onValueChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.description ? (
                <span className="flex flex-col">
                  <span>{o.label}</span>
                  <span className="text-callout opacity-70">{o.description}</span>
                </span>
              ) : (
                o.label
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
