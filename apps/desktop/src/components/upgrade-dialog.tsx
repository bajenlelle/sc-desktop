import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { openUpgradeFlow } from "@/lib/billing";
import { trackEvent } from "@/lib/analytics";

interface Props {
  open: boolean;
  onClose: () => void;
  featureName?: string;
  description?: string;
  /** Stable identifiers for analytics; default to featureName / "upgrade_dialog". */
  analyticsFeature?: string;
  analyticsSource?: string;
}

export function UpgradeDialog({ open, onClose, featureName = "This feature", description, analyticsFeature, analyticsSource }: Props) {
  const { user, expectPlanChange } = useAuth();
  const [loading, setLoading] = useState(false);
  const body = description ?? "Turn your playlists into MP4s you can share anywhere, with 6 game imports a month on Rookie and unlimited on Pro. Cancel anytime.";

  useEffect(() => {
    if (open) trackEvent("upgrade_gate_hit", { feature: analyticsFeature ?? featureName });
  }, [open, featureName, analyticsFeature]);

  // Existing subscribers are routed to the billing portal instead of
  // Checkout — this dialog also fires on the Rookie import cap, and sending
  // those users to Checkout would open a second subscription.
  async function handleUpgrade() {
    setLoading(true);
    trackEvent("upgrade_clicked", { source: analyticsSource ?? "upgrade_dialog" });
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
        <div className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/12 text-primary">
            <Lock className="size-5" />
          </span>
          <DialogHeader>
            <DialogTitle>{featureName}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Not now
          </Button>
          <Button onClick={handleUpgrade} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            See plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
