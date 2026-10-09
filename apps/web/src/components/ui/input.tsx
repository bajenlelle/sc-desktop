import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md bg-card px-3 py-1 text-sm pointer-coarse:h-11 pointer-coarse:rounded-lg text-foreground shadow-xs ring-1 ring-separator outline-none transition-[box-shadow,background-color] duration-150 placeholder:text-muted-foreground selection:bg-selection selection:text-selection-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:cursor-default disabled:opacity-50",
        "focus-visible:ring-2 focus-visible:ring-selection",
        "aria-invalid:ring-2 aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
