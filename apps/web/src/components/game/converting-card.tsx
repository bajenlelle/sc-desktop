"use client";

import { Clapperboard } from "lucide-react";
import { gameVideoStatusLabel } from "@scoutable/shared/lib/game-upload-core";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { ProgressBar } from "@/components/ui/progress-bar";

/**
 * Our converter at work on an uploaded original: waiting its turn (no
 * progress yet), or so far through. The page polls the row behind this;
 * nothing here needs the tab to stay open.
 */
export function ConvertingCard({ video }: { video: GameVideo }) {
  const percent = video.convertProgress === null ? null : video.convertProgress * 100;
  return (
    <div className="rounded-window bg-card p-4 ring-1 ring-separator sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
          <Clapperboard className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{video.sourceName ?? "Your video"}</p>
          <p className="text-callout text-muted-foreground nums">{gameVideoStatusLabel(video, null, false)}</p>
        </div>
      </div>
      <ProgressBar percent={percent} className="mt-4" />
      <p className="mt-3 text-callout text-muted-foreground">
        We&apos;re making the copy that plays here and looking for the tip-off. You can close this page. We&apos;ll email you when it&apos;s
        ready.
      </p>
    </div>
  );
}
