import * as React from "react"

import { cn } from "@/lib/utils"

/** A key cap for shortcut hints in tooltips and menus. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-separator bg-fill-1 px-1 font-sans text-subheadline text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
