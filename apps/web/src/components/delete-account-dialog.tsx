"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

function mapDeleteAccountError(status: number, body: { error?: string; orgName?: string }): string {
  if (status === 401) return "Your session expired. Sign in again and retry.";
  if (body.error === "last_admin") {
    return `You're the only admin of ${body.orgName ?? "your club"}. Promote another admin or remove its members first.`;
  }
  return "Couldn't delete your account. Try again, or contact support.";
}

export function DeleteAccountDialog({
  email,
  trigger,
}: {
  email: string;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setConfirmText("");
    setError(null);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/delete-account", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(mapDeleteAccountError(res.status, body));
        return;
      }
      // The server already revoked the user — local scope avoids a 401 from
      // the server-side sign-out blocking the redirect.
      try {
        await createClient().auth.signOut({ scope: "local" });
      } catch {
        // ignore — session is dead either way
      }
      router.push("/login");
    } catch {
      setError("Couldn't delete your account. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete account?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This permanently deletes the account{" "}
          <span className="font-semibold text-foreground">{email}</span> — including your games,
          playlists, shared links and watch history. Any active subscription is canceled. This
          can&apos;t be undone.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleDelete}
            disabled={deleting || confirmText !== "DELETE"}
          >
            {deleting ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
