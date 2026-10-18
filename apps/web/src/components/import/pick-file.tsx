"use client";

import { useState } from "react";
import { AlertTriangle, Film, Loader2, Upload } from "lucide-react";
import { estimatedUploadLabel, formatBytes } from "@scoutable/shared/lib/game-upload-core";
import { GAME_VIDEO_MAX_BYTES, sourceExtension } from "@scoutable/shared/lib/game-video-wire";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import type { ImportAnchor } from "@scoutable/shared/lib/import-session";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "@/components/ui/group";
import { UploadInterruptedCard } from "@/components/game/upload-card";
import { VideoFileButton } from "@/components/game/video-file-button";
import { startGameUpload, type GameUploadJob } from "@/lib/game-upload";
import { formatGameDate } from "@/lib/format-game";
import { cn } from "@/lib/utils";

/** Why a chosen file can't be uploaded, before the function is asked. */
function fileProblem(file: File): string | null {
  if (!sourceExtension(file.name)) return "Choose an MP4, MOV, MKV or WebM file.";
  if (file.size > GAME_VIDEO_MAX_BYTES) return "Files up to 8 GB can be uploaded.";
  if (file.size <= 0) return "This file is empty.";
  return null;
}

/**
 * The second step of the web import: the game's video file. Chosen with a
 * button or dropped onto the card; its name, size and a rough upload time
 * show before "Start the upload". A game whose upload was interrupted asks
 * for the same file again instead. A game that already has a copy in the
 * cloud asks before it is replaced.
 */
export function PickFile({
  match,
  anchor,
  isUpdate,
  video,
  job,
  resumeReplaces = false,
}: {
  match: StoredMatch;
  /** Null while the anchor is still being worked out for a resumed flow. */
  anchor: ImportAnchor | null;
  isUpdate: boolean;
  /** The game's row, when it has one: an interrupted upload resumes from it. */
  video: GameVideo | null;
  /** This device's job for the game, while it checks the file. */
  job: GameUploadJob | null;
  /** The interrupted upload was replacing a copy in the cloud: finishing it replaces that copy, with no second question. */
  resumeReplaces?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [replaceAsk, setReplaceAsk] = useState<{ file: File; expectResume: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const checking = job?.phase === "checking";
  const problem = file ? fileProblem(file) : null;
  const interrupted = video?.status === "uploading";

  function start(chosen: File, opts: { replace?: boolean; expectResume?: boolean } = {}) {
    if (!anchor) return;
    void startGameUpload({
      matchId: match.id,
      title: match.title,
      file: chosen,
      anchor,
      replace: opts.replace,
      expectResume: opts.expectResume,
    }).then((outcome) => {
      // The game already has a copy: nothing was sent yet; ask first.
      if (outcome === "already_ready") setReplaceAsk({ file: chosen, expectResume: !!opts.expectResume });
    });
  }

  function choose(chosen: File) {
    setFile(chosen);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-window bg-card px-4 py-3 ring-1 ring-separator">
        <p className="truncate text-sm font-medium text-foreground">{match.title}</p>
        <p className="text-callout text-muted-foreground nums">
          {[formatGameDate(match.date), match.events.length > 0 ? `${match.events.length} plays` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      {isUpdate && <Callout>Already in your library; this updates that game. Its playlists keep working.</Callout>}

      {interrupted ? (
        <UploadInterruptedCard video={video} busy={checking || !anchor} onFile={(f) => start(f, { expectResume: true, replace: resumeReplaces })} />
      ) : file ? (
        <div className="rounded-window bg-card p-4 ring-1 ring-separator sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
              <Film className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                {file.name}
              </p>
              <p className="text-callout text-muted-foreground nums">
                {formatBytes(file.size)}
                {!problem && ` · ${estimatedUploadLabel(file.size)} to upload on a typical connection`}
              </p>
            </div>
          </div>
          {problem && (
            <Callout tone="destructive" icon={<AlertTriangle />} className="mt-3">
              {problem}
            </Callout>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button disabled={!!problem || checking || !anchor} onClick={() => start(file)}>
              {(checking || !anchor) && <Loader2 className="animate-spin" />}
              {checking ? "Checking the file" : "Start the upload"}
            </Button>
            <VideoFileButton variant="ghost" disabled={checking} onFile={choose}>
              Choose another
            </VideoFileButton>
          </div>
          <p className="mt-3 text-callout text-muted-foreground">
            The file uploads from here and is converted in the cloud; keep this tab open until the upload is done. We email you when the
            game is ready to watch.
          </p>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) choose(dropped);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-window bg-fill-1 px-6 py-10 text-center ring-1 ring-separator transition-colors",
            dragging && "bg-primary/10 ring-primary/40",
          )}
        >
          <Upload className="mb-1 size-7 text-muted-foreground" />
          <p className="text-headline text-foreground">Choose the game&apos;s video</p>
          <p className="max-w-md text-callout text-muted-foreground">
            MP4, MOV, MKV or WebM, up to 8 GB. Drop it here or choose it below; it uploads from here and converts in the cloud.
          </p>
          <VideoFileButton className="mt-2" onFile={choose}>
            Choose the video file
          </VideoFileButton>
        </div>
      )}

      <Dialog open={replaceAsk !== null} onOpenChange={(open) => !open && setReplaceAsk(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Replace the video in the cloud?</DialogTitle>
            <DialogDescription>
              This game already has a video in the cloud. Uploading this file replaces it; the game&apos;s plays and playlists stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReplaceAsk(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!replaceAsk) return;
                const { file: chosen, expectResume } = replaceAsk;
                setReplaceAsk(null);
                start(chosen, { replace: true, expectResume });
              }}
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
