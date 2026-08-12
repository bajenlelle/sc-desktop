import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { openUpgradeFlow } from "@/lib/billing";

interface Props {
  open: boolean;
  onClose: () => void;
  featureName?: string;
  description?: string;
}

export function UpgradeDialog({ open, onClose, featureName = "This feature", description }: Props) {
  const { user, expectPlanChange } = useAuth();
  const [loading, setLoading] = useState(false);
  const body = description ?? "Turn your playlists into MP4s you can share anywhere — and import up to unlimited games every month. Try Rookie or Pro free for 14 days, cancel anytime.";

  // Existing subscribers are routed to the billing portal instead of
  // Checkout — this dialog also fires on the Rookie import cap, and sending
  // those users to Checkout would open a second subscription.
  async function handleUpgrade() {
    setLoading(true);
    try {
      const error = await openUpgradeFlow(user?.email);
      if (error) { toast.error(error); return; }
      expectPlanChange();
      onClose();
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <DialogTitle className="text-center">{featureName}</DialogTitle>
          <DialogDescription className="text-center">
            {body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full gap-1.5" onClick={handleUpgrade} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Opening…" : "View plans & upgrade"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose} disabled={loading}>
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
