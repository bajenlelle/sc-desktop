/**
 * Profile "Devices" section (anti-account-sharing v1) — desktop twin of
 * apps/web/src/components/devices-card.tsx. Shows the account's registered
 * devices and offers "Sign out all other devices"; push tokens for evicted
 * devices are pruned too (revoking refresh tokens alone doesn't stop
 * notifications).
 */
import { useEffect, useState } from "react";
import { Globe, Laptop, LogOut, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/device-registry";
import { listMyDevices, pruneOtherPushTokens, type UserDevice } from "@scoutable/shared/lib/devices-db";

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
  const ownDeviceId = getDeviceId();

  useEffect(() => {
    listMyDevices(createClient())
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

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

  if (devices === null || devices.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Devices</h2>
        <ul className="space-y-3">
          {devices.map((d) => {
            const Icon = APP_ICON[d.app] ?? Globe;
            const isThis = d.deviceId === ownDeviceId;
            return (
              <li key={d.deviceId} className="flex items-center gap-3">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {d.deviceName ?? d.platform ?? "Unknown device"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last active {lastActive(d.lastSeen)}
                  </p>
                </div>
                {isThis && <Badge variant="secondary">This device</Badge>}
              </li>
            );
          })}
        </ul>
        {devices.length > 1 && (
          <Button variant="outline" size="sm" onClick={handleSignOutOthers} disabled={signingOut}>
            <LogOut className="mr-2 h-4 w-4" />
            {signingOut ? "Signing out…" : "Sign out all other devices"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
