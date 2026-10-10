/**
 * Full-screen block the (app) layout swaps in when touch_device returns
 * blocked: the account's device cap is full and this device holds no slot.
 * Every listed device is removable — the blocked device has no row of its
 * own — and freeing a slot retries the touch; an ok verdict clears
 * deviceBlocked in auth-context, which unmounts this screen.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useThemeColors } from "@/lib/theme-context";
import { signOutAndCleanup } from "@/lib/notifications";
import { Button } from "@/components/ui/Button";
import { GroupRow, GroupedList } from "@/components/ui/Group";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { listMyDevices, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

const APP_ICON: Record<UserDevice["app"], IconName> = { web: "web", desktop: "laptop", mobile: "phone" };

export function DeviceGateScreen() {
  const { retryDeviceGate } = useAuth();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
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
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }}
    >
      <View className="w-full items-center self-center" style={{ maxWidth: 440 }}>
        <View className="mb-4 h-12 w-12 items-center justify-center rounded-full bg-fill-1">
          <Icon name="lock" size={24} color={colors.mutedForeground} />
        </View>
        <Text variant="title2" accessibilityRole="header" className="text-center">
          Device limit reached
        </Text>
        <Text className="mt-1.5 text-center text-muted-foreground">
          {devices
            ? `Your account is using ${devices.length} ${devices.length === 1 ? "device" : "devices"}. Remove one you no longer use to continue on this device.`
            : "Remove a device you no longer use to continue on this device."}
        </Text>

        <View className="mt-6 w-full">
          {devices === null ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (
            devices.length > 0 && (
              <GroupedList>
                {devices.map((d) => {
                  const name = d.deviceName ?? d.platform ?? "Unknown device";
                  return (
                    <GroupRow
                      key={d.deviceId}
                      icon={APP_ICON[d.app] ?? "web"}
                      label={name}
                      description={appKindLabel(d.app)}
                      trailing={
                        removingId === d.deviceId ? (
                          <ActivityIndicator color={colors.destructive} />
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            textClassName="text-destructive"
                            disabled={removingId !== null}
                            accessibilityLabel={`Remove ${name}`}
                            onPress={() => confirmRemove(d)}
                          >
                            Remove
                          </Button>
                        )
                      }
                    />
                  );
                })}
              </GroupedList>
            )
          )}
        </View>

        <View className="mt-6 w-full gap-2">
          <Button variant="outline" onPress={handleRetry} loading={retrying}>
            Try again
          </Button>
          <Button variant="ghost" onPress={handleSignOut}>
            Sign out
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
