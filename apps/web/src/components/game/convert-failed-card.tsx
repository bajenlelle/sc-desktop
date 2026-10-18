"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { convertErrorIsRetryable, describeConvertError } from "@scoutable/shared/lib/game-upload-core";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
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
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { removeCloudGame, retryCloudGameConvert } from "@/lib/game-upload";

/**
 * A conversion that failed: why, and what to do. The original is kept for a
 * week after a failure, so most failures can simply be run again; one the
 * file itself caused (too long, not a video) needs another file.
 */
export function ConvertFailedCard({ video, onChanged }: { video: GameVideo; onChanged: () => void }) {
  const [busy, setBusy] = useState<"retry" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const retryable = convertErrorIsRetryable(video.convertError);

  async function retry() {
    setBusy("retry");
    const ok = await retryCloudGameConvert(video.matchId, video.id);
    setBusy(null);
    if (ok) onChanged();
  }

  async function remove() {
    setBusy("remove");
    const ok = await removeCloudGame(video.matchId);
    setBusy(null);
    setConfirmRemove(false);
    if (ok) onChanged();
  }

  return (
    <div className="space-y-3">
      <Callout tone="destructive" icon={<AlertTriangle />}>
        <p className="font-medium">The video couldn&apos;t be converted</p>
        <p className="mt-0.5">{describeConvertError(video.convertError)}</p>
      </Callout>
      <div className="flex flex-wrap gap-2">
        {retryable ? (
          <Button onClick={retry} disabled={busy !== null}>
            {busy === "retry" && <Loader2 className="animate-spin" />}
            Try again
          </Button>
        ) : (
          <Button asChild>
            <ImportEntryLink placement="game_page" matchId={video.matchId}>
              Upload another file
            </ImportEntryLink>
          </Button>
        )}
        <Button variant="outline" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
          Remove
        </Button>
      </div>

      <Dialog open={confirmRemove} onOpenChange={(open) => !busy && setConfirmRemove(open)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove this video?</DialogTitle>
            <DialogDescription>The uploaded file is deleted from the cloud. The game and its play-by-play stay in your library.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy !== null} onClick={remove}>
              {busy === "remove" && <Loader2 className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
