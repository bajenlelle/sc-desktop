/**
 * Profile › Devices (anti-account-sharing; the web's DevicesCard): one group
 * of the account's registered devices, the ones idle for 30 days in muted
 * text (only active ones hold a slot), each removable, and "Sign out
 * everywhere else" as the group's last row, which keeps this device's push
 * token and prunes the others (revoking refresh tokens alone doesn't stop
 * notifications).
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { getDeviceId } from "@/lib/device-registry";
import { getCachedPushToken } from "@/lib/notifications";
import { formatDate } from "@/lib/format";
import { useThemeColors } from "@/lib/theme-context";
import { GroupFooter, GroupHeader, GroupRow, GroupedList } from "@/components/ui/Group";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { listMyDevices, pruneOtherPushTokens, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

const APP_ICON: Record<string, IconName> = { desktop: "laptop", mobile: "phone", web: "web" };

function lastActive(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  // In English like the rest of the app, with the year once it isn't this one.
  return formatDate(d, d.getFullYear() === new Date().getFullYear() ? "short" : "medium");
}

export function DevicesSection() {
  const colors = useThemeColors();
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
    Alert.alert("Remove this device?", `${name} will lose access the next time it opens Scoutable.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void handleRemove(d) },
    ]);
  }

  async function handleSignOutOthers() {
    setSigningOut(true);
    try {
      await pruneOtherPushTokens(supabase, getCachedPushToken());
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      Alert.alert("Signed out everywhere else", "Other devices will be logged out the next time they're used.");
    } catch {
      Alert.alert("Something went wrong", "Couldn't sign out other devices. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (devices === null || devices.length === 0) return null;

  const { active, inactive } = partitionDevicesByActivity(devices);

  const renderRow = (d: UserDevice, muted: boolean) => {
    const name = d.deviceName ?? d.platform ?? "Unknown device";
    const isThis = d.deviceId === ownDeviceId;
    return (
      <View key={d.deviceId} className="min-h-12 flex-row items-center gap-3 px-4 py-2">
        <Icon name={APP_ICON[d.app] ?? "web"} size={18} color={colors.mutedForeground} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className={muted ? "text-muted-foreground" : undefined}>
            {name}
          </Text>
          <Text variant="subheadline" className="text-muted-foreground">
            {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
          </Text>
        </View>
        {isThis ? (
          <Text variant="subheadline" className="text-muted-foreground">
            This device
          </Text>
        ) : removingId === d.deviceId ? (
          <ActivityIndicator color={colors.mutedForeground} />
        ) : (
          <Tappable
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name}`}
            disabled={removingId !== null}
            onPress={() => confirmRemove(d)}
            hitSlop={8}
            className="h-8 w-8 items-center justify-center"
          >
            <Icon name="removeCircle" size={19} color={colors.mutedForeground} />
          </Tappable>
        )}
      </View>
    );
  };

  return (
    <View>
      <GroupHeader title="Devices" />
      <GroupedList inset={46}>
        {active.map((d) => renderRow(d, false))}
        {inactive.map((d) => renderRow(d, true))}
        {devices.length > 1 ? (
          <GroupRow
            label={<Text className="text-primary">{signingOut ? "Signing out…" : "Sign out everywhere else"}</Text>}
            disabled={signingOut}
            onPress={handleSignOutOthers}
            accessibilityLabel="Sign out everywhere else"
          />
        ) : null}
      </GroupedList>
      <GroupFooter>Devices not used in the last 30 days don&apos;t count toward your device limit.</GroupFooter>
    </View>
  );
}
