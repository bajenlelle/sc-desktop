"use client";

/**
 * Profile "Devices" section (anti-account-sharing): shows the account's
 * registered devices split by 30-day activity (only active rows count toward
 * the device cap), offers per-device Remove, and keeps "Sign out all other
 * devices" — the owner's lever for evicting borrowed sessions. Push tokens
 * for evicted devices are pruned too (revoking refresh tokens alone doesn't
 * stop notifications).
 */
import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, LogOut, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { APP_ICON, lastActive } from "@/lib/devices-ui";
import { cn } from "@/lib/utils";
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

  useEffect(() => {
    load();
  }, [load]);

  async function handleSignOutOthers() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      // Web holds no push token — prune them all.
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

  async function handleRemove(d: UserDevice) {
    setRemoving(true);
    try {
      await removeDevice(createClient(), d.deviceId);
      trackEvent("device_removed", { source: "profile", target_app: d.app });
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

  function renderRow(d: UserDevice, muted: boolean) {
    const Icon = APP_ICON[d.app] ?? Globe;
    const isThis = d.deviceId === ownDeviceId;
    const name = d.deviceName ?? d.platform ?? "Unknown device";
    return (
      <div key={d.deviceId} className="flex min-h-12 items-center gap-3 px-4 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm", muted && "text-muted-foreground")}>{name}</p>
          <p className="text-callout text-muted-foreground">
            {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
          </p>
        </div>
        {isThis ? (
          <Badge variant="secondary">This device</Badge>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(d)}
            aria-label={`Remove ${name}`}
          >
            <MinusCircle />
          </Button>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-7">
      <div>
        <GroupHeader
          title="Devices"
          action={
            devices.length > 1 && (
              <Button variant="ghost" size="xs" className="text-primary" onClick={handleSignOutOthers} disabled={signingOut}>
                {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
                Sign out everywhere else
              </Button>
            )
          }
        />
        <GroupedList>{active.map((d) => renderRow(d, false))}</GroupedList>
      </div>
      {inactive.length > 0 && (
        <div>
          <GroupHeader title="Inactive devices" />
          <GroupedList>{inactive.map((d) => renderRow(d, true))}</GroupedList>
          <GroupFooter>Not used in the last 30 days, so they don&apos;t count toward your device limit.</GroupFooter>
        </div>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this device?</DialogTitle>
            <DialogDescription>
              {(confirming?.deviceName ?? confirming?.platform ?? "This device") +
                " loses access the next time it opens Scoutable."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={removing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirming && handleRemove(confirming)} disabled={removing}>
              {removing && <Loader2 className="animate-spin" />}
              Remove device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
