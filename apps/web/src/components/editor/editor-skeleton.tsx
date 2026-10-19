"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The editor's shape while the playlist loads: the player's box and a few
 * rows, arranged as the editor will be, so nothing jumps when it arrives.
 */
export function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="@container/editor pb-[calc(var(--tab-bar-height)+1.5rem)]">
      <div className="flex flex-col @min-[860px]/editor:flex-row @min-[860px]/editor:items-start @min-[860px]/editor:gap-6 @min-[860px]/editor:px-6 @min-[860px]/editor:pt-1">
        <div className="contents @min-[860px]/editor:flex @min-[860px]/editor:min-w-0 @min-[860px]/editor:flex-1 @min-[860px]/editor:flex-col @min-[860px]/editor:gap-3">
          <div className="mx-auto w-full max-w-[calc(55dvh*16/9)] @min-[860px]/editor:max-w-[calc((100dvh-var(--page-bar-height)-14rem)*16/9)]">
            <Skeleton className="aspect-video w-full rounded-none bg-fill-3 @min-[860px]/editor:rounded-lg" />
          </div>
          <div className="flex flex-col gap-2 px-4 py-3 @min-[860px]/editor:px-1 @min-[860px]/editor:py-0">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex flex-col @min-[860px]/editor:w-[360px] @min-[860px]/editor:shrink-0">
          <div className="px-4 pt-4 pb-2 sm:px-6 @min-[860px]/editor:px-3 @min-[860px]/editor:pt-0">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex flex-col sm:px-2 @min-[860px]/editor:px-0">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <Skeleton className="h-7 w-[3px] bg-fill-3" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/2 bg-fill-3" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
