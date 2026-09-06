/**
 * Profile "Devices" section — desktop twin of
 * apps/web/src/components/devices-card.tsx. Lists the account's registered
 * devices (split at the cap's 30-day activity window), offers per-device
 * Remove (registry-row eviction — the removed device gets gated on its next
 * boot once the hard cap is on) and "Sign out all other devices" (a different
 * lever: kills sessions, not rows; evicted push tokens are pruned too).
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, Laptop, LogOut, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/device-registry";
import { trackEvent } from "@/lib/analytics";
import {
  listMyDevices,
  pruneOtherPushTokens,
  removeDevice,
  type UserDevice,
} from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

function lastActive(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const APP_ICON = {
  web: Globe,
  desktop: Laptop,
  mobile: Smartphone,
} as const;

export function DevicesCard() {
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [confirming, setConfirming] = useState<UserDevice | null>(null);
  const [removing, setRemoving] = useState(false);
  const ownDeviceId = getDeviceId();

  const load = useCallback(() => {
    listMyDevices(createClient())
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  useEffect(load, [load]);

  async function handleSignOutOthers() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      // Desktop holds no push token — prune them all.
      await pruneOtherPushTokens(supabase, null);
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Signed out everywhere else", {
        description: "Other devices will be logged out the next time they're used.",
      });
    } catch {
      toast.error("Couldn't sign out other devices. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleRemove(device: UserDevice) {
    setRemoving(true);
    try {
      await removeDevice(createClient(), device.deviceId);
      trackEvent("device_removed", { source: "profile", target_app: device.app });
      setConfirming(null);
      load();
    } catch {
      toast.error("Couldn't remove the device. Try again.");
    } finally {
      setRemoving(false);
    }
  }

  if (devices === null || devices.length === 0) return null;

  const { active, inactive } = partitionDevicesByActivity(devices);

  const renderRow = (d: UserDevice, muted: boolean) => {
    const Icon = APP_ICON[d.app] ?? Globe;
    const isThis = d.deviceId === ownDeviceId;
    return (
      <li key={d.deviceId} className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}>
            {d.deviceName ?? d.platform ?? "Unknown device"}
          </p>
          <p className="text-xs text-muted-foreground">
            {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
          </p>
        </div>
        {isThis ? (
          <Badge variant="secondary">This device</Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => setConfirming(d)}
            aria-label={`Remove ${d.deviceName ?? d.platform ?? "device"}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </li>
    );
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Devices</h2>
        <ul className="space-y-3">{active.map((d) => renderRow(d, false))}</ul>
        {inactive.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Inactive</p>
              <p className="text-xs text-muted-foreground">
                Not used in the last 30 days — these don&apos;t count toward your device limit.
              </p>
            </div>
            <ul className="space-y-3">{inactive.map((d) => renderRow(d, true))}</ul>
          </div>
        )}
        {devices.length > 1 && (
          <Button variant="outline" size="sm" onClick={handleSignOutOthers} disabled={signingOut}>
            <LogOut className="mr-2 h-4 w-4" />
            {signingOut ? "Signing out…" : "Sign out all other devices"}
          </Button>
        )}
      </CardContent>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this device?</DialogTitle>
            <DialogDescription>
              {(confirming?.deviceName ?? confirming?.platform ?? "This device") +
                " will lose access the next time it opens Scoutable."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={removing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirming && handleRemove(confirming)}
              disabled={removing}
            >
              {removing ? "Removing…" : "Remove device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
