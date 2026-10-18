"use client";

import { useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { formatBytes, uploadDetail, uploadLabel } from "@scoutable/shared/lib/game-upload-core";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { ProgressBar } from "@/components/ui/progress-bar";
import { VideoFileButton } from "@/components/game/video-file-button";
import { cancelGameUpload, type GameUploadJob } from "@/lib/game-upload";

/**
 * A browser upload under way: the file, how far it is, how fast, and a way
 * to stop it. The same card on the import page and the game page, so
 * leaving one for the other loses nothing.
 */
export function UploadCard({ job }: { job: GameUploadJob }) {
  const [cancelling, setCancelling] = useState(false);
  const percent = job.phase === "uploading" && job.totalBytes > 0 ? (job.doneBytes / job.totalBytes) * 100 : job.phase === "finishing" ? 100 : null;
  const detail = uploadDetail(job);
  return (
    <div className="rounded-window bg-card p-4 ring-1 ring-separator sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
          <Film className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{job.fileName || "Video"}</p>
          <p className="text-callout text-muted-foreground nums">
            {uploadLabel(job)}
            {job.resumed && job.phase === "uploading" ? " · continued" : ""}
          </p>
        </div>
      </div>
      <ProgressBar percent={percent} className="mt-4" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-callout text-muted-foreground nums">{detail ?? "Keep this tab open while it uploads. You can use the rest of the app meanwhile."}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={cancelling}
          onClick={async () => {
            setCancelling(true);
            await cancelGameUpload(job.matchId);
          }}
        >
          {cancelling && <Loader2 className="animate-spin" />}
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * An upload this device isn't running any more (the tab was closed or
 * reloaded): the server keeps the parts that arrived, and picking the same
 * file again continues from there.
 */
export function UploadInterruptedCard({ video, onFile, busy }: { video: GameVideo; onFile: (file: File) => void; busy?: boolean }) {
  const size = video.sourceSizeBytes ? ` (${formatBytes(video.sourceSizeBytes)})` : "";
  return (
    <div className="space-y-3">
      <Callout tone="warning" icon={<Film />}>
        <p className="font-medium">Upload interrupted</p>
        <p className="mt-0.5">
          Pick the same file again to continue where it stopped
          {video.sourceName ? (
            <>
              : <span className="font-medium">{video.sourceName}</span>
              {size}
            </>
          ) : (
            "."
          )}
        </p>
      </Callout>
      <VideoFileButton onFile={onFile} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Choose the file
      </VideoFileButton>
    </div>
  );
}
