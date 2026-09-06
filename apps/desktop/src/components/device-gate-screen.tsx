/**
 * Full-page remedy screen for the device hard cap (dark-launched — shown only
 * when touch_device returns a blocked verdict, i.e. app_config
 * device_gate_enabled is on). The blocked device has a valid session and RLS
 * self-read, just no registry row — so the device list loads and every listed
 * row is removable; freeing one slot and retrying unblocks in place.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, Laptop, Loader2, Lock, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { listMyDevices, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

const APP_ICON = { web: Globe, desktop: Laptop, mobile: Smartphone } as const;

function lastActive(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DeviceGateScreen() {
  const { retryDeviceGate } = useAuth();
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [confirming, setConfirming] = useState<UserDevice | null>(null);
  const [removing, setRemoving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    listMyDevices(createClient())
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  useEffect(load, [load]);

  const active = devices ? partitionDevicesByActivity(devices).active : [];

  async function handleRemove(device: UserDevice) {
    setRemoving(true);
    try {
      await removeDevice(createClient(), device.deviceId);
      trackEvent("device_removed", { source: "gate", target_app: device.app });
      setConfirming(null);
      // A freed slot should unblock immediately — retry without ceremony.
      await retryDeviceGate();
      load();
    } catch {
      toast.error("Couldn't remove the device. Try again.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryDeviceGate();
      load();
    } finally {
      setRetrying(false);
    }
  }

  function handleSignOut() {
    trackEvent("device_gate_signed_out");
    void createClient().auth.signOut();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">Device limit reached</h1>
        <p className="text-sm text-muted-foreground">
          {active.length > 0
            ? `Your account is using ${active.length} devices. Remove one you no longer use to continue on this device.`
            : "Your account has reached its device limit. Remove a device you no longer use to continue on this one."}
        </p>
      </div>

      {devices === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        active.length > 0 && (
          <ul className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card p-4">
            {active.map((d) => {
              const Icon = APP_ICON[d.app] ?? Globe;
              return (
                <li key={d.deviceId} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {d.deviceName ?? d.platform ?? "Unknown device"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setConfirming(d)}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Checking…" : "Try again"}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>

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
    </div>
  );
}
