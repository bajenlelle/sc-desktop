"use client";

/**
 * Device-cap gate (anti-account-sharing v2). When touch_device returns
 * `blocked` this wrapper swaps the page content — navbar stays — for a
 * resolve screen: the account's active devices, each removable, plus retry
 * and sign out. The blocked browser holds a session (RLS self-read works)
 * but NO registry row of its own, so every listed row is safe to remove.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Laptop, Lock, Smartphone } from "lucide-react";
import { toast } from "sonner";
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
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/components/auth-context";
import { listMyDevices, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

const APP_ICON = {
  web: Globe,
  desktop: Laptop,
  mobile: Smartphone,
} as const;

function lastActive(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-muted p-3">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-foreground">Device limit reached</h1>
              <p className="text-sm text-muted-foreground">
                {devices === null
                  ? "Your account has reached its device limit. Remove a device you no longer use to continue in this browser."
                  : `Your account is using ${active.length} ${active.length === 1 ? "browser or device" : "browsers and devices"}. Remove one you no longer use to continue in this browser.`}
              </p>
            </div>
          </div>

          {devices === null ? (
            <p className="text-center text-sm text-muted-foreground">Loading devices…</p>
          ) : (
            <ul className="space-y-3">
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmTarget(d)}
                      disabled={removing}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? "Checking…" : "Try again"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

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
              {removing ? "Removing…" : "Remove device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
