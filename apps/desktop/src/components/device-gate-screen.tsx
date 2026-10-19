/**
 * Full-page remedy screen for the device hard cap (dark-launched — shown only
 * when touch_device returns a blocked verdict, i.e. app_config
 * device_gate_enabled is on). The blocked device has a valid session and RLS
 * self-read, just no registry row — so the device list loads and every listed
 * row is removable; freeing one slot and retrying unblocks in place.
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Lock } from "lucide-react";
import { StatusScreen } from "@/components/status-screen";
import { GroupedList } from "@/components/ui/group";
import { APP_ICON, lastActive } from "@/lib/devices-ui";
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
    <>
      <StatusScreen
        icon={<Lock />}
        title="Device limit reached"
        body={
          active.length > 0
            ? `Your account is signed in on ${active.length} devices. Remove one you no longer use to continue on this one.`
            : "Your account has reached its device limit. Remove a device you no longer use to continue on this one."
        }
        actions={
          <>
            <Button variant="outline" onClick={handleRetry} disabled={retrying}>
              {retrying && <Loader2 className="animate-spin" />}
              Try again
            </Button>
            <Button variant="ghost" onClick={handleSignOut}>
              Sign out
            </Button>
          </>
        }
      >
        {devices === null ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          active.length > 0 && (
            <GroupedList>
              {active.map((d) => {
                const Icon = APP_ICON[d.app] ?? Globe;
                return (
                  <div key={d.deviceId} className="flex min-h-12 items-center gap-3 px-4 py-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{d.deviceName ?? d.platform ?? "Unknown device"}</p>
                      <p className="text-callout text-muted-foreground">
                        {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
                      </p>
                    </div>
                    <Button variant="outline" size="xs" onClick={() => setConfirming(d)}>
                      Remove…
                    </Button>
                  </div>
                );
              })}
            </GroupedList>
          )
        )}
      </StatusScreen>

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
              {removing && <Loader2 className="animate-spin" />}
              Remove device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
