import * as React from "react"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"

/** A Finder-style search field: recessed, rounded, grows a ring on focus; iOS's height on touch. */
export function SearchField({
  className,
  inputClassName,
  ...props
}: React.ComponentProps<"input"> & { inputClassName?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-coarse:left-2.5 pointer-coarse:size-4" />
      <input
        type="search"
        className={cn(
          "h-7 w-full rounded-md bg-fill-1 pr-2 pl-7 text-sm text-foreground outline-none pointer-coarse:h-9 pointer-coarse:rounded-lg pointer-coarse:pl-8 transition-[box-shadow,background-color] duration-150 placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-selection [&::-webkit-search-cancel-button]:appearance-none",
          inputClassName
        )}
        {...props}
      />
    </div>
  )
}
