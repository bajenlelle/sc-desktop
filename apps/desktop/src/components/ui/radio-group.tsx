import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

export interface RadioOption<T extends string> {
  value: T
  label: React.ReactNode
  /** Muted words after the label: what this choice covers right now. */
  detail?: React.ReactNode
}

/**
 * macOS radio buttons: a short stack of mutually exclusive choices whose
 * labels are too long for a segmented control. The whole row is the label;
 * arrow keys move the choice (Radix), and the keys stop there.
 */
export function RadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: T
  onValueChange: (value: T) => void
  options: RadioOption<T>[]
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
}) {
  const id = React.useId()
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn("flex flex-col", className)}
    >
      {options.map((o) => (
        <label
          key={o.value}
          htmlFor={`${id}-${o.value}`}
          className="-mx-2 flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 text-sm text-foreground transition-colors duration-150 hover:bg-fill-1"
        >
          <RadioGroupPrimitive.Item
            id={`${id}-${o.value}`}
            value={o.value}
            className="flex size-4 shrink-0 items-center justify-center rounded-full bg-fill-2 shadow-[inset_0_0_0_1px_var(--separator)] outline-none transition-colors duration-150 data-[state=checked]:bg-primary data-[state=checked]:shadow-none focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <RadioGroupPrimitive.Indicator className="block size-1.5 rounded-full bg-white" />
          </RadioGroupPrimitive.Item>
          <span className="min-w-0 truncate">
            {o.label}
            {o.detail && <span className="ml-1.5 text-muted-foreground">{o.detail}</span>}
          </span>
        </label>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
