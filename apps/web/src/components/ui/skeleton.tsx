import * as React from "react"

import { cn } from "@/lib/utils"
import { GroupedList } from "@/components/ui/group"

/** A placeholder block that pulses while content loads; the caller sizes it. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden data-slot="skeleton" className={cn("animate-pulse rounded bg-fill-2", className)} {...props} />
}

/**
 * Rows the shape of GroupRows, for a grouped list that is still loading:
 * a leading mark, a title line and a shorter description line.
 */
export function SkeletonRows({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <GroupedList className={className} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-2">
          <Skeleton className="size-4 shrink-0 bg-fill-3" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3 bg-fill-3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </GroupedList>
  )
}
