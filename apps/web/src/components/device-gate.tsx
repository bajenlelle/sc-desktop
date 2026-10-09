"use client";

/**
 * Device-cap gate (anti-account-sharing v2). When touch_device returns
 * `blocked` this wrapper swaps the page content — the sidebar and tab bar
 * stay — for a resolve screen: the account's active devices, each removable,
 * plus retry and sign out. The blocked browser holds a session (RLS
 * self-read works) but NO registry row of its own, so every listed row is
 * safe to remove.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GroupedList } from "@/components/ui/group";
import { StatusScreen } from "@/components/status-screen";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { APP_ICON, lastActive } from "@/lib/devices-ui";
import { useAuth } from "@/components/auth-context";
import { listMyDevices, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

export function DeviceGate({ children }: { children: React.ReactNode }) {
  const { deviceBlocked } = useAuth();
  // device_gate_resolved must outlive the gate screen (it unmounts on
  // resolve), so the marker and the effect live on this always-mounted shell.
  const removedRef = useRef(false);
  useEffect(() => {
    if (!deviceBlocked && removedRef.current) {
      removedRef.current = false;
      trackEvent("device_gate_resolved");
    }
  }, [deviceBlocked]);

  if (!deviceBlocked) return <>{children}</>;
  return <GateScreen onRemoved={() => (removedRef.current = true)} />;
}

function GateScreen({ onRemoved }: { onRemoved: () => void }) {
  const router = useRouter();
  const { retryDeviceGate } = useAuth();
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<UserDevice | null>(null);
  const [removing, setRemoving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    listMyDevices(createClient())
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  const active = devices ? partitionDevicesByActivity(devices).active : [];

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryDeviceGate();
    } finally {
      setRetrying(false);
    }
  }

  async function handleRemove(d: UserDevice) {
    setRemoving(true);
    try {
      await removeDevice(createClient(), d.deviceId);
      trackEvent("device_removed", { source: "gate", target_app: d.app });
      setDevices((prev) => prev?.filter((x) => x.deviceId !== d.deviceId) ?? prev);
      setConfirmTarget(null);
      onRemoved();
      // A slot just freed up — retry immediately; on ok the gate unmounts.
      await retryDeviceGate();
    } catch {
      toast.error("Couldn't remove the device. Try again.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleSignOut() {
    trackEvent("device_gate_signed_out");
    await createClient().auth.signOut({ scope: "local" });
    router.push("/login");
  }

  return (
    <>
      <StatusScreen
        className="min-h-[calc(100dvh-var(--tab-bar-height))] pt-[calc(var(--safe-top)+3rem)]"
        icon={<Lock />}
        title="Device limit reached"
        body={
          active.length > 0
            ? `Your account is signed in on ${active.length} ${active.length === 1 ? "browser or device" : "browsers and devices"}. Remove one you no longer use to continue in this browser.`
            : "Your account has reached its device limit. Remove a device you no longer use to continue in this browser."
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
                    <Button variant="outline" size="xs" onClick={() => setConfirmTarget(d)} disabled={removing}>
                      Remove…
                    </Button>
                  </div>
                );
              })}
            </GroupedList>
          )
        )}
      </StatusScreen>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this device?</DialogTitle>
            <DialogDescription>
              {confirmTarget
                ? `${confirmTarget.deviceName ?? confirmTarget.platform ?? "This device"} will lose access the next time it opens Scoutable.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={removing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmTarget && handleRemove(confirmTarget)}
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
