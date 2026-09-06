/**
 * Profile "Devices" section (anti-account-sharing) — mobile twin of the
 * web/desktop DevicesCard. Lists the account's registered devices split at
 * the 30-day activity window (only active rows hold cap slots), offers
 * per-row Remove (self-service eviction), and "Sign out all other devices";
 * this device's push token is kept, all others pruned (revoking refresh
 * tokens alone doesn't stop notifications).
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { getDeviceId } from "@/lib/device-registry";
import { getCachedPushToken } from "@/lib/notifications";
import { Button } from "@/components/Button";
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

export function DevicesSection() {
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [ownDeviceId, setOwnDeviceId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await listMyDevices(supabase));
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
    getDeviceId().then(setOwnDeviceId);
  }, [load]);

  async function handleRemove(d: UserDevice) {
    setRemovingId(d.deviceId);
    try {
      await removeDevice(supabase, d.deviceId);
      trackEvent("device_removed", { source: "profile", target_app: d.app });
      await load();
    } catch {
      Alert.alert("Couldn't remove the device", "Try again.");
    } finally {
      setRemovingId(null);
    }
  }

  function confirmRemove(d: UserDevice) {
    const name = d.deviceName ?? d.platform ?? "Unknown device";
    Alert.alert(
      "Remove this device?",
      `${name} will lose access the next time it opens Scoutable.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void handleRemove(d) },
      ]
    );
  }

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

  const { active, inactive } = partitionDevicesByActivity(devices);

  const renderRow = (d: UserDevice, dimmed: boolean) => (
    <View key={d.deviceId} className={`flex-row items-center gap-3 ${dimmed ? "opacity-50" : ""}`}>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-base text-foreground dark:text-foreground-dark">
          {d.deviceName ?? d.platform ?? "Unknown device"}
        </Text>
        <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
        </Text>
      </View>
      {d.deviceId === ownDeviceId ? (
        <Text className="text-xs font-medium text-primary dark:text-primary-dark">
          This device
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={removingId !== null}
          onPress={() => confirmRemove(d)}
          className="min-h-[32px] justify-center px-2 active:opacity-60"
        >
          <Text className="text-sm font-medium text-destructive dark:text-destructive-dark">
            {removingId === d.deviceId ? "Removing…" : "Remove"}
          </Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View className="gap-3 rounded-xl border border-border dark:border-border-dark p-4">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
        Devices
      </Text>
      {active.map((d) => renderRow(d, false))}
      {inactive.length > 0 && (
        <>
          <View className="mt-1">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
              Inactive
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Not used in the last 30 days — these don't count toward your device limit.
            </Text>
          </View>
          {inactive.map((d) => renderRow(d, true))}
        </>
      )}
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
