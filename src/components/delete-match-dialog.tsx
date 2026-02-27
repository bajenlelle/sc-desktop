import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteMatch } from "@/lib/matches-db";
import { removeClipsByMatchId } from "@/lib/playlists-db";

export function DeleteMatchDialog({
  matchId,
  matchTitle,
  trigger,
  onDeleted,
}: {
  matchId: string;
  matchTitle: string;
  trigger: React.ReactNode;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMatch(matchId);
      await removeClipsByMatchId(matchId);
      setOpen(false);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete game.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete game?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will permanently remove{" "}
          <span className="font-semibold text-foreground">
            {matchTitle}
          </span>{" "}
          and all its clips. This can&apos;t be undone.
        </p>
        {deleteError && (
          <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete game"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
