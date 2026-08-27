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
import { useImportQuota } from "@/lib/use-import-quota";

export function DeleteMatchDialog({
  matchId,
  matchTitle,
  trigger,
  onDeleted,
  isDemo,
}: {
  matchId: string;
  matchTitle: string;
  trigger: React.ReactNode;
  onDeleted: () => void;
  /** The sample game never counted against the quota, so no note for it. */
  isDemo?: boolean;
}) {
  // null = unlimited tier or team space, where the quota note is noise.
  const importQuota = useImportQuota();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMatch(matchId);
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
        {!isDemo && importQuota !== null && (
          <p className="text-xs text-muted-foreground">
            {importQuota.window === "lifetime"
              ? "Deleting doesn't restore your free imports — you get 3 games total. Re-importing this same game later is free."
              : "Deleting doesn't restore your monthly import — the import has already been used. Re-importing this same game later is free."}
          </p>
        )}
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
