"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { LabelsApi } from "./use-labels";

/**
 * Deleting a label takes it off every clip it is on, in every playlist and
 * in the bank, and has no undo, so it asks first (the desktop does too).
 * One dialog for every picker the page shows; it outlives the picker that
 * asked, which closes as the dialog takes focus.
 */
export function LabelDeleteDialog({ labels }: { labels: Pick<LabelsApi, "deleting" | "cancelDelete" | "confirmDelete"> }) {
  return (
    <ConfirmDialog
      open={labels.deleting?.open ?? false}
      onOpenChange={(open) => !open && labels.cancelDelete()}
      title={`Delete “${labels.deleting?.label.name ?? ""}”?`}
      description="It comes off every clip you've labelled with it."
      confirmLabel="Delete label"
      destructive
      onConfirm={labels.confirmDelete}
    />
  );
}
