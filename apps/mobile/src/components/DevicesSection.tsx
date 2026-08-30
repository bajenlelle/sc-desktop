/**
 * Profile "Devices" section (anti-account-sharing v1) — mobile twin of the
 * web/desktop DevicesCard. Lists the account's registered devices and offers
 * "Sign out all other devices"; this device's push token is kept, all others
 * pruned (revoking refresh tokens alone doesn't stop notifications).
 */
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device-registry";
import { getCachedPushToken } from "@/lib/notifications";
import { Button } from "@/components/Button";
import {
  listMyDevices,
  pruneOtherPushTokens,
  type UserDevice,
} from "@scoutable/shared/lib/devices-db";

function lastActive(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const APP_LABEL: Record<UserDevice["app"], string> = {
  web: "Web",
  desktop: "Desktop",
  mobile: "Mobile",
};

export function DevicesSection() {
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [ownDeviceId, setOwnDeviceId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    listMyDevices(supabase)
      .then(setDevices)
      .catch(() => setDevices([]));
    getDeviceId().then(setOwnDeviceId);
  }, []);

  async function handleSignOutOthers() {
    setSigningOut(true);
    try {
      await pruneOtherPushTokens(supabase, getCachedPushToken());
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      Alert.alert(
        "Signed out everywhere else",
        "Other devices will be logged out the next time they're used."
      );
    } catch {
      Alert.alert("Something went wrong", "Couldn't sign out other devices. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (devices === null || devices.length === 0) return null;

  return (
    <View className="gap-3 rounded-xl border border-border dark:border-border-dark p-4">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
        Devices
      </Text>
      {devices.map((d) => (
        <View key={d.deviceId} className="flex-row items-center gap-3">
          <View className="min-w-0 flex-1">
            <Text
              numberOfLines={1}
              className="text-base text-foreground dark:text-foreground-dark"
            >
              {d.deviceName ?? d.platform ?? "Unknown device"}
            </Text>
            <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {APP_LABEL[d.app]} · Last active {lastActive(d.lastSeen)}
            </Text>
          </View>
          {d.deviceId === ownDeviceId && (
            <Text className="text-xs font-medium text-primary dark:text-primary-dark">
              This device
            </Text>
          )}
        </View>
      ))}
      {devices.length > 1 && (
        <Button
          title="Sign out all other devices"
          variant="outline"
          onPress={handleSignOutOthers}
          loading={signingOut}
        />
      )}
    </View>
  );
}
