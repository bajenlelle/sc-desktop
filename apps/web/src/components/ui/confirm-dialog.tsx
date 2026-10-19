"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The one confirmation worth asking for: an action that can't be undone
 * (deleting a playlist). Everything else is undoable and asks nothing. The
 * destructive button names what happens; Cancel is the quiet way out.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** The action, as a verb phrase: "Delete playlist". */
  confirmLabel: string;
  destructive?: boolean;
  /** The action is running: the dialog stays and the buttons wait. */
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Anything between the text and the buttons. */
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={busy} onClick={() => void onConfirm()}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
