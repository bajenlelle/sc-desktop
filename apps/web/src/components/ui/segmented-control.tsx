"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { springs } from "@/lib/motion"

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  title?: string
}

/**
 * A macOS segmented control: the selected segment is a raised pill that
 * springs between segments (one shared layout element), the others are
 * labels on a recessed track. On touch screens it takes iOS's 32pt height.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = "sm",
  "aria-label": ariaLabel,
}: {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  className?: string
  size?: "sm" | "md"
  "aria-label"?: string
}) {
  const id = React.useId()
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T)
      }}
      aria-label={ariaLabel}
      className={cn("inline-flex shrink-0 items-center rounded-md bg-fill-2 p-0.5 pointer-coarse:rounded-lg", className)}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          title={o.title}
          className={cn(
            "relative flex items-center justify-center rounded-[5px] font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground active:scale-[0.98] data-[state=on]:text-foreground focus-visible:ring-2 focus-visible:ring-selection",
            size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-sm",
            "pointer-coarse:h-8 pointer-coarse:rounded-md pointer-coarse:px-3.5"
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`${id}-thumb`}
              transition={springs.snappy}
              className="absolute inset-0 rounded-[5px] bg-card shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_var(--separator)] pointer-coarse:rounded-md"
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5 [&_svg]:size-3.5">
            {o.icon}
            {o.label}
          </span>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}
