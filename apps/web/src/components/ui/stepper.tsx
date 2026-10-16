import * as React from "react"
import { Minus, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

/** A ± stepper: two pressable ends around a tabular readout. */
export function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  format,
  label,
  disabled = false,
  className,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  format?: (value: number) => React.ReactNode
  /** Accessible name for the control, e.g. "Pre-roll". */
  label: string
  disabled?: boolean
  className?: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const btn =
    "flex size-7 items-center justify-center text-muted-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 hover:text-foreground active:scale-95 active:bg-fill-3 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection [&_svg]:size-3.5"
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center overflow-hidden rounded-md bg-card shadow-xs ring-1 ring-separator", className)}
    >
      <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} className={btn}>
        <Minus />
      </button>
      <span className={cn("min-w-9 px-1 text-center text-sm nums text-foreground", disabled && "opacity-50")}>{format ? format(value) : value}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} className={btn}>
        <Plus />
      </button>
    </div>
  )
}
