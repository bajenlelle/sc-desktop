import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Filter pop-up buttons built on the menu primitive, so they are portaled,
 * keyboard-navigable (arrows, type-ahead, Escape) and animate from their
 * trigger. Same props as the hand-rolled originals.
 */
export function TriggerButton({
  label,
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string; active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 min-w-[130px] items-center justify-between gap-2 rounded-md bg-card px-3 text-sm shadow-xs ring-1 ring-separator outline-none transition-[background-color,transform] duration-150 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
      {...props}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function SingleSelectDropdown({
  options,
  value,
  onChange,
  placeholder = "All",
  required = false,
}: {
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const label = value
    ? (options.find((o) => o.value === value)?.label ?? placeholder)
    : placeholder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton label={label} active={!!value} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
        {value && !required && (
          <>
            <DropdownMenuItem onSelect={() => onChange(null)} className="text-muted-foreground">
              Clear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
}) {
  const label =
    selected.size === 0
      ? placeholder
      : selected.size === 1
        ? (options.find((o) => selected.has(o.value))?.label ?? placeholder)
        : `${selected.size} selected`;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton label={label} active={selected.size > 0} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
        {selected.size > 0 && (
          <>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onChange(new Set());
              }}
              className="text-muted-foreground"
            >
              <Check className="invisible" />
              Clear all
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.has(o.value)}
            // Keep the menu open while ticking several options.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.value)}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
