import * as React from "react"

import { cn } from "@/lib/utils"

/** Multi-line text field; same surface, ring and focus as `Input`. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full min-w-0 resize-none rounded-md bg-card px-3 py-2 text-sm text-foreground shadow-xs ring-1 ring-separator outline-none transition-[box-shadow,background-color] duration-150 placeholder:text-muted-foreground selection:bg-selection selection:text-selection-foreground disabled:cursor-default disabled:opacity-50",
        "focus-visible:ring-2 focus-visible:ring-selection",
        "aria-invalid:ring-2 aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
