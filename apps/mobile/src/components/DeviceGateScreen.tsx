/**
 * Full-screen block the (app) layout swaps in when touch_device returns
 * blocked: the account's device cap is full and this device holds no slot.
 * Every listed device is removable — the blocked device has no row of its
 * own — and freeing a slot retries the touch; an ok verdict clears
 * deviceBlocked in auth-context, which unmounts this screen.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { themeColors } from "@/lib/theme";
import { signOutAndCleanup } from "@/lib/notifications";
import { Button } from "@/components/Button";
import { listMyDevices, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

const APP_ICON: Record<UserDevice["app"], keyof typeof Ionicons.glyphMap> = {
  web: "globe-outline",
  desktop: "desktop-outline",
  mobile: "phone-portrait-outline",
};

export function DeviceGateScreen() {
  const { retryDeviceGate } = useAuth();
  const colors = themeColors(useColorScheme());
  /** Active (slot-holding) devices only; null = still loading. */
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    listMyDevices(supabase)
      .then((all) => setDevices(partitionDevicesByActivity(all).active))
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRemove(d: UserDevice) {
    setRemovingId(d.deviceId);
    try {
      await removeDevice(supabase, d.deviceId);
      trackEvent("device_removed", { source: "gate", target_app: d.app });
      setDevices((prev) => prev?.filter((x) => x.deviceId !== d.deviceId) ?? prev);
      // On an ok verdict auth-context flips deviceBlocked and this unmounts.
      await retryDeviceGate();
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

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryDeviceGate();
      // Still blocked (and mounted): refresh who's holding the slots.
      load();
    } finally {
      setRetrying(false);
    }
  }

  function handleSignOut() {
    trackEvent("device_gate_signed_out");
    void signOutAndCleanup();
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-6 px-6 py-8">
        <View>
          <Ionicons name="lock-closed-outline" size={32} color={colors.mutedForeground} />
          <Text className="mt-3 font-heading text-4xl text-foreground dark:text-foreground-dark">
            Device limit reached
          </Text>
          <Text className="mt-2 text-base text-muted-foreground dark:text-muted-foreground-dark">
            {devices
              ? `Your account is using ${devices.length} ${devices.length === 1 ? "device" : "devices"}. Remove one you no longer use to continue on this device.`
              : "Remove a device you no longer use to continue on this device."}
          </Text>
        </View>

        {devices === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          devices.length > 0 && (
            <View className="gap-3 rounded-xl border border-border dark:border-border-dark p-4">
              {devices.map((d) => (
                <View key={d.deviceId} className="flex-row items-center gap-3">
                  <Ionicons name={APP_ICON[d.app]} size={20} color={colors.mutedForeground} />
                  <View className="min-w-0 flex-1">
                    <Text
                      numberOfLines={1}
                      className="text-base text-foreground dark:text-foreground-dark"
                    >
                      {d.deviceName ?? d.platform ?? "Unknown device"}
                    </Text>
                    <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {appKindLabel(d.app)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={removingId !== null}
                    onPress={() => confirmRemove(d)}
                    className="min-h-[32px] justify-center px-2 active:opacity-60"
                  >
                    {removingId === d.deviceId ? (
                      <ActivityIndicator size="small" color={colors.destructive} />
                    ) : (
                      <Text className="text-sm font-medium text-destructive dark:text-destructive-dark">
                        Remove
                      </Text>
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          )
        )}

        <View className="gap-3">
          <Button title="Try again" variant="outline" onPress={handleRetry} loading={retrying} />
          <Button title="Sign out" variant="ghost" onPress={handleSignOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
