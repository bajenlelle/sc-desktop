import { Fragment } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterButton } from "@/components/ui/filter-button";
import { cn } from "@/lib/utils";

/**
 * Filter pop-up buttons built on the menu primitive, so they are portaled,
 * keyboard-navigable (arrows, type-ahead, Escape) and animate from their
 * trigger. Same props as the hand-rolled originals.
 */

/**
 * The highlighted row of a pop-up one picks values from takes the app's
 * neutral fill, as a hovered row does, and a darker one while pressed. The
 * menu primitive's accent would read here as one more chosen option, beside
 * the ticked ones; it stays the highlight of menus of actions.
 */
const CHOICE = "focus:bg-fill-2 focus:text-foreground active:bg-fill-3";
export function TriggerButton({
  label,
  active,
  ...props
}: React.ComponentProps<"button"> & { label: string; active: boolean }) {
  return <FilterButton label={label} active={active} {...props} />;
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
            <DropdownMenuItem onSelect={() => onChange(null)} className={cn("text-muted-foreground", CHOICE)}>
              Clear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className={CHOICE}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface MultiSelectOption {
  value: string;
  label: string;
  /** What type-ahead matches on when it is not the label ("Pedro" for "#4 Pedro"). */
  textValue?: string;
}

export interface MultiSelectGroup {
  label: string;
  options: readonly MultiSelectOption[];
}

/** Either a flat list or labelled groups, never both. */
type MultiSelectChoices =
  | { options: readonly MultiSelectOption[]; groups?: never }
  | { groups: readonly MultiSelectGroup[]; options?: never };

export function MultiSelectDropdown({
  options,
  groups,
  selected,
  onChange,
  placeholder,
}: MultiSelectChoices & {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
}) {
  const everyOption = groups ? groups.flatMap((g) => g.options) : (options ?? []);
  const label =
    selected.size === 0
      ? placeholder
      : selected.size === 1
        ? (everyOption.find((o) => selected.has(o.value))?.label ?? placeholder)
        : `${selected.size} selected`;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  // One value can sit in two groups, so a grouped item's key carries its group.
  function item(o: MultiSelectOption, key: string) {
    return (
      <DropdownMenuCheckboxItem
        key={key}
        checked={selected.has(o.value)}
        textValue={o.textValue ?? o.label}
        // Keep the menu open while ticking several options.
        onSelect={(e) => e.preventDefault()}
        onCheckedChange={() => toggle(o.value)}
        className={CHOICE}
      >
        {o.label}
      </DropdownMenuCheckboxItem>
    );
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
              className={cn("text-muted-foreground", CHOICE)}
            >
              <Check className="invisible" />
              Clear all
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {groups
          ? groups.map((g, i) => (
              <Fragment key={g.label}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                {g.options.map((o) => item(o, `${g.label}:${o.value}`))}
              </Fragment>
            ))
          : (options ?? []).map((o) => item(o, o.value))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
